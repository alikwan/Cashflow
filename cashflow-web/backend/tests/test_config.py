from app.config import settings


def test_postgres_url_built_from_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_USER", "u")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p")
    monkeypatch.setenv("POSTGRES_DB", "d")
    monkeypatch.setenv("POSTGRES_PORT", "5432")
    from importlib import reload
    import app.config as c; reload(c)
    assert c.settings.postgres_url == "postgresql+psycopg://u:p@localhost:5432/d"
    assert c.settings.app_tz == "Asia/Baghdad"
