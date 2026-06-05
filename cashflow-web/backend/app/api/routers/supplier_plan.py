"""
app/api/routers/supplier_plan.py
==================================
GET /api/supplier-plan?month=YYYY-MM&scenarioId=<optional>

Computes the predictive dinar-pool distribution for one forecast month using
Option-1: dollar suppliers are funded via siyrafa and excluded from the pool.

Pool = forecast_in − salaries − purchases − refunds − partners − siyrafa − reserve
       (all values read from forecast_base for the requested month)

Calls domain.allocation.compute_pool + domain.allocation.allocate_dinar.
USD suppliers get allocated_m=0 by design (the 'allocate_dinar' function handles this).

Auth: requires valid session cookie (get_current_user dependency).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.routers._utils import load_active_caps
from app.api.schemas import AllocEntry, SupplierPlanResponse
from app.db.models import (
    Assumption,
    ForecastBase,
    PerSupplierMonthly,
    Supplier,
)
from app.domain.allocation import allocate_dinar, compute_pool

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
    scenarioId: int | None = Query(default=None),  # noqa: N803 — matches spec param name
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
    # 2. Read forecast_base values for the requested month
    # ------------------------------------------------------------------
    fb_rows: list[ForecastBase] = (
        db.query(ForecastBase)
        .filter(
            ForecastBase.engine == "seasonal",
            ForecastBase.year_month == month,
        )
        .all()
    )
    series: dict[str, float] = {r.series_key: float(r.value_m) for r in fb_rows}

    forecast_in  = series.get("cash_in",       0.0)
    salaries     = series.get("out_salaries",   0.0)
    purchases    = series.get("out_purchases",  0.0)
    refunds      = series.get("out_refunds",    0.0)
    partners     = series.get("out_drawings",   0.0)
    siyrafa      = series.get("out_siyrafa",    0.0)

    # ------------------------------------------------------------------
    # 3. Compute the dinar pool (domain function)
    # ------------------------------------------------------------------
    pool_m: float = compute_pool(
        forecast_in, salaries, purchases, refunds, partners, siyrafa, reserve_m
    )

    # ------------------------------------------------------------------
    # 4. Build the suppliers list for allocate_dinar
    #    - ordered by display_order
    #    - cap = most-recent effective supplier_cap (effective_from <= today)
    #    - share = historical paid_m fraction among dinar suppliers
    # ------------------------------------------------------------------
    today = date.today()

    suppliers: list[Supplier] = (
        db.query(Supplier)
        .filter(Supplier.active.is_(True))
        .order_by(Supplier.display_order.asc())
        .all()
    )

    supplier_ids  = [sup.id         for sup in suppliers]
    account_ids   = [sup.account_id for sup in suppliers]

    # Active cap per supplier — one bulk query (avoids N+1 per-supplier queries).
    active_cap: dict[int, float] = load_active_caps(db, supplier_ids, today)

    # Historical paid_m totals per supplier account_id — filtered to active suppliers.
    # Reused below for per-month actuals (step 6).
    all_psm: list[PerSupplierMonthly] = (
        db.query(PerSupplierMonthly)
        .filter(PerSupplierMonthly.supplier_account_id.in_(account_ids))
        .all()
    )
    paid_totals: dict[int, float] = {}
    for row in all_psm:
        paid_totals[row.supplier_account_id] = (
            paid_totals.get(row.supplier_account_id, 0.0) + float(row.paid_m)
        )

    # Sum of paid_m for dinar (non-USD) suppliers only
    dinar_total: float = sum(
        paid_totals.get(sup.account_id, 0.0)
        for sup in suppliers
        if sup.currency != "USD"
    )
    dinar_count: int = sum(1 for sup in suppliers if sup.currency != "USD")

    # Build supplier dict list expected by allocate_dinar:
    # {id, name, currency, cap, share}
    # USD suppliers have share=0 (allocate_dinar zeroes them anyway).
    # A dinar supplier with zero payment history gets share=0 (excluded from pool
    # until it accumulates history); the equal-fallback only applies when ALL dinar
    # suppliers have zero history.
    supplier_list: list[dict] = []
    for sup in suppliers:
        cap: float = active_cap.get(sup.id, 0.0)

        if sup.currency == "USD":
            share = 0.0
        elif dinar_total > 0:
            share = paid_totals.get(sup.account_id, 0.0) / dinar_total
        else:
            # Fallback: equal shares among dinar suppliers
            share = 1.0 / dinar_count if dinar_count > 0 else 0.0

        supplier_list.append({
            "id":       sup.account_id,
            "name":     sup.name,
            "currency": sup.currency or "IQD",
            "cap":      cap,
            "share":    share,
        })

    # ------------------------------------------------------------------
    # 5. Run the allocation (domain function)
    # ------------------------------------------------------------------
    result = allocate_dinar(pool_m, supplier_list)

    # ------------------------------------------------------------------
    # 6. Attach actual_paid_m for the requested month (optional, for UI)
    #    Reuses the filtered per_supplier_monthly rows loaded in step 4.
    # ------------------------------------------------------------------
    actual_by_aid: dict[int, float] = {}
    for row in all_psm:
        if row.year_month == month:
            actual_by_aid[row.supplier_account_id] = float(row.paid_m)

    alloc_entries: list[AllocEntry] = []
    for a in result["alloc"]:
        alloc_entries.append(AllocEntry(
            id=a["id"],
            name=a["name"],
            currency=a["currency"],
            allocated_m=a["allocated_m"],
            actual_paid_m=actual_by_aid.get(a["id"]),
        ))

    return SupplierPlanResponse(
        month=month,
        pool_m=pool_m,
        alloc=alloc_entries,
        leftover_m=result["leftover_m"],
    )
