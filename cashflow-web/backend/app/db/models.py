"""
SQLAlchemy 2.x ORM models for the cashflow-web backend.
20 tables: 8 analytical (§3.1) + 12 application (§3.2).

Rules applied throughout:
- Mapped[...] + mapped_column(...) everywhere.
- Money columns: annotated Mapped[Decimal] (Postgres returns decimal.Decimal),
  column type Numeric, default=0 unless explicitly nullable.
- DateTime(timezone=True) for all timestamps; default=lambda: datetime.now(timezone.utc).
- Python-side default= only (no server_default).
- JSON().with_variant(JSONB, "postgresql") for JSON columns.
- created_by / acknowledged_by / user_id FKs are nullable integers (ETL/seed writes
  before any interactive user exists — spec-consistent, intentional).
- Surrogate PKs are Integer, EXCEPT etl_runs.id which is BigInteger (bigserial per
  spec §3.1 — the high-churn ETL run log).
- No relationships(), no back_populates, no __repr__, no business logic.
"""

from decimal import Decimal
from datetime import datetime, timezone, date
from sqlalchemy import (
    String, Integer, BigInteger, Numeric, Boolean, Date, DateTime,
    Text, JSON, ForeignKey, UniqueConstraint, Index, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


# ---------------------------------------------------------------------------
# Analytical tables (§3.1)
# ---------------------------------------------------------------------------

class EtlRun(Base):
    __tablename__ = "etl_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    source_max_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rows_loaded: Mapped[int] = mapped_column(Integer, default=0)
    usd_rate_used: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    opening_cash_m: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    reconciliation_residual_m: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    source_tz: Mapped[str | None] = mapped_column(Text, nullable=True)


class MonthlyCashflow(Base):
    __tablename__ = "monthly_cashflow"

    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)
    cash_in_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_suppliers_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_drawings_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_refunds_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_purchases_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_salaries_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_other_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_siyrafa_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    internal_transfers_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_total_operational_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    out_total_comprehensive_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    net_operating_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    net_total_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    cash_running_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    bond_count: Mapped[int] = mapped_column(Integer, default=0)
    fiscal_year: Mapped[str] = mapped_column(String(9), nullable=False)


class PerSupplierMonthly(Base):
    __tablename__ = "per_supplier_monthly"

    supplier_account_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)
    paid_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    paid_iqd_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    paid_usd_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    recv_m: Mapped[Decimal] = mapped_column(Numeric, default=0)


class BalancesSnapshot(Base):
    __tablename__ = "balances_snapshot"

    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    currency_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    balance_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    balance_iqd_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    last_active: Mapped[date | None] = mapped_column(Date, nullable=True)


class InstallmentsSummary(Base):
    __tablename__ = "installments_summary"

    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    premium_count: Mapped[int] = mapped_column(Integer, default=0)
    face_total_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    cash_paid_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    discount_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    remaining_m: Mapped[Decimal] = mapped_column(Numeric, default=0)


class InstallmentsAging(Base):
    __tablename__ = "installments_aging"

    snapshot_date: Mapped[date] = mapped_column(Date, primary_key=True)
    bucket_key: Mapped[str] = mapped_column(String(16), primary_key=True)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    count: Mapped[int] = mapped_column(Integer, default=0)


class SeasonalIndex(Base):
    __tablename__ = "seasonal_index"

    series_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    fm_pos: Mapped[int] = mapped_column(Integer, primary_key=True)
    avg_value_m: Mapped[Decimal] = mapped_column(Numeric, default=0)


class ForecastBase(Base):
    __tablename__ = "forecast_base"

    series_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)
    engine: Mapped[str] = mapped_column(String(16), primary_key=True)
    value_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    cagr: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    mape: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)


# ---------------------------------------------------------------------------
# Application tables (§3.2)
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class SupplierCap(Base):
    __tablename__ = "supplier_caps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id"), nullable=False
    )
    monthly_cap_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    plan_low_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    plan_high_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    user_monthly_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Assumption(Base):
    __tablename__ = "assumptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # nullable FK: NULL means the single global row; non-NULL means per-scenario
    scenario_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("scenarios.id"), nullable=True
    )
    usd_rate: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    unexpected_reserve_m: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    income_growth_pct: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    in_growth_factor: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    out_growth_factor: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    cagr_floor: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    cagr_cap: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    forecast_horizon: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fiscal_year_start_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    forecast_engine: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        # Enforce exactly ONE global row (scenario_id IS NULL).
        # An ordinary UNIQUE on scenario_id would NOT prevent multiple NULLs in
        # Postgres (NULLs are considered distinct), so we use a partial index on
        # the boolean expression instead.
        Index(
            "uq_assumptions_global",
            text("(scenario_id IS NULL)"),
            unique=True,
            postgresql_where=text("scenario_id IS NULL"),
            sqlite_where=text("scenario_id IS NULL"),
        ),
        # Enforce at most one row per scenario.
        Index(
            "uq_assumptions_per_scenario",
            "scenario_id",
            unique=True,
            postgresql_where=text("scenario_id IS NOT NULL"),
            sqlite_where=text("scenario_id IS NOT NULL"),
        ),
    )


class ScenarioAdjustment(Base):
    __tablename__ = "scenario_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scenario_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("scenarios.id"), nullable=False
    )
    series_key: Mapped[str] = mapped_column(String(32), nullable=False)
    adjust_pct: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    override_value_m: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    year_month: Mapped[str | None] = mapped_column(String(7), nullable=True)


class PaymentPlan(Base):
    __tablename__ = "payment_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year_month: Mapped[str] = mapped_column(String(7), nullable=False)
    scenario_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("scenarios.id"), nullable=False
    )
    pool_for_suppliers_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    reserve_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # Both columns are NOT NULL, so a plain UNIQUE suffices (no partial-index
        # NULL handling needed, unlike assumptions above): one plan per month+scenario.
        UniqueConstraint("year_month", "scenario_id", name="uq_plan_month_scenario"),
    )


class PaymentPlanLine(Base):
    __tablename__ = "payment_plan_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_plan_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_plans.id"), nullable=False
    )
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id"), nullable=False
    )
    planned_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    cap_applied_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    allocated_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    actual_paid_m: Mapped[Decimal] = mapped_column(Numeric, default=0)
    variance_m: Mapped[Decimal] = mapped_column(Numeric, default=0)


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_key: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_type: Mapped[str] = mapped_column(String(24), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(8), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    status: Mapped[str] = mapped_column(String(12), default="new")
    acknowledged_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AppSettings(Base):
    # Single-row table: the application keeps exactly one row with id=1.
    # No CHECK constraint on id to avoid Alembic autogenerate drift.
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accent: Mapped[str | None] = mapped_column(String(16), nullable=True)
    show_alert: Mapped[bool] = mapped_column(Boolean, default=True)
    neg_threshold_m: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    over_cap_warn: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_json: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    after_json: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
