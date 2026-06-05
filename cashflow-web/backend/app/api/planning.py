"""
app/api/planning.py
====================
Shared planner helper reused by BOTH supplier_plan (read) and payment_plans (write).

compute_month_allocation(db, year_month, reserve_m) → dict with keys:
  pool_m      : float  — distributable dinar pool for the month
  alloc       : list[dict]  — allocate_dinar output entries
                  each: {id (account_id), supplier_id (pk), name, currency, allocated_m}
  leftover_m  : float  — un-allocated remainder
  suppliers   : list[dict]  — supplier dicts passed to allocate_dinar (for audit/debug)

The supplier_plan router adds actual_paid_m on top; payment_plans builds plan lines.
supplier_plan's JSON response shape is unchanged — it maps id/name/currency/allocated_m
from alloc and fetches actual_paid_m separately (same as before).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.api.routers._utils import load_active_caps
from app.db.models import (
    Assumption,
    ForecastBase,
    PerSupplierMonthly,
    Supplier,
)
from app.domain.allocation import allocate_dinar, compute_pool


def compute_month_allocation(
    db: Session,
    year_month: str,
    reserve_m: float,
) -> dict:
    """
    Return allocation dict for one forecast month.

    Keys:
      pool_m      float
      alloc       list[dict]  — {id(account_id), supplier_id(pk), name, currency, allocated_m}
      leftover_m  float
      suppliers   list[dict]  — intermediate supplier dicts (for debugging / plan lines)
      _all_psm    list[PerSupplierMonthly]  — internal: ALL per_supplier_monthly rows for
                    suppliers in this call (not filtered to year_month); consumed by
                    supplier_plan.py to avoid a second DB query when building actual_paid_m.
                    Callers outside the router layer should not rely on this key.

    The `id` field in alloc entries is account_id (mirrors the existing supplier-plan contract).
    The `supplier_id` field is the suppliers.id PK (needed by payment_plan_lines FK).
    """
    # ------------------------------------------------------------------
    # 1. Read forecast_base values for the requested month
    # ------------------------------------------------------------------
    fb_rows: list[ForecastBase] = (
        db.query(ForecastBase)
        .filter(
            ForecastBase.engine == "seasonal",
            ForecastBase.year_month == year_month,
        )
        .all()
    )
    series: dict[str, float] = {r.series_key: float(r.value_m) for r in fb_rows}

    forecast_in = series.get("cash_in",       0.0)
    salaries    = series.get("out_salaries",   0.0)
    purchases   = series.get("out_purchases",  0.0)
    refunds     = series.get("out_refunds",    0.0)
    partners    = series.get("out_drawings",   0.0)
    siyrafa     = series.get("out_siyrafa",    0.0)

    # ------------------------------------------------------------------
    # 2. Compute the dinar pool
    # ------------------------------------------------------------------
    pool_m: float = compute_pool(
        forecast_in, salaries, purchases, refunds, partners, siyrafa, reserve_m
    )

    # ------------------------------------------------------------------
    # 3. Build the suppliers list for allocate_dinar
    # ------------------------------------------------------------------
    today = date.today()

    suppliers_orm: list[Supplier] = (
        db.query(Supplier)
        .filter(Supplier.active.is_(True))
        .order_by(Supplier.display_order.asc())
        .all()
    )

    supplier_ids = [sup.id         for sup in suppliers_orm]
    account_ids  = [sup.account_id for sup in suppliers_orm]

    # Active cap per supplier — bulk query
    active_cap: dict[int, float] = load_active_caps(db, supplier_ids, today)

    # Historical paid_m totals per supplier account_id
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

    dinar_total: float = sum(
        paid_totals.get(sup.account_id, 0.0)
        for sup in suppliers_orm
        if sup.currency != "USD"
    )
    dinar_count: int = sum(1 for sup in suppliers_orm if sup.currency != "USD")

    supplier_list: list[dict] = []
    for sup in suppliers_orm:
        cap: float = active_cap.get(sup.id, 0.0)

        if sup.currency == "USD":
            share = 0.0
        elif dinar_total > 0:
            share = paid_totals.get(sup.account_id, 0.0) / dinar_total
        else:
            share = 1.0 / dinar_count if dinar_count > 0 else 0.0

        supplier_list.append({
            "id":          sup.account_id,   # account_id — used by AllocEntry + response
            "supplier_id": sup.id,           # PK — needed for PaymentPlanLine FK
            "name":        sup.name,
            "currency":    sup.currency or "IQD",
            "cap":         cap,
            "share":       share,
        })

    # ------------------------------------------------------------------
    # 4. Run the allocation
    # ------------------------------------------------------------------
    result = allocate_dinar(pool_m, supplier_list)

    # Enrich alloc entries with supplier_id (pk) by matching on id (account_id)
    # allocate_dinar only propagates id/name/currency/allocated_m; we need supplier_id too.
    sid_by_account_id: dict[int, int] = {sup.account_id: sup.id for sup in suppliers_orm}
    enriched_alloc: list[dict] = []
    for entry in result["alloc"]:
        enriched_alloc.append({
            **entry,
            "supplier_id": sid_by_account_id.get(entry["id"], 0),
        })

    return {
        "pool_m":     pool_m,
        "alloc":      enriched_alloc,
        "leftover_m": result["leftover_m"],
        "suppliers":  supplier_list,
        # carry per-supplier_monthly for the requested month (used by reconcile)
        "_all_psm":   all_psm,
    }
