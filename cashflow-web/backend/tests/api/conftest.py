"""
Shared test fixtures for the cashflow-web API test suite.

Design rules:
- `_testing_session` owns the engine and sessionmaker; it is tmp_path-scoped
  so each test function gets a fresh SQLite DB (no cross-test bleed).
- `client`, `seed_user`, and `auth` all share the same `_testing_session`
  instance so rows committed by seed_user are visible to request sessions.
- The `client` fixture does NOT enter the TestClient as a context manager —
  this intentionally prevents the FastAPI lifespan from running, keeping the
  owner-seeding side-effect out of tests.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
import app.db.models  # noqa: F401 — register all tables on Base.metadata


@pytest.fixture
def _testing_session(tmp_path):
    """Fresh SQLite engine + sessionmaker; shared by client/seed_user/auth."""
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False, future=True)


@pytest.fixture
def client(_testing_session):
    """TestClient backed by the shared in-memory DB."""
    from app.main import create_app
    from app.api.deps import get_session

    app = create_app()

    def _override():
        db = _testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    return TestClient(app)


@pytest.fixture
def seed_user(_testing_session):
    """Insert owner/secret user directly (no dependency on seed_owner_user logic)."""
    from app.db.models import User
    from app.api.auth import hash_password

    s = _testing_session()
    try:
        s.add(User(
            username="owner",
            password_hash=hash_password("secret"),
            display_name="المالك",
            is_active=True,
        ))
        s.commit()
    finally:
        s.close()


@pytest.fixture
def auth(client, seed_user):
    """Return cookies dict after a successful login (used by future endpoint tests)."""
    client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    return {"session": client.cookies["session"]}
