import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from app.db import models

EXPECTED_TABLES = {
    "etl_runs","monthly_cashflow","per_supplier_monthly","balances_snapshot",
    "installments_summary","installments_aging","seasonal_index","forecast_base",
    "users","suppliers","supplier_caps","scenarios","assumptions",
    "scenario_adjustments","payment_plans","payment_plan_lines","notes","alerts",
    "app_settings","audit_log",
}

def test_all_tables_created(session):
    names = set(inspect(session.bind).get_table_names())
    assert EXPECTED_TABLES.issubset(names)

def test_payment_plan_unique_month_scenario(session):
    sc = models.Scenario(name="base", kind="base", is_baseline=True); session.add(sc); session.flush()
    session.add(models.PaymentPlan(year_month="2026-05", scenario_id=sc.id, pool_for_suppliers_m=0, reserve_m=15, status="draft")); session.commit()
    session.add(models.PaymentPlan(year_month="2026-05", scenario_id=sc.id, pool_for_suppliers_m=0, reserve_m=15, status="draft"))
    with pytest.raises(IntegrityError):
        session.commit()
