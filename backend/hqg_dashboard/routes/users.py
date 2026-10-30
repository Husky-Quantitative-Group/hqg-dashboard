"""User search for sharing strategies (formerly the users Lambda)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..dependencies import Db, current_user

router = APIRouter()

DEFAULT_LIMIT = 8
MAX_LIMIT = 20


@router.get("/users/search", dependencies=[Depends(current_user)])
def search_users(db: Db, q: str | None = None, limit: str | None = None) -> dict[str, Any]:
    """Users whose NetID, then full name, starts with q (case-insensitive)."""
    prefix = (q or "").strip().lower()
    if len(prefix) < 2:
        return {"items": []}
    try:
        count = int(limit) if limit is not None else DEFAULT_LIMIT
    except ValueError:
        count = DEFAULT_LIMIT
    count = max(1, min(count, MAX_LIMIT))

    with db.transaction() as conn:
        by_netid = conn.execute(
            """
            SELECT netid, full_name, uconn_email FROM users
            WHERE starts_with(lower(netid), %s)
            ORDER BY netid COLLATE "C"
            LIMIT %s
            """,
            [prefix, count],
        ).fetchall()
        by_name = conn.execute(
            """
            SELECT netid, full_name, uconn_email FROM users
            WHERE starts_with(lower(full_name), %s)
            ORDER BY lower(full_name) COLLATE "C"
            LIMIT %s
            """,
            [prefix, count],
        ).fetchall()

    matches = {row["netid"]: row for row in [*by_netid, *by_name]}
    return {
        "items": [
            {
                "netid": row["netid"],
                "full_name": row["full_name"] or "",
                "uconn_email": row["uconn_email"] or "",
            }
            for row in list(matches.values())[:count]
        ]
    }
