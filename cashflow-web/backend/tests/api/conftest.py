import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
import app.db.models  # noqa: F401 — register all tables on Base.metadata


@pytest.fixture
def client(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", future=True)
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng, autoflush=False, future=True)

    from app.main import create_app
    from app.api.deps import get_session

    app = create_app()

    def _override_get_session():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override_get_session
    return TestClient(app)
