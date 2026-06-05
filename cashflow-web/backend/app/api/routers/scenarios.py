"""
app/api/routers/scenarios.py
=============================
CRUD for Scenarios + per-scenario Assumptions upsert.

Endpoints (all auth-protected):
  GET    /api/scenarios                       → list scenarios
  POST   /api/scenarios                       → create scenario (audit create_scenario)
  PUT    /api/scenarios/{id}                  → update scenario (audit update_scenario)
  DELETE /api/scenarios/{id}                  → delete scenario (audit delete_scenario)
  PUT    /api/scenarios/{id}/assumptions      → upsert assumptions (audit update_assumptions)

Conflict (409) rules:
  - is_baseline=True when one already exists  → uq_one_baseline_scenario index fires.
  - DELETE with dependent rows (FK violation) → caught as IntegrityError.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.audit import record_audit, to_audit_dict
from app.api.deps import get_current_user, get_session
from app.api.errors import ApiError
from app.api.schemas import (
    AssumptionOut,
    AssumptionUpdate,
    ScenarioCreate,
    ScenarioOut,
    ScenarioUpdate,
)
from app.db.models import Assumption, Scenario

router = APIRouter(prefix="/api", tags=["scenarios"])


# ---------------------------------------------------------------------------
# GET /api/scenarios
# ---------------------------------------------------------------------------

@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> list[ScenarioOut]:
    rows = db.query(Scenario).order_by(Scenario.id.asc()).all()
    return [
        ScenarioOut(
            id=s.id,
            name=s.name,
            kind=s.kind,
            is_baseline=s.is_baseline,
            description=s.description,
        )
        for s in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/scenarios
# ---------------------------------------------------------------------------

@router.post("/scenarios", response_model=ScenarioOut, status_code=201)
def create_scenario(
    body: ScenarioCreate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> ScenarioOut:
    """Create a new scenario. 409 if is_baseline=True and one already exists."""
    scenario = Scenario(
        name=body.name,
        kind=body.kind,
        is_baseline=body.is_baseline,
        description=body.description,
        created_by=user.id,
    )

    try:
        db.add(scenario)
        db.flush()  # get scenario.id — may raise IntegrityError on duplicate baseline

        record_audit(
            db, user,
            action="create_scenario",
            entity="scenario",
            entity_id=scenario.id,
            before=None,
            after=to_audit_dict(scenario),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("conflict", "يوجد سيناريو أساسي بالفعل", 409)

    return ScenarioOut(
        id=scenario.id,
        name=scenario.name,
        kind=scenario.kind,
        is_baseline=scenario.is_baseline,
        description=scenario.description,
    )


# ---------------------------------------------------------------------------
# PUT /api/scenarios/{id}
# ---------------------------------------------------------------------------

@router.put("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(
    scenario_id: int,
    body: ScenarioUpdate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> ScenarioOut:
    """Update a scenario. 404 if not found; 409 on duplicate baseline."""
    scenario: Scenario | None = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if scenario is None:
        raise ApiError("not_found", f"السيناريو {scenario_id} غير موجود", 404)

    before_dict = to_audit_dict(scenario)

    if body.name is not None:
        scenario.name = body.name
    if body.kind is not None:
        scenario.kind = body.kind
    if body.description is not None:
        scenario.description = body.description
    if body.is_baseline is not None:
        scenario.is_baseline = body.is_baseline

    try:
        db.flush()  # may raise IntegrityError on duplicate baseline

        record_audit(
            db, user,
            action="update_scenario",
            entity="scenario",
            entity_id=scenario.id,
            before=before_dict,
            after=to_audit_dict(scenario),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("conflict", "يوجد سيناريو أساسي بالفعل", 409)

    return ScenarioOut(
        id=scenario.id,
        name=scenario.name,
        kind=scenario.kind,
        is_baseline=scenario.is_baseline,
        description=scenario.description,
    )


# ---------------------------------------------------------------------------
# DELETE /api/scenarios/{id}
# ---------------------------------------------------------------------------

@router.delete("/scenarios/{scenario_id}")
def delete_scenario(
    scenario_id: int,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> dict:
    """Delete a scenario. 404 if not found; 409 if dependent rows exist."""
    scenario: Scenario | None = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if scenario is None:
        raise ApiError("not_found", f"السيناريو {scenario_id} غير موجود", 404)

    before_dict = to_audit_dict(scenario)

    # Also delete linked assumptions (orphan cleanup before FK check)
    db.query(Assumption).filter(Assumption.scenario_id == scenario_id).delete(
        synchronize_session=False
    )

    db.delete(scenario)

    record_audit(
        db, user,
        action="delete_scenario",
        entity="scenario",
        entity_id=scenario_id,
        before=before_dict,
        after=None,
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("conflict", "لا يمكن حذف سيناريو مرتبط ببيانات", 409)

    return {"deleted": scenario_id}


# ---------------------------------------------------------------------------
# PUT /api/scenarios/{id}/assumptions
# ---------------------------------------------------------------------------

@router.put("/scenarios/{scenario_id}/assumptions", response_model=AssumptionOut)
def upsert_assumptions(
    scenario_id: int,
    body: AssumptionUpdate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> AssumptionOut:
    """
    Upsert the Assumption row for the given scenario.
    - 404 if scenario not found.
    - If a row already exists: update provided fields (before=old snapshot).
    - If no row: insert.
    - Audit action=update_assumptions in the same transaction.
    """
    # Confirm scenario exists
    scenario: Scenario | None = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if scenario is None:
        raise ApiError("not_found", f"السيناريو {scenario_id} غير موجود", 404)

    existing: Assumption | None = (
        db.query(Assumption).filter(Assumption.scenario_id == scenario_id).first()
    )
    before_dict = to_audit_dict(existing)  # None if no row yet

    if existing is None:
        row = Assumption(scenario_id=scenario_id)
        db.add(row)
    else:
        row = existing

    # Apply only fields explicitly provided in the body (non-None)
    update_data = body.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(row, field, Decimal(str(value)) if isinstance(value, float) else value)

    try:
        db.flush()  # INSERT may raise IntegrityError on uq_assumptions_per_scenario race

        record_audit(
            db, user,
            action="update_assumptions",
            entity="assumptions",
            entity_id=scenario_id,
            before=before_dict,
            after=to_audit_dict(row),
        )

        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("conflict", "افتراضات لهذا السيناريو موجودة مسبقاً", 409)

    db.refresh(row)

    def _opt_float(v) -> float | None:
        return float(v) if v is not None else None

    return AssumptionOut(
        id=row.id,
        scenario_id=row.scenario_id,
        usd_rate=_opt_float(row.usd_rate),
        unexpected_reserve_m=_opt_float(row.unexpected_reserve_m),
        income_growth_pct=_opt_float(row.income_growth_pct),
        in_growth_factor=_opt_float(row.in_growth_factor),
        out_growth_factor=_opt_float(row.out_growth_factor),
        cagr_floor=_opt_float(row.cagr_floor),
        cagr_cap=_opt_float(row.cagr_cap),
        forecast_horizon=row.forecast_horizon,
        fiscal_year_start_month=row.fiscal_year_start_month,
        forecast_engine=row.forecast_engine,
    )
