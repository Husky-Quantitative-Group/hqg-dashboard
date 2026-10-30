"""User administration and access requests."""

from __future__ import annotations

from datetime import datetime

import pytest

from support import APPLICATION, add_user, execute


@pytest.fixture
def admin(sign_in):
    return sign_in("root", roles=["ADMIN"], full_name="Root Admin")


def apply(client, session_headers, netid, **changes):
    response = client.post(
        "/auth/apply", json={**APPLICATION, **changes}, headers=session_headers(netid)
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.parametrize(
    "method, path",
    [
        ("get", "/admin/users"),
        ("get", "/admin/users/root"),
        ("patch", "/admin/users/root"),
        ("get", "/admin/access-requests"),
        ("post", "/admin/access-requests/x/approve"),
        ("post", "/admin/access-requests/x/deny"),
    ],
)
def test_admin_routes_need_an_admin(client, sign_in, method, path):
    response = client.request(
        method, path, json={}, headers=sign_in("alice", roles=["PUBLIC", "FUND"])
    )
    assert (response.status_code, response.json()) == (403, {"message": "Forbidden"})
    assert client.request(method, path, json={}).status_code == 401


def test_list_and_get_users(client, db, admin):
    add_user(db, "Zed", roles=[], notes="hello")
    users = client.get("/admin/users", headers=admin).json()
    assert [user["netid"] for user in users] == ["Zed", "root"]
    assert users[0] == {"netid": "Zed", "roles": [], "is_banned": False, "notes": "hello"}

    assert client.get("/admin/users/root", headers=admin).json() == {
        "netid": "root",
        "full_name": "Root Admin",
        "roles": ["ADMIN"],
        "is_banned": False,
    }
    response = client.get("/admin/users/nobody", headers=admin)
    assert (response.status_code, response.json()) == (404, {"message": "User not found"})
    response = client.get("/admin/users/%20", headers=admin)
    assert (response.status_code, response.json()) == (400, {"message": "netid is required"})


def test_update_user(client, db, admin):
    add_user(db, "alice", full_name="Alice")
    response = client.patch(
        "/admin/users/alice",
        json={
            "roles": ["PUBLIC", "FUND"],
            "is_banned": True,
            "notes": "spam",
            "full_name": None,
            "netid": "eve",
        },
        headers=admin,
    )
    assert response.status_code == 200
    user = response.json()
    updated_at = user.pop("updated_at")
    assert datetime.fromisoformat(updated_at)
    assert user == {
        "netid": "alice",
        "roles": ["PUBLIC", "FUND"],
        "is_banned": True,
        "notes": "spam",
    }

    response = client.patch(
        "/admin/users/alice", json={"roles": None, "is_banned": None}, headers=admin
    )
    assert (response.json()["roles"], response.json()["is_banned"]) == ([], False)


@pytest.mark.parametrize(
    "body, message",
    [
        ({}, "body is required"),
        ([1], "body is required"),
        ({"netid": "eve"}, "no updatable fields provided"),
        ({"roles": "ADMIN"}, "roles must be a list of PUBLIC/FUND/ADMIN"),
        ({"roles": ["OWNER"]}, "roles must be a list of PUBLIC/FUND/ADMIN"),
        ({"is_banned": "yes"}, "is_banned must be a boolean"),
        ({"github_url": 5}, "github_url must be a string"),
    ],
)
def test_update_user_validates_input(client, db, admin, body, message):
    add_user(db, "alice")
    response = client.patch("/admin/users/alice", json=body, headers=admin)
    assert (response.status_code, response.json()) == (400, {"message": message})


def test_update_unknown_user(client, admin):
    response = client.patch("/admin/users/nobody", json={"notes": "x"}, headers=admin)
    assert (response.status_code, response.json()) == (404, {"message": "User not found"})


def test_access_requests_newest_first(client, admin, session_headers):
    first = apply(client, session_headers, "ada")
    second = apply(client, session_headers, "bob", full_name="Bob Brown")
    assert client.get("/admin/access-requests", headers=admin).json() == [second, first]


def test_approve_creates_a_public_member(client, admin, session_headers):
    apply(client, session_headers, "ada")
    response = client.post(
        "/admin/access-requests/ada/approve", json={"decision_notes": "Welcome"}, headers=admin
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    user = body["user"]
    joined_at = user.pop("joined_at")
    assert user == {
        "netid": "ada",
        "full_name": "Ada Lovelace",
        "uconn_email": "ada.lovelace@uconn.edu",
        "discord_username": "ada_l",
        "linkedin_url": "https://www.linkedin.com/in/ada",
        "github_url": "https://github.com/ada",
        "roles": ["PUBLIC"],
        "is_banned": False,
    }
    (decided,) = client.get("/admin/access-requests", headers=admin).json()
    assert decided["status"] == "APPROVED"
    assert (decided["decided_by"], decided["decided_at"], decided["decision_notes"]) == (
        "root",
        joined_at,
        "Welcome",
    )
    assert client.get("/auth/me", headers=session_headers("ada")).json()["roles"] == ["PUBLIC"]
    response = client.post("/admin/access-requests/ada/approve", json={}, headers=admin)
    assert (response.status_code, response.json()) == (
        404,
        {"message": "Pending access request not found"},
    )


def test_approving_an_existing_account_changes_nothing(client, db, admin, session_headers):
    add_user(db, "ada", is_banned=True)
    apply(client, session_headers, "ada")
    response = client.post("/admin/access-requests/ada/approve", headers=admin)
    assert (response.status_code, response.json()) == (
        500,
        {"message": "Failed to approve access request"},
    )
    assert execute(db, "SELECT status FROM user_access_applications") == [{"status": "PENDING"}]
    assert execute(db, "SELECT is_banned FROM users WHERE netid = 'ada'") == [{"is_banned": True}]


def test_deny(client, db, admin, session_headers):
    apply(client, session_headers, "ada")
    response = client.post("/admin/access-requests/ada/deny", content=b"not json", headers=admin)
    assert (response.status_code, response.json()) == (200, {"ok": True})
    (denied,) = client.get("/admin/access-requests", headers=admin).json()
    assert (denied["status"], denied["decided_by"], denied["decision_notes"]) == (
        "DENIED",
        "root",
        "",
    )
    assert execute(db, "SELECT netid FROM users WHERE netid = 'ada'") == []
    response = client.post("/admin/access-requests/ada/deny", headers=admin)
    assert response.status_code == 404
    response = client.post("/admin/access-requests/nobody/approve", headers=admin)
    assert response.status_code == 404


def test_decision_notes_are_stored_as_text(client, admin, session_headers):
    apply(client, session_headers, "ada")
    client.post("/admin/access-requests/ada/deny", json={"decision_notes": 42}, headers=admin)
    assert client.get("/admin/access-requests", headers=admin).json()[0]["decision_notes"] == "42"
