"""
app/api/routers/cashflow.py
============================
GET /api/cashflow/monthly?perspective=comprehensive|operational

Returns pre-computed monthly cashflow data from the `monthly_cashflow` table
and forecast rows from `forecast_base`, projected into a perspective-aware
snake_case JSON shape.

Perspectives
------------
comprehensive (default): out_total_m = out_total_comprehensive_m (includes siyrafa)
                          net_total_m = net_total_m
operational:              out_total_m = out_total_operational_m  (excludes siyrafa)
                          net_total_m = net_operating_m

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import (
    CashflowByFiscalYear,
    CashflowMonthPoint,
    CashflowMonthlyResponse,
    ForecastPoint,
)
from app.db.models import ForecastBase, MonthlyCashflow

# Series keys for the OUT components (used when summing forecast).
# Comprehensive = all; Operational = excludes siyrafa.
_OUT_SERIES_KEYS = {
    "comprehensive": {"out_suppliers", "out_drawings", "out_refunds", "out_purchases", "out_salaries", "out_other", "out_siyrafa"},
    "operational":   {"out_suppliers", "out_drawings", "out_refunds", "out_purchases", "out_salaries", "out_other"},
}

router = APIRouter(prefix="/api/cashflow", tags=["read"])


@router.get("/monthly", response_model=CashflowMonthlyResponse)
def get_cashflow_monthly(
    perspective: Literal["comprehensive", "operational"] = Query(default="comprehensive"),
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> CashflowMonthlyResponse:
    # ------------------------------------------------------------------
    # 1. All monthly_cashflow rows, ordered ascending
    # ------------------------------------------------------------------
    cf_rows: list[MonthlyCashflow] = (
        db.query(MonthlyCashflow)
        .order_by(MonthlyCashflow.year_month.asc())
        .all()
    )

    # ------------------------------------------------------------------
    # 2. Build months list (perspective-aware)
    # ------------------------------------------------------------------
    months: list[CashflowMonthPoint] = []
    for r in cf_rows:
        if perspective == "comprehensive":
            out_total = float(r.out_total_comprehensive_m)
            net_total = float(r.net_total_m)
        else:
            out_total = float(r.out_total_operational_m)
            net_total = float(r.net_operating_m)

        months.append(CashflowMonthPoint(
            year_month=r.year_month,
            cash_in_m=float(r.cash_in_m),
            out_total_m=out_total,
            net_total_m=net_total,
            cash_running_m=float(r.cash_running_m),
            fiscal_year=r.fiscal_year,
        ))

    # ------------------------------------------------------------------
    # 3. by_fiscal_year aggregation
    # ------------------------------------------------------------------
    fy_agg: dict[str, dict[str, float]] = defaultdict(
        lambda: {"in_m": 0.0, "out_m": 0.0, "net_m": 0.0}
    )
    for pt in months:
        fy_agg[pt.fiscal_year]["in_m"] += pt.cash_in_m
        fy_agg[pt.fiscal_year]["out_m"] += pt.out_total_m
        fy_agg[pt.fiscal_year]["net_m"] += pt.net_total_m

    by_fiscal_year = [
        CashflowByFiscalYear(fiscal_year=fy, **vals)
        for fy, vals in sorted(fy_agg.items())
    ]

    # ------------------------------------------------------------------
    # 4. Forecast — pivot forecast_base (engine='seasonal') per year_month
    # ------------------------------------------------------------------
    forecast_rows: list[ForecastBase] = (
        db.query(ForecastBase)
        .filter(ForecastBase.engine == "seasonal")
        .order_by(ForecastBase.year_month.asc())
        .all()
    )

    # Pivot: {year_month → {series_key → value_m}}
    pivot: dict[str, dict[str, float]] = defaultdict(dict)
    for row in forecast_rows:
        pivot[row.year_month][row.series_key] = float(row.value_m)

    out_keys = _OUT_SERIES_KEYS[perspective]
    forecast: list[ForecastPoint] = []
    for ym in sorted(pivot.keys()):
        series = pivot[ym]
        cash_in_m = series.get("cash_in", 0.0)
        out_total_m = sum(v for k, v in series.items() if k in out_keys)
        net_total_m = cash_in_m - out_total_m
        forecast.append(ForecastPoint(
            year_month=ym,
            cash_in_m=cash_in_m,
            out_total_m=out_total_m,
            net_total_m=net_total_m,
        ))

    return CashflowMonthlyResponse(
        months=months,
        forecast=forecast,
        by_fiscal_year=by_fiscal_year,
    )
