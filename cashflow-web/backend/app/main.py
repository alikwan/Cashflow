"""
FastAPI application factory for cashflow-web.

Entry point for uvicorn:
    uvicorn app.main:app --reload

The module-level `app` is created by calling `create_app()` so both
  - `uvicorn app.main:app` (production / dev server)
  - `from app.main import create_app` (test fixtures)
work without circular-import issues.

Architecture rules (enforced here):
- No business logic in main.py.
- Only /api/health is registered here; all other routers mount in their own files.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.api.errors import register_error_handlers
from app.config import settings

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Build and return a configured FastAPI application instance."""

    # Guard: sessions are cryptographically unsafe without a secret key.
    if not settings.app_secret_key:
        raise RuntimeError("APP_SECRET_KEY must be set")

    # ------------------------------------------------------------------
    # Lifespan: owner seeding on startup (production only).
    # TestClient does NOT enter the lifespan context when used without the
    # `with` statement (the default in our fixtures), so this block is
    # safely skipped during tests.
    # ------------------------------------------------------------------
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup — seed owner user if configured
        try:
            from app.db.base import SessionLocal
            from app.api.auth import seed_owner_user

            with SessionLocal() as session:
                created = seed_owner_user(session)
                if created:
                    logger.info("Owner user seeded successfully.")
        except Exception:
            logger.exception("Owner seeding failed (non-fatal — DB may be unreachable).")

        # Startup — build and start the nightly ETL scheduler
        # Set the attribute unconditionally first so any future code can always
        # do `if app.state.scheduler is not None` without risking AttributeError
        # (e.g. when start() below fails and the attribute would otherwise be unset).
        app.state.scheduler = None
        scheduler = None
        try:
            from app.etl.scheduler import build_scheduler
            from app.api.routers.etl import run_etl_job

            scheduler = build_scheduler(
                run_at=settings.etl_daily_at,
                tz=settings.app_tz,
                job=run_etl_job,
            )
            scheduler.start()
            app.state.scheduler = scheduler
            logger.info(
                "Nightly ETL scheduler started (daily at %s %s).",
                settings.etl_daily_at,
                settings.app_tz,
            )
        except Exception:
            logger.exception(
                "Nightly ETL scheduler failed to start (non-fatal — continuing)."
            )

        yield  # Application runs here

        # Shutdown — stop the scheduler gracefully
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
                logger.info("ETL scheduler shut down.")
            except Exception:
                logger.exception("ETL scheduler shutdown error (ignored).")

    application = FastAPI(
        title="Cashflow Web API — معرض البيت السعيد",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------
    # Session middleware — HttpOnly by default in Starlette
    # ------------------------------------------------------------------
    application.add_middleware(
        SessionMiddleware,
        secret_key=settings.app_secret_key,
        session_cookie="session",
        https_only=False,   # local LAN deployment, no TLS
        same_site="lax",    # CSRF protection for standard form submissions
    )

    # ------------------------------------------------------------------
    # Error handlers
    # ------------------------------------------------------------------
    register_error_handlers(application)

    # ------------------------------------------------------------------
    # Throttle state — one fresh instance per create_app() call so that
    # test fixtures with separate apps don't share throttle state.
    # ------------------------------------------------------------------
    from app.api.auth import LoginThrottle
    application.state.login_throttle = LoginThrottle()

    # ------------------------------------------------------------------
    # Routes — /api/health lives here; feature routers in app/api/
    # ------------------------------------------------------------------

    @application.get("/api/health", tags=["ops"])
    async def health() -> dict:
        return {"status": "ok"}

    # Auth router
    from app.api.auth import router as auth_router
    application.include_router(auth_router)

    # Read routers — meta + dashboard
    from app.api.routers.meta import router as meta_router
    from app.api.routers.dashboard import router as dashboard_router
    application.include_router(meta_router)
    application.include_router(dashboard_router)

    # Read routers — C2: cashflow/monthly, breakdown, suppliers, installments
    from app.api.routers.cashflow import router as cashflow_router
    from app.api.routers.breakdown import router as breakdown_router
    from app.api.routers.suppliers import router as suppliers_router
    from app.api.routers.installments import router as installments_router
    application.include_router(cashflow_router)
    application.include_router(breakdown_router)
    application.include_router(suppliers_router)
    application.include_router(installments_router)

    # Read routers — C3: forecast + supplier-plan
    from app.api.routers.forecast import router as forecast_router
    from app.api.routers.supplier_plan import router as supplier_plan_router
    application.include_router(forecast_router)
    application.include_router(supplier_plan_router)

    # Write routers — D1: scenarios CRUD + assumptions upsert
    from app.api.routers.scenarios import router as scenarios_router
    application.include_router(scenarios_router)

    # Write routers — D2: payment-plans, notes, alerts ack, settings
    from app.api.routers.payment_plans import router as payment_plans_router
    from app.api.routers.notes import router as notes_router
    from app.api.routers.alerts import router as alerts_router
    from app.api.routers.settings import router as settings_router
    application.include_router(payment_plans_router)
    application.include_router(notes_router)
    application.include_router(alerts_router)
    application.include_router(settings_router)

    # Export routers — E1: xlsx + pdf
    from app.api.export import router as export_router
    application.include_router(export_router)

    # ETL control — F1: manual trigger + status
    from app.api.routers.etl import router as etl_router
    application.include_router(etl_router)

    return application


# Module-level instance for uvicorn
app = create_app()
