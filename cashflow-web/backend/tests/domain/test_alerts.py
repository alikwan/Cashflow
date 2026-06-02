from app.domain.alerts import generate_alerts

def test_liquidity_deficit_and_reconciliation_gap():
    ctx = {
        "forecast_net_by_month": {"2026-09": -5.0, "2026-10": 3.0},
        "neg_threshold_m": 0.0,
        "reconciliation_residual_m": 80.0, "reconciliation_threshold_m": 50.0,
        "cap_exceedances": [], "net_decline_pct": 0.10, "expense_velocity": 1.2,
    }
    alerts = generate_alerts(ctx)
    types = {a["alert_type"] for a in alerts}
    assert "liquidity_deficit" in types          # شهر 2026-09 سالب
    assert "reconciliation_gap" in types          # 80 > 50
    deficit = next(a for a in alerts if a["alert_type"] == "liquidity_deficit")
    assert deficit["severity"] == "danger" and "2026-09" in deficit["related_key"]
