"""Behavior shared by every route: CORS, error bodies, the health check and the JWKS."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hqg_dashboard.app import create_app
from hqg_dashboard.routes import strategies
from support import FRONTEND_URL, add_strategy

PREFLIGHT = {
    "Access-Control-Request-Method": "PATCH",
    "Access-Control-Request-Headers": "content-type",
}


def test_cors_preflight_allows_only_the_dashboard(client):
    response = client.options(
        "/strategies/1/permissions", headers={"Origin": FRONTEND_URL, **PREFLIGHT}
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_URL
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["access-control-max-age"] == "300"
    assert "PATCH" in response.headers["access-control-allow-methods"]

    response = client.options("/strategies", headers={"Origin": "https://evil.test", **PREFLIGHT})
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_errors_carry_cors_headers(client):
    response = client.get("/strategies", headers={"Origin": FRONTEND_URL})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == FRONTEND_URL


def test_crashes_answer_json_with_cors_headers(client, db, sign_in, monkeypatch):
    add_strategy(db, "1", read=["ROLE#PUBLIC"])

    def crash(row):
        raise RuntimeError("boom")

    monkeypatch.setattr(strategies, "strategy_json", crash)
    response = client.get("/strategies", headers={"Origin": FRONTEND_URL, **sign_in("alice")})
    assert response.status_code == 500
    assert response.json() == {"message": "Internal Server Error"}
    assert response.headers["access-control-allow-origin"] == FRONTEND_URL


@pytest.mark.parametrize("method", ["get", "post", "patch"])
def test_unknown_routes(client, method):
    response = getattr(client, method)("/no/such/route")
    assert response.status_code == 404
    assert response.json() == {"message": "Not Found"}


def test_unsupported_methods(client):
    response = client.delete("/strategies")
    assert response.status_code == 405
    assert response.json() == {"message": "Method Not Allowed"}


def test_health(client):
    response = client.get("/health")
    assert (response.status_code, response.json()) == (200, {"status": "healthy"})


def test_jwks_is_public_and_cacheable(client):
    response = client.get("/.well-known/jwks.json")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=600"
    (key,) = response.json()["keys"]
    assert {"kty": "RSA", "use": "sig", "alg": "RS256"}.items() <= key.items()


def test_restarts_keep_this_months_key(client, settings):
    (key,) = client.get("/.well-known/jwks.json").json()["keys"]
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get("/.well-known/jwks.json").json()["keys"] == [key]
