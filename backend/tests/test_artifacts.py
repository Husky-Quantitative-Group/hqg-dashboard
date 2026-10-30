"""Strategy files: listing, downloading and saving new versions."""

from __future__ import annotations

import pytest

from support import add_strategy, execute


@pytest.fixture
def alice(client, db, sign_in):
    add_strategy(db, "1", {"main.py": "print(1)\n", "README.md": "# One\n"}, write=["USER#alice"])
    return sign_in("alice")


def save(client, headers, *files, strategy_id="1"):
    body = {"files": [{"artifactId": path, "content": content} for path, content in files]}
    return client.post(f"/strategies/{strategy_id}/artifacts", json=body, headers=headers)


def test_list_and_download(client, alice):
    assert client.get("/strategies/1/artifacts", headers=alice).json() == {
        "artifacts": ["README.md", "main.py"]
    }
    response = client.get("/strategies/1/artifacts/main.py", headers=alice)
    assert response.status_code == 200
    assert response.content == b"print(1)\n"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"] == 'attachment; filename="main.py"'


def test_files_need_read_access(client, alice, sign_in):
    bob = sign_in("bob")
    for path in ("/strategies/1/artifacts", "/strategies/1/artifacts/main.py"):
        response = client.get(path, headers=bob)
        assert (response.status_code, response.json()) == (403, {"message": "forbidden"})


def test_missing_files(client, alice, db):
    response = client.get("/strategies/1/artifacts/nope.py", headers=alice)
    assert (response.status_code, response.json()) == (404, {"message": "Artifact not found"})
    execute(db, "DELETE FROM strategy_artifact_versions WHERE artifact_id = 'main.py'")
    response = client.get("/strategies/1/artifacts/main.py", headers=alice)
    assert (response.status_code, response.json()) == (
        404,
        {"message": "Artifact version not found"},
    )


def test_saving_publishes_a_new_strategy_version(client, alice):
    response = save(client, alice, ("main.py", "print(2)\n"), ("lib/util.py", "X = 1\n"))
    assert response.status_code == 200
    assert response.json() == {"ok": True, "version": 2, "artifacts": ["main.py", "lib/util.py"]}

    assert client.get("/strategies/1", headers=alice).json()["current_version"] == 2
    assert client.get("/strategies/1/artifacts", headers=alice).json() == {
        "artifacts": ["README.md", "lib/util.py", "main.py"]
    }
    assert client.get("/strategies/1/artifacts/main.py", headers=alice).text == "print(2)\n"
    assert client.get("/strategies/1/artifacts/lib/util.py", headers=alice).text == "X = 1\n"
    assert client.get("/strategies/1/artifacts/README.md", headers=alice).text == "# One\n"
    assert save(client, alice, ("main.py", "print(3)\n")).json()["version"] == 3


def test_unusual_file_names_download_safely(client, alice):
    names = ['quote".py', "naïve.py"]
    assert save(client, alice, *((name, "x") for name in names)).status_code == 200
    dispositions = [
        client.get(f"/strategies/1/artifacts/{name}", headers=alice).headers["content-disposition"]
        for name in names
    ]
    assert dispositions == [
        "attachment; filename*=UTF-8''quote%22.py",
        "attachment; filename*=UTF-8''na%C3%AFve.py",
    ]


def test_saving_needs_write_access(client, alice, db, sign_in):
    add_strategy(db, "2", read=["USER#alice"])
    response = save(client, alice, ("main.py", "x"), strategy_id="2")
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    response = save(client, sign_in("root", roles=["ADMIN"]), ("main.py", "x"), strategy_id="404")
    assert (response.status_code, response.json()) == (404, {"message": "Strategy not found"})


@pytest.mark.parametrize(
    "files, status_code, message",
    [
        ([], 400, "files must be a non-empty list"),
        ({"main.py": "x"}, 400, "files must be a non-empty list"),
        ([{"artifactId": "main.py"}], 400, "Each file must include artifactId and content"),
        (
            [{"artifactId": "", "content": "x"}],
            400,
            "Each file must include artifactId and content",
        ),
        (["main.py"], 400, "Each file must include artifactId and content"),
        ([{"artifactId": "main.py", "content": 5}], 400, "Invalid content for main.py"),
        (
            [{"artifactId": "big.py", "content": "x" * 1_000_001}],
            413,
            "big.py exceeds max size of 1MB",
        ),
        ([{"artifactId": "a.py", "content": "1"}] * 2, 400, "Save 1-49 unique artifacts at a time"),
        (
            [{"artifactId": f"{index}.py", "content": ""} for index in range(50)],
            400,
            "Save 1-49 unique artifacts at a time",
        ),
    ],
)
def test_saving_validates_files(client, alice, files, status_code, message):
    response = client.post("/strategies/1/artifacts", json={"files": files}, headers=alice)
    assert (response.status_code, response.json()) == (status_code, {"message": message})
    assert client.get("/strategies/1", headers=alice).json()["current_version"] == 1


def test_saving_rejects_text_that_is_not_unicode(client, alice):
    body = b'{"files": [{"artifactId": "a.py", "content": "\\udc00"}]}'
    response = client.post("/strategies/1/artifacts", content=body, headers=alice)
    assert (response.status_code, response.json()) == (400, {"message": "Invalid content for a.py"})


def test_saving_requires_a_json_object(client, alice):
    response = client.post("/strategies/1/artifacts", content=b"files", headers=alice)
    assert (response.status_code, response.json()) == (400, {"message": "invalid JSON body"})
