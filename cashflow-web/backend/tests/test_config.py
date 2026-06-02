def test_postgres_url_built_from_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "localhost")
    monkeypatch.setenv("POSTGRES_USER", "u")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p")
    monkeypatch.setenv("POSTGRES_DB", "d")
    monkeypatch.setenv("POSTGRES_PORT", "5432")
    from importlib import reload
    import app.config as c; reload(c)
    assert c.settings.postgres_url == "postgresql+psycopg://u:p@localhost:5432/d"


def test_app_tz_default_applies_when_unset(monkeypatch):
    # عزل تام: لا متغيّر بيئة ولا ملف .env → القيمة الافتراضية للحقل هي ما يُختبر.
    # (الحذف من os.environ وحده لا يكفي لأن config.py يقرأ .env الذي يضبط APP_TZ.)
    monkeypatch.delenv("APP_TZ", raising=False)
    from app.config import Settings
    assert Settings(_env_file=None).app_tz == "Asia/Baghdad"
