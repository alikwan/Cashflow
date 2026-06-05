"""
app/api/routers/_utils.py
==========================
Shared helpers for the read-endpoint routers.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import BalancesSnapshot


def latest_snapshot_date(db: Session, kinds: list[str]) -> date | None:
    """Return the most recent balances_snapshot date among the given account_kinds, or None."""
    return (
        db.query(BalancesSnapshot.snapshot_date)
        .filter(BalancesSnapshot.account_kind.in_(kinds))
        .order_by(BalancesSnapshot.snapshot_date.desc())
        .limit(1)
        .scalar()
    )
