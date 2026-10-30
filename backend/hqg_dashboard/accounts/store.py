"""Account records in PostgreSQL; each accepted change commits atomically or not at all."""

from __future__ import annotations

import json
from typing import Any

from ..db import Database
from .control import ConcurrentUpdate


class PostgresStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def get(self, account_id: str, record: str) -> Any:
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT body FROM engine_account_records WHERE account_id = %s AND record = %s",
                [account_id, record],
            ).fetchone()
        return json.loads(row["body"]) if row else None

    def commit(
        self,
        account_id: str,
        generation: int | None,
        state: dict[str, Any],
        extra: dict[str, Any],
    ) -> None:
        """Write the state if its stored generation is still `generation` (None: no state
        exists yet), together with extra records that must not exist yet."""
        bodies = {record: _dumps(body) for record, body in {"state": state, **extra}.items()}
        with self.db.transaction() as conn:
            if generation is None:
                written = conn.execute(
                    """
                    INSERT INTO engine_account_records (account_id, record, body, generation)
                    VALUES (%s, 'state', %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    [account_id, bodies.pop("state"), state["generation"]],
                )
            else:
                written = conn.execute(
                    """
                    UPDATE engine_account_records SET body = %s, generation = %s
                    WHERE account_id = %s AND record = 'state' AND generation = %s
                    """,
                    [bodies.pop("state"), state["generation"], account_id, generation],
                )
            if written.rowcount != 1:
                raise ConcurrentUpdate("Concurrent account update")

            for record, body in bodies.items():
                written = conn.execute(
                    """
                    INSERT INTO engine_account_records (account_id, record, body)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    [account_id, record, body],
                )
                if written.rowcount != 1:
                    raise ConcurrentUpdate("Concurrent account update")


def _dumps(body: Any) -> str:
    return json.dumps(body, allow_nan=False)
