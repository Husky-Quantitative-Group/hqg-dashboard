"""Test data, written straight to the database, and the engine account test fixtures."""

from __future__ import annotations

import gzip
import json
import time
from collections.abc import Iterable, Mapping, Sequence
from typing import Any
from uuid import uuid4

from psycopg import Connection, sql

from hqg_dashboard.artifacts import save_files
from hqg_dashboard.auth.cas import CasClient
from hqg_dashboard.config import Settings
from hqg_dashboard.db import Database
from hqg_dashboard.serialization import utcnow

FRONTEND_URL = "https://dashboard.test"
API_URL = "https://api.test"


class FakeCas(CasClient):
    """A CAS server that accepts the tickets in `tickets`, a map of ticket to NetID."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings.cas_base_url, settings.cas_callback_url)
        self.tickets: dict[str, str] = {}

    def validate(self, ticket: str) -> str | None:
        return self.tickets.get(ticket)


# A complete access application.
APPLICATION = {
    "full_name": "Ada Lovelace",
    "uconn_email": "ada.lovelace@uconn.edu",
    "discord_username": "ada_l",
    "linkedin_url": "https://www.linkedin.com/in/ada",
    "github_url": "https://github.com/ada",
}


def execute(db: Database, query: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    """Run one statement and return its rows, if it has any."""
    with db.transaction() as conn:
        cursor = conn.execute(query, params)
        return cursor.fetchall() if cursor.description else []


def add_user(db: Database, netid: str, roles: Sequence[str] = ("PUBLIC",), **fields: Any) -> None:
    """Create a member, replacing any member with the same NetID."""
    with db.transaction() as conn:
        conn.execute("DELETE FROM users WHERE netid = %s", [netid])
        _insert(conn, "users", {"netid": netid, "roles": list(roles), **fields})


def add_strategy(
    db: Database,
    strategy_id: str,
    files: Mapping[str, str] | None = None,
    *,
    owner: str | None = "owner",
    read: Iterable[str] = (),
    write: Iterable[str] = (),
    **fields: Any,
) -> None:
    """Create a strategy at version 1 with the given files and grants.

    read and write list principals such as "USER#alice" or "ROLE#PUBLIC".
    """
    files = {"main.py": "print('hello')\n"} if files is None else files
    now = utcnow()
    strategy = {
        "id": strategy_id,
        "name": f"Strategy {strategy_id}",
        "owner": owner,
        "owner_display": owner,
        "current_version": 1,
        "created_at": now,
        "updated_at": now,
        **fields,
    }
    with db.transaction() as conn:
        _insert(conn, "strategies", strategy)
        save_files(conn, strategy_id, 1, {path: text.encode() for path, text in files.items()}, now)
        for access, principals in (("read", read), ("write", write)):
            for principal in principals:
                _insert(
                    conn,
                    "strategy_permissions",
                    {"strategy_id": strategy_id, "access": access, "principal": principal},
                )


def gzip_json(value: Any) -> bytes:
    return gzip.compress(json.dumps(value).encode())


def _insert(conn: Connection, table: str, values: Mapping[str, Any]) -> None:
    conn.execute(
        sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, values)),
            sql.SQL(", ").join(map(sql.Placeholder, values)),
        ),
        values,
    )


# Engine accounts: one account, provisioned for "operator", and a strategy package
# it can register. The tests are ported from the AWS deployment.

ACCOUNT, ENGINE = str(uuid4()), str(uuid4())
SERVICE_SECRET = "test-secret"
PACKAGE = dict(
    strategy_id="sample",
    version=1,
    entrypoint="main.py",
    files={
        "main.py": 'class Example(Strategy):\n    universe = ["AAPL"]\n',
        "helper.py": "TARGET = 0.5",
    },
)


def seed_package(db: Database, package: dict[str, Any]) -> None:
    """Store the package's files as that version of its strategy, writable by "operator"."""
    strategy_id, version = package["strategy_id"], package["version"]
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO strategies (id, name, current_version, entrypoint)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
                SET current_version = EXCLUDED.current_version, entrypoint = EXCLUDED.entrypoint
            """,
            [strategy_id, strategy_id, version, package["entrypoint"]],
        )
        conn.execute(
            """
            INSERT INTO strategy_permissions (strategy_id, access, principal)
            VALUES (%s, 'write', 'USER#operator')
            ON CONFLICT DO NOTHING
            """,
            [strategy_id],
        )
        for path, content in package["files"].items():
            conn.execute(
                """
                INSERT INTO strategy_artifacts (strategy_id, artifact_id, latest_version)
                VALUES (%s, %s, %s)
                ON CONFLICT (strategy_id, artifact_id)
                    DO UPDATE SET latest_version = EXCLUDED.latest_version
                """,
                [strategy_id, path, version],
            )
            conn.execute(
                """
                INSERT INTO strategy_artifact_versions
                    (strategy_id, artifact_id, version, content, created_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (strategy_id, artifact_id, version)
                    DO UPDATE SET content = EXCLUDED.content
                """,
                [strategy_id, path, version, content.encode()],
            )


def paused(store: Any) -> None:
    """Record a fresh heartbeat in which both modes are paused and reconciled."""
    state = store.get(ACCOUNT, "state")
    state["last_sync"] = time.time()
    state["observed"] = dict(
        control_version=state["control_version"],
        modes={mode: dict(gate_open=False, reconciled=True) for mode in ("paper", "live")},
    )
    state["generation"] += 1
    store.commit(ACCOUNT, state["generation"] - 1, state, {})


def registration(version: int = 1, control_version: int = 0) -> dict[str, Any]:
    return dict(
        strategy_id="sample",
        version=version,
        idempotency_key=str(uuid4()),
        expected_control_version=control_version,
    )
