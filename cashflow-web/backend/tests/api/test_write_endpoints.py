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
