"""
app/api/routers/alerts.py
===========================
Alert read + acknowledge endpoints.

Endpoints (all auth-protected):
  GET  /api/alerts            → active alerts (status != 'resolved'), newest first
  POST /api/alerts/{id}/ack   → idempotent acknowledge: status→'read', acknowledged_by/at set
                                 (audit ack_alert; 404 if missing)
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.audit import record_audit, to_audit_dict
from app.api.deps import get_current_user, get_session
from app.api.errors import ApiError
from app.api.schemas import AlertDetailOut, AlertsListOut
from app.db.models import Alert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


# ---------------------------------------------------------------------------
# GET /api/alerts
# ---------------------------------------------------------------------------

@router.get("", response_model=AlertsListOut)
def list_active_alerts(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> AlertsListOut:
    rows: list[Alert] = (
        db.query(Alert)
        .filter(Alert.status != "resolved")
        .order_by(Alert.generated_at.desc())
        .all()
    )
    return AlertsListOut(alerts=[AlertDetailOut.model_validate(a) for a in rows])


# ---------------------------------------------------------------------------
# POST /api/alerts/{id}/ack
# ---------------------------------------------------------------------------

@router.post("/{alert_id}/ack", response_model=AlertDetailOut)
def ack_alert(
    alert_id: int,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> AlertDetailOut:
    """Idempotent acknowledge — acking a 'read' alert keeps it 'read'."""
    alert: Alert | None = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert is None:
        raise ApiError("not_found", f"التنبيه {alert_id} غير موجود", 404)

    before_dict = to_audit_dict(alert)

    if alert.status != "read":
        alert.status = "read"
    # Always refresh acknowledged_by/at (idempotent re-ack just updates timestamp)
    alert.acknowledged_by = user.id
    alert.acknowledged_at = datetime.now(timezone.utc)

    record_audit(
        db, user,
        action="ack_alert",
        entity="alert",
        entity_id=alert_id,
        before=before_dict,
        after=to_audit_dict(alert),
    )
    db.commit()
    db.refresh(alert)

    return AlertDetailOut.model_validate(alert)
