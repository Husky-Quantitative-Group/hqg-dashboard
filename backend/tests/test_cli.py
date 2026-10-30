"""The operator commands."""

from __future__ import annotations

import pytest

from hqg_dashboard.accounts.store import PostgresStore
from hqg_dashboard.cli import main
from support import ACCOUNT, ENGINE, execute


@pytest.fixture
def database_env(db, database_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", database_url)
    return db


def test_migrate(database_env, capsys):
    assert main(["migrate"]) == 0
    assert capsys.readouterr().out == "The schema is up to date.\n"


def test_commands_need_a_database_url(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit) as excinfo:
        main(["migrate"])
    assert excinfo.value.code == 2
    assert "DATABASE_URL" in capsys.readouterr().err


def test_rotate_keys(database_env, capsys):
    assert main(["rotate-keys"]) == 0
    (key,) = execute(database_env, "SELECT kid FROM jwt_signing_keys")
    assert capsys.readouterr().out == f"Now signing with key {key['kid']}.\n"


def test_seed_without_backtests(database_env, capsys):
    assert main(["seed", "--skip-backtests", "--admin-netid", " root "]) == 0
    output = capsys.readouterr().out
    assert "Seeded admin user root\n" in output
    assert output.endswith(
        "Backtests: seeded 0/5, skipped 5.\n"
        "Backtests were skipped because --skip-backtests was set.\n"
        "Seeding complete.\n"
    )
    assert len(execute(database_env, "SELECT id FROM strategies")) == 5


def test_provision_and_authorize_replacement(database_env, monkeypatch, capsys):
    monkeypatch.setenv("DASHBOARD_SYNC_SECRET", "secret")
    provision = [
        "provision-account",
        "--account-id",
        ACCOUNT,
        "--engine-id",
        ENGINE,
        "--netid",
        "op",
    ]

    assert main([*provision, "--allow-live"]) == 0
    assert capsys.readouterr().out.endswith("Both modes are paused and require Resume.\n")
    state = PostgresStore(database_env).get(ACCOUNT, "state")
    assert state["users"] == {"op": ["control", "live"]}

    with pytest.raises(SystemExit):
        main(provision)
    assert "Concurrent account update" in capsys.readouterr().err

    assert main(["authorize-replacement", "--account-id", ACCOUNT, "--actor", "maintainer"]) == 0
    assert PostgresStore(database_env).get(ACCOUNT, "state")["control_version"] == 1


def test_provision_needs_the_service_secret(database_env, monkeypatch, capsys):
    monkeypatch.delenv("ENGINE_SECRET", raising=False)
    provision = [
        "provision-account",
        "--account-id",
        ACCOUNT,
        "--engine-id",
        ENGINE,
        "--netid",
        "op",
    ]
    with pytest.raises(SystemExit):
        main([*provision, "--secret-env", "ENGINE_SECRET"])
    assert "ENGINE_SECRET" in capsys.readouterr().err
