"""
tests/test_constraints.py

TDD: verify the four new uniqueness rules added in Part 2 of the schema-
hardening migration.  Every test uses the SQLite `session` fixture from
conftest.py — Base.metadata.create_all builds partial indexes from model
metadata so the constraints are enforced in-process without Postgres.

Rules under test:
  1. SupplierCap — uq_supplier_cap_effective  (supplier_id, effective_from)
  2. PaymentPlanLine — uq_plan_line_supplier   (payment_plan_id, supplier_id)
  3. ScenarioAdjustment — uq_scenario_adj_all_months  (partial: year_month IS NULL)
  4. Scenario — uq_one_baseline_scenario       (partial: is_baseline = true)
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import models


# ---------------------------------------------------------------------------
# Helpers — minimal parent rows
# ---------------------------------------------------------------------------

def _make_supplier(session, *, account_id: int = 1) -> models.Supplier:
    s = models.Supplier(account_id=account_id, name="Test Supplier")
    session.add(s)
    session.flush()
    return s


def _make_scenario(session, *, name: str = "test", is_baseline: bool = False) -> models.Scenario:
    sc = models.Scenario(name=name, is_baseline=is_baseline)
    session.add(sc)
    session.flush()
    return sc


def _make_payment_plan(session, scenario_id: int, *, year_month: str = "2026-01") -> models.PaymentPlan:
    pp = models.PaymentPlan(
        year_month=year_month,
        scenario_id=scenario_id,
        pool_for_suppliers_m=0,
        reserve_m=0,
        status="draft",
    )
    session.add(pp)
    session.flush()
    return pp


# ---------------------------------------------------------------------------
# 1. SupplierCap — uq_supplier_cap_effective
# ---------------------------------------------------------------------------

def test_supplier_cap_duplicate_effective_from_rejected(session):
    """Two SupplierCap rows with same (supplier_id, effective_from) → IntegrityError."""
    supplier = _make_supplier(session)
    eff = date(2026, 1, 1)

    session.add(models.SupplierCap(
        supplier_id=supplier.id,
        effective_from=eff,
        monthly_cap_m=10,
        plan_low_m=5,
        plan_high_m=15,
        user_monthly_m=10,
    ))
    session.flush()

    session.add(models.SupplierCap(
        supplier_id=supplier.id,
        effective_from=eff,   # same date → duplicate
        monthly_cap_m=20,
        plan_low_m=10,
        plan_high_m=25,
        user_monthly_m=20,
    ))
    with pytest.raises(IntegrityError):
        session.flush()


def test_supplier_cap_different_effective_from_allowed(session):
    """Different effective_from dates for the same supplier are fine."""
    supplier = _make_supplier(session)

    session.add(models.SupplierCap(
        supplier_id=supplier.id, effective_from=date(2026, 1, 1),
        monthly_cap_m=10, plan_low_m=5, plan_high_m=15, user_monthly_m=10,
    ))
    session.add(models.SupplierCap(
        supplier_id=supplier.id, effective_from=date(2026, 2, 1),
        monthly_cap_m=20, plan_low_m=5, plan_high_m=25, user_monthly_m=20,
    ))
    session.flush()   # must not raise


# ---------------------------------------------------------------------------
# 2. PaymentPlanLine — uq_plan_line_supplier
# ---------------------------------------------------------------------------

def test_payment_plan_line_duplicate_supplier_rejected(session):
    """Two PaymentPlanLine rows with same (payment_plan_id, supplier_id) → IntegrityError."""
    sc = _make_scenario(session)
    pp = _make_payment_plan(session, sc.id)
    supplier = _make_supplier(session)

    session.add(models.PaymentPlanLine(
        payment_plan_id=pp.id, supplier_id=supplier.id,
        planned_m=10, cap_applied_m=10, allocated_m=10, actual_paid_m=0, variance_m=10,
    ))
    session.flush()

    session.add(models.PaymentPlanLine(
        payment_plan_id=pp.id, supplier_id=supplier.id,  # duplicate
        planned_m=20, cap_applied_m=20, allocated_m=20, actual_paid_m=0, variance_m=20,
    ))
    with pytest.raises(IntegrityError):
        session.flush()


def test_payment_plan_line_different_supplier_allowed(session):
    """Same plan but different suppliers is fine."""
    sc = _make_scenario(session)
    pp = _make_payment_plan(session, sc.id)
    s1 = _make_supplier(session, account_id=1)
    s2 = _make_supplier(session, account_id=2)

    session.add(models.PaymentPlanLine(
        payment_plan_id=pp.id, supplier_id=s1.id,
        planned_m=10, cap_applied_m=10, allocated_m=10, actual_paid_m=0, variance_m=10,
    ))
    session.add(models.PaymentPlanLine(
        payment_plan_id=pp.id, supplier_id=s2.id,
        planned_m=20, cap_applied_m=20, allocated_m=20, actual_paid_m=0, variance_m=20,
    ))
    session.flush()   # must not raise


# ---------------------------------------------------------------------------
# 3. ScenarioAdjustment — partial unique: year_month IS NULL (all-months case)
# ---------------------------------------------------------------------------

def test_scenario_adjustment_null_year_month_duplicate_rejected(session):
    """Two ScenarioAdjustment rows with same (scenario_id, series_key, year_month=NULL) → IntegrityError."""
    sc = _make_scenario(session)

    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month=None, adjust_pct=5,
    ))
    session.flush()

    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month=None,  # duplicate all-months
        adjust_pct=10,
    ))
    with pytest.raises(IntegrityError):
        session.flush()


def test_scenario_adjustment_non_null_year_month_duplicate_rejected(session):
    """Two ScenarioAdjustment rows with same (scenario_id, series_key, year_month='2026-01') → IntegrityError."""
    sc = _make_scenario(session)

    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month="2026-01", adjust_pct=5,
    ))
    session.flush()

    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month="2026-01",  # duplicate
        adjust_pct=10,
    ))
    with pytest.raises(IntegrityError):
        session.flush()


def test_scenario_adjustment_null_and_non_null_allowed(session):
    """NULL year_month row and a specific year_month row for same key can coexist."""
    sc = _make_scenario(session)

    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month=None, adjust_pct=5,
    ))
    session.add(models.ScenarioAdjustment(
        scenario_id=sc.id, series_key="cash_in", year_month="2026-01", adjust_pct=10,
    ))
    session.flush()   # must not raise


# ---------------------------------------------------------------------------
# 4. Scenario — uq_one_baseline_scenario (partial: is_baseline = true)
# ---------------------------------------------------------------------------

def test_second_baseline_scenario_rejected(session):
    """Two Scenario rows with is_baseline=True → IntegrityError."""
    session.add(models.Scenario(name="baseline-1", is_baseline=True))
    session.flush()

    session.add(models.Scenario(name="baseline-2", is_baseline=True))
    with pytest.raises(IntegrityError):
        session.flush()


def test_multiple_non_baseline_scenarios_allowed(session):
    """Multiple Scenario rows with is_baseline=False are fine."""
    session.add(models.Scenario(name="pessimistic", is_baseline=False))
    session.add(models.Scenario(name="optimistic", is_baseline=False))
    session.flush()   # must not raise


def test_one_baseline_one_non_baseline_allowed(session):
    """One baseline + one non-baseline scenario is fine."""
    session.add(models.Scenario(name="base", is_baseline=True))
    session.add(models.Scenario(name="alt", is_baseline=False))
    session.flush()   # must not raise
