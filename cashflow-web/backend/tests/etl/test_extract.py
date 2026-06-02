from datetime import datetime
from zoneinfo import ZoneInfo
from app.etl.extract import baghdad_today


def test_baghdad_today_is_utc_plus_3(monkeypatch):
    import app.etl.extract as ex
    monkeypatch.setattr(ex, "_utcnow", lambda: datetime(2026, 6, 1, 23, 30, tzinfo=ZoneInfo("UTC")))
    assert baghdad_today().isoformat() == "2026-06-02"
