import copy
import json
import os
import time
from uuid import uuid4

import boto3
import pytest
from botocore.exceptions import ClientError

from aws_fixture import load, seed_package
from control import Control, Conflict, Forbidden, Invalid
from packages import StrategySource
from store import DynamoStore
from validation import validate_package

admin = load("account_admin", "aws/lambdas/accounts/admin.py")
main = load("account_handler", "aws/lambdas/accounts/main.py")
ACCOUNT, ENGINE = str(uuid4()), str(uuid4())
PACKAGE = dict(
    strategy_id="sample",
    version=1,
    entrypoint="main.py",
    files={
        "main.py": 'class Example(Strategy):\n    universe = ["AAPL"]\n',
        "helper.py": "TARGET = 0.5",
    },
)


def services(aws):
    dynamo, s3 = aws
    store = DynamoStore(boto3.client("dynamodb"), os.environ["ACCOUNTS_TABLE"])
    admin.provision(store, ACCOUNT, ENGINE, "operator", "test-secret")
    source = StrategySource(dynamo, s3, os.environ)
    seed_package(dynamo, s3, PACKAGE)
    return store, source, Control(store, lambda: True, strategy_source=source)


def paused(store):
    state = store.get(ACCOUNT, "state")
    state["last_sync"] = time.time()
    state["observed"] = dict(
        control_version=state["control_version"],
        modes={
            mode: dict(gate_open=False, reconciled=True) for mode in ("paper", "live")
        },
    )
    state["generation"] += 1
    store.commit(ACCOUNT, state["generation"] - 1, state, {})


def registration(version=1, control_version=0):
    return dict(
        strategy_id="sample",
        version=version,
        idempotency_key=str(uuid4()),
        expected_control_version=control_version,
    )


def event(body, route="POST /accounts/{accountId}/strategies", actor="operator"):
    return dict(
        requestContext={"routeKey": route, "authorizer": {"netid": actor}},
        pathParameters={"accountId": ACCOUNT},
        body=json.dumps(body),
    )


def provision_event(body, roles=("ADMIN",), actor="maintainer"):
    return {
        "requestContext": {
            "routeKey": "POST /admin/engine-accounts",
            "authorizer": {"lambda": {"netid": actor, "roles": json.dumps(roles)}},
        },
        "body": json.dumps(body),
    }


@pytest.mark.parametrize("live", [False, True])
def test_admin_provisions_configured_account_without_exposing_secret(
    aws, monkeypatch, live
):
    monkeypatch.setenv("CONTROL_READINESS_TOKEN", "server-secret")
    monkeypatch.setenv(
        "CONTROL_READINESS_URL",
        f"https://api.test/prod/internal/v1/accounts/{ACCOUNT}/readiness",
    )
    monkeypatch.setattr(main, "_service", None)
    body = {
        "account_id": ACCOUNT,
        "engine_id": ENGINE,
        "netid": "operator",
        "actor": "forged-actor",
        "secret": "forged-secret",
    }
    if live:
        body["allow_live"] = True
    result = main.handler(provision_event(body), None)
    assert result["statusCode"] == 201
    assert json.loads(result["body"]) == {
        "account_id": ACCOUNT,
        "engine_id": ENGINE,
        "netid": "operator",
        "allow_live": live,
        "state": "paused",
    }
    api = main.service()
    state = api.authenticate_service(ACCOUNT, "server-secret")
    assert state["engine_instance_id"] == ENGINE
    assert state["users"] == {"operator": ["control", "live"] if live else ["control"]}
    assert all(mode["desired_state"] == "paused" for mode in state["modes"].values())
    assert state["configuration"] is None
    with pytest.raises(Forbidden):
        api.authenticate_service(ACCOUNT, "forged-secret")
    records = aws[0].Table(os.environ["ACCOUNTS_TABLE"]).scan()["Items"]
    audits = [
        json.loads(item["body"])
        for item in records
        if item["record"].startswith("audit#")
    ]
    assert len(audits) == 1
    assert audits[0]["actor"] == "maintainer"
    assert audits[0]["netid"] == "operator"
    duplicate = main.handler(provision_event({**body, "engine_id": str(uuid4())}), None)
    assert duplicate["statusCode"] == 409
    assert api.store.get(ACCOUNT, "state") == state


@pytest.mark.parametrize(
    "roles, actor",
    [([], "maintainer"), (["FUND"], "maintainer"), (["ADMIN"], None)],
)
def test_provision_requires_authenticated_admin_before_parsing_body(aws, roles, actor):
    request = provision_event({}, roles, actor)
    request["body"] = "not JSON"
    api = Control(
        DynamoStore(boto3.client("dynamodb"), os.environ["ACCOUNTS_TABLE"]), lambda: False
    )
    assert main.handle(request, api)["statusCode"] == 403
    assert aws[0].Table(os.environ["ACCOUNTS_TABLE"]).scan()["Items"] == []


@pytest.mark.parametrize("changes", [
    {"account_id": "invalid"},
    {"engine_id": "invalid"},
    {"netid": "  "},
    {"netid": []},
    {"allow_live": "true"},
    {"account_id": str(uuid4())},
    None,
])
def test_provision_rejects_invalid_input_and_unconfigured_accounts(
    aws, monkeypatch, changes
):
    monkeypatch.setenv("CONTROL_READINESS_TOKEN", "server-secret")
    monkeypatch.setenv(
        "CONTROL_READINESS_URL",
        f"https://api.test/internal/v1/accounts/{ACCOUNT}/readiness",
    )
    body = {"account_id": ACCOUNT, "engine_id": ENGINE, "netid": "operator"}
    body = [] if changes is None else {**body, **changes}
    api = Control(
        DynamoStore(boto3.client("dynamodb"), os.environ["ACCOUNTS_TABLE"]), lambda: False
    )
    assert main.handle(provision_event(body), api)["statusCode"] == 400
    assert aws[0].Table(os.environ["ACCOUNTS_TABLE"]).scan()["Items"] == []


@pytest.mark.parametrize("missing", ["CONTROL_READINESS_TOKEN", "CONTROL_READINESS_URL"])
def test_provision_requires_server_configuration(aws, monkeypatch, missing):
    monkeypatch.setenv("CONTROL_READINESS_TOKEN", "server-secret")
    monkeypatch.setenv(
        "CONTROL_READINESS_URL",
        f"https://api.test/internal/v1/accounts/{ACCOUNT}/readiness",
    )
    monkeypatch.delenv(missing)
    api = Control(
        DynamoStore(boto3.client("dynamodb"), os.environ["ACCOUNTS_TABLE"]), lambda: False
    )
    result = main.handle(
        provision_event({"account_id": ACCOUNT, "engine_id": ENGINE, "netid": "operator"}),
        api,
    )
    assert result["statusCode"] == 503
    assert aws[0].Table(os.environ["ACCOUNTS_TABLE"]).scan()["Items"] == []


def test_historical_versions_partial_saves_and_later_files(aws):
    _, source, _ = services(aws)
    artifacts = load("artifact_handler", "aws/lambdas/strategy_artifacts/main.py")
    auth = event({})
    for path, code in [
        ("main.py", PACKAGE["files"]["main.py"] + "# v2"),
        ("later.py", "NEW = True"),
    ]:
        assert (
            artifacts.upload_artifacts(
                "sample", {"files": [dict(artifactId=path, content=code)]}, auth
            )["statusCode"]
            == 200
        )
    assert source.resolve("sample", 1, "operator", []) == PACKAGE
    v2 = source.resolve("sample", 2, "operator", [])
    assert v2["files"]["helper.py"] == "TARGET = 0.5"
    assert "later.py" not in v2["files"]
    assert "later.py" in source.resolve("sample", 3, "operator", [])["files"]


@pytest.mark.parametrize(
    "fault", ["unpublished", "entrypoint", "syntax", "history", "object"]
)
def test_invalid_packages_never_register(aws, fault):
    store, source, api = services(aws)
    paused(store)
    body = registration()
    if fault == "unpublished":
        body["version"] = 99
    elif fault == "entrypoint":
        source.strategies.update_item(
            Key={"id": "sample"},
            UpdateExpression="SET entrypoint = :e",
            ExpressionAttributeValues={":e": "missing.py"},
        )
    elif fault == "syntax":
        seed_package(*aws, {**PACKAGE, "files": {"main.py": "!invalid"}})
    else:
        key = {"strategy_artifact_id": "sample#main.py", "strategy_version": 1}
        record = source.versions.get_item(Key=key)["Item"]
        if fault == "history":
            source.versions.delete_item(Key=key)
        else:
            source.s3.delete_object(
                Bucket=source.bucket,
                Key=record["s3_key"],
                VersionId=record["s3_version_id"],
            )
    assert main.handle(event(body), api)["statusCode"] in (400, 503)
    assert store.get(ACCOUNT, "state")["approved_strategies"] == []
    assert store.get(ACCOUNT, "action#" + body["idempotency_key"]) is None


def test_registration_requires_both_account_and_strategy_permission(aws):
    store, source, api = services(aws)
    paused(store)
    assert (
        main.handle(event(registration(), actor="stranger"), api)["statusCode"] == 403
    )
    source.write.delete_item(
        Key={"strategy_id": "sample", "principal": "USER#operator"}
    )
    assert main.handle(event(registration()), api)["statusCode"] == 403
    source.read.put_item(Item={"strategy_id": "sample", "principal": "ROLE#FUND"})
    request = event(registration())
    request["requestContext"]["authorizer"]["roles"] = '["FUND"]'
    assert main.handle(request, api)["statusCode"] == 200


def test_registration_idempotency_immutability_and_atomic_conflict(aws, monkeypatch):
    store, source, api = services(aws)
    paused(store)
    body = registration()
    result = api.change(ACCOUNT, "operator", "register", body)
    assert api.change(ACCOUNT, "operator", "register", body) == result
    with pytest.raises(Conflict):
        api.change(ACCOUNT, "operator", "register", {**body, "version": 2})
    # A different source claiming the same registered version cannot replace it.
    seed_package(*aws, {**PACKAGE, "files": {**PACKAGE["files"], "new.py": "X = 1"}})
    with pytest.raises(Conflict, match="immutable"):
        api.change(ACCOUNT, "operator", "register", registration(control_version=1))
    seed_package(*aws, {**PACKAGE, "version": 2})
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
    assert (
        store.get(ACCOUNT, "state")["approved_strategies"]
        == before["approved_strategies"]
    )
    for prefix in ("action#", "audit#"):
        assert store.get(ACCOUNT, prefix + body2["idempotency_key"]) is None
    assert (
        store.get(
            ACCOUNT,
            "package#"
            + validate_package({**PACKAGE, "version": 2})[0]["source_digest"],
        )
        is None
    )


def test_download_is_account_scoped_pinned_and_digest_checked(aws):
    store, source, api = services(aws)
    paused(store)
    api.change(ACCOUNT, "operator", "register", registration())
    digest = validate_package(PACKAGE)[0]["source_digest"]
    ref = store.get(ACCOUNT, "package#" + digest)
    # A later S3 version cannot replace the registered snapshot.
    source.s3.put_object(Bucket=source.bucket, Key=ref["key"], Body=b"{}")
    request = event(
        {}, "GET /internal/v1/accounts/{accountId}/strategy-packages/{sourceDigest}"
    )
    request["pathParameters"]["sourceDigest"] = digest
    request["headers"] = {"authorization": "Bearer test-secret"}
    assert json.loads(main.handle(request, api)["body"]) == PACKAGE
    request["headers"] = {"authorization": "Bearer wrong"}
    assert main.handle(request, api)["statusCode"] == 403
    other = str(uuid4())
    admin.provision(store, other, str(uuid4()), "operator", "other-secret")
    with pytest.raises(Forbidden):
        api.download(other, "other-secret", digest)
    bad = source.snapshot(ACCOUNT, {**PACKAGE, "version": 2})
    with pytest.raises(Invalid, match="digest mismatch"):
        source.download(bad, digest)
    source.s3.delete_object(
        Bucket=source.bucket, Key=ref["key"], VersionId=ref["version_id"]
    )
    assert (
        main.handle(
            {**request, "headers": {"authorization": "Bearer test-secret"}}, api
        )["statusCode"]
        == 503
    )


def test_registration_limit_and_unversioned_bucket_fail_closed(aws):
    store, source, api = services(aws)
    paused(store)
    state = store.get(ACCOUNT, "state")
    state["approved_strategies"] = [
        validate_package({**PACKAGE, "version": v})[0] for v in range(2, 34)
    ]
    state["generation"] += 1
    store.commit(ACCOUNT, state["generation"] - 1, state, {})
    with pytest.raises(Invalid, match="32"):
        api.change(ACCOUNT, "operator", "register", registration())
    source.s3.put_bucket_versioning(
        Bucket=source.bucket, VersioningConfiguration={"Status": "Suspended"}
    )
    with pytest.raises(Invalid, match="versioning"):
        source.snapshot(ACCOUNT, PACKAGE)


@pytest.mark.parametrize(
    "image_digest, status_code", [(None, 200), ("sha256:" + "a" * 64, 400)]
)
def test_provisioned_account_sync_requires_matching_image_digest(
    aws, image_digest, status_code
):
    store, _, api = services(aws)
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
    request = event(report, "POST /internal/v1/accounts/{accountId}/sync")
    request["headers"] = {"authorization": "Bearer test-secret"}

    result = main.handle(request, api)

    assert result["statusCode"] == status_code
    state = store.get(ACCOUNT, "state")
    if status_code == 400:
        assert json.loads(result["body"]) == {
            "message": "Invalid sync contract or installed image"
        }
        assert state == initial
    else:
        assert state["observed"] == report
        assert state["boot_id"] == report["boot_id"]


def test_provision_duplicates_and_safe_replacement(aws):
    store, _, _ = services(aws)
    initial = store.get(ACCOUNT, "state")
    assert initial["users"] == {"operator": ["control"]}
    assert initial["approved_strategies"] == []
    with pytest.raises(Conflict):
        admin.provision(
            store, ACCOUNT, str(uuid4()), "other", "replacement-secret", True
        )
    assert store.get(ACCOUNT, "state") == initial
    live_account = str(uuid4())
    admin.provision(store, live_account, str(uuid4()), "operator", "live-secret", True)
    assert store.get(live_account, "state")["users"] == {
        "operator": ["control", "live"]
    }
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


@pytest.mark.parametrize(
    "fault", ["none", "http", "status", "marker", "transport", "missing"]
)
def test_readiness_requires_both_real_https_probes(monkeypatch, fault):
    for prefix, marker in [
        ("CONTROL", "hqg-account-control-ready"),
        ("WEBSITE", "hqg-dashboard-app"),
    ]:
        monkeypatch.setenv(
            prefix + "_READINESS_URL", "https://" + prefix.lower() + ".test/"
        )
        monkeypatch.setenv(prefix + "_READINESS_CONTENT", marker)
    monkeypatch.setenv("CONTROL_READINESS_TOKEN", "test-secret")
    if fault == "http":
        monkeypatch.setenv("WEBSITE_READINESS_URL", "http://website.test/")
    if fault == "missing":
        monkeypatch.delenv("WEBSITE_READINESS_URL")
    seen = []

    class Response:
        status = 503 if fault == "status" else 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return (
                b"wrong"
                if fault == "marker"
                else b"hqg-account-control-ready hqg-dashboard-app"
            )

    class Opener:
        def open(self, request, timeout):
            seen.append(request)
            assert timeout == 0.8
            if fault == "transport":
                raise OSError("Unreachable")
            return Response()

    monkeypatch.setattr(main.urllib.request, "build_opener", lambda *args: Opener())
    assert main.readiness() is (fault == "none")
    if fault == "none":
        assert len(seen) == 2
        assert seen[0].get_header("Authorization") == "Bearer test-secret"
        assert seen[1].get_header("Authorization") is None
    assert (
        main.NoRedirect().redirect_request(None, None, None, None, None, None) is None
    )


def test_concurrent_artifact_save_cannot_change_a_published_version(aws, monkeypatch):
    _, source, _ = services(aws)
    artifacts = load("artifact_handler", "aws/lambdas/strategy_artifacts/main.py")
    stale = artifacts.STRATEGIES_TABLE.get_item(Key={"id": "sample"})
    auth = event({})
    first = {
        "files": [
            {
                "artifactId": "main.py",
                "content": PACKAGE["files"]["main.py"] + "# published",
            }
        ]
    }
    assert artifacts.upload_artifacts("sample", first, auth)["statusCode"] == 200
    published = source.resolve("sample", 2, "operator", [])
    monkeypatch.setattr(artifacts.STRATEGIES_TABLE, "get_item", lambda **kwargs: stale)
    second = {
        "files": [
            {
                "artifactId": "main.py",
                "content": PACKAGE["files"]["main.py"] + "# losing save",
            },
            {"artifactId": "orphan.py", "content": "X = 1"},
        ]
    }
    assert artifacts.upload_artifacts("sample", second, auth)["statusCode"] == 409
    assert source.resolve("sample", 2, "operator", []) == published
    assert "Item" not in source.artifacts.get_item(
        Key={"strategy_id": "sample", "artifact_id": "orphan.py"}
    )
    assert "Item" not in source.versions.get_item(
        Key={"strategy_artifact_id": "sample#orphan.py", "strategy_version": 2}
    )
