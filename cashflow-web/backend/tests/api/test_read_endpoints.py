"""
tests/api/test_read_endpoints.py
=================================
TDD tests for /api/meta and /api/dashboard read endpoints (Task C1).

Run RED first (before routers exist), then GREEN after implementation.
"""
import pytest


# ---------------------------------------------------------------------------
# Contract tests — key presence
# ---------------------------------------------------------------------------

def test_meta_contract(client, seed_analytics, auth):
    r = client.get("/api/meta", cookies=auth)
    assert r.status_code == 200
    body = r.json()
    assert {"usd_rate", "current_cash_m", "reserve_m", "fy_start", "last_etl"} <= set(body)


def test_dashboard_contract(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    assert {"fy_totals", "net_decline_pct", "installments", "alerts", "monthly_series", "expense_mix"} <= set(b)


@pytest.mark.parametrize("path", ["/api/meta", "/api/dashboard"])
def test_meta_dashboard_require_auth(client, path):
    assert client.get(path).status_code == 401


# ---------------------------------------------------------------------------
# Value-level assertions — /api/meta
# ---------------------------------------------------------------------------

def test_meta_usd_rate(client, seed_analytics, auth):
    body = client.get("/api/meta", cookies=auth).json()
    assert body["usd_rate"] == 1350


def test_meta_current_cash_m(client, seed_analytics, auth):
    """last seeded row (2024-04) has cash_running_m = 60 + 12*10 + 12*3 = 216."""
    body = client.get("/api/meta", cookies=auth).json()
    # start=60, FY1 net=10/month×12=120, FY2 net=3/month×12=36 → 60+120+36=216
    assert body["current_cash_m"] == pytest.approx(216.0, rel=0.01)


def test_meta_reserve_m(client, seed_analytics, auth):
    body = client.get("/api/meta", cookies=auth).json()
    assert body["reserve_m"] == pytest.approx(15.0, rel=0.01)


def test_meta_fy_start(client, seed_analytics, auth):
    body = client.get("/api/meta", cookies=auth).json()
    assert body["fy_start"] == 5


def test_meta_last_etl_shape(client, seed_analytics, auth):
    body = client.get("/api/meta", cookies=auth).json()
    etl = body["last_etl"]
    assert etl is not None
    assert {"status", "started_at", "finished_at", "rows_loaded", "reconciliation_residual_m"} <= set(etl)
    assert etl["status"] == "success"
    assert etl["rows_loaded"] == 24


# ---------------------------------------------------------------------------
# Value-level assertions — /api/dashboard
# ---------------------------------------------------------------------------

def test_dashboard_monthly_series_length(client, seed_analytics, auth):
    """Seeded 24 MonthlyCashflow rows → monthly_series must have 24 entries."""
    b = client.get("/api/dashboard", cookies=auth).json()
    assert len(b["monthly_series"]) == 24


def test_dashboard_fy_totals_count(client, seed_analytics, auth):
    """Two complete fiscal years seeded → fy_totals has 2 entries."""
    b = client.get("/api/dashboard", cookies=auth).json()
    assert len(b["fy_totals"]) == 2


def test_dashboard_fy_totals_shape(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    for entry in b["fy_totals"]:
        assert {"fiscal_year", "in_m", "out_m", "net_m"} <= set(entry)


def test_dashboard_fy_totals_sorted(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    labels = [e["fiscal_year"] for e in b["fy_totals"]]
    assert labels == sorted(labels)


def test_dashboard_net_decline_pct_range(client, seed_analytics, auth):
    """net_decline_pct must match the seeded data exactly: FY1 net=120M, FY2 net=36M
    → (120-36)/120 = 0.7."""
    b = client.get("/api/dashboard", cookies=auth).json()
    assert isinstance(b["net_decline_pct"], float)
    assert b["net_decline_pct"] == pytest.approx(0.7, rel=1e-3)


def test_dashboard_installments_shape(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    inst = b["installments"]
    assert inst is not None
    assert {"premium_count", "face_total_m", "cash_paid_m", "discount_m", "remaining_m"} <= set(inst)
    assert inst["face_total_m"] == pytest.approx(7122.0, rel=0.01)


def test_dashboard_alerts_excludes_resolved(client, seed_analytics, seed_alerts, auth):
    """Active-only filter: resolved alert must not appear."""
    b = client.get("/api/dashboard", cookies=auth).json()
    statuses = [a["status"] for a in b["alerts"]]
    assert "resolved" not in statuses


def test_dashboard_alerts_includes_active(client, seed_analytics, seed_alerts, auth):
    """new + read alerts must appear."""
    b = client.get("/api/dashboard", cookies=auth).json()
    statuses = {a["status"] for a in b["alerts"]}
    assert "new" in statuses or "read" in statuses  # at least one active


def test_dashboard_alerts_newest_first(client, seed_analytics, seed_alerts, auth):
    """Alerts must be ordered newest generated_at first."""
    b = client.get("/api/dashboard", cookies=auth).json()
    alerts = b["alerts"]
    if len(alerts) >= 2:
        ts = [a["generated_at"] for a in alerts]
        assert ts == sorted(ts, reverse=True)


def test_dashboard_alerts_shape(client, seed_analytics, seed_alerts, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    for a in b["alerts"]:
        assert {"id", "alert_type", "severity", "title", "body", "related_key", "status", "generated_at"} <= set(a)


def test_dashboard_monthly_series_shape(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    for pt in b["monthly_series"]:
        assert {"year_month", "cash_in_m", "out_total_comprehensive_m", "net_total_m", "cash_running_m"} <= set(pt)


def test_dashboard_expense_mix_keys(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    mix = b["expense_mix"]
    assert {"out_suppliers_m", "out_drawings_m", "out_refunds_m",
            "out_purchases_m", "out_salaries_m", "out_siyrafa_m"} <= set(mix)


def test_dashboard_expense_mix_values_positive(client, seed_analytics, auth):
    b = client.get("/api/dashboard", cookies=auth).json()
    mix = b["expense_mix"]
    for key in ("out_suppliers_m", "out_drawings_m", "out_refunds_m",
                "out_purchases_m", "out_salaries_m", "out_siyrafa_m"):
        assert mix[key] >= 0.0


# ---------------------------------------------------------------------------
# Edge case: no analytics data at all (empty DB still returns right shape)
# ---------------------------------------------------------------------------

def test_meta_no_data_defaults(client, auth):
    """Without seed_analytics, meta still returns the right keys with defaults."""
    body = client.get("/api/meta", cookies=auth).json()
    assert body["usd_rate"] == 1350          # global default
    assert body["current_cash_m"] == 0.0
    assert body["reserve_m"] == 15.0
    assert body["fy_start"] == 5
    assert body["last_etl"] is None


def test_dashboard_no_data_empty_lists(client, auth):
    """Without seed_analytics, dashboard returns empty lists (not 500)."""
    b = client.get("/api/dashboard", cookies=auth).json()
    assert b["fy_totals"] == []
    assert b["monthly_series"] == []
    assert b["net_decline_pct"] == 0.0
    assert b["installments"] is None
