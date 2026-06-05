"""
app/api/routers/payment_plans.py
===================================
CRUD + reconcile for PaymentPlan + PaymentPlanLine.

Endpoints (all auth-protected):
  POST   /api/payment-plans                    → create plan + lines (audit create_payment_plan)
  GET    /api/payment-plans                    → list plan headers (?scenario_id= &year_month=)
  GET    /api/payment-plans/{id}               → header + lines (404 if missing)
  PUT    /api/payment-plans/{id}               → update status (audit update_payment_plan)
  POST   /api/payment-plans/{id}/reconcile     → fill actual_paid_m from per_supplier_monthly
                                                  (idempotent; audit reconcile_payment_plan)

Conflict (409) rules:
  - Duplicate (year_month, scenario_id) → uq_plan_month_scenario fires.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.audit import record_audit, to_audit_dict
from app.api.deps import get_current_user, get_session
from app.api.errors import ApiError
from app.api.planning import compute_month_allocation
from app.api.schemas import (
    PaymentPlanCreate,
    PaymentPlanDetailOut,
    PaymentPlanLineOut,
    PaymentPlanOut,
    PaymentPlanStatusUpdate,
)
from app.db.models import (
    Assumption,
    PaymentPlan,
    PaymentPlanLine,
    PerSupplierMonthly,
    Scenario,
)

router = APIRouter(prefix="/api/payment-plans", tags=["payment-plans"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _line_out(line: PaymentPlanLine) -> PaymentPlanLineOut:
    return PaymentPlanLineOut(
        id=line.id,
        supplier_id=line.supplier_id,
        planned_m=float(line.planned_m),
        cap_applied_m=float(line.cap_applied_m),
        allocated_m=float(line.allocated_m),
        actual_paid_m=float(line.actual_paid_m),
        variance_m=float(line.variance_m),
    )


def _plan_detail_out(plan: PaymentPlan, db: Session) -> PaymentPlanDetailOut:
    lines = (
        db.query(PaymentPlanLine)
        .filter(PaymentPlanLine.payment_plan_id == plan.id)
        .all()
    )
    return PaymentPlanDetailOut(
        id=plan.id,
        year_month=plan.year_month,
        scenario_id=plan.scenario_id,
        pool_for_suppliers_m=float(plan.pool_for_suppliers_m),
        reserve_m=float(plan.reserve_m),
        status=plan.status,
        created_by=plan.created_by,
        created_at=plan.created_at,
        approved_at=plan.approved_at,
        lines=[_line_out(ln) for ln in lines],
    )


def _plan_out(plan: PaymentPlan) -> PaymentPlanOut:
    return PaymentPlanOut(
        id=plan.id,
        year_month=plan.year_month,
        scenario_id=plan.scenario_id,
        pool_for_suppliers_m=float(plan.pool_for_suppliers_m),
        reserve_m=float(plan.reserve_m),
        status=plan.status,
        created_by=plan.created_by,
        created_at=plan.created_at,
        approved_at=plan.approved_at,
    )


# ---------------------------------------------------------------------------
# POST /api/payment-plans
# ---------------------------------------------------------------------------

@router.post("", response_model=PaymentPlanDetailOut, status_code=201)
def create_payment_plan(
    body: PaymentPlanCreate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> PaymentPlanDetailOut:
    """Create a payment plan for (year_month, scenario_id).

    409 on duplicate (year_month, scenario_id).
    404 if scenario not found.
    """
    # Validate scenario exists
    scenario: Scenario | None = db.query(Scenario).filter(
        Scenario.id == body.scenario_id
    ).first()
    if scenario is None:
        raise ApiError("not_found", f"السيناريو {body.scenario_id} غير موجود", 404)

    # Read global reserve
    global_assump: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )
    reserve_m: float = float(global_assump.unexpected_reserve_m) if (
        global_assump and global_assump.unexpected_reserve_m is not None
    ) else 15.0

    # Compute allocation
    allocation = compute_month_allocation(db, body.year_month, reserve_m)
    pool_m     = allocation["pool_m"]
    alloc      = allocation["alloc"]

    plan = PaymentPlan(
        year_month=body.year_month,
        scenario_id=body.scenario_id,
        pool_for_suppliers_m=Decimal(str(pool_m)),
        reserve_m=Decimal(str(reserve_m)),
        status="draft",
        created_by=user.id,
    )

    try:
        db.add(plan)
        db.flush()  # get plan.id; may raise IntegrityError on duplicate

        for entry in alloc:
            allocated = entry["allocated_m"]
            # cap_applied_m: find the cap used during allocation (cap from supplier_list)
            cap_m = next(
                (s["cap"] for s in allocation["suppliers"] if s["id"] == entry["id"]),
                0.0,
            )
            line = PaymentPlanLine(
                payment_plan_id=plan.id,
                supplier_id=entry["supplier_id"],
                planned_m=Decimal(str(allocated)),
                cap_applied_m=Decimal(str(cap_m)),
                allocated_m=Decimal(str(allocated)),
                actual_paid_m=Decimal("0"),
                variance_m=Decimal(str(allocated)),
            )
            db.add(line)

        db.flush()

        record_audit(
            db, user,
            action="create_payment_plan",
            entity="payment_plan",
            entity_id=plan.id,
            before=None,
            after=to_audit_dict(plan),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("conflict", "خطة لنفس الشهر والسيناريو موجودة", 409)

    db.refresh(plan)
    return _plan_detail_out(plan, db)


# ---------------------------------------------------------------------------
# GET /api/payment-plans
# ---------------------------------------------------------------------------

@router.get("", response_model=list[PaymentPlanOut])
def list_payment_plans(
    scenario_id: int | None = Query(default=None),
    year_month: str | None = Query(default=None),
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> list[PaymentPlanOut]:
    q = db.query(PaymentPlan)
    if scenario_id is not None:
        q = q.filter(PaymentPlan.scenario_id == scenario_id)
    if year_month is not None:
        q = q.filter(PaymentPlan.year_month == year_month)
    plans = q.order_by(PaymentPlan.created_at.desc()).all()
    return [_plan_out(p) for p in plans]


# ---------------------------------------------------------------------------
# GET /api/payment-plans/{id}
# ---------------------------------------------------------------------------

@router.get("/{plan_id}", response_model=PaymentPlanDetailOut)
def get_payment_plan(
    plan_id: int,
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> PaymentPlanDetailOut:
    plan: PaymentPlan | None = db.query(PaymentPlan).filter(
        PaymentPlan.id == plan_id
    ).first()
    if plan is None:
        raise ApiError("not_found", f"خطة الدفع {plan_id} غير موجودة", 404)
    return _plan_detail_out(plan, db)


# ---------------------------------------------------------------------------
# PUT /api/payment-plans/{id}
# ---------------------------------------------------------------------------

@router.put("/{plan_id}", response_model=PaymentPlanDetailOut)
def update_payment_plan(
    plan_id: int,
    body: PaymentPlanStatusUpdate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> PaymentPlanDetailOut:
    plan: PaymentPlan | None = db.query(PaymentPlan).filter(
        PaymentPlan.id == plan_id
    ).first()
    if plan is None:
        raise ApiError("not_found", f"خطة الدفع {plan_id} غير موجودة", 404)

    before_dict = to_audit_dict(plan)
    plan.status = body.status
    if body.status == "approved" and plan.approved_at is None:
        plan.approved_at = datetime.now(timezone.utc)

    record_audit(
        db, user,
        action="update_payment_plan",
        entity="payment_plan",
        entity_id=plan.id,
        before=before_dict,
        after=to_audit_dict(plan),
    )
    db.commit()
    db.refresh(plan)
    return _plan_detail_out(plan, db)


# ---------------------------------------------------------------------------
# POST /api/payment-plans/{id}/reconcile
# ---------------------------------------------------------------------------

@router.post("/{plan_id}/reconcile", response_model=PaymentPlanDetailOut)
def reconcile_payment_plan(
    plan_id: int,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> PaymentPlanDetailOut:
    """Idempotent: fill each line's actual_paid_m from per_supplier_monthly
    for the plan's year_month (join on supplier_account_id via Supplier).

    Running twice yields identical results.
    """
    plan: PaymentPlan | None = db.query(PaymentPlan).filter(
        PaymentPlan.id == plan_id
    ).first()
    if plan is None:
        raise ApiError("not_found", f"خطة الدفع {plan_id} غير موجودة", 404)

    # Fetch lines
    lines: list[PaymentPlanLine] = (
        db.query(PaymentPlanLine)
        .filter(PaymentPlanLine.payment_plan_id == plan_id)
        .all()
    )

    # Build map: supplier_id (PK) → account_id from Supplier table
    from app.db.models import Supplier
    supplier_ids = [ln.supplier_id for ln in lines]
    suppliers_orm = (
        db.query(Supplier)
        .filter(Supplier.id.in_(supplier_ids))
        .all()
    )
    account_id_by_sup_id: dict[int, int] = {s.id: s.account_id for s in suppliers_orm}

    # actual paid_m for the plan's year_month per account_id
    psm_rows: list[PerSupplierMonthly] = (
        db.query(PerSupplierMonthly)
        .filter(PerSupplierMonthly.year_month == plan.year_month)
        .all()
    )
    actual_by_aid: dict[int, float] = {r.supplier_account_id: float(r.paid_m) for r in psm_rows}

    for line in lines:
        acct_id = account_id_by_sup_id.get(line.supplier_id, 0)
        actual = actual_by_aid.get(acct_id, 0.0)
        line.actual_paid_m = Decimal(str(actual))
        line.variance_m    = line.allocated_m - line.actual_paid_m

    record_audit(
        db, user,
        action="reconcile_payment_plan",
        entity="payment_plan",
        entity_id=plan_id,
        before=None,
        after={"plan_id": plan_id, "year_month": plan.year_month},
    )
    db.commit()
    db.refresh(plan)
    return _plan_detail_out(plan, db)
