import pandas as pd
from app.domain.forecast import seasonal_forecast

def _series():
    idx = [f"{y}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    return pd.Series([10.0]*36, index=idx)

def test_flat_series_forecasts_minus_reserve():
    fc = seasonal_forecast(_series(), horizon=12, reserve_m=2.0)
    assert len(fc.values) == 12
    assert all(abs(v - 8.0) < 1e-6 for v in fc.values)   # 10*(1+0) - 2 = 8
    assert fc.index[0] == "2026-01"                       # month right after last actual 2025-12
    assert -0.10 <= fc.cagr <= 0.15

def test_backtest_mape_and_confidence():
    from app.domain.forecast import backtest_mape, confidence_label
    s = _series()
    mape = backtest_mape(s)                 # flat series → ~0% error
    assert mape is not None and mape < 1.0
    assert confidence_label(10) == "عالية"
    assert confidence_label(40) == "متوسطة"
    assert confidence_label(80) == "منخفضة"


def _two_fy(v1, v2):
    """Two complete fiscal years (May→Apr): FY1 all=v1, FY2 all=v2."""
    idx, vals = [], []
    for base, v in ((2023, v1), (2024, v2)):           # FY 2023-2024, then 2024-2025
        for off in range(12):
            tm = 4 + off                                # 0-based from Jan; 4 == May
            y = base + tm // 12
            m = tm % 12 + 1
            idx.append(f"{y}-{m:02d}"); vals.append(float(v))
    return pd.Series(vals, index=idx)

def test_cagr_uses_complete_fiscal_years_unclamped():
    # FY totals 120 and 132 → CAGR = 132/120 - 1 = 0.10 (within band, NOT clamped)
    fc = seasonal_forecast(_two_fy(10, 11), horizon=12, reserve_m=0.0)
    assert abs(fc.cagr - 0.10) < 1e-9
    assert fc.index[0] == "2025-05"                      # next May after last actual 2025-04
    assert all(abs(v - 10.5 * 1.10) < 1e-6 for v in fc.values)   # seasonal mean (10+11)/2 × (1+cagr)

def test_forecast_start_derived_from_last_actual_month():
    # Rolling forecast: starts the month immediately after the last actual month.
    def start(last_ym):
        return seasonal_forecast(pd.Series([5.0], index=[last_ym]), horizon=12).index[0]
    assert start("2026-04") == "2026-05"   # April → May
    assert start("2025-12") == "2026-01"   # Dec → Jan (year rolls over)
    assert start("2026-06") == "2026-07"   # June → July
    assert start("2026-05") == "2026-06"   # May → June (the production case: no 12-month gap)
