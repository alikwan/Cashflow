"""
app/api/audit.py
================
Unified audit helper — reusable across all write endpoints (D1, D2, …).

Usage (caller commits so that write + audit are one transaction):

    from app.api.audit import record_audit, to_audit_dict
    before_dict = to_audit_dict(obj)   # capture BEFORE mutation
    # … mutate obj …
    record_audit(db, user, "update_thing", "thing", obj.id,
                 before=before_dict, after=to_audit_dict(obj))
    db.commit()
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import AuditLog


# ---------------------------------------------------------------------------
# Public serialisation helper
# ---------------------------------------------------------------------------

def _coerce(v: Any) -> Any:
    """Convert types that are not JSON-serializable to plain Python primitives."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def to_audit_dict(obj: Any) -> dict | None:
    """
    Convert an SQLAlchemy ORM row (or a plain dict) to a JSON-serializable dict.

    Call this BEFORE mutating the ORM object to capture a before-snapshot.
    Routers import this directly so they can capture state at the right moment.

    - If obj is already a dict, coerce values only.
    - If obj is an ORM instance, use its __table__.columns to enumerate columns.
    - If obj is None, return None.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _coerce(v) for k, v in obj.items()}
    # ORM instance
    try:
        cols = obj.__table__.columns.keys()
    except AttributeError:
        return {"value": str(obj)}
    return {col: _coerce(getattr(obj, col)) for col in cols}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def record_audit(
    db: Session,
    user: Any,
    action: str,
    entity: str,
    entity_id: Any,
    *,
    before: Any = None,
    after: Any = None,
) -> AuditLog:
    """
    Append an AuditLog row to the session (does NOT commit — caller commits).

    Parameters
    ----------
    db         : SQLAlchemy session (same one used by the calling router).
    user       : authenticated User ORM instance (user.id must exist).
    action     : machine-readable action string e.g. "create_cap".
    entity     : entity type string e.g. "supplier_cap".
    entity_id  : primary key or logical id of the affected row (coerced to str).
    before     : snapshot before the change (ORM row, dict, or None).
    after      : snapshot after the change  (ORM row, dict, or None).

    Returns the (unflushed) AuditLog row for inspection in tests.
    """
    before_dict = before if isinstance(before, dict) or before is None else to_audit_dict(before)
    after_dict  = after  if isinstance(after,  dict) or after  is None else to_audit_dict(after)

    log = AuditLog(
        user_id=user.id if user is not None else None,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        before_json=before_dict,
        after_json=after_dict,
    )
    db.add(log)
    return log
