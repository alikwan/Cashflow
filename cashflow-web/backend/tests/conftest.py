import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
import app.db.models  # noqa: F401 — registers all models on Base.metadata

@pytest.fixture
def session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'t.db'}", future=True)
    Base.metadata.create_all(engine)
    sess = sessionmaker(bind=engine, future=True)()
    try:
        yield sess
    finally:
        sess.close()
        engine.dispose()
