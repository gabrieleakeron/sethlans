"""Test unitari per il middleware di autenticazione a token condiviso
(storia preview-shared-token, contratto auth in s69413e22).

`_api_token` viene letto a livello di modulo da `server.py`, quindi per
esercitare i due scenari (token settato/non settato) il modulo va ricaricato
dopo aver impostato/rimosso la env var SETHLANS_SERVICE_API_TOKEN.

Integrazione/E2E sono a carico del seth-tester: qui solo unit veloci con
TestClient, niente Testcontainers/Postgres.
"""
import importlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


def _reload_server_with_token(monkeypatch, token: str | None):
    """Ricarica il modulo server con SETHLANS_SERVICE_API_TOKEN impostata (o assente)."""
    if token is None:
        monkeypatch.delenv("SETHLANS_SERVICE_API_TOKEN", raising=False)
    else:
        monkeypatch.setenv("SETHLANS_SERVICE_API_TOKEN", token)
    import server
    importlib.reload(server)
    return server


def _client_for(server_module, engine):
    """TestClient con get_db rediretto sull'engine SQLite in-memory di test
    (stesso pattern della fixture `client` in conftest.py, ma sul modulo
    `server` ricaricato con la env var del token)."""
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

    def _override_get_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    server_module.app.dependency_overrides[server_module.get_db] = _override_get_db
    return TestClient(server_module.app)


@pytest.fixture()
def server_no_token(monkeypatch):
    mod = _reload_server_with_token(monkeypatch, None)
    yield mod
    mod.app.dependency_overrides.clear()
    # Ripristina lo stato "senza token" per non sporcare gli altri test del modulo.
    importlib.reload(mod)


@pytest.fixture()
def server_with_token(monkeypatch):
    mod = _reload_server_with_token(monkeypatch, "segreto-di-test")
    yield mod
    mod.app.dependency_overrides.clear()
    monkeypatch.delenv("SETHLANS_SERVICE_API_TOKEN", raising=False)
    importlib.reload(mod)


def test_token_non_settato_comportamento_invariato(server_no_token, engine):
    """Senza SETHLANS_SERVICE_API_TOKEN, nessuna auth: la richiesta passa senza header."""
    with _client_for(server_no_token, engine) as client:
        resp = client.get("/projects")
    assert resp.status_code == 200


def test_token_settato_header_corretto_passa(server_with_token, engine):
    with _client_for(server_with_token, engine) as client:
        resp = client.get("/projects", headers={"X-Sethlans-Token": "segreto-di-test"})
    assert resp.status_code == 200


def test_token_settato_header_assente_401(server_with_token, engine):
    with _client_for(server_with_token, engine) as client:
        resp = client.get("/projects")
    assert resp.status_code == 401
    body = resp.json()
    assert "detail" in body
    # Il messaggio deve essere generico: non deve contenere il token atteso.
    assert "segreto-di-test" not in resp.text


def test_token_settato_header_errato_401(server_with_token, engine):
    with _client_for(server_with_token, engine) as client:
        resp = client.get("/projects", headers={"X-Sethlans-Token": "sbagliato"})
    assert resp.status_code == 401
    assert "segreto-di-test" not in resp.text


def test_options_passa_anche_con_token_settato(server_with_token, engine):
    """Il preflight CORS (OPTIONS) deve passare senza header anche a token settato."""
    with _client_for(server_with_token, engine) as client:
        resp = client.options(
            "/projects",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert resp.status_code in (200, 204)
