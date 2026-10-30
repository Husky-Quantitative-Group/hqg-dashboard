"""Saved backtest runs: ids, names and the summary stored beside each payload."""

from __future__ import annotations

import gzip
import io
import json
import math
import secrets
import time
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb
from wonderwords import RandomWord

from .serialization import compact, isoformat
from .storage import BACKTESTS_BUCKET, payload_key

CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_words = RandomWord()


def new_run_id() -> str:
    """A ULID: a 48-bit millisecond timestamp, then 80 random bits, in Crockford base32."""
    return _crockford(int(time.time() * 1000), 10) + _crockford(secrets.randbits(80), 16)


def run_name(existing_runs: int) -> str:
    """Names walk the alphabet, one adjective/noun letter pair per run of a strategy."""
    pair = existing_runs % (26 * 26)
    adjective = _words.word(
        starts_with=chr(ord("a") + pair // 26), include_parts_of_speech=["adjectives"]
    )
    noun = _words.word(starts_with=chr(ord("a") + pair % 26), include_parts_of_speech=["nouns"])
    return f"{adjective.strip().title()} {noun.strip().title()}"


def finite_number(value: Any) -> float | None:
    """value as a float if it is a real, finite number (booleans are not numbers)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def clean_metrics(value: Any) -> Any:
    """Metrics as stored: booleans and non-finite numbers become null."""
    if isinstance(value, dict):
        return {key: clean_metrics(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_metrics(item) for item in value]
    if isinstance(value, bool) or (isinstance(value, float) and not math.isfinite(value)):
        return None
    return value


def load_payload(compressed: bytes, max_bytes: int) -> Any:
    """Parse gzipped JSON, refusing to inflate it beyond max_bytes."""
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError(f"payload is larger than {max_bytes} bytes uncompressed")
    return json.loads(raw)


def summarize(payload: dict[str, Any], initial_capital: float) -> dict[str, Any]:
    """The headline numbers stored with a run, from a backtester result payload."""
    metrics = payload["metrics"]
    orders = payload.get("orders")
    total_orders = finite_number(metrics.get("total_orders"))
    if total_orders is None:
        total_orders = len(orders) if isinstance(orders, list) else 0

    net_pnl = None
    equity_stats = payload.get("equity_stats")
    if isinstance(equity_stats, dict):
        net_pnl = finite_number(equity_stats.get("net_profit"))
        equity = finite_number(equity_stats.get("equity"))
        if net_pnl is None and equity is not None:
            net_pnl = equity - initial_capital

    return {
        "metrics": clean_metrics(metrics),
        "net_pnl": net_pnl,
        "sharpe": finite_number(metrics.get("sharpe_ratio")),
        "win_rate": finite_number(metrics.get("win_rate")),
        "max_drawdown": finite_number(metrics.get("max_drawdown")),
        "trades_count": total_orders,
    }


def strategy_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """The numeric metrics copied onto the strategy for the strategy browser."""
    return {key: value for key, value in metrics.items() if finite_number(value) is not None}


def insert_run(conn: Connection, run: dict[str, Any]) -> dict[str, Any] | None:
    """Insert a run unless one with its id exists. Returns the new row, or None."""
    return conn.execute(
        """
        INSERT INTO backtest_runs (
            strategy_id, run_id, name, time_created, created_by, strategy_version,
            backtest_params, metrics, net_pnl, sharpe, win_rate, max_drawdown, trades_count
        )
        VALUES (
            %(strategy_id)s, %(run_id)s, %(name)s, %(time_created)s, %(user)s,
            %(strategy_version)s, %(backtest_params)s, %(metrics)s, %(net_pnl)s, %(sharpe)s,
            %(win_rate)s, %(max_drawdown)s, %(trades_count)s
        )
        ON CONFLICT (strategy_id, run_id) DO NOTHING
        RETURNING *
        """,
        {
            **run,
            "strategy_version": _jsonb(run.get("strategy_version")),
            "backtest_params": Jsonb(run["backtest_params"]),
            "metrics": _jsonb(run.get("metrics")),
        },
    ).fetchone()


def update_strategy_metrics(conn: Connection, strategy_id: str, metrics: dict[str, Any]) -> None:
    conn.execute(
        "UPDATE strategies SET metrics = %s WHERE id = %s",
        [_jsonb(strategy_metrics(metrics) or None), strategy_id],
    )


def run_json(row: dict[str, Any]) -> dict[str, Any]:
    return compact(
        {
            "strategy_id": row["strategy_id"],
            "run_id": row["run_id"],
            "name": row["name"],
            "time_created": isoformat(row["time_created"]),
            "user": row["created_by"],
            "strategy_version": row["strategy_version"],
            "backtest_params": row["backtest_params"],
            "metrics": row["metrics"],
            "net_pnl": row["net_pnl"],
            "sharpe": row["sharpe"],
            "win_rate": row["win_rate"],
            "max_drawdown": row["max_drawdown"],
            "trades_count": row["trades_count"],
            "s3_bucket": BACKTESTS_BUCKET,
            "s3_key": payload_key(row["strategy_id"], row["run_id"]),
        }
    )


def _jsonb(value: Any) -> Jsonb | None:
    return None if value is None else Jsonb(value)


def _crockford(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(CROCKFORD_BASE32[value & 31])
        value >>= 5
    return "".join(reversed(chars))
