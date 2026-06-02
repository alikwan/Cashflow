"""
app/domain/forecast.py
======================
Pure seasonal × CAGR forecasting + backtest MAPE.
No I/O, no SQLAlchemy, no pymssql — only pandas / numpy / stdlib.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CAGR_FLOOR = -0.10
CAGR_CAP = 0.15


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fiscal_year_label(ym: str) -> str:
    """Return 'YYYY-YYYY+1' FY label for a 'YYYY-MM' string.
    Fiscal year starts in May (month 5).
    e.g. '2026-05' → '2026-2027', '2026-04' → '2025-2026'
    """
    y, m = map(int, ym.split("-"))
    s = y if m >= 5 else y - 1
    return f"{s}-{s+1}"


def _months_in_fy(fy_label: str, fy_start: int = 5) -> set[str]:
    """Return the set of 12 YYYY-MM strings that belong to this FY."""
    start_y = int(fy_label.split("-")[0])
    months = set()
    for offset in range(12):
        total_month = (fy_start - 1 + offset)  # 0-based month index from Jan
        y = start_y + total_month // 12
        m = (total_month % 12) + 1
        months.add(f"{y}-{m:02d}")
    return months


def _complete_fy_totals(series: pd.Series, fy_start: int = 5) -> pd.Series:
    """
    Compute per-FY totals, but only for fiscal years where ALL 12 months
    are present in the series index.  Returns a Series keyed by FY label,
    sorted ascending.  May be empty.
    """
    present = set(series.index)

    # Build a mapping ym → FY label for all present months
    fy_map: dict[str, str] = {ym: fiscal_year_label(ym) for ym in present}

    # Count how many of each FY's 12 canonical months exist in the series
    from collections import defaultdict
    fy_count: dict[str, int] = defaultdict(int)
    for ym, fy in fy_map.items():
        fy_count[fy] += 1

    complete_fys = {fy for fy, cnt in fy_count.items() if cnt == 12}

    if not complete_fys:
        return pd.Series(dtype=float)

    # Sum values for the complete FYs
    fy_totals: dict[str, float] = {}
    for ym, val in series.items():
        fy = fy_map[ym]
        if fy in complete_fys:
            fy_totals[fy] = fy_totals.get(fy, 0.0) + val

    result = pd.Series(fy_totals).sort_index()
    return result


def _compute_cagr(complete_fy_totals: pd.Series) -> float:
    """CAGR from first to last complete FY total, clamped to [CAGR_FLOOR, CAGR_CAP]."""
    if len(complete_fy_totals) < 2 or complete_fy_totals.iloc[0] <= 0:
        return 0.0
    years = len(complete_fy_totals) - 1
    raw = (complete_fy_totals.iloc[-1] / complete_fy_totals.iloc[0]) ** (1 / years) - 1
    return float(np.clip(raw, CAGR_FLOOR, CAGR_CAP))


def _derive_base_year(series: pd.Series, fy_start: int) -> int:
    """
    The forecast covers the next full FY (May→Apr) strictly after the last
    actual month in the series.

    Rule: parse last YYYY-MM.
      If last_month < fy_start  →  base_year = last_year
      Else                       →  base_year = last_year + 1

    e.g. last='2026-04' → 2026 (May 2026 starts the next FY)
         last='2025-12' → 2026 (May 2026 starts the next FY)
         last='2026-06' → 2027 (May 2027 starts the next FY)
    """
    last_ym = sorted(series.index)[-1]
    last_year, last_month = map(int, last_ym.split("-"))
    if last_month < fy_start:
        return last_year
    return last_year + 1


def _gen_forecast_index(base_year: int, fy_start: int, horizon: int) -> list[str]:
    """Generate `horizon` YYYY-MM labels starting from base_year-fy_start."""
    result = []
    for offset in range(horizon):
        total_month = (fy_start - 1) + offset  # 0-based from Jan
        y = base_year + total_month // 12
        m = (total_month % 12) + 1
        result.append(f"{y}-{m:02d}")
    return result


# ---------------------------------------------------------------------------
# ForecastResult dataclass
# ---------------------------------------------------------------------------

@dataclass
class ForecastResult:
    index: List[str]
    values: List[float]
    cagr: float
    mape: Optional[float] = field(default=None)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def seasonal_forecast(
    series: pd.Series,
    horizon: int = 12,
    reserve_m: float = 0.0,
    base_year: int = 2026,
    fy_start: int = 5,
) -> ForecastResult:
    """
    Compute a seasonal × CAGR forecast over `horizon` months.

    Parameters
    ----------
    series      : pd.Series indexed by 'YYYY-MM' strings, values in any numeric unit.
    horizon     : number of months to forecast (default 12).
    reserve_m   : amount subtracted from each forecasted value (safety reserve).
    base_year   : fallback start year used only when series is empty.
    fy_start    : first month of the fiscal year (default 5 = May).

    Returns
    -------
    ForecastResult with index, values, cagr, and mape (populated via backtest_mape).
    """
    if series.empty:
        idx = _gen_forecast_index(base_year, fy_start, horizon)
        return ForecastResult(index=idx, values=[0.0] * horizon, cagr=0.0, mape=None)

    # Seasonal profile: mean value per calendar month
    months = series.index.str[5:7].astype(int)
    seasonal = series.groupby(months).mean()  # index = 1..12

    # CAGR using complete fiscal years only (Refinement #2)
    cft = _complete_fy_totals(series, fy_start)
    cagr = _compute_cagr(cft)

    # Derive forecast start from data (Refinement #1)
    actual_base_year = _derive_base_year(series, fy_start)
    idx = _gen_forecast_index(actual_base_year, fy_start, horizon)

    values: list[float] = []
    for ym in idx:
        m = int(ym[5:7])
        base_val = float(seasonal.get(m, 0.0))
        values.append(base_val * (1 + cagr) - reserve_m)

    mape = backtest_mape(series, fy_start=fy_start)

    return ForecastResult(index=idx, values=values, cagr=cagr, mape=mape)


def backtest_mape(series: pd.Series, fy_start: int = 5) -> Optional[float]:
    """
    Train on all complete fiscal years EXCEPT the latest one.
    Forecast the latest complete FY window.
    MAPE = mean(|actual - forecast| / |actual|) × 100 over months that:
      - exist in the series, AND
      - have actual != 0.

    Returns None if there are fewer than 2 complete FYs (need at least 1 train + 1 test).
    """
    cft_all = _complete_fy_totals(series, fy_start)
    if len(cft_all) < 2:
        return None

    # The test FY is the latest complete FY; training uses all earlier complete FYs
    test_fy = cft_all.index[-1]
    train_fys = set(cft_all.index[:-1])

    # Build training series: only months belonging to complete train FYs
    fy_map = {ym: fiscal_year_label(ym) for ym in series.index}
    train_mask = pd.Series(
        [fy_map.get(ym, "") in train_fys for ym in series.index],
        index=series.index,
        dtype=bool,
    )
    train_series = series[train_mask]

    if train_series.empty:
        return None

    # Seasonal profile from training data
    train_months = train_series.index.str[5:7].astype(int)
    seasonal = train_series.groupby(train_months).mean()

    # CAGR from training complete FYs only
    cft_train = _complete_fy_totals(train_series, fy_start)
    cagr = _compute_cagr(cft_train)

    # Determine the months in the test FY window
    test_months_set = _months_in_fy(test_fy, fy_start)

    # Compute MAPE over months that exist in series AND have actual != 0
    errors: list[float] = []
    for ym in sorted(test_months_set):
        if ym not in series.index:
            continue
        actual = float(series[ym])
        if actual == 0.0:
            continue
        m = int(ym[5:7])
        forecast = float(seasonal.get(m, 0.0)) * (1 + cagr)
        errors.append(abs(actual - forecast) / abs(actual))

    if not errors:
        return None

    return float(np.mean(errors) * 100)


def confidence_label(mape: float) -> str:
    """Map a MAPE value to an Arabic confidence label."""
    if mape < 25:
        return "عالية"
    if mape < 50:
        return "متوسطة"
    return "منخفضة"
