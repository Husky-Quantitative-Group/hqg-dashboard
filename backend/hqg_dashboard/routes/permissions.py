"""Who may read or write a strategy (formerly the strategy-permissions Lambda)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from psycopg import Connection

from ..auth.session import Principal
from ..dependencies import CurrentUser, Db, RawBody, parse_json
from ..errors import ApiError
from ..permissions import FUND, PUBLIC, USER_PREFIX, can_read, can_write, user_principal

router = APIRouter()

ACCESS_LEVELS = ("read", "write")


@router.get("/strategies/{strategy_id}/permissions")
def get_permissions(strategy_id: str, user: CurrentUser, db: Db) -> dict[str, Any]:
    with db.transaction() as conn:
        owner = _strategy_owner(conn, strategy_id)
        readable = can_read(conn, strategy_id, user.netid, user.roles)
        writable = can_write(conn, strategy_id, user.netid, user.roles)
        if not _can_manage(user, owner) and not readable:
            raise ApiError(403, "forbidden")

        grants = conn.execute(
            """
            SELECT grants.access, grants.principal, users.full_name, users.uconn_email
            FROM strategy_permissions AS grants
            LEFT JOIN users
                ON starts_with(grants.principal, 'USER#')
                AND users.netid = substr(grants.principal, 6)
            WHERE grants.strategy_id = %s
            ORDER BY grants.principal COLLATE "C"
            """,
            [strategy_id],
        ).fetchall()

    return {
        "read": _summary(grant for grant in grants if grant["access"] == "read"),
        "write": _summary(grant for grant in grants if grant["access"] == "write"),
        "canRead": readable,
        "canWrite": writable,
    }


@router.patch("/strategies/{strategy_id}/permissions")
def update_permissions(
    strategy_id: str, user: CurrentUser, raw_body: RawBody, db: Db
) -> dict[str, Any]:
    """Apply {"read": changes, "write": changes}; granting write also grants read.

    Each changes object may hold public and fund booleans and addUsers and
    removeUsers lists of NetIDs.
    """
    body = parse_json(raw_body)
    with db.transaction() as conn:
        if not _can_manage(user, _strategy_owner(conn, strategy_id)):
            raise ApiError(403, "forbidden")
        if not isinstance(body, dict):
            raise ApiError(400, "body must be an object")

        for access, changes in _validated_changes(body):
            _apply(conn, strategy_id, access, changes)

    return {"ok": True}


def _strategy_owner(conn: Connection, strategy_id: str) -> str | None:
    row = conn.execute("SELECT owner FROM strategies WHERE id = %s", [strategy_id]).fetchone()
    if row is None:
        raise ApiError(404, "Strategy not found")
    return row["owner"]


def _can_manage(user: Principal, owner: str | None) -> bool:
    return user.is_admin or (bool(owner) and owner == user.netid)


def _summary(grants: Any) -> dict[str, Any]:
    principals = list(grants)
    return {
        "public": any(grant["principal"] == PUBLIC for grant in principals),
        "fund": any(grant["principal"] == FUND for grant in principals),
        "users": [
            {
                "netid": grant["principal"].removeprefix(USER_PREFIX),
                "full_name": grant["full_name"] or "",
                "uconn_email": grant["uconn_email"] or "",
            }
            for grant in principals
            if grant["principal"].startswith(USER_PREFIX)
        ],
    }


def _validated_changes(body: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Every change to apply, in order, validated before any is applied."""
    changes: list[tuple[str, dict[str, Any]]] = []
    for access in ACCESS_LEVELS:
        if access not in body:
            continue
        scope = body[access]
        if not isinstance(scope, dict):
            raise ApiError(400, f"{access} must be an object")
        _validate_scope(scope)
        changes.append((access, scope))

        if access == "write":
            implied_read = {
                key: value
                for key, value in scope.items()
                if (key in ("public", "fund") and value is True) or (key == "addUsers" and value)
            }
            if implied_read:
                changes.append(("read", implied_read))
    return changes


def _validate_scope(scope: dict[str, Any]) -> None:
    for flag in ("public", "fund"):
        if scope.get(flag) is not None and not isinstance(scope[flag], bool):
            raise ApiError(400, f"{flag} must be a boolean")
    for netids in ("addUsers", "removeUsers"):
        if scope.get(netids) is not None and not isinstance(scope[netids], list):
            raise ApiError(400, f"{netids} must be a list")


def _apply(conn: Connection, strategy_id: str, access: str, scope: dict[str, Any]) -> None:
    for principal, flag in ((PUBLIC, scope.get("public")), (FUND, scope.get("fund"))):
        if flag is True:
            _grant(conn, strategy_id, access, principal)
        elif flag is False:
            _revoke(conn, strategy_id, access, principal)
    for netid in _netids(scope.get("addUsers")):
        _grant(conn, strategy_id, access, user_principal(netid))
    for netid in _netids(scope.get("removeUsers")):
        _revoke(conn, strategy_id, access, user_principal(netid))


def _netids(values: list[Any] | None) -> list[str]:
    return [value.strip() for value in values or [] if isinstance(value, str) and value.strip()]


def _grant(conn: Connection, strategy_id: str, access: str, principal: str) -> None:
    conn.execute(
        """
        INSERT INTO strategy_permissions (strategy_id, access, principal)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        [strategy_id, access, principal],
    )


def _revoke(conn: Connection, strategy_id: str, access: str, principal: str) -> None:
    conn.execute(
        """
        DELETE FROM strategy_permissions
        WHERE strategy_id = %s AND access = %s AND principal = %s
        """,
        [strategy_id, access, principal],
    )
