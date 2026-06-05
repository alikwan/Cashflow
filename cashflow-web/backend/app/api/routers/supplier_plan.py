"""
app/api/routers/supplier_plan.py
==================================
GET /api/supplier-plan?month=YYYY-MM&scenario_id=<optional>

Computes the predictive dinar-pool distribution for one forecast month using
Option-1: dollar suppliers are funded via siyrafa and excluded from the pool.

Pool = forecast_in − salaries − purchases − refunds − partners − siyrafa − reserve
       (all values read from forecast_base for the requested month)

Calls domain.allocation.compute_pool + domain.allocation.allocate_dinar via
the shared compute_month_allocation helper in app.api.planning.

USD suppliers get allocated_m=0 by design (the 'allocate_dinar' function handles this).

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.planning import compute_month_allocation
from app.api.schemas import AllocEntry, SupplierPlanResponse
from app.db.models import Assumption, PerSupplierMonthly

router = APIRouter(prefix="/api/supplier-plan", tags=["read"])


@router.get("", response_model=SupplierPlanResponse)
def get_supplier_plan(
    month: Annotated[
        str,
        Query(
            description="Forecast month in YYYY-MM format",
            pattern=r"^\d{4}-(0[1-9]|1[0-2])$",
        ),
    ],
    scenario_id: int | None = Query(default=None),  # noqa: ARG001 — accepted for API symmetry; per-scenario plan is a future extension
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> SupplierPlanResponse:
    # ------------------------------------------------------------------
    # 1. Global assumptions: reserve_m
    # ------------------------------------------------------------------
    global_assump: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )
    reserve_m: float = float(global_assump.unexpected_reserve_m) if (
        global_assump and global_assump.unexpected_reserve_m is not None
    ) else 15.0

    # ------------------------------------------------------------------
    # 2. Compute allocation via shared planner
    # ------------------------------------------------------------------
    plan = compute_month_allocation(db, month, reserve_m)

    pool_m     = plan["pool_m"]
    alloc_raw  = plan["alloc"]
    leftover_m = plan["leftover_m"]
    all_psm: list[PerSupplierMonthly] = plan["_all_psm"]

    # ------------------------------------------------------------------
    # 3. Attach actual_paid_m for the requested month (optional, for UI)
    # ------------------------------------------------------------------
    actual_by_aid: dict[int, float] = {}
    for row in all_psm:
        if row.year_month == month:
            actual_by_aid[row.supplier_account_id] = float(row.paid_m)

    alloc_entries: list[AllocEntry] = []
    for a in alloc_raw:
        alloc_entries.append(AllocEntry(
            id=a["id"],           # account_id — unchanged response field
            name=a["name"],
            currency=a["currency"],
            allocated_m=a["allocated_m"],
            actual_paid_m=actual_by_aid.get(a["id"]),
        ))

    return SupplierPlanResponse(
        month=month,
        pool_m=pool_m,
        alloc=alloc_entries,
        leftover_m=leftover_m,
    )
