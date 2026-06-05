"""
app/api/routers/installments.py
================================
GET /api/installments

Returns installment portfolio data for the installments analysis page.

Shape:
  summary     — latest InstallmentsSummary row (InstallmentsSummaryOut), or null
  aging       — latest InstallmentsAging rows for that snapshot_date
  top_debtors — top ~10 BalancesSnapshot rows where account_kind='debtor',
                ordered descending by balance_iqd_m

Note on top_debtors: the analytical DB has no per-contract debtor breakdown;
`balances_snapshot` with account_kind='debtor' (AccountTypeId 1631 — instalment
customers) is the available proxy for largest outstanding balances. This gives
a directionally-correct ranking of largest debtor accounts, not individual
contract balances. A finer breakdown would require a per-contract ETL table
(future enhancement).

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.routers._utils import latest_snapshot_date
from app.api.schemas import (
    AgingBucketOut,
    BalanceEntryOut,
    InstallmentsResponse,
    InstallmentsSummaryOut,
)
from app.db.models import BalancesSnapshot, InstallmentsAging, InstallmentsSummary

# Preferred bucket ordering for display (not_due first, then ascending aging).
_BUCKET_ORDER: dict[str, int] = {
    "not_due": 0,
    "b0_30":   1,
    "b31_60":  2,
    "b61_90":  3,
    "b91_120": 4,
    "b120":    5,
}

router = APIRouter(prefix="/api", tags=["read"])


@router.get("/installments", response_model=InstallmentsResponse)
def get_installments(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> InstallmentsResponse:
    # ------------------------------------------------------------------
    # 1. Latest installments_summary row
    # ------------------------------------------------------------------
    inst_row: Optional[InstallmentsSummary] = (
        db.query(InstallmentsSummary)
        .order_by(InstallmentsSummary.snapshot_date.desc())
        .first()
    )
    summary: Optional[InstallmentsSummaryOut] = None
    latest_snap: Optional[date] = None
    if inst_row is not None:
        latest_snap = inst_row.snapshot_date
        summary = InstallmentsSummaryOut(
            premium_count=inst_row.premium_count,
            face_total_m=float(inst_row.face_total_m),
            cash_paid_m=float(inst_row.cash_paid_m),
            discount_m=float(inst_row.discount_m),
            remaining_m=float(inst_row.remaining_m),
        )

    # ------------------------------------------------------------------
    # 2. Aging buckets at latest snapshot_date
    # ------------------------------------------------------------------
    aging: list[AgingBucketOut] = []
    if latest_snap is not None:
        aging_rows: list[InstallmentsAging] = (
            db.query(InstallmentsAging)
            .filter(InstallmentsAging.snapshot_date == latest_snap)
            .all()
        )
        aging_rows.sort(
            key=lambda r: _BUCKET_ORDER.get(r.bucket_key, 99)
        )
        aging = [
            AgingBucketOut(
                bucket_key=row.bucket_key,
                label=row.label or row.bucket_key,
                amount_m=float(row.amount_m),
                count=row.count,
            )
            for row in aging_rows
        ]

    # ------------------------------------------------------------------
    # 3. Top debtors — latest balances_snapshot where account_kind='debtor'
    # ------------------------------------------------------------------
    debtor_snap: Optional[date] = latest_snapshot_date(db, ["debtor"])
    top_debtors: list[BalanceEntryOut] = []
    if debtor_snap is not None:
        debtor_rows: list[BalancesSnapshot] = (
            db.query(BalancesSnapshot)
            .filter(
                BalancesSnapshot.snapshot_date == debtor_snap,
                BalancesSnapshot.account_kind == "debtor",
            )
            .order_by(BalancesSnapshot.balance_iqd_m.desc())
            .limit(10)
            .all()
        )
        top_debtors = [
            BalanceEntryOut(
                account_id=row.account_id,
                name=row.account_name or "",
                balance_m=float(row.balance_iqd_m),
            )
            for row in debtor_rows
        ]

    return InstallmentsResponse(
        summary=summary,
        aging=aging,
        top_debtors=top_debtors,
    )
