"""
app/api/routers/etl.py — ETL control endpoints.

POST /api/etl/run
    Synchronously pre-checks the single-flight lock (no MSSQL in request path),
    then schedules run_etl_job as a FastAPI BackgroundTask.
    Returns 202 {"status": "started"} when accepted, 409 when already running.
    Auth-protected.

GET /api/etl/status
    Returns the latest EtlRun row (by id desc) as a lightweight status object.
    Returns {"status": "never", ...} when no runs exist yet.
    Auth-protected.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.errors import ApiError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/etl", tags=["etl"])


# ---------------------------------------------------------------------------
# Shared background runner
# ---------------------------------------------------------------------------

def run_etl_job() -> None:
    """Open fresh DB + MSSQL connections, run the full ETL, close both.

    Called by both the manual endpoint (via BackgroundTasks) and the nightly
    APScheduler job.

    Observability note: a real failure inside run_etl() marks its EtlRun row
    'failed' (visible in /api/etl/status) before re-raising. But an
    ETLAlreadyRunning lock rejection is raised BEFORE any row is created, so it
    produces no EtlRun row — it is logged at INFO level here (a skipped run, not
    a failure) to keep it distinct in the logs.
    """
    from app.db.base import SessionLocal
    from app.etl.extract import connect_mssql
    from app.etl import pipeline

    session = SessionLocal()
    conn = None
    try:
        conn = connect_mssql()
        pipeline.run_etl(session, conn)
        logger.info("ETL job completed successfully.")
    except pipeline.ETLAlreadyRunning:
        logger.info("ETL job skipped: another run is already in progress.")
    except Exception:
        logger.exception("ETL job failed.")
    finally:
        try:
            session.close()
        except Exception:
            logger.exception("ETL: failed to close Postgres session.")
        if conn is not None:
            try:
                conn.close()
            except Exception:
                logger.exception("ETL: failed to close MSSQL connection.")


# ---------------------------------------------------------------------------
# POST /api/etl/run
# ---------------------------------------------------------------------------

@router.post("/run", status_code=202)
def trigger_etl(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
):
    """Manually trigger the ETL pipeline in the background.

    The single-flight lock is checked synchronously (Postgres only — no MSSQL
    touched in the request path).  If already running → 409.  Otherwise the
    background job is enqueued and 202 is returned immediately.
    """
    # Import via module reference so monkeypatch in tests works correctly.
    from app.etl import pipeline

    if pipeline._has_running_etl(db):
        raise ApiError("etl_running", "تحديث قيد التشغيل بالفعل", 409)

    background_tasks.add_task(run_etl_job)
    return {"status": "started"}


# ---------------------------------------------------------------------------
# GET /api/etl/status
# ---------------------------------------------------------------------------

@router.get("/status")
def get_etl_status(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
):
    """Return the latest EtlRun as a lightweight status object.

    Required keys in response:
      status                    — 'success'|'failed'|'running'|'never'
      last_run_at               — ISO datetime string or null
      reconciliation_residual_m — numeric or null
    """
    from app.db.models import EtlRun

    run: EtlRun | None = (
        db.query(EtlRun).order_by(EtlRun.id.desc()).first()
    )

    if run is None:
        return {
            "status": "never",
            "last_run_at": None,
            "reconciliation_residual_m": None,
        }

    # Prefer finished_at over started_at for last_run_at
    last_run_at = run.finished_at or run.started_at
    last_run_at_str = last_run_at.isoformat() if last_run_at is not None else None

    residual = (
        float(run.reconciliation_residual_m)
        if run.reconciliation_residual_m is not None
        else None
    )

    return {
        "status": run.status,
        "last_run_at": last_run_at_str,
        "reconciliation_residual_m": residual,
        # Extra informational fields (not required by spec, but useful)
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "rows_loaded": run.rows_loaded,
        "usd_rate_used": float(run.usd_rate_used) if run.usd_rate_used is not None else None,
        "error_message": run.error_message,
    }
