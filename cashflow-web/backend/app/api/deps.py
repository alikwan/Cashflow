"""
FastAPI dependency: database session lifecycle.

Usage in routers:
    from fastapi import Depends
    from app.api.deps import get_session
    from sqlalchemy.orm import Session

    @router.get("/example")
    def example(db: Session = Depends(get_session)):
        ...
"""
from collections.abc import Generator

from sqlalchemy.orm import Session

from app.db.base import SessionLocal


def get_session() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session and close it when the request is done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
