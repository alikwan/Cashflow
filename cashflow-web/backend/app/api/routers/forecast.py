"""
app/api/routers/forecast.py
============================
GET /api/forecast?scenario_id=<int optional>

Projects the ETL-computed `forecast_base` (engine='seasonal') through 3 standard
scenarios (base / opt / pess) and returns multi-scenario cash paths, totals, MAPE,
and confidence label.

Standard scenarios (mirror design-reference/project/src/data.js SCENARIOS):
    base  in_g=1.00  out_g=1.00  label='متحفّظ'
    opt   in_g=1.08  out_g=0.98  label='متفائل'
    pess  in_g=0.92  out_g=1.06  label='متشائم'

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import (
    ForecastMonthPoint,
    ForecastResponse,
    ScenarioMeta,
    ScenarioTotals,
    ScenarioValues,
)
from app.db.models import Assumption, ForecastBase, MonthlyCashflow, Scenario
from app.domain.forecast import confidence_label

# ---------------------------------------------------------------------------
# Standard scenarios — single source of truth for this router
# ---------------------------------------------------------------------------
SCENARIOS: dict[str, dict] = {
    "base": {"label": "متحفّظ",  "in_g": 1.00, "out_g": 1.00},
    "opt":  {"label": "متفائل",  "in_g": 1.08, "out_g": 0.98},
    "pess": {"label": "متشائم", "in_g": 0.92, "out_g": 1.06},
}

# Series keys that compose the OUT total (comprehensive — includes siyrafa)
_OUT_SERIES: set[str] = {
    "out_suppliers", "out_drawings", "out_refunds",
    "out_purchases", "out_salaries", "out_other", "out_siyrafa",
}

router = APIRouter(prefix="/api/forecast", tags=["read"])


@router.get("", response_model=ForecastResponse)
def get_forecast(
    scenario_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> ForecastResponse:
    # ------------------------------------------------------------------
    # 1. Global assumptions: income_growth_pct, unexpected_reserve_m
    # ------------------------------------------------------------------
    global_assump: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )
    reserve_m: float = float(global_assump.unexpected_reserve_m) if (
        global_assump and global_assump.unexpected_reserve_m is not None
    ) else 15.0
    # Global income-growth multiplier (applied on top of each scenario's in_g)
    income_growth_factor: float = float(global_assump.income_growth_pct) if (
        global_assump and global_assump.income_growth_pct is not None
    ) else 1.0

    # scenario_id override: if a Scenario row with a per-scenario income_growth_pct
    # exists, use it — otherwise silently fall back to the global value.
    if scenario_id is not None:
        scenario_row: Scenario | None = (
            db.query(Scenario).filter(Scenario.id == scenario_id).first()
        )
        if scenario_row is not None:
            sc_assump: Assumption | None = (
                db.query(Assumption)
                .filter(Assumption.scenario_id == scenario_id)
                .first()
            )
            if sc_assump is not None and sc_assump.income_growth_pct is not None:
                income_growth_factor = float(sc_assump.income_growth_pct)

    # ------------------------------------------------------------------
    # 2. Latest cash balance (current_cash) from monthly_cashflow
    # ------------------------------------------------------------------
    latest_cf: MonthlyCashflow | None = (
        db.query(MonthlyCashflow)
        .order_by(MonthlyCashflow.year_month.desc())
        .first()
    )
    current_cash: float = float(latest_cf.cash_running_m) if latest_cf else 0.0

    # ------------------------------------------------------------------
    # 3. Pivot forecast_base (engine='seasonal') per year_month
    # ------------------------------------------------------------------
    fb_rows: list[ForecastBase] = (
        db.query(ForecastBase)
        .filter(ForecastBase.engine == "seasonal")
        .order_by(ForecastBase.year_month.asc())
        .all()
    )

    # pivot: {year_month → {series_key → value_m}}
    pivot: dict[str, dict[str, float]] = defaultdict(dict)
    # also keep mape for cash_in (the receipts accuracy series)
    cash_in_mape: Optional[float] = None
    for row in fb_rows:
        pivot[row.year_month][row.series_key] = float(row.value_m)
        if row.series_key == "cash_in" and row.mape is not None:
            cash_in_mape = float(row.mape)

    # ------------------------------------------------------------------
    # 4. Build per-month scenario projections
    # ------------------------------------------------------------------
    sorted_months = sorted(pivot.keys())

    forecast_points: list[ForecastMonthPoint] = []
    cash_paths: dict[str, list[float]] = {"base": [], "opt": [], "pess": []}
    running: dict[str, float] = {"base": current_cash, "opt": current_cash, "pess": current_cash}
    fc_agg: dict[str, dict[str, float]] = {
        s: {"in_m": 0.0, "out_m": 0.0, "net_m": 0.0}
        for s in SCENARIOS
    }

    for ym in sorted_months:
        series = pivot[ym]
        base_in: float = series.get("cash_in", 0.0)
        base_out: float = sum(v for k, v in series.items() if k in _OUT_SERIES)

        scen_vals: dict[str, ScenarioValues] = {}
        for sc_key, sc in SCENARIOS.items():
            in_m = base_in * sc["in_g"] * income_growth_factor
            out_m = base_out * sc["out_g"]
            net_m = in_m - out_m
            scen_vals[sc_key] = ScenarioValues(in_m=in_m, out_m=out_m, net_m=net_m)

            # Accumulate for fc_totals
            fc_agg[sc_key]["in_m"] += in_m
            fc_agg[sc_key]["out_m"] += out_m
            fc_agg[sc_key]["net_m"] += net_m

            # Running cash path (net minus reserve each month)
            running[sc_key] += net_m - reserve_m
            cash_paths[sc_key].append(running[sc_key])

        forecast_points.append(ForecastMonthPoint(
            year_month=ym,
            base=scen_vals["base"],
            opt=scen_vals["opt"],
            pess=scen_vals["pess"],
        ))

    # ------------------------------------------------------------------
    # 5. fc_totals: end_cash + min_cash from cash_paths
    # ------------------------------------------------------------------
    fc_totals: dict[str, ScenarioTotals] = {}
    for sc_key in SCENARIOS:
        path = cash_paths[sc_key]
        end_cash = path[-1] if path else current_cash
        min_cash = min(path) if path else current_cash
        fc_totals[sc_key] = ScenarioTotals(
            in_m=fc_agg[sc_key]["in_m"],
            out_m=fc_agg[sc_key]["out_m"],
            net_m=fc_agg[sc_key]["net_m"],
            end_cash_m=end_cash,
            min_cash_m=min_cash,
        )

    # ------------------------------------------------------------------
    # 6. Scenarios metadata + MAPE / confidence
    # ------------------------------------------------------------------
    scenarios_meta: dict[str, ScenarioMeta] = {
        k: ScenarioMeta(label=v["label"], in_g=v["in_g"], out_g=v["out_g"])
        for k, v in SCENARIOS.items()
    }

    conf: Optional[str] = confidence_label(cash_in_mape) if cash_in_mape is not None else None

    return ForecastResponse(
        forecast=forecast_points,
        cash_paths=cash_paths,
        fc_totals=fc_totals,
        scenarios=scenarios_meta,
        mape=cash_in_mape,
        confidence=conf,
    )
