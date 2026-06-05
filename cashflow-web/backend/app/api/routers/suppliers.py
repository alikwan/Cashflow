"""
app/api/routers/suppliers.py
=============================
GET /api/suppliers

Returns the 14 canonical suppliers with per-supplier monthly payment data,
cap information, current balance, and utilization metrics.

Shape per supplier (mirrors data.js SUPPLIERS):
  id          — suppliers.account_id (used as the external identity)
  name        — suppliers.name
  cap         — active SupplierCap.monthly_cap_m (greatest effective_from <= today)
  currency    — suppliers.currency
  monthly     — last-12 PerSupplierMonthly.paid_m values, ordered ascending
  over_cap    — count of months where paid_m > cap (only when cap > 0; else 0)
  balance_m   — balances_snapshot.balance_iqd_m at latest snapshot for this account
  util        — avg(monthly) / cap  if cap > 0 and monthly non-empty, else null
  active      — suppliers.active

Ordered by suppliers.display_order.

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.routers._utils import latest_snapshot_date, load_active_caps
from app.api.schemas import SupplierOut, SuppliersResponse
from app.db.models import BalancesSnapshot, PerSupplierMonthly, Supplier

router = APIRouter(prefix="/api", tags=["read"])


@router.get("/suppliers", response_model=SuppliersResponse)
def get_suppliers(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> SuppliersResponse:
    today: date = date.today()

    # ------------------------------------------------------------------
    # 1. All suppliers, ordered by display_order
    # ------------------------------------------------------------------
    supplier_rows: list[Supplier] = (
        db.query(Supplier)
        .order_by(Supplier.display_order.asc())
        .all()
    )
    if not supplier_rows:
        return SuppliersResponse(suppliers=[])

    supplier_ids = [s.id for s in supplier_rows]
    account_ids  = [s.account_id for s in supplier_rows]

    # ------------------------------------------------------------------
    # 2. Active cap per supplier: greatest effective_from <= today (bulk)
    # ------------------------------------------------------------------
    active_cap: dict[int, float] = load_active_caps(db, supplier_ids, today)

    # ------------------------------------------------------------------
    # 3. Last-12 per_supplier_monthly rows per supplier
    # ------------------------------------------------------------------
    # Fetch all rows for these account_ids, sorted ascending, and take
    # the last 12 in Python (simpler than a window function in SQLite).
    all_psm: list[PerSupplierMonthly] = (
        db.query(PerSupplierMonthly)
        .filter(PerSupplierMonthly.supplier_account_id.in_(account_ids))
        .order_by(
            PerSupplierMonthly.supplier_account_id.asc(),
            PerSupplierMonthly.year_month.asc(),
        )
        .all()
    )
    # Group by account_id → sorted list of paid_m
    psm_by_account: dict[int, list[float]] = defaultdict(list)
    for row in all_psm:
        psm_by_account[row.supplier_account_id].append(float(row.paid_m))
    # Trim to last 12
    for aid in psm_by_account:
        psm_by_account[aid] = psm_by_account[aid][-12:]

    # ------------------------------------------------------------------
    # 4. Latest balances_snapshot for supplier accounts
    # ------------------------------------------------------------------
    latest_snap: date | None = latest_snapshot_date(db, ["supplier"])
    balance_by_account: dict[int, float] = {}
    if latest_snap is not None:
        snap_rows: list[BalancesSnapshot] = (
            db.query(BalancesSnapshot)
            .filter(
                BalancesSnapshot.snapshot_date == latest_snap,
                BalancesSnapshot.account_kind == "supplier",
                BalancesSnapshot.account_id.in_(account_ids),
            )
            .all()
        )
        for row in snap_rows:
            balance_by_account[row.account_id] = float(row.balance_iqd_m)

    # ------------------------------------------------------------------
    # 5. Assemble response
    # ------------------------------------------------------------------
    result: list[SupplierOut] = []
    for sup in supplier_rows:
        cap = active_cap.get(sup.id, 0.0)
        monthly = psm_by_account.get(sup.account_id, [])
        balance_m = balance_by_account.get(sup.account_id, 0.0)

        # over_cap: count months where paid_m > cap (only when cap > 0)
        over_cap = 0
        if cap > 0:
            over_cap = sum(1 for m in monthly if m > cap)

        # util: avg(monthly) / cap if cap > 0 and monthly non-empty
        util: Optional[float] = None
        if cap > 0 and monthly:
            util = (sum(monthly) / len(monthly)) / cap

        result.append(SupplierOut(
            id=sup.account_id,
            name=sup.name,
            cap=cap,
            currency=sup.currency or "IQD",
            monthly=monthly,
            over_cap=over_cap,
            balance_m=balance_m,
            util=util,
            active=sup.active,
        ))

    return SuppliersResponse(suppliers=result)
