import copy
from uuid import uuid4

import pytest

from aws_fixture import seed_package
from control import ConcurrentUpdate, Conflict, Forbidden, digest
from test_accounts import ACCOUNT, ENGINE, PACKAGE, registration, services
from validation import validate_package


def heartbeat(store):
    state = store.get(ACCOUNT, "state")
    return dict(
        account_id=ACCOUNT,
        engine_instance_id=ENGINE,
        boot_id=state["boot_id"] or str(uuid4()),
        request_id=str(uuid4()),
        image_digest=None,
        approved_strategies=state["approved_strategies"],
        control_version=state["control_version"],
        configuration_digest=state["configuration_digest"],
        modes={
            mode: dict(
                incident_id=(state["observed"] or {}).get("modes", {}).get(
                    mode, {}
                ).get("incident_id", desired["resume_incident_id"] or str(uuid4())),
                state=desired["desired_state"],
                gate_open=desired["desired_state"] == "running",
                reconciled=True,
            )
            for mode, desired in state["modes"].items()
        },
    )


def configured(aws, running=False):
    store, source, api = services(aws)
    state = store.get(ACCOUNT, "state")
    identity = validate_package(PACKAGE)[0]
    configuration = {
        "modes": {
            mode: dict(
                portfolio_id=str(uuid4()),
                enabled=True,
                strategies=[{**identity, "allocation": 1}],
            )
            for mode in ("paper", "live")
        }
    }
    state.update(
        approved_strategies=[identity],
        configuration=configuration,
        configuration_digest=digest(configuration),
        configuration_revision=1,
        control_version=1,
        generation=1,
    )
    for mode in state["modes"].values():
        mode.update(
            desired_state="running" if running else "paused",
            resume_incident_id=str(uuid4()) if running else None,
            resume_version=1,
        )
    store.commit(ACCOUNT, 0, state, {})
    api.sync(ACCOUNT, "test-secret", heartbeat(store))
    return store, source, api


def action(store, name, **extra):
    return dict(
        action=name,
        mode="paper",
        idempotency_key=str(uuid4()),
        expected_control_version=store.get(ACCOUNT, "state")["control_version"],
        **extra,
    )


def race_once(monkeypatch, store, concurrent_update):
    commit = store.commit
    raced = False

    def racing_commit(*args):
        nonlocal raced
        if not raced:
            raced = True
            concurrent_update()
        return commit(*args)

    monkeypatch.setattr(store, "commit", racing_commit)


@pytest.mark.parametrize("kind", ["register", "configure", "resume", "stop"])
def test_control_changes_retry_heartbeat_conflicts(aws, monkeypatch, kind):
    store, _, api = configured(aws)
    before = store.get(ACCOUNT, "state")
    if kind == "register":
        seed_package(*aws, {**PACKAGE, "version": 2})
        body = registration(2, before["control_version"])
    elif kind == "configure":
        body = dict(
            configuration={
                "modes": {
                    mode: {**spec, "enabled": False, "strategies": []}
                    for mode, spec in before["configuration"]["modes"].items()
                }
            },
            idempotency_key=str(uuid4()),
            expected_control_version=before["control_version"],
        )
    else:
        body = action(
            store, kind,
            incident_id=before["observed"]["modes"]["paper"]["incident_id"],
        )
    operation = kind if kind in ("register", "configure") else "action"
    report = heartbeat(store)
    race_once(monkeypatch, store, lambda: api.sync(ACCOUNT, "test-secret", report))

    result = api.change(ACCOUNT, "operator", operation, body)

    state = store.get(ACCOUNT, "state")
    assert result["control_version"] == before["control_version"] + 1
    assert state["observed"] == report
    assert state["generation"] == before["generation"] + 2
    assert state["modes"]["live"] == before["modes"]["live"]
    assert api.change(ACCOUNT, "operator", operation, body) == result


def test_registration_reuses_package_prepared_during_heartbeats(aws, monkeypatch):
    store, source, api = services(aws)
    api.sync(ACCOUNT, "test-secret", heartbeat(store))
    calls = []

    def with_heartbeat(name, operation):
        def wrapped(*args):
            calls.append(name)
            api.sync(ACCOUNT, "test-secret", heartbeat(store))
            return operation(*args)
        return wrapped

    for name in ("resolve", "snapshot"):
        monkeypatch.setattr(source, name, with_heartbeat(name, getattr(source, name)))

    result = api.change(ACCOUNT, "operator", "register", registration())

    assert result["control_version"] == 1
    assert calls == ["resolve", "snapshot"]
    source_digest = store.get(ACCOUNT, "state")["approved_strategies"][0]["source_digest"]
    assert api.download(ACCOUNT, "test-secret", source_digest) == PACKAGE


@pytest.mark.parametrize("timing", ["readiness", "commit"])
def test_sync_returns_concurrent_stop_without_stopping_live(aws, monkeypatch, timing):
    store, _, api = configured(aws, running=True)
    report = heartbeat(store)
    live = copy.deepcopy(store.get(ACCOUNT, "state")["modes"]["live"])
    stop = action(store, "stop")
    probes = 0

    def readiness():
        nonlocal probes
        probes += 1
        if timing == "readiness":
            api.change(ACCOUNT, "operator", "action", stop)
        return True

    monkeypatch.setattr(api, "readiness", readiness)
    if timing == "commit":
        race_once(
            monkeypatch, store,
            lambda: api.change(ACCOUNT, "operator", "action", stop),
        )

    result = api.sync(ACCOUNT, "test-secret", report)

    assert probes == 1
    assert result["dashboard_ready"] is True
    assert result["control_version"] == stop["expected_control_version"] + 1
    assert result["modes"]["paper"]["desired_state"] == "paused"
    assert result["modes"]["live"] == live
    assert store.get(ACCOUNT, "state")["observed"] == report
    assert api.status(ACCOUNT, "operator")["pending"] is True


@pytest.mark.parametrize("fault", ["incident", "reconciliation"])
def test_resume_revalidates_pause_after_heartbeat_conflict(aws, monkeypatch, fault):
    store, _, api = configured(aws)
    report = heartbeat(store)
    resume = action(
        store, "resume", incident_id=report["modes"]["paper"]["incident_id"]
    )
    if fault == "incident":
        report["modes"]["paper"]["incident_id"] = str(uuid4())
    else:
        report["modes"]["paper"]["reconciled"] = False
    race_once(monkeypatch, store, lambda: api.sync(ACCOUNT, "test-secret", report))

    with pytest.raises(Conflict, match="current incident"):
        api.change(ACCOUNT, "operator", "action", resume)

    state = store.get(ACCOUNT, "state")
    assert state["modes"]["paper"]["desired_state"] == "paused"
    assert state["observed"] == report
    assert store.get(ACCOUNT, "action#" + resume["idempotency_key"]) is None


def test_retry_cannot_overwrite_a_newer_control_version(aws, monkeypatch):
    store, _, api = configured(aws)
    incident = heartbeat(store)["modes"]["paper"]["incident_id"]
    resume = action(store, "resume", incident_id=incident)
    stop = action(store, "stop")
    race_once(
        monkeypatch, store,
        lambda: api.change(ACCOUNT, "operator", "action", stop),
    )

    with pytest.raises(Conflict, match="Control version changed"):
        api.change(ACCOUNT, "operator", "action", resume)

    state = store.get(ACCOUNT, "state")
    assert state["control_version"] == stop["expected_control_version"] + 1
    assert state["modes"]["paper"]["desired_state"] == "paused"
    assert store.get(ACCOUNT, "action#" + resume["idempotency_key"]) is None


def test_sync_revalidates_provider_boot_after_conflict(aws, monkeypatch):
    store, _, api = services(aws)
    first, winner = heartbeat(store), heartbeat(store)
    race_once(monkeypatch, store, lambda: api.sync(ACCOUNT, "test-secret", winner))

    with pytest.raises(Forbidden, match="boot mismatch"):
        api.sync(ACCOUNT, "test-secret", first)

    assert store.get(ACCOUNT, "state")["boot_id"] == winner["boot_id"]
    assert store.get(ACCOUNT, "state")["observed"] == winner


def test_repeated_storage_conflicts_stop_after_three_attempts(aws, monkeypatch):
    store, _, api = services(aws)
    commit = store.commit
    attempts = 0

    def always_racing(account_id, generation, state, extra):
        nonlocal attempts
        attempts += 1
        concurrent = store.get(account_id, "state")
        concurrent["generation"] += 1
        commit(account_id, generation, concurrent, {})
        return commit(account_id, generation, state, extra)

    monkeypatch.setattr(store, "commit", always_racing)
    stop = action(store, "stop")
    with pytest.raises(ConcurrentUpdate):
        api.change(ACCOUNT, "operator", "action", stop)

    assert attempts == 3
    assert store.get(ACCOUNT, "state")["control_version"] == 0
    for prefix in ("action#", "audit#"):
        assert store.get(ACCOUNT, prefix + stop["idempotency_key"]) is None
