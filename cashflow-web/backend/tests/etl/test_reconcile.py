from app.etl.reconcile import running_balance, reconciliation_residual

def test_running_balance_anchored_to_opening():
    nets = [("2026-01", 5.0), ("2026-02", -2.0)]
    rb = running_balance(opening_m=100.0, monthly_nets=nets)
    assert rb["2026-01"] == 105.0 and rb["2026-02"] == 103.0

def test_reconciliation_residual():
    assert reconciliation_residual(actual_delta_m=50.0, classified_net_sum_m=47.0) == 3.0
