"""
tests/api/test_write_endpoints.py
===================================
TDD tests for Task D1 admin WRITE endpoints:
  - POST /api/suppliers/{account_id}/caps   (historized cap + audit)
  - GET/POST/PUT/DELETE /api/scenarios      (CRUD + audit)
  - PUT /api/scenarios/{id}/assumptions     (upsert + audit)

All write endpoints require auth (session cookie). Without it → 401.
"""
from __future__ import annotations

import pytest

from app.db.models import AuditLog


# ---------------------------------------------------------------------------
# Helper: get audit rows via a fresh session from _testing_session
# ---------------------------------------------------------------------------

def _audit_rows(Session, action: str) -> list:
    """Return all AuditLog rows with the given action."""
    s = Session()
    try:
        return s.query(AuditLog).filter(AuditLog.action == action).all()
    finally:
        s.close()


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture
def seed_suppliers(_testing_session):
    """Seed the 14 canonical suppliers + initial caps (no analytics data needed)."""
    from app.seed import seed_all
    s = _testing_session()
    try:
        seed_all(s)
    finally:
        s.close()


# ===========================================================================
# Supplier cap tests
# ===========================================================================

class TestSupplierCaps:
    def test_create_supplier_cap_is_historized_and_audited(
        self, client, seed_suppliers, auth, _testing_session
    ):
        """POST a new cap → 201; GET /api/suppliers shows updated cap; audit row exists."""
        resp = client.post(
            "/api/suppliers/1001/caps",
            json={"monthly_cap_m": 12, "effective_from": "2026-06-01"},
            cookies=auth,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["monthly_cap_m"] == 12.0
        assert body["effective_from"] == "2026-06-01"

        # GET /api/suppliers → supplier 1001 now shows cap=12 (most-recent wins)
        sup_resp = client.get("/api/suppliers", cookies=auth)
        assert sup_resp.status_code == 200
        suppliers = sup_resp.json()["suppliers"]
        s1001 = next(s for s in suppliers if s["id"] == 1001)
        assert s1001["cap"] == 12.0

        # Audit row was created in the same transaction
        rows = _audit_rows(_testing_session, "create_cap")
        assert len(rows) == 1
        assert rows[0].entity == "supplier_cap"
        assert rows[0].before_json is None
        assert rows[0].after_json is not None
        assert rows[0].after_json["monthly_cap_m"] == 12.0

    def test_duplicate_cap_same_date_conflict(self, client, seed_suppliers, auth):
        """Posting the same (account_id, effective_from) twice → second is 409 conflict."""
        payload = {"monthly_cap_m": 7, "effective_from": "2026-07-01"}
        r1 = client.post("/api/suppliers/1001/caps", json=payload, cookies=auth)
        assert r1.status_code == 201

        r2 = client.post("/api/suppliers/1001/caps", json=payload, cookies=auth)
        assert r2.status_code == 409
        assert r2.json()["error"]["code"] == "conflict"

    def test_create_cap_unknown_account_404(self, client, seed_suppliers, auth):
        """Unknown account_id → 404."""
        resp = client.post(
            "/api/suppliers/9999/caps",
            json={"monthly_cap_m": 5, "effective_from": "2026-06-01"},
            cookies=auth,
        )
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "not_found"

    def test_create_cap_requires_auth(self, client, seed_suppliers):
        """No session cookie → 401."""
        resp = client.post(
            "/api/suppliers/1001/caps",
            json={"monthly_cap_m": 5, "effective_from": "2026-06-01"},
        )
        assert resp.status_code == 401

    def test_create_cap_negative_cap_422(self, client, seed_suppliers, auth):
        """monthly_cap_m=-5 → 422 (field validation)."""
        resp = client.post(
            "/api/suppliers/1001/caps",
            json={"monthly_cap_m": -5, "effective_from": "2026-06-01"},
            cookies=auth,
        )
        assert resp.status_code == 422

    def test_create_cap_plan_range_invalid_422(self, client, seed_suppliers, auth):
        """plan_low_m > plan_high_m (both > 0) → 422."""
        resp = client.post(
            "/api/suppliers/1001/caps",
            json={
                "monthly_cap_m": 10,
                "effective_from": "2026-06-01",
                "plan_low_m": 8.0,
                "plan_high_m": 5.0,
            },
            cookies=auth,
        )
        assert resp.status_code == 422


# ===========================================================================
# Scenario CRUD tests
# ===========================================================================

class TestScenarios:
    def test_create_scenario_and_list(self, client, auth, _testing_session):
        """POST a scenario → 201; GET lists it; audit row action=create_scenario."""
        payload = {"name": "سيناريو اختبار", "kind": "custom", "is_baseline": False}
        r = client.post("/api/scenarios", json=payload, cookies=auth)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["name"] == "سيناريو اختبار"
        assert data["kind"] == "custom"
        assert data["is_baseline"] is False
        created_id = data["id"]

        # GET lists it
        list_r = client.get("/api/scenarios", cookies=auth)
        assert list_r.status_code == 200
        ids = [s["id"] for s in list_r.json()]
        assert created_id in ids

        # Audit row
        rows = _audit_rows(_testing_session, "create_scenario")
        assert len(rows) == 1
        assert rows[0].entity == "scenario"

    def test_duplicate_baseline_scenario_conflict(self, client, auth):
        """Two scenarios with is_baseline=True → second is 409 conflict."""
        p1 = {"name": "الأساسي 1", "is_baseline": True}
        p2 = {"name": "الأساسي 2", "is_baseline": True}
        r1 = client.post("/api/scenarios", json=p1, cookies=auth)
        assert r1.status_code == 201

        r2 = client.post("/api/scenarios", json=p2, cookies=auth)
        assert r2.status_code == 409
        assert r2.json()["error"]["code"] == "conflict"

    def test_update_scenario_audited(self, client, auth, _testing_session):
        """PUT changes name → audit row action=update_scenario with before/after differing."""
        r = client.post(
            "/api/scenarios",
            json={"name": "الاسم الأول", "is_baseline": False},
            cookies=auth,
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        put_r = client.put(
            f"/api/scenarios/{sid}",
            json={"name": "الاسم الثاني"},
            cookies=auth,
        )
        assert put_r.status_code == 200
        assert put_r.json()["name"] == "الاسم الثاني"

        rows = _audit_rows(_testing_session, "update_scenario")
        assert len(rows) == 1
        row = rows[0]
        assert row.before_json["name"] == "الاسم الأول"
        assert row.after_json["name"] == "الاسم الثاني"

    def test_update_scenario_not_found(self, client, auth):
        """PUT unknown id → 404."""
        r = client.put(
            "/api/scenarios/99999",
            json={"name": "x"},
            cookies=auth,
        )
        assert r.status_code == 404

    def test_delete_scenario(self, client, auth, _testing_session):
        """DELETE → gone; audit action=delete_scenario."""
        r = client.post(
            "/api/scenarios",
            json={"name": "للحذف", "is_baseline": False},
            cookies=auth,
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        del_r = client.delete(f"/api/scenarios/{sid}", cookies=auth)
        assert del_r.status_code == 200

        # No longer in list
        list_r = client.get("/api/scenarios", cookies=auth)
        ids = [s["id"] for s in list_r.json()]
        assert sid not in ids

        # Audit
        rows = _audit_rows(_testing_session, "delete_scenario")
        assert len(rows) == 1
        assert rows[0].before_json is not None
        assert rows[0].after_json is None

    def test_delete_scenario_not_found(self, client, auth):
        """DELETE unknown id → 404."""
        r = client.delete("/api/scenarios/99999", cookies=auth)
        assert r.status_code == 404

    def test_delete_scenario_in_use_conflict(self, client, auth, _testing_session):
        """A scenario with a dependent ScenarioAdjustment cannot be deleted → 409.

        (FK enforcement is enabled on the SQLite test engine, so this mirrors
        Postgres restrict-on-delete behaviour.)"""
        from app.db.models import ScenarioAdjustment

        r = client.post(
            "/api/scenarios",
            json={"name": "مرتبط", "is_baseline": False},
            cookies=auth,
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        # Attach a dependent row that the delete handler does NOT pre-clean.
        s = _testing_session()
        try:
            s.add(ScenarioAdjustment(scenario_id=sid, series_key="cash_in", adjust_pct=0.05))
            s.commit()
        finally:
            s.close()

        del_r = client.delete(f"/api/scenarios/{sid}", cookies=auth)
        assert del_r.status_code == 409
        assert del_r.json()["error"]["code"] == "conflict"

        # Scenario must still exist (delete rolled back).
        ids = [x["id"] for x in client.get("/api/scenarios", cookies=auth).json()]
        assert sid in ids

    def test_update_to_baseline_conflict(self, client, auth):
        """PUT is_baseline=True when another scenario is already baseline → 409 conflict."""
        # Create scenario A as baseline
        r_a = client.post(
            "/api/scenarios",
            json={"name": "الأساسي", "is_baseline": True},
            cookies=auth,
        )
        assert r_a.status_code == 201
        # Create scenario B as non-baseline
        r_b = client.post(
            "/api/scenarios",
            json={"name": "بديل", "is_baseline": False},
            cookies=auth,
        )
        assert r_b.status_code == 201
        sid_b = r_b.json()["id"]

        # Try to make B also a baseline → conflict
        put_r = client.put(
            f"/api/scenarios/{sid_b}",
            json={"is_baseline": True},
            cookies=auth,
        )
        assert put_r.status_code == 409
        assert put_r.json()["error"]["code"] == "conflict"

    def test_scenarios_require_auth(self, client):
        """GET/POST without session → 401."""
        assert client.get("/api/scenarios").status_code == 401
        assert client.post("/api/scenarios", json={"name": "x"}).status_code == 401


# ===========================================================================
# Assumptions upsert tests
# ===========================================================================

class TestAssumptions:
    def test_put_assumptions_upserts(self, client, auth, _testing_session):
        """PUT assumptions twice → only ONE row for that scenario; second value wins; audits present."""
        # Create scenario first
        r = client.post(
            "/api/scenarios",
            json={"name": "سيناريو الافتراضات", "is_baseline": False},
            cookies=auth,
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        # First PUT
        put1 = client.put(
            f"/api/scenarios/{sid}/assumptions",
            json={"usd_rate": 1350.0, "forecast_horizon": 12},
            cookies=auth,
        )
        assert put1.status_code == 200
        assert put1.json()["usd_rate"] == 1350.0

        # Second PUT with different values
        put2 = client.put(
            f"/api/scenarios/{sid}/assumptions",
            json={"usd_rate": 1400.0, "forecast_horizon": 6},
            cookies=auth,
        )
        assert put2.status_code == 200
        assert put2.json()["usd_rate"] == 1400.0
        assert put2.json()["forecast_horizon"] == 6

        # Only ONE assumptions row for this scenario in DB
        from app.db.models import Assumption
        s = _testing_session()
        try:
            count = s.query(Assumption).filter(Assumption.scenario_id == sid).count()
        finally:
            s.close()
        assert count == 1

        # Two audit rows (one insert, one update)
        rows = _audit_rows(_testing_session, "update_assumptions")
        assert len(rows) == 2

    def test_put_assumptions_scenario_not_found(self, client, auth):
        """PUT assumptions for missing scenario → 404."""
        r = client.put(
            "/api/scenarios/99999/assumptions",
            json={"usd_rate": 1300.0},
            cookies=auth,
        )
        assert r.status_code == 404

    def test_put_assumptions_requires_auth(self, client):
        """No cookie → 401."""
        r = client.put("/api/scenarios/1/assumptions", json={"usd_rate": 1300.0})
        assert r.status_code == 401

    def test_put_assumptions_invalid_month_422(self, client, auth):
        """fiscal_year_start_month=13 → 422 (field validation)."""
        r = client.post(
            "/api/scenarios",
            json={"name": "تحقق الافتراضات", "is_baseline": False},
            cookies=auth,
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        put_r = client.put(
            f"/api/scenarios/{sid}/assumptions",
            json={"fiscal_year_start_month": 13},
            cookies=auth,
        )
        assert put_r.status_code == 422


# ===========================================================================
# D2: Payment Plans
# ===========================================================================

class TestPaymentPlans:
    def test_create_payment_plan_returns_201_with_lines(self, client, seed_analytics, auth):
        """POST /api/payment-plans → 201 with plan header + lines for each supplier."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        r = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["year_month"] == "2026-05"
        assert body["status"] == "draft"
        assert isinstance(body["lines"], list)
        assert len(body["lines"]) > 0
        # Each line must have the required fields
        for line in body["lines"]:
            assert "supplier_id" in line
            assert "allocated_m" in line
            assert "actual_paid_m" in line

    def test_duplicate_payment_plan_conflict(self, client, seed_analytics, auth):
        """Creating the same (year_month, scenario_id) twice → second is 409."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        p1 = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        )
        p2 = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        )
        assert p1.status_code == 201
        assert p2.status_code == 409
        assert p2.json()["error"]["code"] == "conflict"

    def test_create_payment_plan_unknown_scenario_404(self, client, seed_analytics, auth):
        """scenario_id that doesn't exist → 404."""
        r = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 9999},
            cookies=auth,
        )
        assert r.status_code == 404

    def test_payment_plan_reconcile_fills_actuals(self, client, seed_analytics, auth):
        """POST /reconcile fills actual_paid_m on each line and sets variance_m."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        r = client.post(f"/api/payment-plans/{pid}/reconcile", cookies=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "lines" in body
        assert all("actual_paid_m" in line for line in body["lines"])
        # variance_m == allocated_m − actual_paid_m for every line
        for line in body["lines"]:
            assert abs(line["variance_m"] - (line["allocated_m"] - line["actual_paid_m"])) < 0.001

    def test_reconcile_is_idempotent(self, client, seed_analytics, auth):
        """Running reconcile twice returns identical lines."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        r1 = client.post(f"/api/payment-plans/{pid}/reconcile", cookies=auth).json()
        r2 = client.post(f"/api/payment-plans/{pid}/reconcile", cookies=auth).json()
        assert r1["lines"] == r2["lines"]

    def test_reconcile_audited(self, client, seed_analytics, auth, _testing_session):
        """Reconcile action is written to audit_log."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        client.post(f"/api/payment-plans/{pid}/reconcile", cookies=auth)
        rows = _audit_rows(_testing_session, "reconcile_payment_plan")
        assert len(rows) >= 1

    def test_update_payment_plan_status(self, client, seed_analytics, auth):
        """PUT /api/payment-plans/{id} can change status to approved."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        r = client.put(f"/api/payment-plans/{pid}", json={"status": "approved"}, cookies=auth)
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        assert r.json()["approved_at"] is not None

    def test_get_payment_plan_by_id(self, client, seed_analytics, auth):
        """GET /api/payment-plans/{id} returns header + lines."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        r = client.get(f"/api/payment-plans/{pid}", cookies=auth)
        assert r.status_code == 200
        assert r.json()["id"] == pid
        assert "lines" in r.json()

    def test_get_payment_plan_not_found(self, client, seed_analytics, auth):
        """GET /api/payment-plans/9999 → 404."""
        r = client.get("/api/payment-plans/9999", cookies=auth)
        assert r.status_code == 404

    def test_list_payment_plans(self, client, seed_analytics, auth):
        """GET /api/payment-plans returns a list."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        )
        r = client.get("/api/payment-plans", cookies=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) == 1

    def test_payment_plans_require_auth(self, client, seed_analytics):
        """GET /api/payment-plans without session → 401."""
        assert client.get("/api/payment-plans").status_code == 401
        assert client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
        ).status_code == 401

    def test_create_payment_plan_audited(self, client, seed_analytics, auth, _testing_session):
        """POST /api/payment-plans writes a create_payment_plan audit row."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        )
        rows = _audit_rows(_testing_session, "create_payment_plan")
        assert len(rows) == 1

    def test_update_payment_plan_invalid_status_422(self, client, seed_analytics, auth):
        """PUT /api/payment-plans/{id} with an invalid status value → 422."""
        client.post("/api/scenarios", json={"name": "base", "kind": "base"}, cookies=auth)
        pid = client.post(
            "/api/payment-plans",
            json={"year_month": "2026-05", "scenario_id": 1},
            cookies=auth,
        ).json()["id"]
        r = client.put(f"/api/payment-plans/{pid}", json={"status": "banana"}, cookies=auth)
        assert r.status_code == 422


# ===========================================================================
# D2: Notes
# ===========================================================================

class TestNotes:
    def test_create_and_list_note(self, client, seed_analytics, auth):
        """POST /api/notes → 201; GET lists it newest-first."""
        r = client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "2026-05", "body": "ملاحظة تجريبية"},
            cookies=auth,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["body"] == "ملاحظة تجريبية"
        assert body["target_type"] == "month"
        assert body["target_key"] == "2026-05"
        note_id = body["id"]

        # GET lists it
        list_r = client.get("/api/notes", cookies=auth)
        assert list_r.status_code == 200
        ids = [n["id"] for n in list_r.json()]
        assert note_id in ids

    def test_list_notes_filter_by_target(self, client, seed_analytics, auth):
        """GET /api/notes?target_type=month&target_key=2026-05 filters correctly."""
        client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "2026-05", "body": "May note"},
            cookies=auth,
        )
        client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "2026-06", "body": "June note"},
            cookies=auth,
        )
        r = client.get("/api/notes?target_type=month&target_key=2026-05", cookies=auth)
        assert r.status_code == 200
        notes = r.json()
        assert all(n["target_key"] == "2026-05" for n in notes)
        assert len(notes) == 1

    def test_delete_note(self, client, seed_analytics, auth):
        """DELETE /api/notes/{id} removes the note; 404 on second delete."""
        r = client.post(
            "/api/notes",
            json={"target_type": "supplier", "target_key": "1001", "body": "للحذف"},
            cookies=auth,
        )
        note_id = r.json()["id"]

        del_r = client.delete(f"/api/notes/{note_id}", cookies=auth)
        assert del_r.status_code == 200

        # Second delete → 404
        del_r2 = client.delete(f"/api/notes/{note_id}", cookies=auth)
        assert del_r2.status_code == 404

    def test_delete_note_audited(self, client, seed_analytics, auth, _testing_session):
        """Delete note writes a delete_note audit row."""
        r = client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "2026-05", "body": "test"},
            cookies=auth,
        )
        note_id = r.json()["id"]
        client.delete(f"/api/notes/{note_id}", cookies=auth)
        rows = _audit_rows(_testing_session, "delete_note")
        assert len(rows) == 1

    def test_create_note_audited(self, client, seed_analytics, auth, _testing_session):
        """POST /api/notes writes a create_note audit row."""
        client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "2026-05", "body": "audit test"},
            cookies=auth,
        )
        rows = _audit_rows(_testing_session, "create_note")
        assert len(rows) == 1

    def test_notes_require_auth(self, client, seed_analytics):
        """GET/POST without session → 401."""
        assert client.get("/api/notes").status_code == 401
        assert client.post(
            "/api/notes",
            json={"target_type": "month", "target_key": "x", "body": "x"},
        ).status_code == 401


# ===========================================================================
# D2: Alerts
# ===========================================================================

class TestAlerts:
    def test_get_active_alerts(self, client, seed_analytics, seed_alerts, auth):
        """GET /api/alerts returns active (non-resolved) alerts, newest first."""
        r = client.get("/api/alerts", cookies=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "alerts" in body
        statuses = [a["status"] for a in body["alerts"]]
        assert "resolved" not in statuses
        assert len(body["alerts"]) == 2  # new + read

    def test_alert_ack(self, client, seed_analytics, seed_alerts, auth):
        """POST /api/alerts/{id}/ack changes status to 'read'; GET reflects it."""
        # Get the first active alert (status='new')
        alerts = client.get("/api/alerts", cookies=auth).json()["alerts"]
        new_alert = next(a for a in alerts if a["status"] == "new")
        aid = new_alert["id"]

        r = client.post(f"/api/alerts/{aid}/ack", cookies=auth)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "read"

        # Verify it persists
        updated = client.get("/api/alerts", cookies=auth).json()["alerts"]
        match = next(a for a in updated if a["id"] == aid)
        assert match["status"] == "read"

    def test_alert_ack_idempotent(self, client, seed_analytics, seed_alerts, auth):
        """ACKing an already-read alert keeps it 'read' (idempotent)."""
        alerts = client.get("/api/alerts", cookies=auth).json()["alerts"]
        read_alert = next(a for a in alerts if a["status"] == "read")
        aid = read_alert["id"]

        r = client.post(f"/api/alerts/{aid}/ack", cookies=auth)
        assert r.status_code == 200
        assert r.json()["status"] == "read"

    def test_alert_ack_not_found(self, client, seed_analytics, seed_alerts, auth):
        """ACK unknown alert id → 404."""
        r = client.post("/api/alerts/99999/ack", cookies=auth)
        assert r.status_code == 404

    def test_alert_ack_audited(self, client, seed_analytics, seed_alerts, auth, _testing_session):
        """ACK writes an ack_alert audit row."""
        alerts = client.get("/api/alerts", cookies=auth).json()["alerts"]
        aid = alerts[0]["id"]
        client.post(f"/api/alerts/{aid}/ack", cookies=auth)
        rows = _audit_rows(_testing_session, "ack_alert")
        assert len(rows) == 1

    def test_alerts_require_auth(self, client, seed_analytics, seed_alerts):
        """GET /api/alerts without session → 401."""
        assert client.get("/api/alerts").status_code == 401


# ===========================================================================
# D2: Settings
# ===========================================================================

class TestSettings:
    def test_get_settings_returns_defaults_when_no_row(self, client, auth):
        """GET /api/settings with no AppSettings row returns defaults."""
        r = client.get("/api/settings", cookies=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "display" in body
        assert "assumptions" in body
        d = body["display"]
        assert d["accent"] == "أزرق"
        assert d["show_alert"] is True
        assert d["neg_threshold_m"] == 0
        assert d["over_cap_warn"] is True

    def test_get_settings_with_global_assumption(self, client, seed_analytics, auth):
        """GET /api/settings with seed_analytics (has global assumption) includes assumptions."""
        r = client.get("/api/settings", cookies=auth)
        assert r.status_code == 200
        body = r.json()
        assert body["assumptions"]["usd_rate"] == 1350.0

    def test_put_settings_persists_display(self, client, auth):
        """PUT /api/settings display fields → GET returns updated values."""
        r = client.put(
            "/api/settings",
            json={"display": {"accent": "أخضر", "show_alert": False, "neg_threshold_m": 5.0}},
            cookies=auth,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["display"]["accent"] == "أخضر"
        assert body["display"]["show_alert"] is False

        # Round-trip
        r2 = client.get("/api/settings", cookies=auth)
        assert r2.json()["display"]["accent"] == "أخضر"
        assert r2.json()["display"]["show_alert"] is False

    def test_put_settings_persists_assumptions(self, client, auth):
        """PUT /api/settings assumptions fields → GET returns updated values."""
        r = client.put(
            "/api/settings",
            json={"assumptions": {"usd_rate": 1400.0, "unexpected_reserve_m": 20.0}},
            cookies=auth,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["assumptions"]["usd_rate"] == 1400.0
        assert body["assumptions"]["unexpected_reserve_m"] == 20.0

        # Round-trip
        r2 = client.get("/api/settings", cookies=auth)
        assert r2.json()["assumptions"]["usd_rate"] == 1400.0

    def test_put_settings_audited(self, client, auth, _testing_session):
        """PUT /api/settings writes an update_settings audit row."""
        client.put(
            "/api/settings",
            json={"display": {"accent": "أحمر"}},
            cookies=auth,
        )
        rows = _audit_rows(_testing_session, "update_settings")
        assert len(rows) == 1

    def test_settings_require_auth(self, client):
        """GET/PUT /api/settings without session → 401."""
        assert client.get("/api/settings").status_code == 401
        assert client.put("/api/settings", json={}).status_code == 401

    def test_put_settings_display_partial_preserves_others(self, client, auth):
        """Partial display PUT only updates the provided field; omitted fields are preserved."""
        # Step 1: PUT full display settings (sets all four fields to non-default values)
        r1 = client.put(
            "/api/settings",
            json={"display": {
                "accent": "أزرق",
                "show_alert": False,
                "over_cap_warn": False,
                "neg_threshold_m": -5.0,
            }},
            cookies=auth,
        )
        assert r1.status_code == 200, r1.text

        # Step 2: Partial PUT — only change accent; omit the other three fields
        r2 = client.put(
            "/api/settings",
            json={"display": {"accent": "أخضر"}},
            cookies=auth,
        )
        assert r2.status_code == 200, r2.text

        # Step 3: GET and verify accent changed but other fields were NOT reset to defaults
        r3 = client.get("/api/settings", cookies=auth)
        assert r3.status_code == 200
        d = r3.json()["display"]
        assert d["accent"] == "أخضر"          # updated
        assert d["show_alert"] is False         # preserved (not reset to default True)
        assert d["over_cap_warn"] is False      # preserved (not reset to default True)
        assert d["neg_threshold_m"] == -5.0     # preserved (not reset to default 0)
