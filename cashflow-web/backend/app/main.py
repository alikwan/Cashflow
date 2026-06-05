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
- No auth, CORS, or SessionMiddleware (added in later tasks).
- Only /api/health is registered here; all other routers mount in their own files.
"""
from fastapi import FastAPI

from app.api.errors import register_error_handlers


def create_app() -> FastAPI:
    """Build and return a configured FastAPI application instance."""
    application = FastAPI(
        title="Cashflow Web API — معرض البيت السعيد",
        version="0.1.0",
        # Disable FastAPI's default validation-error response (422) so our
        # unified error envelope handler takes over for all error types.
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    # Register unified error envelope for ApiError, HTTPException, ValidationError
    register_error_handlers(application)

    # -----------------------------------------------------------------------
    # Routes — only /api/health lives here; feature routers go in app/api/
    # -----------------------------------------------------------------------

    @application.get("/api/health", tags=["ops"])
    async def health() -> dict:
        return {"status": "ok"}

    return application


# Module-level instance for uvicorn
app = create_app()
