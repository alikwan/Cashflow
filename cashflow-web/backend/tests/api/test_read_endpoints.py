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


# ===========================================================================
# Task C2 Tests — /api/cashflow/monthly, /api/breakdown, /api/suppliers,
#                 /api/installments
# ===========================================================================

# ---------------------------------------------------------------------------
# Auth guard — all four new endpoints must return 401 without a session
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/meta",
    "/api/dashboard",
    "/api/cashflow/monthly",
    "/api/breakdown",
    "/api/suppliers",
    "/api/installments",
])
def test_all_endpoints_require_auth(client, path):
    assert client.get(path).status_code == 401


# ---------------------------------------------------------------------------
# /api/cashflow/monthly
# ---------------------------------------------------------------------------

def test_cashflow_monthly_perspective(client, seed_analytics, auth):
    """Contract test: response has months, forecast, by_fiscal_year keys."""
    r = client.get("/api/cashflow/monthly?perspective=comprehensive", cookies=auth).json()
    assert "months" in r and "forecast" in r and "by_fiscal_year" in r
    assert {"year_month", "cash_in_m", "out_total_m", "net_total_m"} <= set(r["months"][0])


def test_cashflow_monthly_months_shape(client, seed_analytics, auth):
    """Each month object has the required keys including cash_running_m + fiscal_year."""
    r = client.get("/api/cashflow/monthly", cookies=auth).json()
    m = r["months"][0]
    assert {"year_month", "cash_in_m", "out_total_m", "net_total_m",
            "cash_running_m", "fiscal_year"} <= set(m)


def test_cashflow_monthly_ordered(client, seed_analytics, auth):
    """Months are returned in ascending year_month order."""
    r = client.get("/api/cashflow/monthly", cookies=auth).json()
    yms = [m["year_month"] for m in r["months"]]
    assert yms == sorted(yms)
    assert yms[0] == "2022-05"


def test_cashflow_monthly_count(client, seed_analytics, auth):
    """24 seeded months → 24 in response."""
    r = client.get("/api/cashflow/monthly", cookies=auth).json()
    assert len(r["months"]) == 24


def test_cashflow_monthly_perspective_comprehensive(client, seed_analytics, auth):
    """Comprehensive out_total_m = out_total_comprehensive_m (includes siyrafa)."""
    r = client.get("/api/cashflow/monthly?perspective=comprehensive", cookies=auth).json()
    # first month FY1: out_comp = 100 (20+40+5+10+10+5+10)
    first = r["months"][0]
    assert first["out_total_m"] == pytest.approx(100.0, rel=0.01)


def test_cashflow_monthly_perspective_operational(client, seed_analytics, auth):
    """Operational out_total_m excludes siyrafa (out_total_operational_m)."""
    r = client.get("/api/cashflow/monthly?perspective=operational", cookies=auth).json()
    # first month FY1: out_op = 90 (100 - 10 siyrafa)
    first = r["months"][0]
    assert first["out_total_m"] == pytest.approx(90.0, rel=0.01)


def test_cashflow_monthly_perspectives_differ(client, seed_analytics, auth):
    """Comprehensive and operational out_total_m must differ (siyrafa > 0)."""
    comp = client.get("/api/cashflow/monthly?perspective=comprehensive", cookies=auth).json()
    oper = client.get("/api/cashflow/monthly?perspective=operational", cookies=auth).json()
    comp_out = comp["months"][0]["out_total_m"]
    oper_out = oper["months"][0]["out_total_m"]
    assert comp_out != pytest.approx(oper_out, rel=0.001)


def test_cashflow_monthly_by_fiscal_year_shape(client, seed_analytics, auth):
    """by_fiscal_year entries have the right keys and are sorted."""
    r = client.get("/api/cashflow/monthly", cookies=auth).json()
    assert len(r["by_fiscal_year"]) == 2
    for fy in r["by_fiscal_year"]:
        assert {"fiscal_year", "in_m", "out_m", "net_m"} <= set(fy)
    labels = [fy["fiscal_year"] for fy in r["by_fiscal_year"]]
    assert labels == sorted(labels)


def test_cashflow_monthly_forecast_empty_when_no_data(client, seed_analytics, auth):
    """Forecast list may be empty if no forecast_base rows (acceptable in C2)."""
    r = client.get("/api/cashflow/monthly", cookies=auth).json()
    # Just validate it's a list
    assert isinstance(r["forecast"], list)


def test_cashflow_monthly_operational_net(client, seed_analytics, auth):
    """Operational net_total_m = net_operating_m column."""
    r = client.get("/api/cashflow/monthly?perspective=operational", cookies=auth).json()
    # first month FY1: in=110, out_op=90 → net_op=20
    first = r["months"][0]
    assert first["net_total_m"] == pytest.approx(20.0, rel=0.01)


# ---------------------------------------------------------------------------
# /api/breakdown
# ---------------------------------------------------------------------------

def test_breakdown_contract(client, seed_analytics, auth):
    """Response has expense_cats, partners, funds keys."""
    r = client.get("/api/breakdown", cookies=auth).json()
    assert {"expense_cats", "partners", "funds"} <= set(r)


def test_breakdown_six_expense_cats(client, seed_analytics, auth):
    """Exactly 6 expense categories."""
    r = client.get("/api/breakdown", cookies=auth).json()
    assert len(r["expense_cats"]) == 6


def test_breakdown_expense_cats_shape(client, seed_analytics, auth):
    """Each category has key, total_m, monthly (column field removed from contract)."""
    r = client.get("/api/breakdown", cookies=auth).json()
    for cat in r["expense_cats"]:
        assert {"key", "total_m", "monthly"} <= set(cat)
        assert "column" not in cat
        assert isinstance(cat["monthly"], list)
        assert len(cat["monthly"]) == 24  # 24 seeded months


def test_breakdown_expense_cats_keys(client, seed_analytics, auth):
    """All six category keys are present."""
    r = client.get("/api/breakdown", cookies=auth).json()
    keys = {cat["key"] for cat in r["expense_cats"]}
    assert keys == {"suppliers", "partners", "siyrafa", "purchases", "salaries", "refunds"}


def test_breakdown_expense_cats_total_positive(client, seed_analytics, auth):
    """All category totals are >= 0."""
    r = client.get("/api/breakdown", cookies=auth).json()
    for cat in r["expense_cats"]:
        assert cat["total_m"] >= 0.0


def test_breakdown_monthly_shape(client, seed_analytics, auth):
    """Each monthly entry has year_month and amount_m."""
    r = client.get("/api/breakdown", cookies=auth).json()
    first_cat = r["expense_cats"][0]
    m = first_cat["monthly"][0]
    assert {"year_month", "amount_m"} <= set(m)


def test_breakdown_partners_from_balances(client, seed_analytics, auth):
    """partners list comes from balances_snapshot kind='partner'."""
    r = client.get("/api/breakdown", cookies=auth).json()
    # May be empty without seed — just verify it's a list
    assert isinstance(r["partners"], list)


def test_breakdown_funds_from_balances(client, seed_analytics, auth):
    """funds list comes from balances_snapshot kind='cashbox'."""
    r = client.get("/api/breakdown", cookies=auth).json()
    assert isinstance(r["funds"], list)


def test_breakdown_partners_shape(client, seed_analytics, auth):
    """Partner entries have account_id, name, balance_m if present."""
    r = client.get("/api/breakdown", cookies=auth).json()
    for p in r["partners"]:
        assert {"account_id", "name", "balance_m"} <= set(p)


def test_breakdown_funds_shape(client, seed_analytics, auth):
    """Fund entries have account_id, name, balance_m if present."""
    r = client.get("/api/breakdown", cookies=auth).json()
    for f in r["funds"]:
        assert {"account_id", "name", "balance_m"} <= set(f)


def test_breakdown_partners_seeded(client, seed_analytics, auth):
    """When seed_analytics seeds balances, partners are returned."""
    r = client.get("/api/breakdown", cookies=auth).json()
    # seed_analytics now seeds 2 partner balances
    names = {p["name"] for p in r["partners"]}
    assert "فؤاد كريم" in names
    assert "علي كوان" in names


def test_breakdown_funds_seeded(client, seed_analytics, auth):
    """When seed_analytics seeds balances, cashbox funds are returned."""
    r = client.get("/api/breakdown", cookies=auth).json()
    names = {f["name"] for f in r["funds"]}
    assert "صندوق المعتصم" in names


def test_breakdown_partners_desc_by_balance(client, seed_analytics, auth):
    """Partners ordered descending by balance_m."""
    r = client.get("/api/breakdown", cookies=auth).json()
    balances = [p["balance_m"] for p in r["partners"]]
    assert balances == sorted(balances, reverse=True)


# ---------------------------------------------------------------------------
# /api/suppliers
# ---------------------------------------------------------------------------

def test_suppliers_contract(client, seed_analytics, auth):
    """Contract: first supplier has all required keys."""
    s = client.get("/api/suppliers", cookies=auth).json()["suppliers"][0]
    assert {"id", "name", "cap", "currency", "monthly", "over_cap", "balance_m"} <= set(s)


def test_suppliers_count(client, seed_analytics, auth):
    """14 canonical suppliers seeded → 14 returned."""
    r = client.get("/api/suppliers", cookies=auth).json()
    assert len(r["suppliers"]) == 14


def test_suppliers_ordered_by_display_order(client, seed_analytics, auth):
    """Suppliers are returned ordered by display_order (1..14)."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = r["suppliers"]
    # The first supplier (display_order=1) is معرض البركة (account_id=1001)
    assert sups[0]["id"] == 1001
    assert sups[0]["name"] == "معرض البركة"


def test_suppliers_cap_values(client, seed_analytics, auth):
    """Cap values come from seeded supplier_caps."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    assert sups[2432]["cap"] == pytest.approx(15.0, rel=0.01)  # حميد الشطباوي cap=15
    assert sups[4937]["cap"] == pytest.approx(40.0, rel=0.01)  # شركة الحافظ cap=40


def test_suppliers_over_cap(client, seed_analytics, auth):
    """Supplier 2432 (cap=15) has exactly one month (paid_m=18) over cap."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    assert sups[2432]["over_cap"] == 1


def test_suppliers_monthly_is_list(client, seed_analytics, auth):
    """monthly is a list of up to 12 numbers."""
    r = client.get("/api/suppliers", cookies=auth).json()
    for s in r["suppliers"]:
        assert isinstance(s["monthly"], list)
        assert len(s["monthly"]) <= 12


def test_suppliers_monthly_values(client, seed_analytics, auth):
    """Seeded months for supplier 2432 appear in monthly list."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    # 2432 has some seeded paid_m values; monthly list should be non-empty
    assert len(sups[2432]["monthly"]) > 0


def test_suppliers_balance_m(client, seed_analytics, auth):
    """balance_m comes from balances_snapshot for the supplier account."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    # supplier 1001 has seeded balance
    assert isinstance(sups[1001]["balance_m"], float)


def test_suppliers_util_when_cap_zero(client, seed_analytics, auth):
    """util is null when cap == 0."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    # وميض (2093) has cap=0
    assert sups[2093]["util"] is None


def test_suppliers_util_when_cap_positive(client, seed_analytics, auth):
    """util for supplier 2432 is exact: avg([18,10×11])/15 = (128/12)/15 ≈ 0.711."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    # 2432: 12 months seeded (18, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10)
    # sum=128, avg=128/12, util=(128/12)/15 = 128/180 ≈ 0.7111
    assert sups[2432]["util"] is not None
    assert sups[2432]["util"] == pytest.approx(128 / 180, rel=0.02)


def test_suppliers_currency(client, seed_analytics, auth):
    """Currency field matches seed data."""
    r = client.get("/api/suppliers", cookies=auth).json()
    sups = {s["id"]: s for s in r["suppliers"]}
    assert sups[1001]["currency"] == "IQD"
    assert sups[4937]["currency"] == "USD"


# ---------------------------------------------------------------------------
# /api/installments
# ---------------------------------------------------------------------------

def test_installments_contract(client, seed_analytics, auth):
    """Response has summary, aging, top_debtors keys."""
    r = client.get("/api/installments", cookies=auth).json()
    assert {"summary", "aging", "top_debtors"} <= set(r)


def test_installments_summary_shape(client, seed_analytics, auth):
    """Summary has the InstallmentsSummaryOut fields."""
    r = client.get("/api/installments", cookies=auth).json()
    s = r["summary"]
    assert {"premium_count", "face_total_m", "cash_paid_m", "discount_m", "remaining_m"} <= set(s)


def test_installments_summary_values(client, seed_analytics, auth):
    """Summary values match the seeded InstallmentsSummary row."""
    r = client.get("/api/installments", cookies=auth).json()
    s = r["summary"]
    assert s["face_total_m"] == pytest.approx(7122.0, rel=0.01)
    assert s["premium_count"] == 8500


def test_installments_aging_nonempty(client, seed_analytics, auth):
    """Aging list is non-empty (seeded buckets)."""
    r = client.get("/api/installments", cookies=auth).json()
    assert len(r["aging"]) > 0


def test_installments_aging_shape(client, seed_analytics, auth):
    """Each aging bucket has bucket_key, label, amount_m, count."""
    r = client.get("/api/installments", cookies=auth).json()
    for bucket in r["aging"]:
        assert {"bucket_key", "label", "amount_m", "count"} <= set(bucket)


def test_installments_top_debtors(client, seed_analytics, auth):
    """top_debtors is a list (may be empty without debtor balances seeded)."""
    r = client.get("/api/installments", cookies=auth).json()
    assert isinstance(r["top_debtors"], list)


def test_installments_top_debtors_shape(client, seed_analytics, auth):
    """top_debtors entries have account_id, name, balance_m."""
    r = client.get("/api/installments", cookies=auth).json()
    for d in r["top_debtors"]:
        assert {"account_id", "name", "balance_m"} <= set(d)


def test_installments_top_debtors_seeded(client, seed_analytics, auth):
    """Seeded debtor balance rows appear in top_debtors."""
    r = client.get("/api/installments", cookies=auth).json()
    assert len(r["top_debtors"]) >= 1


def test_installments_top_debtors_desc(client, seed_analytics, auth):
    """top_debtors are ordered descending by balance_m."""
    r = client.get("/api/installments", cookies=auth).json()
    balances = [d["balance_m"] for d in r["top_debtors"]]
    assert balances == sorted(balances, reverse=True)
