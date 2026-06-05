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

        yield  # Application runs here

        # Shutdown (nothing to do currently)

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

    return application


# Module-level instance for uvicorn
app = create_app()
