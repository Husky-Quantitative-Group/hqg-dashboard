"""Users and access applications: lookups and API shapes shared by several routes."""

from __future__ import annotations

from typing import Any

from psycopg import Connection

from .serialization import compact, isoformat, isoformat_seconds


def find_user(conn: Connection, netid: str) -> dict[str, Any] | None:
    return conn.execute("SELECT * FROM users WHERE netid = %s", [netid]).fetchone()


def user_json(row: dict[str, Any]) -> dict[str, Any]:
    return compact(
        {
            "netid": row["netid"],
            "full_name": row["full_name"],
            "uconn_email": row["uconn_email"],
            "discord_username": row["discord_username"],
            "linkedin_url": row["linkedin_url"],
            "github_url": row["github_url"],
            "roles": list(row["roles"]),
            "is_banned": row["is_banned"],
            "notes": row["notes"],
            "joined_at": isoformat(row["joined_at"]),
            "created_at": isoformat(row["created_at"]),
            "updated_at": isoformat(row["updated_at"]),
        }
    )


def latest_application(
    conn: Connection, netid: str, *, for_update: bool = False
) -> dict[str, Any] | None:
    query = """
        SELECT * FROM user_access_applications
        WHERE netid = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    """
    if for_update:
        query += " FOR UPDATE"
    return conn.execute(query, [netid]).fetchone()


def application_json(row: dict[str, Any]) -> dict[str, Any]:
    return compact(
        {
            "netid": row["netid"],
            "created_at": isoformat_seconds(row["created_at"]),
            "full_name": row["full_name"],
            "uconn_email": row["uconn_email"],
            "discord_username": row["discord_username"],
            "linkedin_url": row["linkedin_url"],
            "github_url": row["github_url"],
            "status": row["status"],
            "decided_at": isoformat(row["decided_at"]),
            "decided_by": row["decided_by"],
            "decision_notes": row["decision_notes"],
        }
    )
