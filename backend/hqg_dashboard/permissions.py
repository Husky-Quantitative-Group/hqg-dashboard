"""Strategy access checks (formerly the hqg_permissions Lambda layer).

Grants are rows of strategy_permissions naming a principal: USER#<netid> or
ROLE#<role>. A write grant also allows reading. ADMIN bypasses every check.
"""

from __future__ import annotations

from collections.abc import Iterable

from psycopg import Connection

PUBLIC = "ROLE#PUBLIC"
FUND = "ROLE#FUND"
USER_PREFIX = "USER#"


def user_principal(netid: str) -> str:
    return USER_PREFIX + netid


def role_principals(roles: Iterable[str]) -> list[str]:
    stripped = (role.strip() for role in roles if isinstance(role, str))
    return [f"ROLE#{role}" for role in stripped if role and role != "ADMIN"]


def caller_principals(netid: str, roles: Iterable[str]) -> list[str]:
    """Every principal whose grants apply to the caller."""
    return [user_principal(netid), PUBLIC, *role_principals(roles)]


def can_read(conn: Connection, strategy_id: str, netid: str, roles: Iterable[str]) -> bool:
    return _has_grant(conn, strategy_id, ["read", "write"], netid, roles)


def can_write(conn: Connection, strategy_id: str, netid: str, roles: Iterable[str]) -> bool:
    return _has_grant(conn, strategy_id, ["write"], netid, roles)


def _has_grant(
    conn: Connection, strategy_id: str, access: list[str], netid: str, roles: Iterable[str]
) -> bool:
    roles = list(roles)
    if "ADMIN" in roles:
        return True
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM strategy_permissions
            WHERE strategy_id = %s AND access = ANY(%s) AND principal = ANY(%s)
        ) AS granted
        """,
        [strategy_id, access, caller_principals(netid, roles)],
    ).fetchone()
    return row["granted"]
