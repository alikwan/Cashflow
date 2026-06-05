"""
Tests for Task B1: HttpOnly cookie-session auth + owner seeding + login throttle.

TDD — written BEFORE implementation so they initially fail (RED).
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
import app.db.models  # noqa: F401


# ---------------------------------------------------------------------------
# Fixtures local to this module (throttle tests need a fresh app.state)
# ---------------------------------------------------------------------------

@pytest.fixture
def _ts(tmp_path):
    """Fresh SQLite engine + sessionmaker shared across fixtures in this module."""
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False, future=True)


@pytest.fixture
def client(_ts):
    """TestClient backed by the shared in-memory DB."""
    from app.main import create_app
    from app.api.deps import get_session

    app = create_app()

    def _override():
        db = _ts()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    return TestClient(app)


@pytest.fixture
def seed_user(_ts):
    """Insert owner/secret user directly so tests don't depend on seeding logic."""
    from app.db.models import User
    from app.api.auth import hash_password

    s = _ts()
    s.add(User(
        username="owner",
        password_hash=hash_password("secret"),
        display_name="المالك",
        is_active=True,
    ))
    s.commit()
    s.close()


@pytest.fixture
def auth(client, seed_user):
    """Return cookies dict after a successful login."""
    client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    return {"session": client.cookies["session"]}


# ---------------------------------------------------------------------------
# 1. Login / me / logout flow
# ---------------------------------------------------------------------------

def test_login_wrong_password_returns_401(client, seed_user):
    r = client.post("/api/auth/login", json={"username": "owner", "password": "wrong"})
    assert r.status_code == 401
    assert "error" in r.json()
    assert r.json()["error"]["code"] == "unauthorized"


def test_login_unknown_user_returns_401(client):
    r = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_login_sets_cookie_and_me_works(client, seed_user):
    ok = client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    assert ok.status_code == 200
    assert "session" in ok.cookies
    body = ok.json()
    assert body["username"] == "owner"
    assert "display_name" in body

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "owner"


def test_me_requires_auth(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_logout_clears_session(client, seed_user):
    client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    # Confirm logged in
    assert client.get("/api/auth/me").status_code == 200

    out = client.post("/api/auth/logout")
    assert out.status_code == 200
    assert out.json() == {"status": "ok"}

    # Session is cleared — /me should now be 401
    assert client.get("/api/auth/me").status_code == 401


def test_inactive_user_cannot_login(tmp_path):
    """An inactive user (is_active=False) must be rejected at login."""
    from app.main import create_app
    from app.api.deps import get_session
    from app.db.models import User
    from app.api.auth import hash_password

    eng = create_engine(f"sqlite:///{tmp_path / 'i.db'}", future=True)
    Base.metadata.create_all(eng)
    Sess = sessionmaker(bind=eng, autoflush=False, future=True)

    s = Sess()
    s.add(User(
        username="inactive",
        password_hash=hash_password("pw"),
        display_name="X",
        is_active=False,
    ))
    s.commit()
    s.close()

    app = create_app()

    def _override():
        db = Sess()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"username": "inactive", "password": "pw"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2. Login throttle
# ---------------------------------------------------------------------------

def test_throttle_returns_429_after_5_failures(tmp_path):
    """
    Use a fresh app so the throttle state starts at zero.
    After 5 consecutive bad-password attempts, the 6th (and beyond) must return 429.
    """
    from app.main import create_app
    from app.api.deps import get_session
    from app.db.models import User
    from app.api.auth import hash_password

    eng = create_engine(f"sqlite:///{tmp_path / 'th.db'}", future=True)
    Base.metadata.create_all(eng)
    Sess = sessionmaker(bind=eng, autoflush=False, future=True)

    s = Sess()
    s.add(User(
        username="owner",
        password_hash=hash_password("secret"),
        display_name="المالك",
        is_active=True,
    ))
    s.commit()
    s.close()

    app = create_app()

    def _override():
        db = Sess()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)

    # 5 failed attempts
    for _ in range(5):
        r = c.post("/api/auth/login", json={"username": "owner", "password": "bad"})
        assert r.status_code == 401, f"Expected 401 before lockout, got {r.status_code}"

    # 6th attempt must be throttled BEFORE password check
    r6 = c.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    assert r6.status_code == 429
    assert r6.json()["error"]["code"] == "too_many_requests"


def test_throttle_resets_on_success(tmp_path):
    """
    After a successful login, the failure counter for that username resets.
    Subsequent bad attempts can again accumulate to 5 before 429.
    """
    from app.main import create_app
    from app.api.deps import get_session
    from app.db.models import User
    from app.api.auth import hash_password

    eng = create_engine(f"sqlite:///{tmp_path / 'tr.db'}", future=True)
    Base.metadata.create_all(eng)
    Sess = sessionmaker(bind=eng, autoflush=False, future=True)

    s = Sess()
    s.add(User(
        username="owner",
        password_hash=hash_password("secret"),
        display_name="المالك",
        is_active=True,
    ))
    s.commit()
    s.close()

    app = create_app()

    def _override():
        db = Sess()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = _override
    c = TestClient(app)

    # 4 failed attempts
    for _ in range(4):
        c.post("/api/auth/login", json={"username": "owner", "password": "bad"})

    # Successful login resets counter
    ok = c.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    assert ok.status_code == 200

    # Counter reset — next 5 fails should be 401, not 429
    for i in range(5):
        r = c.post("/api/auth/login", json={"username": "owner", "password": "bad"})
        assert r.status_code == 401, f"Expected 401 after reset (attempt {i+1}), got {r.status_code}"


# ---------------------------------------------------------------------------
# 3. seed_owner_user idempotency
# ---------------------------------------------------------------------------

def test_seed_owner_user_idempotency(tmp_path):
    """
    seed_owner_user must be idempotent:
      - First call returns True and inserts exactly one row.
      - Second call returns False and leaves exactly one row.
    """
    from app.api.auth import seed_owner_user
    from app.db.models import User

    eng = create_engine(f"sqlite:///{tmp_path / 's.db'}", future=True)
    Base.metadata.create_all(eng)
    Sess = sessionmaker(bind=eng, autoflush=False, future=True)

    # Temporarily patch settings so seed has something to work with
    import app.config as cfg_module
    orig_username = cfg_module.settings.app_owner_username
    orig_password = cfg_module.settings.app_owner_password
    cfg_module.settings.app_owner_username = "test_owner"
    cfg_module.settings.app_owner_password = "test_pw_xyz"

    try:
        s = Sess()
        result1 = seed_owner_user(s)
        s.close()

        s = Sess()
        result2 = seed_owner_user(s)
        count = s.query(User).filter_by(username="test_owner").count()
        s.close()
    finally:
        cfg_module.settings.app_owner_username = orig_username
        cfg_module.settings.app_owner_password = orig_password

    assert result1 is True, "First seed call must return True"
    assert result2 is False, "Second seed call must return False (idempotent)"
    assert count == 1, "Must be exactly one user row"


def test_seed_owner_user_no_op_when_creds_empty(tmp_path):
    """seed_owner_user returns False without inserting if either cred is empty."""
    from app.api.auth import seed_owner_user
    from app.db.models import User

    eng = create_engine(f"sqlite:///{tmp_path / 'n.db'}", future=True)
    Base.metadata.create_all(eng)
    Sess = sessionmaker(bind=eng, autoflush=False, future=True)

    import app.config as cfg_module
    orig_username = cfg_module.settings.app_owner_username
    orig_password = cfg_module.settings.app_owner_password
    cfg_module.settings.app_owner_username = ""
    cfg_module.settings.app_owner_password = ""

    try:
        s = Sess()
        result = seed_owner_user(s)
        count = s.query(User).count()
        s.close()
    finally:
        cfg_module.settings.app_owner_username = orig_username
        cfg_module.settings.app_owner_password = orig_password

    assert result is False
    assert count == 0


# ---------------------------------------------------------------------------
# 4. create_app() guard — missing APP_SECRET_KEY
# ---------------------------------------------------------------------------

def test_create_app_requires_secret_key():
    """create_app() must raise RuntimeError when APP_SECRET_KEY is empty."""
    import app.config as cfg_module
    orig = cfg_module.settings.app_secret_key
    cfg_module.settings.app_secret_key = ""

    try:
        with pytest.raises(RuntimeError, match="APP_SECRET_KEY"):
            from app.main import create_app
            create_app()
    finally:
        cfg_module.settings.app_secret_key = orig


# ---------------------------------------------------------------------------
# 5. No password material leaks into responses
# ---------------------------------------------------------------------------

def test_responses_never_expose_password_hash(client, seed_user):
    """Neither login nor /me may serialize the password_hash field."""
    login = client.post("/api/auth/login", json={"username": "owner", "password": "secret"})
    assert "password_hash" not in login.text
    me = client.get("/api/auth/me")
    assert "password_hash" not in me.text
