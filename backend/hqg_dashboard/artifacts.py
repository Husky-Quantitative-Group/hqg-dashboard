"""Versioned strategy files (formerly the artifacts S3 bucket and its DynamoDB index).

Saving files as strategy version N writes version N of each saved file and
points the file at it. Files a save leaves out keep their older version, so
the files of version N are the newest version of each file at or below N.
"""

from __future__ import annotations

from datetime import datetime

import psycopg
from psycopg import Connection

from .db import Database
from .serialization import utcnow


class StaleVersion(Exception):
    """The strategy gained a new version after the caller read it."""


def save_files(
    conn: Connection, strategy_id: str, version: int, files: dict[str, bytes], created_at: datetime
) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO strategy_artifacts (strategy_id, artifact_id, latest_version)
            VALUES (%s, %s, %s)
            ON CONFLICT (strategy_id, artifact_id)
                DO UPDATE SET latest_version = EXCLUDED.latest_version
            """,
            [(strategy_id, artifact_id, version) for artifact_id in files],
        )
        cur.executemany(
            """
            INSERT INTO strategy_artifact_versions
                (strategy_id, artifact_id, version, content, created_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            [
                (strategy_id, artifact_id, version, content, created_at)
                for artifact_id, content in files.items()
            ],
        )


def publish_version(
    db: Database, strategy_id: str, base_version: int, files: dict[str, bytes]
) -> int:
    """Save files as version base_version + 1 and make it current, atomically.

    Raises StaleVersion when another save published base_version + 1 first.
    """
    version = base_version + 1
    now = utcnow()
    try:
        with db.transaction() as conn:
            published = conn.execute(
                """
                UPDATE strategies SET current_version = %s, updated_at = %s
                WHERE id = %s AND current_version = %s
                """,
                [version, now, strategy_id, base_version],
            )
            if published.rowcount != 1:
                raise StaleVersion
            save_files(conn, strategy_id, version, files, now)
    except psycopg.errors.UniqueViolation as exc:
        raise StaleVersion from exc
    return version
