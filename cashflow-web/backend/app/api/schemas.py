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
