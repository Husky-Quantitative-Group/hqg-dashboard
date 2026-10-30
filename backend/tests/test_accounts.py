"""Engine account control, ported from the AWS deployment's tests."""

from __future__ import annotations

import copy
import time
from uuid import uuid4

import psycopg
import pytest

from hqg_dashboard.accounts import admin, readiness
from hqg_dashboard.accounts.control import Conflict, Forbidden, Invalid
from hqg_dashboard.accounts.validation import validate_package
from hqg_dashboard.artifacts import publish_version
from hqg_dashboard.routes import artifacts as artifact_routes
from support import (
    ACCOUNT,
    ENGINE,
    PACKAGE,
    SERVICE_SECRET,
    execute,
    paused,
    registration,
    seed_package,
)

SERVICE = {"Authorization": f"Bearer {SERVICE_SECRET}"}


@pytest.fixture
def operator(sign_in):
    return sign_in("operator", roles=())


def save(client, headers, files):
    body = {"files": [dict(artifactId=path, content=code) for path, code in files.items()]}
    return client.post("/strategies/sample/artifacts", json=body, headers=headers)


def test_historical_versions_partial_saves_and_later_files(services, client, operator):
    _, source, _ = services
    assert (
        save(client, operator, {"main.py": PACKAGE["files"]["main.py"] + "# v2"}).status_code == 200
    )
    assert save(client, operator, {"later.py": "NEW = True"}).status_code == 200

    assert source.resolve("sample", 1, "operator", []) == PACKAGE
    v2 = source.resolve("sample", 2, "operator", [])
    assert v2["files"]["helper.py"] == "TARGET = 0.5"
    assert "later.py" not in v2["files"]
    assert "later.py" in source.resolve("sample", 3, "operator", [])["files"]


@pytest.mark.parametrize("fault", ["unpublished", "entrypoint", "syntax", "history"])
def test_invalid_packages_never_register(services, client, db, operator, fault):
    store, _, _ = services
    paused(store)
    body = registration()
    if fault == "unpublished":
        body["version"] = 99
    elif fault == "entrypoint":
        execute(db, "UPDATE strategies SET entrypoint = 'missing.py' WHERE id = 'sample'")
    elif fault == "syntax":
        seed_package(db, {**PACKAGE, "files": {"main.py": "!invalid"}})
    else:
        execute(db, "DELETE FROM strategy_artifact_versions WHERE artifact_id = 'main.py'")

    response = client.post(f"/accounts/{ACCOUNT}/strategies", json=body, headers=operator)

    assert response.status_code == 400
    assert store.get(ACCOUNT, "state")["approved_strategies"] == []
    assert store.get(ACCOUNT, "action#" + body["idempotency_key"]) is None


def test_registration_requires_both_account_and_strategy_permission(services, client, db, sign_in):
    store, _, _ = services
    paused(store)
    url = f"/accounts/{ACCOUNT}/strategies"

    response = client.post(url, json=registration(), headers=sign_in("stranger"))
    assert response.status_code == 403
    assert response.json() == {"message": "Account permission required"}

    execute(db, "DELETE FROM strategy_permissions WHERE principal = 'USER#operator'")
    response = client.post(url, json=registration(), headers=sign_in("operator", roles=()))
    assert response.status_code == 403
    assert response.json() == {"message": "Strategy read permission required"}

    execute(
        db,
        "INSERT INTO strategy_permissions (strategy_id, access, principal)"
        " VALUES ('sample', 'read', 'ROLE#FUND')",
    )
    response = client.post(url, json=registration(), headers=sign_in("operator", roles=["FUND"]))
    assert response.status_code == 200
    assert response.json()["control_version"] == 1


def test_registration_idempotency_immutability_and_atomic_conflict(services, db, monkeypatch):
    store, _, api = services
    paused(store)
    body = registration()
    result = api.change(ACCOUNT, "operator", "register", body)
    assert api.change(ACCOUNT, "operator", "register", body) == result
    with pytest.raises(Conflict):
        api.change(ACCOUNT, "operator", "register", {**body, "version": 2})
    # A different source claiming the same registered version cannot replace it.
    seed_package(db, {**PACKAGE, "files": {**PACKAGE["files"], "new.py": "X = 1"}})
    with pytest.raises(Conflict, match="immutable"):
        api.change(ACCOUNT, "operator", "register", registration(control_version=1))
    seed_package(db, {**PACKAGE, "version": 2})
    paused(store)
    before = store.get(ACCOUNT, "state")
    body2 = registration(2, 1)
    commit = store.commit

    def concurrent_write(account_id, generation, state, extra):
        concurrent = store.get(account_id, "state")
        concurrent["generation"] += 1
        commit(account_id, generation, concurrent, {})
        commit(account_id, generation, state, extra)

    monkeypatch.setattr(store, "commit", concurrent_write)
    with pytest.raises(Conflict):
        api.change(ACCOUNT, "operator", "register", body2)
    assert store.get(ACCOUNT, "state")["approved_strategies"] == before["approved_strategies"]
    for prefix in ("action#", "audit#"):
        assert store.get(ACCOUNT, prefix + body2["idempotency_key"]) is None
    v2_digest = validate_package({**PACKAGE, "version": 2})[0]["source_digest"]
    assert store.get(ACCOUNT, "package#" + v2_digest) is None


def test_download_is_account_scoped_pinned_and_digest_checked(services, client, db, operator):
    store, source, api = services
    paused(store)
    api.change(ACCOUNT, "operator", "register", registration())
    digest = validate_package(PACKAGE)[0]["source_digest"]
    url = f"/internal/v1/accounts/{ACCOUNT}/strategy-packages/{digest}"

    # Saving the strategy again cannot change the registered snapshot.
    assert save(client, operator, {"main.py": "# replaced"}).status_code == 200
    response = client.get(url, headers=SERVICE)
    assert response.status_code == 200
    assert response.json() == PACKAGE

    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 403
    response = client.get(url)
    assert response.status_code == 403
    assert response.json() == {"message": "Service authentication required"}

    other = str(uuid4())
    admin.provision(store, other, str(uuid4()), "operator", "other-secret")
    with pytest.raises(Forbidden):
        api.download(other, "other-secret", digest)
    bad = source.snapshot(ACCOUNT, {**PACKAGE, "version": 2})
    with pytest.raises(Invalid, match="digest mismatch"):
        source.download(bad, digest)

    execute(db, "DELETE FROM engine_account_records WHERE record = %s", ["package#" + digest])
    response = client.get(url, headers=SERVICE)
    assert response.status_code == 400
    assert response.json() == {"message": "Registered snapshot missing"}


def test_registration_limit_fails_closed(services):
    store, _, api = services
    paused(store)
    state = store.get(ACCOUNT, "state")
    state["approved_strategies"] = [
        validate_package({**PACKAGE, "version": version})[0] for version in range(2, 34)
    ]
    state["generation"] += 1
    store.commit(ACCOUNT, state["generation"] - 1, state, {})
    with pytest.raises(Invalid, match="32"):
        api.change(ACCOUNT, "operator", "register", registration())


@pytest.mark.parametrize("image_digest, status_code", [(None, 200), ("sha256:" + "a" * 64, 400)])
def test_provisioned_account_sync_requires_matching_image_digest(
    services, client, image_digest, status_code
):
    store, _, _ = services
    initial = store.get(ACCOUNT, "state")
    assert initial["image_digest"] is None
    report = dict(
        account_id=ACCOUNT,
        engine_instance_id=ENGINE,
        boot_id=str(uuid4()),
        request_id=str(uuid4()),
        image_digest=image_digest,
        approved_strategies=[],
        control_version=0,
        configuration_digest=None,
        modes={
            mode: dict(
                incident_id=str(uuid4()),
                state="unconfigured",
                gate_open=False,
                reconciled=True,
            )
            for mode in ("paper", "live")
        },
    )

    response = client.post(f"/internal/v1/accounts/{ACCOUNT}/sync", json=report, headers=SERVICE)

    assert response.status_code == status_code
    state = store.get(ACCOUNT, "state")
    if status_code == 400:
        assert response.json() == {"message": "Invalid sync contract or installed image"}
        assert state == initial
    else:
        assert response.json()["dashboard_ready"] is True
        assert state["observed"] == report
        assert state["boot_id"] == report["boot_id"]


def test_readiness_route_requires_the_service_secret(services, client):
    url = f"/internal/v1/accounts/{ACCOUNT}/readiness"
    response = client.get(url, headers=SERVICE)
    assert response.status_code == 200
    assert response.json() == {"application": "hqg-account-control-ready"}
    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 403
    assert (
        client.get(f"/internal/v1/accounts/{uuid4()}/readiness", headers=SERVICE).status_code == 403
    )


def test_status_is_limited_to_account_users(services, client, operator, sign_in):
    response = client.get(f"/accounts/{ACCOUNT}/status", headers=operator)
    assert response.status_code == 200
    status = response.json()
    assert status["account_id"] == ACCOUNT
    assert "service_secret_hash" not in status and "users" not in status
    assert (status["online"], status["pending"]) == (False, True)

    response = client.get(f"/accounts/{ACCOUNT}/status", headers=sign_in("stranger"))
    assert response.status_code == 403
    assert client.get(f"/accounts/{ACCOUNT}/status").status_code == 401


def test_storage_failures_answer_service_unavailable(services, client, operator, monkeypatch):
    store, _, _ = services

    def unavailable(*args):
        raise psycopg.OperationalError("connection lost")

    monkeypatch.setattr(store, "get", unavailable)
    response = client.get(f"/accounts/{ACCOUNT}/status", headers=operator)
    assert response.status_code == 503
    assert response.json() == {"message": "Account control unavailable"}


def test_malformed_requests_are_rejected(services, client, operator):
    url = f"/accounts/{ACCOUNT}/actions"
    response = client.post(url, content=b"{not json", headers=operator)
    assert response.status_code == 400
    response = client.post(url, json={"action": "stop"}, headers=operator)
    assert response.status_code == 400
    assert response.json() == {"message": "'idempotency_key'"}


def test_provision_duplicates_and_safe_replacement(services):
    store, _, _ = services
    initial = store.get(ACCOUNT, "state")
    assert initial["users"] == {"operator": ["control"]}
    assert initial["approved_strategies"] == []
    with pytest.raises(Conflict):
        admin.provision(store, ACCOUNT, str(uuid4()), "other", "replacement-secret", True)
    assert store.get(ACCOUNT, "state") == initial
    live_account = str(uuid4())
    admin.provision(store, live_account, str(uuid4()), "operator", "live-secret", True)
    assert store.get(live_account, "state")["users"] == {"operator": ["control", "live"]}
    state = copy.deepcopy(initial)
    state.update(
        last_sync=time.time(),
        boot_id=str(uuid4()),
        generation=1,
        configuration={"retained": True},
    )
    store.commit(ACCOUNT, 0, state, {})
    with pytest.raises(Conflict):
        admin.authorize_replacement(store, ACCOUNT, "maintainer")
    state.update(last_sync=time.time() - 16, generation=2)
    store.commit(ACCOUNT, 1, state, {})
    admin.authorize_replacement(store, ACCOUNT, "maintainer")
    updated = store.get(ACCOUNT, "state")
    assert updated["configuration"] == state["configuration"]
    assert updated["boot_id"] is updated["observed"] is updated["last_sync"] is None
    assert all(
        mode["desired_state"] == "paused" and mode["resume_incident_id"] is None
        for mode in updated["modes"].values()
    )
    assert updated["control_version"] == 1


@pytest.mark.parametrize("fault", ["none", "http", "status", "marker", "transport", "missing"])
def test_readiness_requires_both_real_https_probes(monkeypatch, fault):
    website_url = {"http": "http://website.test/", "missing": ""}.get(
        fault, "https://website.test/"
    )
    probe = readiness.ReadinessProbe("https://control.test/", "test-secret", website_url)
    seen = []

    class Response:
        status = 503 if fault == "status" else 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return b"wrong" if fault == "marker" else b"hqg-account-control-ready hqg-dashboard-app"

    class Opener:
        def open(self, request, timeout):
            seen.append(request)
            assert timeout == 0.8
            if fault == "transport":
                raise OSError("Unreachable")
            return Response()

    monkeypatch.setattr(readiness.urllib.request, "build_opener", lambda *args: Opener())
    assert probe() is (fault == "none")
    if fault == "none":
        assert len(seen) == 2
        assert seen[0].get_header("Authorization") == "Bearer test-secret"
        assert seen[1].get_header("Authorization") is None
    assert readiness.NoRedirect().redirect_request(None, None, None, None, None, None) is None


def test_concurrent_artifact_save_cannot_change_a_published_version(
    services, client, db, operator, monkeypatch
):
    _, source, _ = services
    assert (
        save(client, operator, {"main.py": PACKAGE["files"]["main.py"] + "# published"}).status_code
        == 200
    )
    published = source.resolve("sample", 2, "operator", [])

    def stale_publish(db, strategy_id, base_version, files):
        # This save read the strategy before the save above published version 2.
        return publish_version(db, strategy_id, 1, files)

    monkeypatch.setattr(artifact_routes, "publish_version", stale_publish)
    response = save(
        client,
        operator,
        {"main.py": PACKAGE["files"]["main.py"] + "# losing save", "orphan.py": "X = 1"},
    )

    assert response.status_code == 409
    assert response.json() == {"message": "Strategy changed; refresh before saving"}
    assert source.resolve("sample", 2, "operator", []) == published
    assert execute(db, "SELECT * FROM strategy_artifacts WHERE artifact_id = 'orphan.py'") == []
    assert (
        execute(db, "SELECT * FROM strategy_artifact_versions WHERE artifact_id = 'orphan.py'")
        == []
    )
