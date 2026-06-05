"""
FastAPI dependency: database session lifecycle + authentication.

Usage in routers:
    from fastapi import Depends, Request
    from app.api.deps import get_session, get_current_user
    from sqlalchemy.orm import Session

    @router.get("/example")
    def example(db: Session = Depends(get_session)):
        ...

    @router.get("/protected")
    def protected(user = Depends(get_current_user)):
        ...
"""
from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db.base import SessionLocal


def get_session() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session and close it when the request is done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_session)):
    """
    Dependency: resolve the currently authenticated user from the session cookie.

    Raises ApiError 401 if:
    - No session cookie / user_id key present.
    - User not found in the DB.
    - User is inactive (is_active=False).
    """
    from app.api.errors import ApiError
    from app.db.models import User

    user_id = request.session.get("user_id")
    if user_id is None:
        raise ApiError("unauthorized", "يجب تسجيل الدخول", 401)

    user: User | None = db.query(User).filter_by(id=user_id).first()
    if user is None or not user.is_active:
        raise ApiError("unauthorized", "يجب تسجيل الدخول", 401)

    return user
