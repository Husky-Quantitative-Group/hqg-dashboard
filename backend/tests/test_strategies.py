"""Listing, reading and branching strategies."""

from __future__ import annotations

from datetime import datetime

import pytest
from psycopg.types.json import Jsonb

from hqg_dashboard.artifacts import publish_version
from support import add_strategy, add_user, execute

NEW_STRATEGY = {"source_strategy_id": "1", "name": "Mine", "readme_content": "# Mine\n"}


def ids(response):
    assert response.status_code == 200
    return [strategy["id"] for strategy in response.json()]


def test_members_see_the_strategies_shared_with_them(client, db, sign_in):
    add_strategy(db, "1", read=["ROLE#PUBLIC"])
    add_strategy(db, "2", read=["ROLE#FUND"])
    add_strategy(db, "3", write=["USER#alice"])
    add_strategy(db, "4", read=["USER#bob"])

    assert ids(client.get("/strategies", headers=sign_in("alice"))) == ["1", "3"]
    assert ids(client.get("/strategies", headers=sign_in("bob", roles=["PUBLIC", "FUND"]))) == [
        "1",
        "2",
        "4",
    ]
    assert ids(client.get("/strategies", headers=sign_in("root", roles=["ADMIN"]))) == [
        "1",
        "2",
        "3",
        "4",
    ]


def test_strategies_show_their_owners_current_name(client, db, sign_in):
    add_user(db, "owner", full_name="Olive Owner")
    add_strategy(
        db,
        "1",
        read=["ROLE#PUBLIC"],
        description="Buys low",
        tags=["value"],
        metrics=Jsonb({"sharpe_ratio": 1.5}),
    )
    add_strategy(db, "2", read=["ROLE#PUBLIC"], owner_display="HQG")

    strategy = client.get("/strategies/1", headers=sign_in("alice")).json()
    created_at, updated_at = strategy.pop("created_at"), strategy.pop("updated_at")
    assert strategy == {
        "id": "1",
        "name": "Strategy 1",
        "entrypoint": "main.py",
        "current_version": 1,
        "description": "Buys low",
        "owner": "owner",
        "owner_display": "Olive Owner",
        "tags": ["value"],
        "metrics": {"sharpe_ratio": 1.5},
    }
    assert created_at.endswith("+00:00") and datetime.fromisoformat(created_at)
    assert updated_at == created_at

    listed = client.get("/strategies", headers=sign_in("alice")).json()
    assert [strategy["owner_display"] for strategy in listed] == ["Olive Owner", "HQG"]


def test_reading_a_strategy_needs_read_access(client, db, sign_in):
    add_strategy(db, "1", write=["USER#writer"])
    alice = sign_in("alice")
    response = client.get("/strategies/1", headers=alice)
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    assert client.get("/strategies/1", headers=sign_in("writer")).status_code == 200
    # Permissions are checked first, so unknown ids look the same as private ones.
    assert client.get("/strategies/404", headers=alice).status_code == 403
    response = client.get("/strategies/404", headers=sign_in("root", roles=["ADMIN"]))
    assert (response.status_code, response.json()) == (404, {"message": "Not found"})


def test_branching_copies_the_latest_files_and_replaces_the_readme(client, db, sign_in):
    add_strategy(
        db, "7", {"main.py": "v1", "lib/util.py": "U", "README.md": "old"}, read=["ROLE#PUBLIC"]
    )
    publish_version(db, "7", 1, {"main.py": b"v2"})
    execute(db, "SELECT setval('strategy_id_seq', 7)")
    alice = sign_in("alice", full_name="Alice Smith")

    response = client.post(
        "/strategies",
        json={
            "sourceStrategyId": 7,
            "name": " Mine ",
            "description": " Momentum, mostly ",
            "readme_content": "# Mine\n",
            "tags": ["Momentum", " fx "],
        },
        headers=alice,
    )

    assert response.status_code == 201
    strategy = response.json()
    created_at = strategy.pop("created_at")
    assert strategy == {
        "id": "8",
        "name": "Mine",
        "entrypoint": "main.py",
        "current_version": 1,
        "updated_at": created_at,
        "description": "Momentum, mostly",
        "owner": "alice",
        "owner_display": "Alice Smith",
        "tags": ["Momentum", "fx"],
    }
    assert client.get("/strategies/8/artifacts", headers=alice).json() == {
        "artifacts": ["README.md", "lib/util.py", "main.py"]
    }
    assert client.get("/strategies/8/artifacts/main.py", headers=alice).content == b"v2"
    assert client.get("/strategies/8/artifacts/README.md", headers=alice).text == "# Mine\n"
    grants = execute(
        db, "SELECT access, principal FROM strategy_permissions WHERE strategy_id = '8'"
    )
    assert sorted((row["access"], row["principal"]) for row in grants) == [
        ("read", "USER#alice"),
        ("write", "USER#alice"),
    ]
    assert ids(client.get("/strategies", headers=alice)) == ["7", "8"]


def test_branching_keeps_the_readme_name_or_adds_one(client, db, sign_in):
    add_strategy(db, "1", {"main.py": "M", "readme.md": "old"}, read=["ROLE#PUBLIC"])
    add_strategy(db, "2", {"main.py": "M"}, read=["ROLE#PUBLIC"])
    execute(db, "SELECT setval('strategy_id_seq', 2)")
    alice = sign_in("alice")

    for source, expected in (("1", ["main.py", "readme.md"]), ("2", ["README.md", "main.py"])):
        response = client.post(
            "/strategies", json={**NEW_STRATEGY, "source_strategy_id": source}, headers=alice
        )
        assert response.status_code == 201
        files = client.get(f"/strategies/{response.json()['id']}/artifacts", headers=alice).json()
        assert files == {"artifacts": expected}


def test_branching_needs_a_readable_source(client, db, sign_in):
    add_strategy(db, "1", read=["USER#bob"])
    execute(db, "SELECT setval('strategy_id_seq', 1)")
    alice = sign_in("alice")
    response = client.post(
        "/strategies", json={**NEW_STRATEGY, "source_strategy_id": "99"}, headers=alice
    )
    assert (response.status_code, response.json()) == (
        404,
        {"message": "Source strategy 99 not found"},
    )
    response = client.post("/strategies", json=NEW_STRATEGY, headers=alice)
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    assert execute(db, "SELECT id FROM strategies") == [{"id": "1"}]
    response = client.post(
        "/strategies", json=NEW_STRATEGY, headers=sign_in("root", roles=["ADMIN"])
    )
    assert response.status_code == 201


def test_a_failed_branch_leaves_nothing_behind(client, db, sign_in):
    add_strategy(db, "1", {"main.py": "M"}, read=["ROLE#PUBLIC"])
    execute(db, "SELECT setval('strategy_id_seq', 1)")
    execute(db, "DELETE FROM strategy_artifact_versions")
    response = client.post("/strategies", json=NEW_STRATEGY, headers=sign_in("alice"))
    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to copy artifacts: Missing version record for main.py v1"
    }
    assert execute(db, "SELECT id FROM strategies") == [{"id": "1"}]


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"source_strategy_id": None}, "source_strategy_id is required"),
        ({"name": 5}, "name must be a string"),
        ({"name": "  "}, "name is required"),
        ({"name": "x" * 61}, "name must be 60 characters or fewer"),
        ({"description": 5}, "description must be a string"),
        ({"description": "x" * 76}, "description must be 75 characters or fewer"),
        ({"readme_content": 5}, "readme_content must be a string"),
        ({"readme_content": "x" * 10_001}, "readme_content must be 10000 characters or fewer"),
        ({"tags": "fx"}, "tags must be a list of strings"),
        ({"tags": list("abcdef")}, "tags must contain at most 5 items"),
        ({"tags": [1]}, "each tag must be a string"),
        ({"tags": [" "]}, "tags cannot be empty"),
        ({"tags": ["x" * 16]}, "each tag must be 15 characters or fewer"),
        ({"tags": ["FX", "fx"]}, "duplicate tags are not allowed"),
    ],
)
def test_branching_validates_input(client, sign_in, changes, message):
    response = client.post(
        "/strategies", json={**NEW_STRATEGY, **changes}, headers=sign_in("alice")
    )
    assert (response.status_code, response.json()) == (400, {"message": message})


def test_branching_requires_a_readme_and_a_json_object(client, sign_in):
    alice = sign_in("alice")
    body = {key: value for key, value in NEW_STRATEGY.items() if key != "readme_content"}
    response = client.post("/strategies", json=body, headers=alice)
    assert response.json() == {"message": "readme_content is required"}
    response = client.post("/strategies", content=b"{", headers=alice)
    assert (response.status_code, response.json()) == (400, {"message": "invalid JSON body"})
    response = client.post("/strategies", json=[NEW_STRATEGY], headers=alice)
    assert (response.status_code, response.json()) == (400, {"message": "body must be an object"})
