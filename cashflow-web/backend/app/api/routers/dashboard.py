"""
app/api/routers/dashboard.py
=============================
GET /api/dashboard — aggregated data for the main dashboard page.

Reads pre-computed analytical tables; no heavy computation here.

Returned shape (snake_case):
  fy_totals          list[FyTotal]         — one entry per fiscal year, sorted
  net_decline_pct    float                 — last two complete FY comparison
  installments       InstallmentsSummaryOut|null — latest snapshot
  alerts             list[AlertOut]        — active only, newest first
  monthly_series     list[MonthlyPoint]    — all rows ordered by year_month
  expense_mix        ExpenseMix            — Σ over full window per category

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import (
    AlertOut,
    DashboardResponse,
    ExpenseMix,
    FyTotal,
    InstallmentsSummaryOut,
    MonthlyPoint,
)
from app.db.models import Alert, InstallmentsSummary, MonthlyCashflow

router = APIRouter(prefix="/api", tags=["read"])


# ---------------------------------------------------------------------------
# Helper: net_decline_pct from ORM rows (mirrors pipeline._fiscal_year_metrics)
# ---------------------------------------------------------------------------

def _compute_net_decline(rows: list[MonthlyCashflow]) -> float:
    """
    Compute net_decline_pct from ORM rows, following exactly the same rule as
    app.etl.pipeline._fiscal_year_metrics:

      1. Group rows by fiscal_year; count months per group.
      2. Keep only groups with exactly 12 months (complete FYs).
      3. If fewer than 2 complete FYs → return 0.0.
      4. prev = second-to-last complete FY (by label sort), last = latest.
      5. (prev_net − last_net) / prev_net  when prev_net > 0 and last_net < prev_net,
         else 0.0.
    """
    # Group by fiscal_year → list of net_total_m values
    fy_nets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        fy_nets[row.fiscal_year].append(float(row.net_total_m))

    # Only complete fiscal years (12 months)
    complete = {fy: nets for fy, nets in fy_nets.items() if len(nets) == 12}
    if len(complete) < 2:
        return 0.0

    sorted_fys = sorted(complete.keys())
    prev_net = sum(complete[sorted_fys[-2]])
    last_net = sum(complete[sorted_fys[-1]])

    if prev_net > 0 and last_net < prev_net:
        return (prev_net - last_net) / prev_net
    return 0.0


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> DashboardResponse:
    # ------------------------------------------------------------------
    # 1. monthly_cashflow — all rows, ordered by year_month
    # ------------------------------------------------------------------
    cf_rows: list[MonthlyCashflow] = (
        db.query(MonthlyCashflow)
        .order_by(MonthlyCashflow.year_month.asc())
        .all()
    )

    monthly_series = [
        MonthlyPoint(
            year_month=r.year_month,
            cash_in_m=float(r.cash_in_m),
            out_total_comprehensive_m=float(r.out_total_comprehensive_m),
            net_total_m=float(r.net_total_m),
            cash_running_m=float(r.cash_running_m),
        )
        for r in cf_rows
    ]

    # ------------------------------------------------------------------
    # 2. fy_totals — group by fiscal_year, sorted ascending
    # ------------------------------------------------------------------
    fy_agg: dict[str, dict[str, float]] = defaultdict(lambda: {"in_m": 0.0, "out_m": 0.0, "net_m": 0.0})
    for r in cf_rows:
        fy_agg[r.fiscal_year]["in_m"] += float(r.cash_in_m)
        fy_agg[r.fiscal_year]["out_m"] += float(r.out_total_comprehensive_m)
        fy_agg[r.fiscal_year]["net_m"] += float(r.net_total_m)

    fy_totals = [
        FyTotal(fiscal_year=fy, **vals)
        for fy, vals in sorted(fy_agg.items())
    ]

    # ------------------------------------------------------------------
    # 3. net_decline_pct
    # ------------------------------------------------------------------
    net_decline_pct = _compute_net_decline(cf_rows)

    # ------------------------------------------------------------------
    # 4. installments — latest snapshot
    # ------------------------------------------------------------------
    inst_row: Optional[InstallmentsSummary] = (
        db.query(InstallmentsSummary)
        .order_by(InstallmentsSummary.snapshot_date.desc())
        .first()
    )
    installments: Optional[InstallmentsSummaryOut] = (
        InstallmentsSummaryOut(
            premium_count=inst_row.premium_count,
            face_total_m=float(inst_row.face_total_m),
            cash_paid_m=float(inst_row.cash_paid_m),
            discount_m=float(inst_row.discount_m),
            remaining_m=float(inst_row.remaining_m),
        )
        if inst_row else None
    )

    # ------------------------------------------------------------------
    # 5. alerts — active only (status != 'resolved'), newest first
    # ------------------------------------------------------------------
    alert_rows: list[Alert] = (
        db.query(Alert)
        .filter(Alert.status != "resolved")
        .order_by(Alert.generated_at.desc())
        .all()
    )
    alerts = [AlertOut.model_validate(a) for a in alert_rows]

    # ------------------------------------------------------------------
    # 6. expense_mix — Σ over full window
    # ------------------------------------------------------------------
    expense_mix = ExpenseMix(
        out_suppliers_m=sum(float(r.out_suppliers_m) for r in cf_rows),
        out_drawings_m=sum(float(r.out_drawings_m) for r in cf_rows),
        out_refunds_m=sum(float(r.out_refunds_m) for r in cf_rows),
        out_purchases_m=sum(float(r.out_purchases_m) for r in cf_rows),
        out_salaries_m=sum(float(r.out_salaries_m) for r in cf_rows),
        out_siyrafa_m=sum(float(r.out_siyrafa_m) for r in cf_rows),
        out_other_m=sum(float(r.out_other_m) for r in cf_rows),
    )

    return DashboardResponse(
        fy_totals=fy_totals,
        net_decline_pct=net_decline_pct,
        installments=installments,
        alerts=alerts,
        monthly_series=monthly_series,
        expense_mix=expense_mix,
    )
