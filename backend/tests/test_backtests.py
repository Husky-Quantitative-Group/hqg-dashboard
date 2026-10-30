"""Saved backtest runs and the signed URLs that upload and download their payloads."""

from __future__ import annotations

import dataclasses
import gzip
import json
import time
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from hqg_dashboard import backtests
from hqg_dashboard.app import create_app
from hqg_dashboard.backtests import CROCKFORD_BASE32, insert_run, new_run_id, run_name
from hqg_dashboard.storage import DOWNLOAD_AUDIENCE, UPLOAD_AUDIENCE, payload_key
from support import API_URL, FRONTEND_URL, add_strategy, execute, gzip_json

PAYLOAD = {
    "metrics": {
        "sharpe_ratio": 1.25,
        "win_rate": 0.5,
        "max_drawdown": -0.1,
        "total_orders": 4,
        "converged": True,
        "label": "fast",
    },
    "equity_stats": {"net_profit": 1234.5, "equity": 101234.5},
    "orders": [{}, {}, {}],
}
PARAMS = {"start_date": "2020-01-03T00:00:00", "end_date": "2024-12-31", "initial_capital": 100000}


@pytest.fixture
def alice(client, db, sign_in):
    add_strategy(db, "1", write=["USER#alice"])
    return sign_in("alice")


@pytest.fixture
def plain_words(monkeypatch):
    """One-word run-name stand-ins: the real lists hold two-word entries like "ad hoc"."""
    monkeypatch.setattr(
        backtests._words, "word", lambda starts_with, include_parts_of_speech: starts_with * 2
    )


def presign(client, headers, strategy_id="1"):
    response = client.post(f"/strategies/{strategy_id}/backtests/presign", headers=headers)
    assert response.status_code == 200
    return response.json()


def upload(client, presigned, content, **field_changes):
    """Post the payload the way the browser posted it to S3."""
    form = presigned["s3"]["upload"]
    fields = {**form["fields"], **field_changes}
    return client.post(
        form["url"],
        data=fields,
        files={"file": ("run.json.gz", content, "application/gzip")},
        headers={"Origin": FRONTEND_URL},
    )


def finalize(client, headers, run_id, params=PARAMS, **body):
    body = {"run_id": run_id, "backtest_params": params, "strategy_version": 1, **body}
    return client.post("/strategies/1/backtests", json=body, headers=headers)


def save(client, headers, payload=PAYLOAD, params=PARAMS, **body):
    presigned = presign(client, headers)
    assert upload(client, presigned, gzip_json(payload)).status_code == 204
    return finalize(
        client, headers, presigned["run_id"], params, s3_key=presigned["s3"]["key"], **body
    )


def test_presign(client, alice):
    presigned = presign(client, alice)
    run_id = presigned["run_id"]
    assert len(run_id) == 26 and set(run_id) <= set(CROCKFORD_BASE32)
    fields = presigned["s3"]["upload"]["fields"]
    assert presigned == {
        "strategy_id": "1",
        "run_id": run_id,
        "created_by": "alice",
        "s3": {
            "bucket": "backtests",
            "key": f"strategies/1/runs/{run_id}/run.json.gz",
            "expires_in": 20,
            "upload": {
                "method": "POST",
                "url": f"{API_URL}/storage/backtests",
                "fields": {
                    "key": f"strategies/1/runs/{run_id}/run.json.gz",
                    "Content-Type": "application/gzip",
                    "token": fields["token"],
                },
            },
        },
    }


def test_saving_needs_write_access(client, db, alice, sign_in):
    add_strategy(db, "2", read=["USER#alice"])
    response = client.post("/strategies/2/backtests/presign", headers=alice)
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    response = client.post("/strategies/2/backtests", json={}, headers=alice)
    assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    root = sign_in("root", roles=["ADMIN"])
    response = client.post(
        "/strategies/404/backtests", json={"run_id": "x", "backtest_params": PARAMS}, headers=root
    )
    assert (response.status_code, response.json()) == (404, {"message": "Strategy not found"})


def test_save_list_get_and_download(client, alice):
    response = save(client, alice)

    assert response.status_code == 201
    run = response.json()
    run_id, name, time_created = run.pop("run_id"), run.pop("name"), run.pop("time_created")
    assert len(name.split()) == 2 and name == name.title() and name[0] == "A"
    assert time_created.endswith("+00:00")
    assert run == {
        "strategy_id": "1",
        "user": "alice",
        "strategy_version": 1,
        "backtest_params": {
            "start_date": "2020-01-03",
            "end_date": "2024-12-31",
            "initial_capital": 100000,
        },
        "metrics": {**PAYLOAD["metrics"], "converged": None},
        "net_pnl": 1234.5,
        "sharpe": 1.25,
        "win_rate": 0.5,
        "max_drawdown": -0.1,
        "trades_count": 4,
        "s3_bucket": "backtests",
        "s3_key": f"strategies/1/runs/{run_id}/run.json.gz",
    }
    run.update(run_id=run_id, name=name, time_created=time_created)

    strategy = client.get("/strategies/1", headers=alice).json()
    assert strategy["metrics"] == {
        "sharpe_ratio": 1.25,
        "win_rate": 0.5,
        "max_drawdown": -0.1,
        "total_orders": 4,
    }

    listed = client.get("/strategies/1/backtests", headers=alice).json()
    assert listed == {"strategy_id": "1", "items": [run], "next_cursor": None}

    saved = client.get(f"/strategies/1/backtests/{run_id}", headers=alice).json()
    download_url = saved["s3"].pop("download_url")
    assert saved == {
        "strategy_id": "1",
        "run_id": run_id,
        "item": run,
        "s3": {"bucket": "backtests", "key": run["s3_key"], "expires_in": 20},
    }
    assert download_url.startswith(
        f"{API_URL}/storage/backtests/strategies/1/runs/{run_id}/run.json.gz?token="
    )

    # The browser fetches the payload without credentials.
    response = client.get(download_url, headers={"Origin": FRONTEND_URL})
    assert response.status_code == 200
    assert json.loads(gzip.decompress(response.content)) == PAYLOAD
    assert response.headers["content-type"] == "application/gzip"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["access-control-allow-origin"] == FRONTEND_URL


def test_net_pnl_falls_back_to_final_equity(client, alice):
    assert save(client, alice).status_code == 201
    payload = {"metrics": {}, "equity_stats": {"equity": 90000}, "orders": [{}, {}]}
    run = save(client, alice, payload, strategy_version=2).json()
    assert (run["net_pnl"], run["trades_count"]) == (-10000, 2)
    assert "sharpe" not in run
    # The strategy shows the metrics of its latest run, even when there are none.
    assert "metrics" not in client.get("/strategies/1", headers=alice).json()


def test_finalizing_again_returns_the_saved_run(client, alice):
    presigned = presign(client, alice)
    upload(client, presigned, gzip_json(PAYLOAD))
    first = finalize(client, alice, presigned["run_id"])
    again = finalize(client, alice, presigned["run_id"])
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()


@pytest.mark.usefixtures("plain_words")
def test_duplicate_runs_are_rejected(client, alice):
    original = save(client, alice).json()["run_id"]
    response = save(
        client, alice, params={**PARAMS, "start_date": "2020-01-03", "initial_capital": 100000.0}
    )
    assert response.status_code == 409
    assert response.json() == {
        "message": "Duplicate run already exists for this strategy version and parameters",
        "duplicate_run_id": original,
    }
    second = save(client, alice, strategy_version=2)
    assert second.status_code == 201
    assert second.json()["name"] == "Aa Bb"


@pytest.mark.parametrize(
    "body, message",
    [
        ({}, "run_id is required"),
        ({"run_id": " "}, "run_id is required"),
        ({"run_id": "x", "backtest_params": "x"}, "backtest_params must be an object"),
        (
            {"run_id": "x", "backtest_params": {"start_date": "2020-01-01"}},
            "backtest_params must include start_date and end_date",
        ),
        (
            {"run_id": "x", "backtestParams": {**PARAMS, "initial_capital": "1"}},
            "backtest_params.initial_capital must be a number",
        ),
        (
            {"run_id": "x", "backtest_params": {**PARAMS, "initial_capital": True}},
            "backtest_params.initial_capital must be a number",
        ),
        (
            {"run_id": "x", "backtest_params": {**PARAMS, "initial_capital": 10**400}},
            "backtest_params.initial_capital must be a finite number",
        ),
        (
            {"run_id": "x", "backtest_params": {**PARAMS, "start_date": "T1"}},
            "backtest_params.start_date and end_date must be valid dates",
        ),
        (
            {"run_id": "x", "backtest_params": PARAMS, "s3_key": "elsewhere"},
            "s3_key does not match expected key for this run",
        ),
        ({"runId": "x", "backtest_params": PARAMS}, "S3 object not found for run_id"),
    ],
)
def test_finalize_validates_input(client, alice, body, message):
    response = client.post("/strategies/1/backtests", json=body, headers=alice)
    assert (response.status_code, response.json()) == (400, {"message": message})


def test_finalize_rejects_non_finite_capital(client, alice):
    # JSON has no such numbers, but Python's parser accepts these literals.
    for literal, message in (("NaN", "a number"), ("Infinity", "a finite number")):
        body = json.dumps({"run_id": "x", "backtest_params": {**PARAMS, "initial_capital": None}})
        body = body.replace("null", literal)
        response = client.post("/strategies/1/backtests", content=body.encode(), headers=alice)
        assert response.json() == {"message": f"backtest_params.initial_capital must be {message}"}


def test_finalize_needs_a_valid_payload(client, alice):
    presigned = presign(client, alice)
    upload(client, presigned, b"not gzip")
    response = finalize(client, alice, presigned["run_id"])
    assert response.status_code == 500
    assert response.json()["message"].startswith("Failed to load saved payload: ")

    presigned = presign(client, alice)
    upload(client, presigned, gzip_json({"orders": []}))
    response = finalize(client, alice, presigned["run_id"])
    assert (response.status_code, response.json()) == (
        400,
        {"message": "Saved payload is missing metrics"},
    )


def test_payloads_inflate_only_to_the_configured_size(client, settings, alice):
    app = create_app(dataclasses.replace(settings, backtest_payload_max_bytes=100))
    with TestClient(app, base_url=API_URL) as limited:
        presigned = presign(limited, alice)
        upload(limited, presigned, gzip.compress(b" " * 1000 + json.dumps(PAYLOAD).encode()))
        response = finalize(limited, alice, presigned["run_id"])
    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to load saved payload: payload is larger than 100 bytes uncompressed"
    }


def test_listing_pages_newest_first(client, db, alice):
    with db.transaction() as conn:
        for run_id in ("01A", "01C", "01B"):
            insert_run(
                conn,
                {
                    "strategy_id": "1",
                    "run_id": run_id,
                    "name": run_id,
                    "time_created": datetime(2026, 1, 1, tzinfo=UTC),
                    "user": "alice",
                    "backtest_params": PARAMS,
                    "net_pnl": None,
                    "sharpe": None,
                    "win_rate": None,
                    "max_drawdown": None,
                    "trades_count": 0,
                },
            )

    def page(**params):
        response = client.get("/strategies/1/backtests", params=params, headers=alice)
        assert response.status_code == 200
        return response.json()

    first = page(limit="2")
    assert [item["run_id"] for item in first["items"]] == ["01C", "01B"]
    assert first["next_cursor"] == {"strategy_id": "1", "run_id": "01B"}
    second = page(limit="2", cursor=json.dumps(first["next_cursor"]))
    assert ([item["run_id"] for item in second["items"]], second["next_cursor"]) == (["01A"], None)

    assert len(page(limit="0")["items"]) == 1
    assert len(page(limit="lots")["items"]) == 3
    assert len(page(cursor="null")["items"]) == 3
    for cursor in ("{", '{"run_id": 5}', "[1]"):
        response = client.get("/strategies/1/backtests", params={"cursor": cursor}, headers=alice)
        assert (response.status_code, response.json()) == (400, {"message": "invalid cursor"})


def test_reading_runs_needs_read_access(client, alice, sign_in):
    bob = sign_in("bob")
    for path in ("/strategies/1/backtests", "/strategies/1/backtests/01A"):
        response = client.get(path, headers=bob)
        assert (response.status_code, response.json()) == (403, {"message": "forbidden"})
    response = client.get("/strategies/1/backtests/01A", headers=alice)
    assert (response.status_code, response.json()) == (404, {"message": "Not found"})


def test_upload_urls_are_signed_for_one_key(client, db, alice):
    presigned = presign(client, alice)
    keys, key = client.app.state.keys, presigned["s3"]["key"]
    now = int(time.time())
    invalid_tokens = [
        "junk",
        keys.sign({"aud": UPLOAD_AUDIENCE, "key": key, "iat": now - 60, "exp": now - 30}),
        keys.sign({"aud": DOWNLOAD_AUDIENCE, "key": key, "iat": now, "exp": now + 20}),
        keys.sign({"sub": "alice", "key": key, "iat": now, "exp": now + 20}),
    ]
    for token in invalid_tokens:
        response = upload(client, presigned, b"x", token=token)
        assert (response.status_code, response.json()) == (
            403,
            {"message": "Upload URL is invalid or expired"},
        )
    response = upload(client, presigned, b"x", key=payload_key("1", "other"))
    assert response.status_code == 403

    response = client.post(
        presigned["s3"]["upload"]["url"], data=presigned["s3"]["upload"]["fields"]
    )
    assert (response.status_code, response.json()) == (400, {"message": "file is required"})
    assert execute(db, "SELECT key FROM backtest_payloads") == []


def test_uploads_replace_earlier_uploads_and_carry_cors_headers(client, db, alice):
    presigned = presign(client, alice)
    assert upload(client, presigned, b"first").status_code == 204
    response = upload(client, presigned, b"second")
    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == FRONTEND_URL
    rows = execute(db, "SELECT key, content FROM backtest_payloads")
    assert rows == [{"key": presigned["s3"]["key"], "content": b"second"}]


def test_uploads_are_limited_in_size(client, settings, alice):
    app = create_app(dataclasses.replace(settings, backtest_upload_max_bytes=10))
    with TestClient(app, base_url=API_URL) as limited:
        presigned = presign(limited, alice)
        assert upload(limited, presigned, b"x" * 10).status_code == 204
        response = upload(limited, presigned, b"x" * 11)
        assert (response.status_code, response.json()) == (413, {"message": "Upload is too large"})
        response = upload(limited, presigned, b"x" * (70 * 1024))
        assert response.status_code == 413


def test_download_urls_are_signed_for_one_key(client, alice):
    run_id = save(client, alice).json()["run_id"]
    download_url = client.get(f"/strategies/1/backtests/{run_id}", headers=alice).json()["s3"][
        "download_url"
    ]
    path, _, token = download_url.partition("?token=")
    assert client.get(path).status_code == 403
    assert client.get(f"{path}?token=junk").status_code == 403
    response = client.get(path.replace(run_id, "other") + f"?token={token}")
    assert (response.status_code, response.json()) == (
        403,
        {"message": "Download URL is invalid or expired"},
    )

    keys, key = client.app.state.keys, payload_key("1", "missing")
    now = int(time.time())
    token = keys.sign({"aud": DOWNLOAD_AUDIENCE, "key": key, "iat": now, "exp": now + 20})
    response = client.get(f"{API_URL}/storage/backtests/{key}?token={token}")
    assert (response.status_code, response.json()) == (404, {"message": "Not found"})


@pytest.mark.usefixtures("plain_words")
def test_run_names_walk_the_alphabet():
    assert list(map(run_name, (0, 1, 26, 675, 676))) == [
        "Aa Aa",
        "Aa Bb",
        "Bb Aa",
        "Zz Zz",
        "Aa Aa",
    ]


def test_run_ids_sort_by_creation_time():
    earlier = new_run_id()
    time.sleep(0.002)
    assert new_run_id() > earlier
