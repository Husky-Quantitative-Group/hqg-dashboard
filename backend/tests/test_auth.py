"""CAS login, the session cookie, the authorizer and access applications."""

from __future__ import annotations

import json
import time

import jwt
import pytest

from hqg_dashboard.auth.session import COOKIE_NAME
from hqg_dashboard.storage import UPLOAD_AUDIENCE
from support import APPLICATION, add_user, execute


def platform_claims(client, token):
    """Verify a session token the way hqg-platform does: against the published JWKS."""
    keys = client.get("/.well-known/jwks.json").json()["keys"]
    kid = jwt.get_unverified_header(token)["kid"]
    jwk = next(key for key in keys if key["kid"] == kid)
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    return jwt.decode(
        token, public_key, algorithms=["RS256"], leeway=90, options={"require": ["exp", "sub"]}
    )


def test_login_redirects_to_cas(client):
    response = client.get("/auth/login")
    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://login.uconn.edu/cas/login?service=https%3A%2F%2Fapi.test%2Fauth%2Fcallback"
    )


def test_callback_rejects_missing_and_invalid_tickets(client):
    response = client.get("/auth/callback")
    assert (response.status_code, response.text) == (400, "Missing ticket")
    response = client.get("/auth/callback", params={"ticket": "ST-unknown"})
    assert (response.status_code, response.text) == (401, "CAS validation failed")


def test_callback_sets_a_session_cookie_other_services_accept(client, db):
    add_user(db, "abc12345", roles=["PUBLIC", "FUND"])
    client.app.state.cas.tickets["ST-1"] = "abc12345"

    response = client.get("/auth/callback", params={"ticket": "ST-1"})

    assert response.status_code == 302
    assert response.headers["location"] == "https://dashboard.test"
    name, _, rest = response.headers["set-cookie"].partition("=")
    token, _, attributes = rest.partition("; ")
    assert name == COOKIE_NAME
    assert attributes == (
        "Path=/; HttpOnly; SameSite=Strict; Max-Age=86400; Domain=.uconnquant.com; Secure"
    )
    claims = platform_claims(client, token)
    assert claims["sub"] == "abc12345"
    assert claims["roles"] == ["PUBLIC", "FUND"]
    assert claims["exp"] - claims["iat"] == 86400


def test_callback_signs_in_people_without_an_account(client):
    client.app.state.cas.tickets["ST-2"] = "newcomer"
    response = client.get("/auth/callback", params={"ticket": "ST-2"})
    token = response.headers["set-cookie"].split(";")[0].removeprefix(f"{COOKIE_NAME}=")
    assert platform_claims(client, token)["roles"] == []

    cookie = {"Cookie": f"{COOKIE_NAME}={token}"}
    assert client.get("/auth/me", headers=cookie).status_code == 403
    assert client.get("/auth/apply/check", headers=cookie).json() == {"has_application": False}


def test_me(client, db, session_headers, sign_in):
    assert client.get("/auth/me").json() == {"message": "Unauthorized"}
    assert client.get("/auth/me", headers={"Cookie": f"{COOKIE_NAME}=junk"}).status_code == 401
    assert client.get("/auth/me", headers=session_headers("nobody")).status_code == 403

    response = client.get("/auth/me", headers=sign_in("abc12345", roles=["ADMIN"]))
    assert response.json() == {"netid": "abc12345", "roles": ["ADMIN"], "display_name": "abc12345"}

    response = client.get("/auth/me", headers=sign_in("ada", full_name="Ada Lovelace"))
    assert response.json() == {"netid": "ada", "roles": ["PUBLIC"], "display_name": "Ada Lovelace"}

    response = client.get("/auth/me", headers=sign_in("banned", is_banned=True))
    assert (response.status_code, response.json()) == (403, {"message": "Forbidden"})


def test_protected_routes_authorize_like_api_gateway(client, session_headers, sign_in):
    # No Cookie header at all: API Gateway's identity source check.
    response = client.get("/strategies")
    assert (response.status_code, response.json()) == (401, {"message": "Unauthorized"})

    keys = client.app.state.keys
    now = int(time.time())
    rejected = {
        "no session cookie": {"Cookie": "other=1"},
        "garbage": {"Cookie": f"{COOKIE_NAME}=junk"},
        "expired": {
            "Cookie": f"{COOKIE_NAME}="
            + keys.sign({"sub": "alice", "iat": now - 7200, "exp": now - 3600})
        },
        "no subject": {"Cookie": f"{COOKIE_NAME}=" + keys.sign({"iat": now, "exp": now + 60})},
        "storage token": {
            "Cookie": f"{COOKIE_NAME}="
            + keys.sign({"aud": UPLOAD_AUDIENCE, "key": "k", "iat": now, "exp": now + 20})
        },
        "not a member": session_headers("stranger"),
        "banned": sign_in("banned", is_banned=True),
    }
    for reason, headers in rejected.items():
        response = client.get("/strategies", headers=headers)
        assert (response.status_code, response.json()) == (403, {"message": "Forbidden"}), reason

    assert client.get("/strategies", headers=sign_in("alice")).status_code == 200


def test_roles_come_from_the_database_not_the_cookie(client, db, session_headers):
    add_user(db, "alice", roles=["PUBLIC"])
    stale_admin_cookie = session_headers("alice", roles=["ADMIN"])
    assert client.get("/admin/users", headers=stale_admin_cookie).status_code == 403
    execute(db, "UPDATE users SET roles = ARRAY['ADMIN'] WHERE netid = 'alice'")
    assert client.get("/admin/users", headers=session_headers("alice")).status_code == 200


def test_apply_and_check(client, session_headers):
    headers = session_headers("ada")
    assert client.post("/auth/apply", json=APPLICATION).status_code == 401
    assert client.get("/auth/apply/check").status_code == 401
    assert client.get("/auth/apply/check", headers=headers).json() == {"has_application": False}

    response = client.post(
        "/auth/apply", json={**APPLICATION, "full_name": " Ada Lovelace "}, headers=headers
    )
    assert response.status_code == 201
    application = response.json()
    created_at = application.pop("created_at")
    assert time.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ")
    assert application == {"netid": "ada", **APPLICATION, "status": "PENDING"}

    assert client.get("/auth/apply/check", headers=headers).json() == {
        "has_application": True,
        "status": "PENDING",
        "created_at": created_at,
    }
    response = client.post("/auth/apply", json=APPLICATION, headers=headers)
    assert (response.status_code, response.json()) == (
        409,
        {"message": "Application already pending"},
    )


def test_apply_omits_blank_optional_fields(client, session_headers):
    body = {**APPLICATION, "discord_username": "  ", "linkedin_url": "", "github_url": None}
    response = client.post("/auth/apply", json=body, headers=session_headers("ada"))
    assert response.status_code == 201
    assert {"discord_username", "linkedin_url", "github_url"}.isdisjoint(response.json())


@pytest.mark.parametrize(
    "changes, errors",
    [
        (
            {"full_name": "", "uconn_email": ""},
            {"full_name": "full_name is required", "uconn_email": "uconn_email is required"},
        ),
        (
            {"full_name": "4da", "uconn_email": "ada@gmail.com"},
            {
                "full_name": "full_name is invalid",
                "uconn_email": "uconn_email must be a @uconn.edu address",
            },
        ),
        (
            {
                "discord_username": "a",
                "linkedin_url": "https://example.com",
                "github_url": "github.com/ada",
            },
            {
                "discord_username": "discord_username is invalid",
                "linkedin_url": "linkedin_url must be a linkedin.com URL",
                "github_url": "github_url must be a github.com URL",
            },
        ),
    ],
)
def test_apply_validates_input(client, session_headers, changes, errors):
    response = client.post(
        "/auth/apply", json={**APPLICATION, **changes}, headers=session_headers("ada")
    )
    assert response.status_code == 400
    assert response.json() == {"message": "Invalid input", "errors": errors}


def test_apply_treats_a_malformed_body_as_empty(client, session_headers):
    response = client.post("/auth/apply", content=b"[1, 2", headers=session_headers("ada"))
    assert response.status_code == 400
    assert set(response.json()["errors"]) == {"full_name", "uconn_email"}


def test_members_cannot_apply_but_banned_people_can(client, sign_in):
    response = client.post("/auth/apply", json=APPLICATION, headers=sign_in("member"))
    assert (response.status_code, response.json()) == (409, {"message": "User already has access"})
    assert client.get("/auth/apply/check", headers=sign_in("member")).json() == {
        "has_application": True,
        "status": "APPROVED",
    }

    banned = sign_in("banned", is_banned=True)
    assert client.post("/auth/apply", json=APPLICATION, headers=banned).status_code == 201


def test_check_reports_the_latest_decision(client, db, session_headers, sign_in):
    headers = session_headers("ada")
    client.post("/auth/apply", json=APPLICATION, headers=headers)
    response = client.post(
        "/admin/access-requests/ada/deny", json={}, headers=sign_in("admin", roles=["ADMIN"])
    )
    assert response.status_code == 200
    assert client.get("/auth/apply/check", headers=headers).json()["status"] == "DENIED"

    # A denied applicant may apply again.
    assert client.post("/auth/apply", json=APPLICATION, headers=headers).status_code == 201
    assert client.get("/auth/apply/check", headers=headers).json()["status"] == "PENDING"
