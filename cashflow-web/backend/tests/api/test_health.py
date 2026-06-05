def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_unknown_resource_uses_error_envelope(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert set(body["error"]) >= {"code", "message"}  # unified envelope


def test_unhandled_exception_uses_error_envelope():
    """A bare unexpected error must still emit the unified envelope, never a
    plain-text 500."""
    from fastapi.testclient import TestClient
    from app.main import create_app

    app = create_app()

    @app.get("/api/boom")
    def _boom():
        raise RuntimeError("kaboom")

    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/boom")
    assert r.status_code == 500
    body = r.json()
    assert set(body["error"]) >= {"code", "message"}
    assert body["error"]["code"] == "internal_server_error"
