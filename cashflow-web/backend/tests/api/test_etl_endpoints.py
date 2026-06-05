"""
Tests for ETL control endpoints:
  POST /api/etl/run   — manual trigger (background); auth-protected
  GET  /api/etl/status — latest EtlRun shape; auth-protected

Design rules:
- NEVER touch MSSQL in tests: monkeypatch _has_running_etl and run_etl_job.
- 409 path is synchronous (no MSSQL connection ever opened).
- 202 path schedules the background job via FastAPI BackgroundTasks; the job
  itself is stubbed so it does nothing.
- Scheduler NEVER starts during tests (TestClient used WITHOUT 'with').
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import pytest

# ---------------------------------------------------------------------------
# 401 — both endpoints require auth
# ---------------------------------------------------------------------------

def test_etl_run_requires_auth(client):
    r = client.post("/api/etl/run")
    assert r.status_code == 401, r.json()


def test_etl_status_requires_auth(client):
    r = client.get("/api/etl/status")
    assert r.status_code == 401, r.json()


# ---------------------------------------------------------------------------
# GET /api/etl/status — shape with no runs in DB
# ---------------------------------------------------------------------------

def test_etl_status_shape(client, auth):
    """Response must always contain the three required keys."""
    s = client.get("/api/etl/status", cookies=auth).json()
    assert {"status", "last_run_at", "reconciliation_residual_m"} <= set(s)


def test_etl_status_never_when_no_runs(client, auth):
    """When no EtlRun rows exist the status must be 'never'."""
    s = client.get("/api/etl/status", cookies=auth).json()
    assert s["status"] == "never"
    assert s["last_run_at"] is None
    assert s["reconciliation_residual_m"] is None


# ---------------------------------------------------------------------------
# GET /api/etl/status — with a real EtlRun row
# ---------------------------------------------------------------------------

def test_etl_status_with_a_run(_testing_session, client, auth):
    """Insert a success EtlRun directly, then GET status → reflects that run."""
    from app.db.models import EtlRun

    now = datetime.now(timezone.utc)
    s = _testing_session()
    try:
        s.add(EtlRun(
            id=42,
            started_at=now - timedelta(minutes=5),
            finished_at=now - timedelta(minutes=4),
            status="success",
            rows_loaded=100,
            usd_rate_used=Decimal("1350"),
            reconciliation_residual_m=Decimal("0"),
            source_tz="Asia/Baghdad",
        ))
        s.commit()
    finally:
        s.close()

    resp = client.get("/api/etl/status", cookies=auth).json()
    assert resp["status"] == "success"
    assert resp["last_run_at"] is not None
    assert resp["reconciliation_residual_m"] == 0


# ---------------------------------------------------------------------------
# POST /api/etl/run — 409 when lock is held (synchronous, no MSSQL)
# ---------------------------------------------------------------------------

def test_etl_run_rejects_when_already_running(client, auth, monkeypatch):
    """When _has_running_etl returns True the endpoint must return 409 etl_running.

    The monkeypatch targets the module attribute so the router's
    `pipeline._has_running_etl(db)` call picks it up — no MSSQL needed.
    """
    monkeypatch.setattr("app.etl.pipeline._has_running_etl", lambda s: True)
    r = client.post("/api/etl/run", cookies=auth)
    assert r.status_code == 409, r.json()
    assert r.json()["error"]["code"] == "etl_running"


# ---------------------------------------------------------------------------
# POST /api/etl/run — 202 when idle (background job stubbed, no MSSQL)
# ---------------------------------------------------------------------------

def test_etl_run_accepts_when_idle(client, auth, monkeypatch):
    """Happy path: 202 returned AND the background job is actually enqueued/run
    (no MSSQL touched because the job is stubbed)."""
    from unittest.mock import Mock

    # The lock check: not running
    monkeypatch.setattr("app.etl.pipeline._has_running_etl", lambda s: False)
    # Stub the background runner so it never tries to open an MSSQL connection,
    # but assert it was actually scheduled+invoked (TestClient runs bg tasks sync).
    mock_job = Mock()
    monkeypatch.setattr("app.api.routers.etl.run_etl_job", mock_job)

    r = client.post("/api/etl/run", cookies=auth)
    assert r.status_code == 202, r.json()
    assert r.json()["status"] == "started"
    mock_job.assert_called_once()
