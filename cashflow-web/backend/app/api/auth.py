"""
Authentication router for cashflow-web.

Provides:
  - hash_password / verify_password    (argon2)
  - seed_owner_user(session)           (idempotent owner bootstrap)
  - LoginThrottle                      (in-memory per-username throttle)
  - router                             (POST /login, POST /logout, GET /me)

Mount the router in create_app() under prefix="/api/auth".
"""
import time
import logging
from collections import defaultdict

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.api.deps import get_session
from app.api.errors import ApiError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Argon2 helpers
# ---------------------------------------------------------------------------

_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    """Return an argon2id hash of *pw*."""
    return _ph.hash(pw)


def verify_password(hash_: str, pw: str) -> bool:
    """Return True if *pw* matches *hash_*, False otherwise (never raises)."""
    try:
        return _ph.verify(hash_, pw)
    except (VerifyMismatchError, InvalidHashError, VerificationError):
        # VerificationError is the parent of VerifyMismatchError; catching it too
        # makes this truly never-raise even on a misconfigured argon2 backend.
        return False


# ---------------------------------------------------------------------------
# Owner seeding
# ---------------------------------------------------------------------------

def seed_owner_user(session: Session) -> bool:
    """
    Idempotent bootstrap: create the owner user if not already present.

    Returns True if a new user was created, False if it already existed or
    if either APP_OWNER_USERNAME / APP_OWNER_PASSWORD is empty in settings.
    """
    from app.config import settings  # local import to avoid module-level cycles
    from app.db.models import User

    username = settings.app_owner_username
    password = settings.app_owner_password

    if not username or not password:
        return False

    existing = session.query(User).filter_by(username=username).first()
    if existing is not None:
        return False

    user = User(
        username=username,
        password_hash=hash_password(password),
        display_name="المالك",
        is_active=True,
    )
    session.add(user)
    session.commit()
    return True


# ---------------------------------------------------------------------------
# Login throttle
# ---------------------------------------------------------------------------

_THROTTLE_MAX_FAILURES = 5
_THROTTLE_WINDOW_SECS = 300


class LoginThrottle:
    """
    Simple in-memory per-username failure counter.

    Thread-safety: single-threaded (uvicorn default) — no lock needed.
    Each create_app() call constructs a fresh instance, keeping test state
    fully isolated.
    """

    def __init__(
        self,
        max_failures: int = _THROTTLE_MAX_FAILURES,
        window_secs: int = _THROTTLE_WINDOW_SECS,
    ) -> None:
        self._max = max_failures
        self._window = window_secs
        # key → list of failure timestamps
        self._failures: dict[str, list[float]] = defaultdict(list)

    def _prune(self, key: str) -> None:
        """Remove failure timestamps outside the current window."""
        cutoff = time.time() - self._window
        self._failures[key] = [t for t in self._failures[key] if t >= cutoff]

    def is_blocked(self, key: str) -> bool:
        """Return True if *key* has exceeded the failure threshold."""
        self._prune(key)
        return len(self._failures[key]) >= self._max

    def record_failure(self, key: str) -> None:
        """Record one failure for *key*."""
        self._failures[key].append(time.time())

    def reset(self, key: str) -> None:
        """Clear all recorded failures for *key* (called on successful login)."""
        self._failures.pop(key, None)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_session)):
    """Authenticate and set an HttpOnly session cookie."""
    from app.db.models import User

    throttle: LoginThrottle = request.app.state.login_throttle
    key = body.username.lower()

    # Check throttle BEFORE any DB / password work
    if throttle.is_blocked(key):
        raise ApiError("too_many_requests", "محاولات دخول كثيرة، حاول لاحقاً", 429)

    # Look up user
    user: User | None = db.query(User).filter_by(username=body.username).first()

    # Reject: unknown user, inactive, or wrong password
    _auth_fail_msg = "اسم المستخدم أو كلمة المرور غير صحيحة"
    if user is None or not user.is_active or not verify_password(user.password_hash, body.password):
        throttle.record_failure(key)
        raise ApiError("unauthorized", _auth_fail_msg, 401)

    # Success — reset throttle, set session, update last_login
    throttle.reset(key)
    request.session["user_id"] = user.id
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    return {"username": user.username, "display_name": user.display_name}


@router.post("/logout")
def logout(request: Request):
    """Clear the session cookie."""
    request.session.clear()
    return {"status": "ok"}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_session)):
    """Return the currently logged-in user (requires valid session)."""
    from app.api.deps import get_current_user
    user = get_current_user(request=request, db=db)
    return {"username": user.username, "display_name": user.display_name}
