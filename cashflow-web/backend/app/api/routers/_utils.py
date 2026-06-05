"""
app/api/routers/_utils.py
==========================
Shared helpers for the read-endpoint routers.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import BalancesSnapshot, SupplierCap


def latest_snapshot_date(db: Session, kinds: list[str]) -> date | None:
    """Return the most recent balances_snapshot date among the given account_kinds, or None."""
    return (
        db.query(BalancesSnapshot.snapshot_date)
        .filter(BalancesSnapshot.account_kind.in_(kinds))
        .order_by(BalancesSnapshot.snapshot_date.desc())
        .limit(1)
        .scalar()
    )


def load_active_caps(
    db: Session,
    supplier_ids: list[int],
    today: date | None = None,
) -> dict[int, float]:
    """Map supplier_id -> active monthly_cap_m (greatest effective_from <= today), 0.0 if none.

    One bulk query; latest-wins by iterating effective_from ascending.
    """
    from datetime import date as _date
    today = today or _date.today()
    rows = (
        db.query(SupplierCap)
        .filter(
            SupplierCap.supplier_id.in_(supplier_ids),
            SupplierCap.effective_from <= today,
        )
        .order_by(SupplierCap.effective_from.asc())
        .all()
    )
    caps: dict[int, float] = {}
    for r in rows:
        caps[r.supplier_id] = float(r.monthly_cap_m)
    return caps
