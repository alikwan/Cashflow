"""
app/api/routers/settings.py
==============================
Application settings: display prefs (AppSettings row id=1) +
global financial assumptions (Assumption row with scenario_id IS NULL).

Endpoints (all auth-protected):
  GET /api/settings   → merged display + assumptions (defaults if no rows)
  PUT /api/settings   → upsert AppSettings row id=1 and global Assumption row;
                        only provided fields are updated (audit update_settings)
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.audit import record_audit, to_audit_dict
from app.api.deps import get_current_user, get_session
from app.api.schemas import (
    AssumptionFields,
    DisplaySettings,
    SettingsOut,
    SettingsUpdate,
)
from app.db.models import AppSettings, Assumption

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DISPLAY_DEFAULTS = DisplaySettings()  # accent='أزرق', show_alert=True, etc.


def _read_display(row: AppSettings | None) -> DisplaySettings:
    if row is None:
        return DisplaySettings()
    return DisplaySettings(
        accent=row.accent or _DISPLAY_DEFAULTS.accent,
        show_alert=row.show_alert,
        neg_threshold_m=float(row.neg_threshold_m) if row.neg_threshold_m is not None else 0,
        over_cap_warn=row.over_cap_warn,
    )


def _read_assumptions(row: Assumption | None) -> AssumptionFields:
    if row is None:
        return AssumptionFields()

    def _f(v) -> float | None:
        return float(v) if v is not None else None

    return AssumptionFields(
        usd_rate=_f(row.usd_rate),
        unexpected_reserve_m=_f(row.unexpected_reserve_m),
        income_growth_pct=_f(row.income_growth_pct),
        in_growth_factor=_f(row.in_growth_factor),
        out_growth_factor=_f(row.out_growth_factor),
        cagr_floor=_f(row.cagr_floor),
        cagr_cap=_f(row.cagr_cap),
        forecast_horizon=row.forecast_horizon,
        fiscal_year_start_month=row.fiscal_year_start_month,
        forecast_engine=row.forecast_engine,
    )


# ---------------------------------------------------------------------------
# GET /api/settings
# ---------------------------------------------------------------------------

@router.get("", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> SettingsOut:
    app_row: AppSettings | None = (
        db.query(AppSettings).filter(AppSettings.id == 1).first()
    )
    assump_row: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )
    return SettingsOut(
        display=_read_display(app_row),
        assumptions=_read_assumptions(assump_row),
    )


# ---------------------------------------------------------------------------
# PUT /api/settings
# ---------------------------------------------------------------------------

@router.put("", response_model=SettingsOut)
def put_settings(
    body: SettingsUpdate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> SettingsOut:
    # --- AppSettings upsert ---
    app_row: AppSettings | None = (
        db.query(AppSettings).filter(AppSettings.id == 1).first()
    )
    before_display = to_audit_dict(app_row)

    if app_row is None:
        app_row = AppSettings(id=1)
        db.add(app_row)

    if body.display is not None:
        d = body.display
        if d.accent is not None:
            app_row.accent = d.accent
        app_row.show_alert = d.show_alert
        app_row.neg_threshold_m = Decimal(str(d.neg_threshold_m))
        app_row.over_cap_warn = d.over_cap_warn
    app_row.updated_at = datetime.now(timezone.utc)

    # --- Global Assumption upsert ---
    assump_row: Assumption | None = (
        db.query(Assumption)
        .filter(Assumption.scenario_id.is_(None))
        .first()
    )
    before_assump = to_audit_dict(assump_row)

    if assump_row is None:
        assump_row = Assumption(scenario_id=None)
        db.add(assump_row)

    if body.assumptions is not None:
        a = body.assumptions
        update_data = a.model_dump(exclude_none=True)
        for field, value in update_data.items():
            setattr(
                assump_row,
                field,
                Decimal(str(value)) if isinstance(value, float) else value,
            )
    assump_row.updated_at = datetime.now(timezone.utc)

    db.flush()

    record_audit(
        db, user,
        action="update_settings",
        entity="settings",
        entity_id=1,
        before={"display": before_display, "assumptions": before_assump},
        after={
            "display": to_audit_dict(app_row),
            "assumptions": to_audit_dict(assump_row),
        },
    )
    db.commit()
    db.refresh(app_row)
    db.refresh(assump_row)

    return SettingsOut(
        display=_read_display(app_row),
        assumptions=_read_assumptions(assump_row),
    )
