"""Seeding the sample strategies, their backtests and an admin."""

from __future__ import annotations

import gzip
import io
import json
import urllib.error
from pathlib import Path

import pytest

from hqg_dashboard import seed as seeding
from hqg_dashboard.artifacts import publish_version
from hqg_dashboard.seed import SEED_DIR, BacktesterClient, load_samples, seed
from support import execute

RESULT = {"metrics": {"sharpe_ratio": 1.0, "total_orders": 3}, "equity_stats": {"net_profit": 10.0}}


class FakeBacktester:
    def __init__(self):
        self.jobs = []

    def run_backtest(self, **job):
        self.jobs.append(job)
        return RESULT


def ids(client, headers):
    return [strategy["id"] for strategy in client.get("/strategies", headers=headers).json()]


def test_seeding_strategies_and_an_admin(client, db, sign_in):
    samples = load_samples()
    summary = seed(
        db, samples, backtester=None, skip_reason="--skip-backtests was set", admin_netid="root"
    )

    backtests = sum(len(sample.backtests) for sample in samples)
    assert (summary.requested, summary.seeded, summary.skipped) == (backtests, 0, backtests)
    alice = sign_in("alice")
    assert ids(client, alice) == ["1", "2", "3", "4", "5"]
    strategy = client.get("/strategies/1", headers=alice).json()
    assert {
        key: strategy[key]
        for key in ("name", "owner", "owner_display", "current_version", "created_at")
    } == {
        "name": "Buy and Hold SPY",
        "owner": "hqg",
        "owner_display": "HQG",
        "current_version": 1,
        "created_at": "2026-03-06T17:00:00+00:00",
    }
    assert client.get("/strategies/1/artifacts", headers=alice).json() == {
        "artifacts": ["README.md", "main.py"]
    }
    main_py = (SEED_DIR / "strategies" / "1" / "main.py").read_bytes()
    assert client.get("/strategies/1/artifacts/main.py", headers=alice).content == main_py
    assert execute(db, "SELECT roles FROM users WHERE netid = 'root'") == [{"roles": ["ADMIN"]}]

    # New strategies continue after the sample ids.
    response = client.post(
        "/strategies",
        json={"source_strategy_id": "1", "name": "Mine", "readme_content": ""},
        headers=alice,
    )
    assert response.json()["id"] == "6"


def test_seeding_runs_the_sample_backtests(client, db, sign_in):
    backtester = FakeBacktester()
    summary = seed(db, load_samples(), backtester=backtester)

    assert summary.seeded == summary.requested == len(backtester.jobs) > 0
    assert backtester.jobs[0] == {
        "strategy_code": (SEED_DIR / "strategies" / "1" / "main.py").read_text(),
        "start_date": "2020-01-03T00:00:00",
        "end_date": "2024-12-31T00:00:00",
        "initial_capital": 100000,
        "name": "Accurate Alteration",
    }
    alice = sign_in("alice")
    (run,) = client.get("/strategies/1/backtests", headers=alice).json()["items"]
    assert {
        key: run[key]
        for key in ("name", "user", "strategy_version", "backtest_params", "sharpe", "net_pnl")
    } == {
        "name": "Accurate Alteration",
        "user": "hqg",
        "strategy_version": 1,
        "backtest_params": {
            "name": "Accurate Alteration",
            "start_date": "2020-01-03",
            "end_date": "2024-12-31",
            "initial_capital": 100000,
        },
        "sharpe": 1.0,
        "net_pnl": 10.0,
    }
    download_url = client.get(f"/strategies/1/backtests/{run['run_id']}", headers=alice).json()[
        "s3"
    ]["download_url"]
    assert json.loads(gzip.decompress(client.get(download_url).content)) == RESULT
    assert client.get("/strategies/1", headers=alice).json()["metrics"] == RESULT["metrics"]


def test_reseeding_resets_samples_but_keeps_grants_and_profiles(db):
    samples = load_samples()
    seed(db, samples, backtester=FakeBacktester(), admin_netid="root")
    publish_version(db, "1", 1, {"main.py": b"edited", "extra.py": b"X = 1"})
    execute(
        db,
        "INSERT INTO strategy_permissions (strategy_id, access, principal)"
        " VALUES ('1', 'write', 'USER#bob')",
    )
    execute(
        db,
        "UPDATE users SET full_name = 'Root Admin', roles = ARRAY['PUBLIC'] WHERE netid = 'root'",
    )

    seed(db, samples, backtester=None, admin_netid="root")

    assert execute(db, "SELECT current_version FROM strategies WHERE id = '1'") == [
        {"current_version": 1}
    ]
    files = execute(
        db,
        """
        SELECT artifact_id FROM strategy_artifact_versions
        WHERE strategy_id = '1'
        ORDER BY artifact_id COLLATE "C"
        """,
    )
    assert [row["artifact_id"] for row in files] == ["README.md", "main.py"]
    assert execute(db, "SELECT run_id FROM backtest_runs") == []
    assert execute(db, "SELECT key FROM backtest_payloads") == []
    assert execute(db, "SELECT metrics FROM strategies WHERE id = '1'") == [{"metrics": None}]
    grants = execute(
        db, "SELECT access, principal FROM strategy_permissions WHERE strategy_id = '1' ORDER BY 1"
    )
    assert [(row["access"], row["principal"]) for row in grants] == [
        ("read", "ROLE#PUBLIC"),
        ("write", "USER#bob"),
    ]
    assert execute(db, "SELECT full_name, roles FROM users WHERE netid = 'root'") == [
        {"full_name": "Root Admin", "roles": ["ADMIN"]}
    ]


@pytest.mark.parametrize(
    "entry, message",
    [
        ({"title": "No id"}, "Strategy entry missing id"),
        ({"id": "9", "entrypoint": "main.py", "files": ["main.py"]}, "Strategy 9 missing owner"),
        (
            {"id": "9", "description": "x" * 76},
            "Strategy 9 description must be 75 characters or fewer",
        ),
        ({"id": "9", "files": []}, "Strategy 9 missing files list"),
        (
            {
                "id": "9",
                "owner": "o",
                "owner_display": "O",
                "entrypoint": "run.py",
                "files": ["main.py"],
                "backtests": [{}],
            },
            "Strategy 9 entrypoint 'run.py' is not present in files list",
        ),
    ],
)
def test_sample_definitions_are_validated(tmp_path, entry, message):
    (tmp_path / "strategies" / "9").mkdir(parents=True)
    (tmp_path / "strategies" / "9" / "main.py").write_text("print(9)\n")
    (tmp_path / "strategies.json").write_text(json.dumps([entry]))
    with pytest.raises(ValueError, match=message):
        load_samples(Path(tmp_path))


class FakeBacktesterApi:
    """Answers urllib requests with queued (status, body) responses."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def urlopen(self, request, timeout):
        self.requests.append((request.get_method(), request.full_url, request.data))
        status, body = self.responses.pop(0)
        raw = json.dumps(body).encode()
        if status >= 400:
            raise urllib.error.HTTPError(request.full_url, status, "error", {}, io.BytesIO(raw))
        response = io.BytesIO(raw)
        response.status = status
        return response


@pytest.mark.parametrize(
    "responses, expected",
    [
        ([(200, {"status": "healthy"}), (422, {"detail": "invalid"})], (True, "")),
        ([(503, {})], (False, "GET /health returned HTTP 503")),
        (
            [(200, {"status": "healthy"}), (401, {})],
            (False, "Backtester API is running but blocked by auth/permissions"),
        ),
    ],
)
def test_backtester_preflight(monkeypatch, responses, expected):
    api = FakeBacktesterApi(*responses)
    monkeypatch.setattr(seeding.urllib.request, "urlopen", api.urlopen)
    assert BacktesterClient("http://backtester.test/").preflight() == expected


def test_backtester_jobs_are_polled_until_they_finish(monkeypatch):
    api = FakeBacktesterApi(
        (202, {"job_id": "j1"}),
        (200, {"status": "RUNNING"}),
        (200, {"status": "COMPLETED", "result": RESULT}),
        (202, {"job_id": "j2"}),
        (200, {"status": "FAILED", "error": "boom"}),
    )
    monkeypatch.setattr(seeding.urllib.request, "urlopen", api.urlopen)
    monkeypatch.setattr(seeding, "POLL_INTERVAL_SECONDS", 0)
    client = BacktesterClient("http://backtester.test")
    job = dict(strategy_code="code", start_date="s", end_date="e", initial_capital=1.0, name="n")

    assert client.run_backtest(**job) == RESULT
    method, url, data = api.requests[0]
    assert (method, url, json.loads(data)) == (
        "POST",
        "http://backtester.test/api/v1/backtest",
        job,
    )
    assert api.requests[1][:2] == ("GET", "http://backtester.test/api/v1/backtest/j1")
    with pytest.raises(ValueError, match="Backtest job j2 ended with status FAILED: boom"):
        client.run_backtest(**job)
