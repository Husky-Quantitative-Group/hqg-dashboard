"""Searching members to share strategies with."""

from __future__ import annotations

import pytest

from support import add_user


@pytest.fixture
def alice(client, db, sign_in):
    add_user(db, "abc12345", full_name="Zed Zimmer", uconn_email="zed@uconn.edu")
    add_user(db, "abd22222", full_name="Abby Adams")
    add_user(db, "xyz99999", full_name="Abe Lincoln")
    add_user(db, "nameless")
    return sign_in("alice", full_name="Alice Anders")


def search(client, headers, **params):
    response = client.get("/users/search", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def test_matches_netids_then_names(client, alice):
    assert search(client, alice, q="ab") == [
        {"netid": "abc12345", "full_name": "Zed Zimmer", "uconn_email": "zed@uconn.edu"},
        {"netid": "abd22222", "full_name": "Abby Adams", "uconn_email": ""},
        {"netid": "xyz99999", "full_name": "Abe Lincoln", "uconn_email": ""},
    ]
    assert [item["netid"] for item in search(client, alice, q=" ALI ")] == ["alice"]
    assert [item["netid"] for item in search(client, alice, q="nam")] == ["nameless"]


@pytest.mark.parametrize(
    "limit, expected", [(None, 3), ("1", 1), ("0", 1), ("2", 2), ("many", 3), ("100", 3)]
)
def test_limit(client, alice, limit, expected):
    params = {"q": "ab"} if limit is None else {"q": "ab", "limit": limit}
    assert len(search(client, alice, **params)) == expected


def test_short_queries_match_nothing(client, alice):
    assert search(client, alice, q="a") == []
    assert search(client, alice) == []


def test_search_needs_a_member(client, session_headers):
    assert client.get("/users/search", params={"q": "ab"}).status_code == 401
    assert (
        client.get("/users/search", params={"q": "ab"}, headers=session_headers("x")).status_code
        == 403
    )
