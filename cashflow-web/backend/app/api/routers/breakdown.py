"""
app/api/routers/breakdown.py
=============================
GET /api/breakdown

Returns expense category breakdown and balance data for the analysis page.

Shape:
  expense_cats  — list of 6 categories with totals + monthly series
  partners      — balances_snapshot rows where account_kind='partner', desc by balance
  funds         — balances_snapshot rows where account_kind='cashbox'

Expense category → monthly_cashflow column mapping (spec §C2):
  suppliers → out_suppliers_m
  partners  → out_drawings_m   (partner withdrawals, AccountTypeId 2518)
  siyrafa   → out_siyrafa_m    (currency exchange, OperationsType 7)
  purchases → out_purchases_m
  salaries  → out_salaries_m
  refunds   → out_refunds_m

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import (
    BalanceEntryOut,
    BreakdownResponse,
    ExpenseCatMonthly,
    ExpenseCatOut,
)
from app.db.models import BalancesSnapshot, MonthlyCashflow

# Ordered list of (key, column_attr_name) — order mirrors data.js EXP_CATS
_EXPENSE_CATS: list[tuple[str, str]] = [
    ("suppliers", "out_suppliers_m"),
    ("partners",  "out_drawings_m"),
    ("siyrafa",   "out_siyrafa_m"),
    ("purchases", "out_purchases_m"),
    ("salaries",  "out_salaries_m"),
    ("refunds",   "out_refunds_m"),
]

router = APIRouter(prefix="/api", tags=["read"])


@router.get("/breakdown", response_model=BreakdownResponse)
def get_breakdown(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> BreakdownResponse:
    # ------------------------------------------------------------------
    # 1. Monthly cashflow rows (ascending)
    # ------------------------------------------------------------------
    cf_rows: list[MonthlyCashflow] = (
        db.query(MonthlyCashflow)
        .order_by(MonthlyCashflow.year_month.asc())
        .all()
    )

    # ------------------------------------------------------------------
    # 2. Build expense_cats
    # ------------------------------------------------------------------
    expense_cats: list[ExpenseCatOut] = []
    for key, col in _EXPENSE_CATS:
        monthly_entries: list[ExpenseCatMonthly] = []
        total = 0.0
        for r in cf_rows:
            val = float(getattr(r, col))
            total += val
            monthly_entries.append(ExpenseCatMonthly(year_month=r.year_month, amount_m=val))
        expense_cats.append(ExpenseCatOut(
            key=key,
            column=col,
            total_m=total,
            monthly=monthly_entries,
        ))

    # ------------------------------------------------------------------
    # 3. Latest snapshot_date from balances_snapshot
    # ------------------------------------------------------------------
    latest_snap: date | None = (
        db.query(BalancesSnapshot.snapshot_date)
        .order_by(BalancesSnapshot.snapshot_date.desc())
        .limit(1)
        .scalar()
    )

    partners: list[BalanceEntryOut] = []
    funds: list[BalanceEntryOut] = []

    if latest_snap is not None:
        snap_rows: list[BalancesSnapshot] = (
            db.query(BalancesSnapshot)
            .filter(
                BalancesSnapshot.snapshot_date == latest_snap,
                BalancesSnapshot.account_kind.in_(["partner", "cashbox"]),
            )
            .all()
        )
        for row in snap_rows:
            entry = BalanceEntryOut(
                account_id=row.account_id,
                name=row.account_name or "",
                balance_m=float(row.balance_iqd_m),
            )
            if row.account_kind == "partner":
                partners.append(entry)
            else:
                funds.append(entry)

        # Sort partners descending by balance_m
        partners.sort(key=lambda p: p.balance_m, reverse=True)

    return BreakdownResponse(
        expense_cats=expense_cats,
        partners=partners,
        funds=funds,
    )
