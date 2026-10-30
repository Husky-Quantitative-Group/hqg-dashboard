"""Who may read or write a strategy, and changing it."""

from __future__ import annotations

import pytest

from support import add_strategy, add_user, execute


@pytest.fixture
def owner(client, db, sign_in):
    add_strategy(db, "1", owner="olive", read=["USER#olive"], write=["USER#olive"])
    return sign_in("olive")


def grants(db):
    rows = execute(
        db, "SELECT access, principal FROM strategy_permissions ORDER BY access, principal"
    )
    return [(row["access"], row["principal"]) for row in rows]


def patch(client, headers, body):
    return client.patch("/strategies/1/permissions", json=body, headers=headers)


def test_summary(client, db, owner, sign_in):
    add_user(db, "bob", full_name="Bob Brown", uconn_email="bob@uconn.edu")
    execute(
        db,
        """
        INSERT INTO strategy_permissions (strategy_id, access, principal) VALUES
            ('1', 'read', 'ROLE#PUBLIC'), ('1', 'read', 'USER#bob'), ('1', 'write', 'ROLE#FUND'),
            ('1', 'read', 'USER#ghost')
        """,
    )

    response = client.get("/strategies/1/permissions", headers=owner)

    assert response.status_code == 200
    assert response.json() == {
        "read": {
            "public": True,
            "fund": False,
            "users": [
                {"netid": "bob", "full_name": "Bob Brown", "uconn_email": "bob@uconn.edu"},
                {"netid": "ghost", "full_name": "", "uconn_email": ""},
                {"netid": "olive", "full_name": "", "uconn_email": ""},
            ],
        },
        "write": {
            "public": False,
            "fund": True,
            "users": [{"netid": "olive", "full_name": "", "uconn_email": ""}],
        },
        "canRead": True,
        "canWrite": True,
    }
    summary = client.get("/strategies/1/permissions", headers=sign_in("bob")).json()
    assert (summary["canRead"], summary["canWrite"]) == (True, False)


def test_viewing_needs_read_access(client, db, owner, sign_in):
    response = client.get("/strategies/1/permissions", headers=sign_in("bob"))
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    response = client.get("/strategies/404/permissions", headers=owner)
    assert (response.status_code, response.json()) == (404, {"message": "Strategy not found"})
    summary = client.get(
        "/strategies/1/permissions", headers=sign_in("root", roles=["ADMIN"])
    ).json()
    assert (summary["canRead"], summary["canWrite"]) == (True, True)


def test_owner_shares_and_unshares(client, db, owner):
    response = patch(
        client,
        owner,
        {
            "read": {"public": True, "addUsers": [" bob ", "", 7]},
            "write": {"fund": True, "addUsers": ["cat"]},
        },
    )
    assert (response.status_code, response.json()) == (200, {"ok": True})
    assert grants(db) == [
        ("read", "ROLE#FUND"),
        ("read", "ROLE#PUBLIC"),
        ("read", "USER#bob"),
        ("read", "USER#cat"),
        ("read", "USER#olive"),
        ("write", "ROLE#FUND"),
        ("write", "USER#cat"),
        ("write", "USER#olive"),
    ]

    # Revoking write keeps read; repeating a change is harmless.
    response = patch(
        client,
        owner,
        {
            "read": {"public": False, "removeUsers": ["bob"]},
            "write": {"fund": False, "removeUsers": ["cat"]},
        },
    )
    assert response.status_code == 200
    assert patch(client, owner, {"read": {"public": False}}).status_code == 200
    assert grants(db) == [
        ("read", "ROLE#FUND"),
        ("read", "USER#cat"),
        ("read", "USER#olive"),
        ("write", "USER#olive"),
    ]


def test_only_the_owner_or_an_admin_can_change_permissions(client, db, owner, sign_in):
    execute(
        db,
        "INSERT INTO strategy_permissions (strategy_id, access, principal)"
        " VALUES ('1', 'write', 'USER#bob')",
    )
    response = patch(client, sign_in("bob"), {"read": {"public": True}})
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    assert (
        patch(client, sign_in("root", roles=["ADMIN"]), {"read": {"public": True}}).status_code
        == 200
    )
    response = client.patch("/strategies/404/permissions", json={}, headers=owner)
    assert (response.status_code, response.json()) == (404, {"message": "Strategy not found"})


@pytest.mark.parametrize(
    "body, message",
    [
        ([], "body must be an object"),
        ({"read": True}, "read must be an object"),
        ({"read": {"public": "yes"}}, "public must be a boolean"),
        ({"write": {"fund": 1}}, "fund must be a boolean"),
        ({"read": {"addUsers": "bob"}}, "addUsers must be a list"),
        ({"read": {"public": True}, "write": {"removeUsers": "bob"}}, "removeUsers must be a list"),
    ],
)
def test_invalid_changes_change_nothing(client, db, owner, body, message):
    before = grants(db)
    response = patch(client, owner, body)
    assert (response.status_code, response.json()) == (400, {"message": message})
    assert grants(db) == before


def test_changes_must_be_json(client, owner):
    response = client.patch("/strategies/1/permissions", content=b"{", headers=owner)
    assert (response.status_code, response.json()) == (400, {"message": "invalid JSON body"})
