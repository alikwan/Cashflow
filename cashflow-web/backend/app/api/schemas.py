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

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


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
