"""
app/api/schemas.py
==================
Pydantic response models for all cashflow-web read endpoints.

All money values are float (Decimal cast at the router level).
All timestamps are ISO-format strings (serialized by Pydantic from datetime).
Keys are snake_case throughout — the React client maps these to its own names.

Reuse guide for later tasks:
  C2 (suppliers)      → import SupplierOut, SupplierCapOut (add here)
  C3 (forecast)       → import ForecastPointOut (add here)
  settings PATCH      → import AssumptionOut (add here)
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ---------------------------------------------------------------------------
# Shared config: allow ORM objects to be passed directly
# ---------------------------------------------------------------------------

class _OrmBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# /api/meta sub-models
# ---------------------------------------------------------------------------

class LastEtlOut(_OrmBase):
    """Summary of the latest ETL run row."""
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    rows_loaded: int
    reconciliation_residual_m: Optional[float]


class MetaResponse(BaseModel):
    """Response model for GET /api/meta."""
    usd_rate: float
    current_cash_m: float
    reserve_m: float
    fy_start: int
    last_etl: Optional[LastEtlOut]


# ---------------------------------------------------------------------------
# /api/dashboard sub-models
# ---------------------------------------------------------------------------

class FyTotal(BaseModel):
    """One fiscal year's aggregated totals."""
    fiscal_year: str
    in_m: float
    out_m: float
    net_m: float


class InstallmentsSummaryOut(_OrmBase):
    """Latest installments snapshot."""
    premium_count: int
    face_total_m: float
    cash_paid_m: float
    discount_m: float
    remaining_m: float


class AlertOut(_OrmBase):
    """Active alert row."""
    id: int
    alert_type: str
    severity: Optional[str]
    title: str
    body: Optional[str]
    related_key: Optional[str]
    status: str
    generated_at: datetime


class MonthlyPoint(_OrmBase):
    """Single month in the dashboard line-chart series."""
    year_month: str
    cash_in_m: float
    out_total_comprehensive_m: float
    net_total_m: float
    cash_running_m: float


class ExpenseMix(BaseModel):
    """Expense-category totals over the full historical window."""
    out_suppliers_m: float
    out_drawings_m: float
    out_refunds_m: float
    out_purchases_m: float
    out_salaries_m: float
    out_siyrafa_m: float
    out_other_m: float


class DashboardResponse(BaseModel):
    """Response model for GET /api/dashboard."""
    fy_totals: list[FyTotal]
    net_decline_pct: float
    installments: Optional[InstallmentsSummaryOut]
    alerts: list[AlertOut]
    monthly_series: list[MonthlyPoint]
    expense_mix: ExpenseMix


# ---------------------------------------------------------------------------
# /api/cashflow/monthly  (C2)
# ---------------------------------------------------------------------------

class CashflowMonthPoint(BaseModel):
    """One month in the cashflow series — perspective-aware out/net."""
    year_month: str
    cash_in_m: float
    out_total_m: float
    net_total_m: float
    cash_running_m: float
    fiscal_year: str


class ForecastPoint(BaseModel):
    """One forecast month — perspective-aware out/net."""
    year_month: str
    cash_in_m: float
    out_total_m: float
    net_total_m: float


class CashflowByFiscalYear(BaseModel):
    """Aggregated totals per fiscal year."""
    fiscal_year: str
    in_m: float
    out_m: float
    net_m: float


class CashflowMonthlyResponse(BaseModel):
    """Response for GET /api/cashflow/monthly."""
    months: list[CashflowMonthPoint]
    forecast: list[ForecastPoint]
    by_fiscal_year: list[CashflowByFiscalYear]


# ---------------------------------------------------------------------------
# /api/breakdown  (C2)
# ---------------------------------------------------------------------------

class ExpenseCatMonthly(BaseModel):
    """One month entry in an expense category's monthly series."""
    year_month: str
    amount_m: float


class ExpenseCatOut(BaseModel):
    """One expense category with totals + monthly series."""
    key: str
    total_m: float
    monthly: list[ExpenseCatMonthly]


class BalanceEntryOut(BaseModel):
    """One account's balance (partner, fund, or debtor)."""
    account_id: int
    name: str
    balance_m: float


class BreakdownResponse(BaseModel):
    """Response for GET /api/breakdown."""
    expense_cats: list[ExpenseCatOut]
    partners: list[BalanceEntryOut]
    funds: list[BalanceEntryOut]


# ---------------------------------------------------------------------------
# /api/suppliers  (C2)
# ---------------------------------------------------------------------------

class SupplierOut(BaseModel):
    """One supplier entry."""
    id: int          # account_id (mirrors data.js)
    name: str
    cap: float
    currency: str
    monthly: list[float]
    over_cap: int
    balance_m: float
    util: Optional[float]
    active: bool


class SuppliersResponse(BaseModel):
    """Response for GET /api/suppliers."""
    suppliers: list[SupplierOut]


# ---------------------------------------------------------------------------
# /api/installments  (C2)
# ---------------------------------------------------------------------------

class AgingBucketOut(BaseModel):
    """One aging bucket."""
    bucket_key: str
    label: str
    amount_m: float
    count: int


class InstallmentsResponse(BaseModel):
    """Response for GET /api/installments."""
    summary: Optional[InstallmentsSummaryOut]
    aging: list[AgingBucketOut]
    top_debtors: list[BalanceEntryOut]


# ---------------------------------------------------------------------------
# /api/forecast  (C3)
# ---------------------------------------------------------------------------

class ScenarioValues(BaseModel):
    """Per-scenario in/out/net for a single forecast month."""
    in_m: float
    out_m: float
    net_m: float


class ForecastMonthPoint(BaseModel):
    """One forecast month with all three scenario projections."""
    year_month: str
    base: ScenarioValues
    opt: ScenarioValues
    pess: ScenarioValues


class ScenarioTotals(BaseModel):
    """Aggregated totals for one scenario over the full horizon."""
    in_m: float
    out_m: float
    net_m: float
    end_cash_m: float
    min_cash_m: float


class ScenarioMeta(BaseModel):
    """Metadata for a single scenario."""
    label: str
    in_g: float
    out_g: float


class ForecastResponse(BaseModel):
    """Response for GET /api/forecast."""
    forecast: list[ForecastMonthPoint]
    cash_paths: dict[str, list[float]]   # base/opt/pess → running cash list
    fc_totals: dict[str, ScenarioTotals] # base/opt/pess → totals
    scenarios: dict[str, ScenarioMeta]   # base/opt/pess → metadata
    mape: Optional[float]
    confidence: Optional[str]


# ---------------------------------------------------------------------------
# D1: Write endpoint schemas
# ---------------------------------------------------------------------------

# --- Supplier caps ---

class CapCreate(BaseModel):
    """Body for POST /api/suppliers/{account_id}/caps."""
    monthly_cap_m: float = Field(ge=0)
    effective_from: date
    plan_low_m: float = Field(default=0.0, ge=0)
    plan_high_m: float = Field(default=0.0, ge=0)
    user_monthly_m: float = Field(default=0.0, ge=0)

    @model_validator(mode="after")
    def _check_plan_range(self) -> "CapCreate":
        low = self.plan_low_m
        high = self.plan_high_m
        if low > 0 and high > 0 and low > high:
            raise ValueError("plan_low_m must be ≤ plan_high_m")
        return self


class CapOut(BaseModel):
    """Response for a created SupplierCap row."""
    id: int
    supplier_id: int
    monthly_cap_m: float
    plan_low_m: float
    plan_high_m: float
    user_monthly_m: float
    effective_from: date
    created_by: Optional[int]


# --- Scenarios ---

class ScenarioCreate(BaseModel):
    """Body for POST /api/scenarios."""
    name: str
    kind: Optional[str] = None
    is_baseline: bool = False
    description: Optional[str] = None


class ScenarioUpdate(BaseModel):
    """Body for PUT /api/scenarios/{id} — all fields optional."""
    name: Optional[str] = None
    kind: Optional[str] = None
    is_baseline: Optional[bool] = None
    description: Optional[str] = None


class ScenarioOut(BaseModel):
    """Response shape for a Scenario row."""
    id: int
    name: str
    kind: Optional[str]
    is_baseline: bool
    description: Optional[str]


# --- Assumptions ---

class AssumptionUpdate(BaseModel):
    """Body for PUT /api/scenarios/{id}/assumptions — all fields optional."""
    usd_rate: Optional[float] = Field(default=None, ge=0)
    unexpected_reserve_m: Optional[float] = Field(default=None, ge=0)
    income_growth_pct: Optional[float] = None
    in_growth_factor: Optional[float] = None
    out_growth_factor: Optional[float] = None
    cagr_floor: Optional[float] = None
    cagr_cap: Optional[float] = None
    forecast_horizon: Optional[int] = Field(default=None, ge=1)
    fiscal_year_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    forecast_engine: Optional[str] = None


class AssumptionOut(BaseModel):
    """Response shape for an Assumption row."""
    id: int
    scenario_id: Optional[int]
    usd_rate: Optional[float]
    unexpected_reserve_m: Optional[float]
    income_growth_pct: Optional[float]
    in_growth_factor: Optional[float]
    out_growth_factor: Optional[float]
    cagr_floor: Optional[float]
    cagr_cap: Optional[float]
    forecast_horizon: Optional[int]
    fiscal_year_start_month: Optional[int]
    forecast_engine: Optional[str]


# ---------------------------------------------------------------------------
# /api/supplier-plan  (C3)
# ---------------------------------------------------------------------------

class AllocEntry(BaseModel):
    """One supplier's allocation in the monthly plan."""
    id: int
    name: str
    currency: str
    allocated_m: float
    actual_paid_m: Optional[float] = None


class SupplierPlanResponse(BaseModel):
    """Response for GET /api/supplier-plan."""
    month: str
    pool_m: float
    alloc: list[AllocEntry]
    leftover_m: float


# ---------------------------------------------------------------------------
# D2: Payment Plans
# ---------------------------------------------------------------------------

class PaymentPlanCreate(BaseModel):
    """Body for POST /api/payment-plans."""
    year_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    scenario_id: int


class PaymentPlanStatusUpdate(BaseModel):
    """Body for PUT /api/payment-plans/{id}."""
    status: Literal["draft", "approved"]


class PaymentPlanLineOut(BaseModel):
    """One line in a payment plan response."""
    id: int
    supplier_id: int
    planned_m: float
    cap_applied_m: float
    allocated_m: float
    actual_paid_m: float
    variance_m: float


class PaymentPlanOut(BaseModel):
    """Response for a PaymentPlan (header only, no lines)."""
    id: int
    year_month: str
    scenario_id: int
    pool_for_suppliers_m: float
    reserve_m: float
    status: str
    created_by: Optional[int]
    created_at: datetime
    approved_at: Optional[datetime]


class PaymentPlanDetailOut(BaseModel):
    """Response for a PaymentPlan with lines."""
    id: int
    year_month: str
    scenario_id: int
    pool_for_suppliers_m: float
    reserve_m: float
    status: str
    created_by: Optional[int]
    created_at: datetime
    approved_at: Optional[datetime]
    lines: list[PaymentPlanLineOut]


# ---------------------------------------------------------------------------
# D2: Notes
# ---------------------------------------------------------------------------

class NoteCreate(BaseModel):
    """Body for POST /api/notes."""
    target_type: str
    target_key: str
    body: str


class NoteOut(BaseModel):
    """Response for a Note row."""
    id: int
    target_type: str
    target_key: str
    body: str
    created_by: Optional[int]
    created_at: datetime


# ---------------------------------------------------------------------------
# D2: Alerts
# ---------------------------------------------------------------------------

class AlertDetailOut(_OrmBase):
    """Full alert row (includes acknowledged_at)."""
    id: int
    alert_type: str
    severity: Optional[str]
    title: str
    body: Optional[str]
    related_key: Optional[str]
    status: str
    generated_at: datetime
    acknowledged_at: Optional[datetime]


class AlertsListOut(BaseModel):
    """Response for GET /api/alerts."""
    alerts: list[AlertDetailOut]


# ---------------------------------------------------------------------------
# D2: Settings
# ---------------------------------------------------------------------------

class DisplaySettings(BaseModel):
    """Display preferences from AppSettings row (GET response — concrete values with defaults)."""
    accent: str = "أزرق"
    show_alert: bool = True
    neg_threshold_m: float = 0
    over_cap_warn: bool = True


class DisplaySettingsUpdate(BaseModel):
    """PUT-body display sub-model — all fields Optional so callers can do field-level partial updates."""
    accent: Optional[str] = None
    show_alert: Optional[bool] = None
    neg_threshold_m: Optional[float] = None
    over_cap_warn: Optional[bool] = None


class AssumptionFields(BaseModel):
    """Financial assumption fields from global Assumption row."""
    usd_rate: Optional[float] = None
    unexpected_reserve_m: Optional[float] = None
    income_growth_pct: Optional[float] = None
    in_growth_factor: Optional[float] = None
    out_growth_factor: Optional[float] = None
    cagr_floor: Optional[float] = None
    cagr_cap: Optional[float] = None
    forecast_horizon: Optional[int] = None
    fiscal_year_start_month: Optional[int] = None
    forecast_engine: Optional[str] = None


class SettingsOut(BaseModel):
    """Response for GET/PUT /api/settings."""
    display: DisplaySettings
    assumptions: AssumptionFields


class SettingsUpdate(BaseModel):
    """Body for PUT /api/settings — all sub-fields optional.

    `display` uses DisplaySettingsUpdate (all fields Optional) so callers can do
    field-level partial updates without resetting other display fields to defaults.
    `assumptions` already uses all-Optional AssumptionFields.
    """
    display: Optional[DisplaySettingsUpdate] = None
    assumptions: Optional[AssumptionFields] = None
