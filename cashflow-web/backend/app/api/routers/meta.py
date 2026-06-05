"""
app/api/routers/meta.py
========================
GET /api/meta — returns global constants the dashboard client needs at startup.

Sources (in priority order):
  usd_rate          → latest successful etl_runs.usd_rate_used
                       → assumptions (global, scenario_id IS NULL).usd_rate
                       → hard-coded default 1350
  current_cash_m    → max(year_month) row of monthly_cashflow.cash_running_m
  reserve_m         → assumptions (global).unexpected_reserve_m → 15
  fy_start          → assumptions (global).fiscal_year_start_month → 5
  last_etl          → latest etl_runs row summary (or null)

Auth: requires valid session cookie (get_current_user dependency).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import LastEtlOut, MetaResponse
from app.db.models import Assumption, EtlRun, MonthlyCashflow

router = APIRouter(prefix="/api", tags=["read"])


@router.get("/meta", response_model=MetaResponse)
def get_meta(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> MetaResponse:
    # ------------------------------------------------------------------
    # 1. Global assumptions row (scenario_id IS NULL)
    # ------------------------------------------------------------------
    assumption: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )

    # ------------------------------------------------------------------
    # 2. Latest successful ETL run
    # ------------------------------------------------------------------
    latest_etl: EtlRun | None = (
        db.query(EtlRun)
        .filter(EtlRun.status == "success")
        .order_by(EtlRun.id.desc())
        .first()
    )

    # ------------------------------------------------------------------
    # 3. usd_rate resolution chain
    # ------------------------------------------------------------------
    usd_rate: float = 1350.0
    if latest_etl is not None and latest_etl.usd_rate_used is not None:
        usd_rate = float(latest_etl.usd_rate_used)
    elif assumption is not None and assumption.usd_rate is not None:
        usd_rate = float(assumption.usd_rate)

    # ------------------------------------------------------------------
    # 4. current_cash_m — last monthly_cashflow row by year_month
    # ------------------------------------------------------------------
    last_cf: MonthlyCashflow | None = (
        db.query(MonthlyCashflow)
        .order_by(MonthlyCashflow.year_month.desc())
        .first()
    )
    current_cash_m: float = float(last_cf.cash_running_m) if last_cf else 0.0

    # ------------------------------------------------------------------
    # 5. reserve_m + fy_start from assumptions → defaults
    # ------------------------------------------------------------------
    reserve_m: float = 15.0
    if assumption is not None and assumption.unexpected_reserve_m is not None:
        reserve_m = float(assumption.unexpected_reserve_m)

    fy_start: int = 5
    if assumption is not None and assumption.fiscal_year_start_month is not None:
        fy_start = int(assumption.fiscal_year_start_month)

    # ------------------------------------------------------------------
    # 6. last_etl summary — use ANY latest run (not just successful)
    # ------------------------------------------------------------------
    # NOTE: this is intentionally a SEPARATE query from the success-filtered one
    # in step 2. They diverge when the most recent run FAILED: usd_rate must come
    # from the latest *successful* run (step 2), while last_etl surfaces the latest
    # run of any status so the UI can show a failure. Do not merge into one query.
    any_latest_etl: EtlRun | None = (
        db.query(EtlRun)
        .order_by(EtlRun.id.desc())
        .first()
    )
    last_etl_out: LastEtlOut | None = None
    if any_latest_etl is not None:
        last_etl_out = LastEtlOut.model_validate(any_latest_etl)

    return MetaResponse(
        usd_rate=usd_rate,
        current_cash_m=current_cash_m,
        reserve_m=reserve_m,
        fy_start=fy_start,
        last_etl=last_etl_out,
    )
