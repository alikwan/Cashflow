import pandas as pd
from app.domain.classify import classify_monthly

def _bond(ym, optype, amt, to_type=None, from_type=None, cur=1):
    return {"year_month": ym, "OperationsType": optype, "Amount1": amt,
            "to_type": to_type, "from_type": from_type, "Currency1Id": cur}

def test_perspectives_and_categories():
    rows = [
        _bond("2026-04", 0, 100_000_000),                 # مقبوضات
        _bond("2026-04", 1, 30_000_000, to_type=2614),    # موردون
        _bond("2026-04", 1, 44_000_000, to_type=2518),    # سحوبات شركاء
        _bond("2026-04", 5, 5_000_000,  to_type=3121),    # أجور
        _bond("2026-04", 7, 40_000_000),                  # صيرفة
        _bond("2026-04", 3, 9_000_000),                   # تحويل داخلي (يُستبعد)
    ]
    out = classify_monthly(pd.DataFrame(rows)).set_index("year_month")
    r = out.loc["2026-04"]
    assert r["cash_in_m"] == 100.0
    assert r["out_suppliers_m"] == 30.0
    assert r["out_drawings_m"] == 44.0
    assert r["out_salaries_m"] == 5.0
    assert r["out_siyrafa_m"] == 40.0
    assert r["internal_transfers_m"] == 9.0
    assert r["out_total_operational_m"] == 79.0
    assert r["out_total_comprehensive_m"] == 119.0
    assert r["net_operating_m"] == 21.0
    assert r["net_total_m"] == -19.0

def test_fiscal_year_starts_may():
    from app.domain.classify import fiscal_year_label
    assert fiscal_year_label("2026-05") == "2026-2027"
    assert fiscal_year_label("2026-04") == "2025-2026"
