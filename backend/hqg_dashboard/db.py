"""PostgreSQL connection pool and schema migrations."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).with_name("migrations")

# Advisory lock keys. Their values are arbitrary but must stay distinct.
MIGRATION_LOCK = 72_001
KEY_ROTATION_LOCK = 72_002


class Database:
    """A connection pool whose connections return rows as dicts."""

    def __init__(self, url: str, *, max_size: int = 10) -> None:
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=max_size,
            kwargs={"row_factory": dict_row},
            open=False,
        )

    def open(self) -> None:
        self.pool.open(wait=True, timeout=30)

    def close(self) -> None:
        self.pool.close()

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """Yield a connection in a transaction: committed on success, rolled back on error."""
        with self.pool.connection() as conn:
            yield conn


def migrate(db: Database) -> list[str]:
    """Apply pending migrations in filename order and return their names.

    Safe to run from several processes at once: the advisory lock serializes them.
    """
    with db.transaction() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", [MIGRATION_LOCK])
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name       text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {row["name"] for row in conn.execute("SELECT name FROM schema_migrations")}
        pending = [
            path for path in sorted(MIGRATIONS_DIR.glob("*.sql")) if path.name not in applied
        ]
        for path in pending:
            log.info("Applying migration %s", path.name)
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", [path.name])
    return [path.name for path in pending]


def continue_strategy_ids(conn: Connection, after: int = 0) -> None:
    """Make new strategy ids follow the highest numeric id in use, or `after` if higher."""
    conn.execute(
        """
        SELECT setval('strategy_id_seq', greatest(last_id, 1), last_id > 0)
        FROM (
            SELECT greatest(%s, coalesce(max(id::bigint), 0)) AS last_id
            FROM strategies WHERE id ~ '^[0-9]+$'
        ) AS ids
        """,
        [after],
    )
