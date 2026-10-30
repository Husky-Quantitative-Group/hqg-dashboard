"""Sample data: the strategies in seed/strategies.json, their backtests and an admin.

Re-seeding replaces the sample strategies' files and saved backtests but keeps
any permissions granted on them, as the AWS seed script did. Every sample
strategy is readable by all members (ROLE#PUBLIC).
"""

from __future__ import annotations

import gzip
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .artifacts import save_files
from .backtests import finite_number, insert_run, new_run_id, summarize, update_strategy_metrics
from .db import Database, continue_strategy_ids
from .permissions import PUBLIC
from .serialization import utcnow
from .storage import payload_key

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
SEEDED_AT = datetime.fromisoformat("2026-03-06T12:00:00-05:00")
VERSION = 1
DESCRIPTION_MAX_CHARS = 75

DEFAULT_START_DATE = "2020-01-03"
DEFAULT_END_DATE = "2024-12-31"
DEFAULT_INITIAL_CAPITAL = 100000.0
POLL_INTERVAL_SECONDS = 2.0
POLL_TIMEOUT_SECONDS = 900


@dataclass
class SampleStrategy:
    id: str
    name: str
    description: str
    owner: str
    owner_display: str
    entrypoint: str
    files: dict[str, str]
    backtests: list[dict[str, Any]]


@dataclass
class BacktestSummary:
    requested: int = 0
    seeded: int = 0
    skipped: int = 0
    skip_reason: str = ""


class BacktesterClient:
    """Runs sample backtests on hqg-backtester and waits for their results."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.strip().rstrip("/")
        if not self.base_url:
            raise ValueError("--backtester-url must be a non-empty URL")

    def preflight(self) -> tuple[bool, str]:
        """Whether the backtester is healthy and accepts unauthenticated jobs."""
        status, payload = self._request("GET", "/health", timeout=10)
        if status != 200:
            return False, f"GET /health returned HTTP {status}"
        if not isinstance(payload, dict) or payload.get("status") != "healthy":
            return False, "GET /health did not return expected {'status': 'healthy'} payload"

        # An empty job is a validation error unless auth blocks the request first.
        status, payload = self._request("POST", "/api/v1/backtest", {}, timeout=10)
        if status in (400, 422):
            return True, ""
        if status in (401, 403):
            return False, "Backtester API is running but blocked by auth/permissions"
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if detail:
            return False, f"POST /api/v1/backtest preflight returned HTTP {status}: {detail}"
        return False, f"POST /api/v1/backtest preflight returned unexpected HTTP {status}"

    def run_backtest(
        self, strategy_code: str, start_date: str, end_date: str, initial_capital: float, name: str
    ) -> dict[str, Any]:
        job = {
            "strategy_code": strategy_code,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
            "name": name,
        }
        status, submitted = self._request("POST", "/api/v1/backtest", job, timeout=30)
        if status != 202:
            detail = submitted.get("detail") if isinstance(submitted, dict) else submitted
            raise ValueError(f"Failed to submit backtest job (HTTP {status}): {detail}")
        job_id = str(submitted.get("job_id") or "").strip() if isinstance(submitted, dict) else ""
        if not job_id:
            raise ValueError("Backtester submit response missing job_id")

        deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            status, job_status = self._request("GET", f"/api/v1/backtest/{job_id}", timeout=30)
            if status != 200 or not isinstance(job_status, dict):
                raise ValueError(
                    f"Failed polling backtest job {job_id} (HTTP {status}): {job_status}"
                )
            state = str(job_status.get("status") or "").upper()
            if state in ("PENDING", "RUNNING"):
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            if state == "COMPLETED" and isinstance(job_status.get("result"), dict):
                return job_status["result"]
            raise ValueError(
                f"Backtest job {job_id} ended with status {state}: {job_status.get('error')}"
            )
        raise ValueError(
            f"Backtest job {job_id} did not finish within {POLL_TIMEOUT_SECONDS} seconds"
        )

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None, *, timeout: int
    ) -> tuple[int, Any]:
        url = self.base_url + path
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as exc:
            status, raw = exc.code, exc.read()
        except urllib.error.URLError as exc:
            raise ValueError(f"Request to {url} failed: {exc.reason}") from exc

        text = raw.decode("utf-8", errors="replace")
        if not text.strip():
            return status, {}
        try:
            return status, json.loads(text)
        except json.JSONDecodeError:
            return status, {"raw": text}


def load_samples(seed_dir: Path = SEED_DIR) -> list[SampleStrategy]:
    entries = json.loads((seed_dir / "strategies.json").read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError("strategies.json must be a list of strategy objects")
    return [_sample(seed_dir, entry) for entry in entries]


def seed(
    db: Database,
    samples: list[SampleStrategy],
    *,
    backtester: BacktesterClient | None,
    skip_reason: str = "",
    admin_netid: str | None = None,
) -> BacktestSummary:
    _seed_strategies(db, samples)
    summary = BacktestSummary(skip_reason=skip_reason)
    for sample in samples:
        count = len(sample.backtests)
        summary.requested += count
        if not count:
            continue
        if backtester is None:
            summary.skipped += count
            print(f"Skipping {count} backtest seed(s) for strategy {sample.id}: {skip_reason}")
            continue
        for index, backtest in enumerate(sample.backtests):
            _seed_backtest(db, backtester, sample, index, backtest)
            summary.seeded += 1
    if admin_netid:
        _seed_admin(db, admin_netid)
    return summary


def _sample(seed_dir: Path, entry: Any) -> SampleStrategy:
    if not isinstance(entry, dict):
        raise ValueError("Each strategy entry must be an object")
    strategy_id = str(entry.get("id", "")).strip()
    if not strategy_id:
        raise ValueError("Strategy entry missing id")

    def required(field: str) -> str:
        value = str(entry.get(field) or "").strip()
        if not value:
            raise ValueError(f"Strategy {strategy_id} missing {field}")
        return value

    description = entry.get("description") or ""
    if not isinstance(description, str):
        raise ValueError(f"Strategy {strategy_id} description must be a string")
    if len(description.strip()) > DESCRIPTION_MAX_CHARS:
        limit = f"{DESCRIPTION_MAX_CHARS} characters or fewer"
        raise ValueError(f"Strategy {strategy_id} description must be {limit}")
    filenames = entry.get("files")
    if not isinstance(filenames, list) or not filenames:
        raise ValueError(f"Strategy {strategy_id} missing files list")
    backtests = entry.get("backtests") or []
    if not isinstance(backtests, list) or not all(isinstance(item, dict) for item in backtests):
        raise ValueError(f"Strategy {strategy_id} backtests must be a list of objects")

    entrypoint = required("entrypoint")
    files = {
        str(name): (seed_dir / "strategies" / strategy_id / str(name)).read_text(encoding="utf-8")
        for name in filenames
    }
    if backtests and entrypoint not in files:
        raise ValueError(
            f"Strategy {strategy_id} entrypoint '{entrypoint}' is not present in files list"
        )
    return SampleStrategy(
        id=strategy_id,
        name=str(entry.get("title") or "").strip() or f"Strategy {strategy_id}",
        description=description.strip(),
        owner=required("owner"),
        owner_display=required("owner_display"),
        entrypoint=entrypoint,
        files=files,
        backtests=backtests,
    )


def _seed_strategies(db: Database, samples: list[SampleStrategy]) -> None:
    now = utcnow()
    with db.transaction() as conn:
        for sample in samples:
            prefix = f"strategies/{sample.id}/"
            conn.execute("DELETE FROM backtest_payloads WHERE starts_with(key, %s)", [prefix])
            conn.execute("DELETE FROM backtest_runs WHERE strategy_id = %s", [sample.id])
            conn.execute("DELETE FROM strategy_artifacts WHERE strategy_id = %s", [sample.id])
            conn.execute(
                """
                INSERT INTO strategies (
                    id, name, description, owner, owner_display, entrypoint,
                    current_version, tags, metrics, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    owner = EXCLUDED.owner,
                    owner_display = EXCLUDED.owner_display,
                    entrypoint = EXCLUDED.entrypoint,
                    current_version = EXCLUDED.current_version,
                    tags = NULL,
                    metrics = NULL,
                    created_at = EXCLUDED.created_at,
                    updated_at = EXCLUDED.updated_at
                """,
                [
                    sample.id,
                    sample.name,
                    sample.description,
                    sample.owner,
                    sample.owner_display,
                    sample.entrypoint,
                    VERSION,
                    SEEDED_AT,
                    SEEDED_AT,
                ],
            )
            files = {name: content.encode("utf-8") for name, content in sample.files.items()}
            save_files(conn, sample.id, VERSION, files, now)
            conn.execute(
                """
                INSERT INTO strategy_permissions (strategy_id, access, principal)
                VALUES (%s, 'read', %s)
                ON CONFLICT DO NOTHING
                """,
                [sample.id, PUBLIC],
            )
            print(f"Seeded strategy {sample.id} ({sample.name}) with {len(files)} files")

        continue_strategy_ids(conn)


def _seed_backtest(
    db: Database,
    backtester: BacktesterClient,
    sample: SampleStrategy,
    index: int,
    backtest: dict[str, Any],
) -> None:
    name = str(backtest.get("name") or "").strip() or f"Backtest {index + 1}"
    params = (
        backtest.get("backtest_params") if isinstance(backtest.get("backtest_params"), dict) else {}
    )
    start_date = _date_part(params.get("start_date")) or DEFAULT_START_DATE
    end_date = _date_part(params.get("end_date")) or DEFAULT_END_DATE
    initial_capital = finite_number(params.get("initial_capital"))
    if initial_capital is None:
        initial_capital = DEFAULT_INITIAL_CAPITAL

    payload = backtester.run_backtest(
        strategy_code=sample.files[sample.entrypoint],
        start_date=f"{start_date}T00:00:00",
        end_date=f"{end_date}T00:00:00",
        initial_capital=initial_capital,
        name=name,
    )
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}

    run_id = new_run_id()
    key = payload_key(sample.id, run_id)
    run = {
        "strategy_id": sample.id,
        "run_id": run_id,
        "name": name,
        "time_created": utcnow(),
        "user": sample.owner,
        "strategy_version": VERSION,
        "backtest_params": {
            "name": name,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
        },
        **summarize({**payload, "metrics": metrics}, initial_capital),
    }
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO backtest_payloads (key, content, uploaded_at) VALUES (%s, %s, %s)",
            [key, gzip.compress(json.dumps(payload).encode("utf-8")), utcnow()],
        )
        insert_run(conn, run)
        update_strategy_metrics(conn, sample.id, metrics)
    print(f"Seeded backtest run {run_id} ({name}) for strategy {sample.id}")


def _seed_admin(db: Database, netid: str) -> None:
    now = utcnow()
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO users (netid, roles, is_banned, created_at, updated_at, joined_at)
            VALUES (%s, ARRAY['ADMIN'], false, %s, %s, %s)
            ON CONFLICT (netid) DO UPDATE
                SET roles = ARRAY['ADMIN'], is_banned = false, updated_at = EXCLUDED.updated_at
            """,
            [netid, now, now, now],
        )
    print(f"Seeded admin user {netid}")


def _date_part(value: Any) -> str:
    return value.split("T")[0].strip() if isinstance(value, str) else ""
