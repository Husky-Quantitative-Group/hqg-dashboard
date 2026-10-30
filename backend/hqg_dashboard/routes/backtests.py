"""Saved backtest runs (formerly the strategy-backtests Lambda).

Saving a run takes three requests: presign (reserve a run id and get a signed
upload form), the upload itself (see routes/storage.py), then finalize, which
reads the uploaded payload and records the run with its headline metrics.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..backtests import (
    finite_number,
    insert_run,
    load_payload,
    new_run_id,
    run_json,
    run_name,
    summarize,
    update_strategy_metrics,
)
from ..dependencies import AppSettings, CurrentUser, Db, Keys, RawBody, parse_json_object
from ..errors import ApiError
from ..permissions import can_read, can_write
from ..serialization import utcnow
from ..storage import BACKTESTS_BUCKET, URL_LIFETIME_SECONDS, download_url, payload_key, upload_form

router = APIRouter()

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200


@dataclass(frozen=True)
class FinalizeRequest:
    run_id: str
    start_date: str
    end_date: str
    initial_capital: int | float
    strategy_version: Any
    s3_key: str | None


@router.post("/strategies/{strategy_id}/backtests/presign")
def presign_upload(
    strategy_id: str, user: CurrentUser, db: Db, keys: Keys, settings: AppSettings
) -> dict[str, Any]:
    with db.transaction() as conn:
        if not can_write(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")

    run_id = new_run_id()
    key = payload_key(strategy_id, run_id)
    return {
        "strategy_id": strategy_id,
        "run_id": run_id,
        "created_by": user.netid,
        "s3": {
            "bucket": BACKTESTS_BUCKET,
            "key": key,
            "expires_in": URL_LIFETIME_SECONDS,
            "upload": upload_form(keys, settings.public_api_url, key),
        },
    }


@router.get("/strategies/{strategy_id}/backtests")
def list_runs(
    strategy_id: str,
    user: CurrentUser,
    db: Db,
    limit: str | None = None,
    cursor: str | None = None,
) -> dict[str, Any]:
    """A page of runs, newest first. Pass next_cursor back as cursor for the next."""
    with db.transaction() as conn:
        if not can_read(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        page_size = _page_size(limit)
        rows = conn.execute(
            """
            SELECT * FROM backtest_runs
            WHERE strategy_id = %(strategy_id)s
              AND (%(after)s::text IS NULL OR run_id < %(after)s)
            ORDER BY run_id DESC
            LIMIT %(limit)s
            """,
            {"strategy_id": strategy_id, "after": _cursor_run_id(cursor), "limit": page_size + 1},
        ).fetchall()

    page = rows[:page_size]
    next_cursor = None
    if len(rows) > page_size:
        next_cursor = {"strategy_id": strategy_id, "run_id": page[-1]["run_id"]}
    return {
        "strategy_id": strategy_id,
        "items": [run_json(row) for row in page],
        "next_cursor": next_cursor,
    }


@router.get("/strategies/{strategy_id}/backtests/{run_id}")
def get_run(
    strategy_id: str, run_id: str, user: CurrentUser, db: Db, keys: Keys, settings: AppSettings
) -> dict[str, Any]:
    with db.transaction() as conn:
        if not can_read(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        row = conn.execute(
            "SELECT * FROM backtest_runs WHERE strategy_id = %s AND run_id = %s",
            [strategy_id, run_id],
        ).fetchone()
    if row is None:
        raise ApiError(404, "Not found")

    key = payload_key(strategy_id, run_id)
    return {
        "strategy_id": strategy_id,
        "run_id": run_id,
        "item": run_json(row),
        "s3": {
            "bucket": BACKTESTS_BUCKET,
            "key": key,
            "expires_in": URL_LIFETIME_SECONDS,
            "download_url": download_url(keys, settings.public_api_url, key),
        },
    }


@router.post("/strategies/{strategy_id}/backtests")
def finalize_run(
    strategy_id: str, user: CurrentUser, raw_body: RawBody, db: Db, settings: AppSettings
) -> JSONResponse:
    """Record an uploaded run. Finalizing the same run again returns it unchanged."""
    with db.transaction() as conn:
        if not can_write(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
    request = _finalize_request(parse_json_object(raw_body))
    key = payload_key(strategy_id, request.run_id)

    with db.transaction() as conn:
        # Lock the strategy so concurrent saves cannot both pass the duplicate check.
        strategy = conn.execute(
            "SELECT id FROM strategies WHERE id = %s FOR UPDATE", [strategy_id]
        ).fetchone()
        if strategy is None:
            raise ApiError(404, "Strategy not found")

        runs = conn.execute(
            """
            SELECT run_id, strategy_version, backtest_params FROM backtest_runs
            WHERE strategy_id = %s
            """,
            [strategy_id],
        ).fetchall()
        duplicate_run_id = _duplicate_run_id(runs, request)
        if duplicate_run_id:
            raise ApiError(
                409,
                "Duplicate run already exists for this strategy version and parameters",
                duplicate_run_id=duplicate_run_id,
            )
        if request.s3_key and request.s3_key != key:
            raise ApiError(400, "s3_key does not match expected key for this run")

        stored = conn.execute(
            "SELECT content FROM backtest_payloads WHERE key = %s", [key]
        ).fetchone()
        if stored is None:
            raise ApiError(400, "S3 object not found for run_id")
        try:
            payload = load_payload(stored["content"], settings.backtest_payload_max_bytes)
        except Exception as exc:
            raise ApiError(500, f"Failed to load saved payload: {exc}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("metrics"), dict):
            raise ApiError(400, "Saved payload is missing metrics")

        run = {
            "strategy_id": strategy_id,
            "run_id": request.run_id,
            "name": run_name(len(runs)),
            "time_created": utcnow(),
            "user": user.netid,
            "strategy_version": request.strategy_version,
            "backtest_params": {
                "start_date": request.start_date,
                "end_date": request.end_date,
                "initial_capital": request.initial_capital,
            },
            **summarize(payload, float(request.initial_capital)),
        }
        inserted = insert_run(conn, run)
        update_strategy_metrics(conn, strategy_id, payload["metrics"])
        if inserted is None:
            existing = conn.execute(
                "SELECT * FROM backtest_runs WHERE strategy_id = %s AND run_id = %s",
                [strategy_id, request.run_id],
            ).fetchone()
            return JSONResponse(run_json(existing))

    return JSONResponse(run_json(inserted), status_code=201)


def _page_size(limit: str | None) -> int:
    try:
        page_size = int(limit or DEFAULT_PAGE_SIZE)
    except ValueError:
        page_size = DEFAULT_PAGE_SIZE
    return max(1, min(page_size, MAX_PAGE_SIZE))


def _cursor_run_id(cursor: str | None) -> str | None:
    """The run id inside a next_cursor that the client passed back as JSON."""
    if not cursor or not cursor.strip():
        return None
    try:
        position = json.loads(cursor)
    except ValueError as exc:
        raise ApiError(400, "invalid cursor") from exc
    if not position:
        return None
    run_id = position.get("run_id") if isinstance(position, dict) else None
    if not isinstance(run_id, str):
        raise ApiError(400, "invalid cursor")
    return run_id


def _finalize_request(body: dict[str, Any]) -> FinalizeRequest:
    run_id = body.get("run_id") or body.get("runId")
    if not isinstance(run_id, str) or not run_id.strip():
        raise ApiError(400, "run_id is required")

    params = body.get("backtest_params") or body.get("backtestParams") or {}
    if not isinstance(params, dict):
        raise ApiError(400, "backtest_params must be an object")
    start_date, end_date = _text(params.get("start_date")), _text(params.get("end_date"))
    if not start_date or not end_date:
        raise ApiError(400, "backtest_params must include start_date and end_date")

    initial_capital = params.get("initial_capital")
    if (
        isinstance(initial_capital, bool)
        or not isinstance(initial_capital, (int, float))
        or initial_capital != initial_capital  # NaN
    ):
        raise ApiError(400, "backtest_params.initial_capital must be a number")
    if finite_number(initial_capital) is None:
        raise ApiError(400, "backtest_params.initial_capital must be a finite number")

    start_date, end_date = _date_part(start_date), _date_part(end_date)
    if not start_date or not end_date:
        raise ApiError(400, "backtest_params.start_date and end_date must be valid dates")

    s3_key = body.get("s3_key") or body.get("s3Key")
    return FinalizeRequest(
        run_id=run_id.strip(),
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        strategy_version=body.get("strategy_version") or body.get("strategyVersion"),
        s3_key=s3_key.strip() if isinstance(s3_key, str) and s3_key.strip() else None,
    )


def _duplicate_run_id(runs: list[dict[str, Any]], request: FinalizeRequest) -> str | None:
    """A different run with the same strategy version, dates and initial capital."""
    for run in runs:
        params = run["backtest_params"]
        if (
            run["run_id"] != request.run_id
            and _version_key(run["strategy_version"]) == _version_key(request.strategy_version)
            and isinstance(params, dict)
            and _date_part(params.get("start_date")) == request.start_date
            and _date_part(params.get("end_date")) == request.end_date
            and finite_number(params.get("initial_capital")) == float(request.initial_capital)
        ):
            return run["run_id"]
    return None


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _date_part(value: Any) -> str:
    """The date of a YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS value."""
    return value.split("T")[0].strip() if isinstance(value, str) else ""


def _version_key(value: Any) -> str:
    return "" if value is None else str(value).strip()
