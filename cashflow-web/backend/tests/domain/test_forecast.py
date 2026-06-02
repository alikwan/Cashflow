import pandas as pd
from app.domain.forecast import seasonal_forecast

def _series():
    idx = [f"{y}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    return pd.Series([10.0]*36, index=idx)

def test_flat_series_forecasts_minus_reserve():
    fc = seasonal_forecast(_series(), horizon=12, reserve_m=2.0)
    assert len(fc.values) == 12
    assert all(abs(v - 8.0) < 1e-6 for v in fc.values)   # 10*(1+0) - 2 = 8
    assert fc.index[0] == "2026-05"                       # next May after 2025-12
    assert -0.10 <= fc.cagr <= 0.15
