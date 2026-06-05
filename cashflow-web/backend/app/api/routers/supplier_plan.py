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

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.api.schemas import AllocEntry, SupplierPlanResponse
from app.db.models import (
    Assumption,
    ForecastBase,
    PerSupplierMonthly,
    Supplier,
    SupplierCap,
)
from app.domain.allocation import allocate_dinar, compute_pool

router = APIRouter(prefix="/api/supplier-plan", tags=["read"])


@router.get("", response_model=SupplierPlanResponse)
def get_supplier_plan(
    month: str = Query(..., description="Forecast month in YYYY-MM format"),
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

    # Historical paid_m totals per supplier account_id over all per_supplier_monthly rows
    all_psm: list[PerSupplierMonthly] = db.query(PerSupplierMonthly).all()
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
    # USD suppliers have share=0 (allocate_dinar zeroes them anyway)
    supplier_list: list[dict] = []
    for sup in suppliers:
        # Active cap: greatest effective_from <= today
        cap_row: SupplierCap | None = (
            db.query(SupplierCap)
            .filter(
                SupplierCap.supplier_id == sup.id,
                SupplierCap.effective_from <= today,
            )
            .order_by(SupplierCap.effective_from.desc())
            .first()
        )
        cap: float = float(cap_row.monthly_cap_m) if cap_row else 0.0

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
