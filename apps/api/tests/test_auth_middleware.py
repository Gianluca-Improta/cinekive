"""Security middleware checks — token auth and public-tunnel rules.

These exercise the middleware directly with synthetic requests so no server,
Qdrant, or network is needed.
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cinearchive.api.auth import SecurityMiddleware


def _client(peer: str = "127.0.0.1") -> TestClient:
    app = FastAPI()
    app.add_middleware(SecurityMiddleware)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/shots")
    async def shots():
        return {"ok": True}

    @app.get("/system")
    async def system():
        return {"ok": True}

    @app.post("/ingest")
    async def ingest():
        return {"ok": True}

    # The peer address is what the middleware inspects.
    return TestClient(app, client=(peer, 50000))


@pytest.fixture(autouse=True)
def _clear_token(monkeypatch):
    monkeypatch.delenv("CINEKIVE_API_TOKEN", raising=False)
    monkeypatch.delenv("CINEKIVE_API_TOKEN_FILE", raising=False)
    yield


def test_no_token_configured_is_open():
    client = _client(peer="192.168.1.20")
    # Without a secret there is nothing to enforce (plain source checkout).
    assert client.get("/shots", headers={"host": "192.168.1.20:8000"}).status_code == 200


def test_health_stays_reachable_with_token(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="192.168.1.20")
    assert client.get("/health", headers={"host": "192.168.1.20:8000"}).status_code == 200


def test_loopback_is_trusted_with_token(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="127.0.0.1")
    res = client.get("/shots", headers={"host": "127.0.0.1:8000"})
    assert res.status_code == 200


def test_remote_client_without_token_is_rejected(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="192.168.1.20")
    res = client.get("/shots", headers={"host": "192.168.1.20:8000"})
    assert res.status_code == 401
    assert res.json()["code"] == "token_required"


def test_remote_client_with_header_token_is_allowed(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="192.168.1.20")
    res = client.get(
        "/shots",
        headers={"host": "192.168.1.20:8000", "X-Cinekive-Token": "s3cret"},
    )
    assert res.status_code == 200


def test_remote_client_with_bearer_token_is_allowed(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="192.168.1.20")
    res = client.get(
        "/shots",
        headers={"host": "192.168.1.20:8000", "authorization": "Bearer s3cret"},
    )
    assert res.status_code == 200


def test_remote_client_with_wrong_token_is_rejected(monkeypatch):
    monkeypatch.setenv("CINEKIVE_API_TOKEN", "s3cret")
    client = _client(peer="192.168.1.20")
    res = client.get(
        "/shots",
        headers={"host": "192.168.1.20:8000", "X-Cinekive-Token": "nope"},
    )
    assert res.status_code == 401


def test_token_can_be_read_from_a_file(monkeypatch, tmp_path):
    token_file = tmp_path / "token.txt"
    token_file.write_text("filetoken\n", encoding="utf-8")
    monkeypatch.setenv("CINEKIVE_API_TOKEN_FILE", str(token_file))
    client = _client(peer="192.168.1.20")
    assert client.get("/shots", headers={"host": "192.168.1.20:8000"}).status_code == 401
    res = client.get(
        "/shots",
        headers={"host": "192.168.1.20:8000", "X-Cinekive-Token": "filetoken"},
    )
    assert res.status_code == 200


def test_public_tunnel_blocks_writes():
    client = _client(peer="192.168.1.20")
    res = client.post("/ingest", headers={"host": "abc.trycloudflare.com"})
    assert res.status_code == 403
    assert res.json()["code"] == "tunnel_read_only"


def test_public_tunnel_blocks_machine_state_reads():
    client = _client(peer="192.168.1.20")
    res = client.get("/system", headers={"host": "abc.trycloudflare.com"})
    assert res.status_code == 403
    assert res.json()["code"] == "tunnel_blocked"


def test_public_tunnel_still_allows_browsing():
    client = _client(peer="192.168.1.20")
    assert client.get("/shots", headers={"host": "abc.trycloudflare.com"}).status_code == 200


def test_lan_host_is_not_treated_as_public():
    client = _client(peer="192.168.1.20")
    assert client.get("/shots", headers={"host": "192.168.1.20:8000"}).status_code == 200
