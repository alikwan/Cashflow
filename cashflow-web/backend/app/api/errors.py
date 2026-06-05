"""
Unified error-response envelope for the cashflow-web API.

All error responses produced by this application share the same JSON shape:
    {
        "error": {
            "code":    "<machine-readable string>",
            "message": "<human-readable string>"
        }
    }

Raises:
    ApiError — raise from any router/service to emit a structured error.

Usage:
    from app.api.errors import ApiError
    raise ApiError(code="not_found", message="Plan not found", status=404)

Wiring:
    Call register_error_handlers(app) once in create_app().
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


# ---------------------------------------------------------------------------
# Exception class
# ---------------------------------------------------------------------------

class ApiError(Exception):
    """Application-level error that maps to a structured JSON response."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# HTTP status code → string code mapping
# ---------------------------------------------------------------------------

_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "unprocessable_entity",
    429: "too_many_requests",
    500: "internal_server_error",
    503: "service_unavailable",
}


def _http_status_to_code(status_code: int) -> str:
    return _STATUS_CODES.get(status_code, "http_error")


# ---------------------------------------------------------------------------
# Error envelope helper
# ---------------------------------------------------------------------------

def _error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message}},
    )


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------

async def _api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return _error_response(exc.status, exc.code, exc.message)


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code = _http_status_to_code(exc.status_code)
    message = str(exc.detail) if exc.detail is not None else "An error occurred"
    return _error_response(exc.status_code, code, message)


async def _validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Produce a concise human-readable summary of the first validation error(s).
    errors = exc.errors()
    if errors:
        first = errors[0]
        loc = " → ".join(str(p) for p in first.get("loc", []) if p != "body")
        msg = first.get("msg", "Validation error")
        readable = f"{loc}: {msg}" if loc else msg
    else:
        readable = "Request validation failed"
    return _error_response(422, "validation_error", readable)


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all so an unexpected error still emits the unified envelope (never a
    bare plain-text 500). The detail is intentionally generic — internal error
    messages and stack traces are not exposed to the client."""
    return _error_response(500, "internal_server_error", "An unexpected error occurred")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_error_handlers(app: FastAPI) -> None:
    """Wire all error handlers onto the FastAPI app. Called once from create_app()."""
    app.add_exception_handler(ApiError, _api_error_handler)          # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, _http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error_handler)  # type: ignore[arg-type]
    # Catch-all for any otherwise-unhandled exception → unified 500 envelope.
    app.add_exception_handler(Exception, _unhandled_exception_handler)  # type: ignore[arg-type]
