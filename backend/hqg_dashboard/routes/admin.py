"""User administration and access requests (formerly the admin Lambda)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from psycopg import Connection, sql

from ..auth.session import Principal
from ..dependencies import CurrentUser, Db, RawBody, parse_json_object_or_empty
from ..errors import ApiError
from ..serialization import utcnow
from ..users import application_json, find_user, latest_application, user_json


def require_admin(user: CurrentUser) -> Principal:
    if not user.is_admin:
        raise ApiError(403, "Forbidden")
    return user


Admin = Annotated[Principal, Depends(require_admin)]

router = APIRouter(prefix="/admin")

ROLES = {"PUBLIC", "FUND", "ADMIN"}
TEXT_FIELDS = {
    "full_name",
    "uconn_email",
    "discord_username",
    "linkedin_url",
    "github_url",
    "notes",
}
UPDATABLE_FIELDS = TEXT_FIELDS | {"roles", "is_banned"}


@router.get("/users")
def list_users(_admin: Admin, db: Db) -> list[dict[str, Any]]:
    with db.transaction() as conn:
        rows = conn.execute('SELECT * FROM users ORDER BY netid COLLATE "C"')
        return [user_json(row) for row in rows]


@router.get("/users/{netid}")
def get_user(netid: str, _admin: Admin, db: Db) -> dict[str, Any]:
    with db.transaction() as conn:
        user = find_user(conn, _netid(netid))
    if user is None:
        raise ApiError(404, "User not found")
    return user_json(user)


@router.patch("/users/{netid}")
def update_user(netid: str, _admin: Admin, raw_body: RawBody, db: Db) -> dict[str, Any]:
    netid = _netid(netid)
    body = parse_json_object_or_empty(raw_body)
    if not body:
        raise ApiError(400, "body is required")
    changes = _user_changes(body)

    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(field), sql.Placeholder(field))
        for field in changes
    )
    with db.transaction() as conn:
        user = conn.execute(
            sql.SQL(
                """
                UPDATE users SET {}, updated_at = %(updated_at)s
                WHERE netid = %(netid)s
                RETURNING *
                """
            ).format(assignments),
            {**changes, "updated_at": utcnow(), "netid": netid},
        ).fetchone()
    if user is None:
        raise ApiError(404, "User not found")
    return user_json(user)


@router.get("/access-requests")
def list_access_requests(_admin: Admin, db: Db) -> list[dict[str, Any]]:
    with db.transaction() as conn:
        rows = conn.execute(
            "SELECT * FROM user_access_applications ORDER BY created_at DESC, id DESC"
        )
        return [application_json(row) for row in rows]


@router.post("/access-requests/{netid}/approve")
def approve_access_request(netid: str, admin: Admin, raw_body: RawBody, db: Db) -> dict[str, Any]:
    """Approve the user's pending application and create their PUBLIC account."""
    netid = _netid(netid)
    notes = _decision_notes(raw_body)
    with db.transaction() as conn:
        application = _pending_application(conn, netid)
        decided_at = utcnow()
        _decide(conn, application, "APPROVED", decided_at, notes, admin.netid)
        user = conn.execute(
            """
            INSERT INTO users (
                netid, full_name, discord_username, linkedin_url, github_url,
                uconn_email, joined_at, roles, is_banned
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, ARRAY['PUBLIC'], false)
            ON CONFLICT (netid) DO NOTHING
            RETURNING *
            """,
            [
                netid,
                application["full_name"],
                application["discord_username"],
                application["linkedin_url"],
                application["github_url"],
                application["uconn_email"],
                decided_at,
            ],
        ).fetchone()
        if user is None:
            # The NetID already has an account (for example a banned one): change nothing.
            raise ApiError(500, "Failed to approve access request")
    return {"ok": True, "user": user_json(user)}


@router.post("/access-requests/{netid}/deny")
def deny_access_request(netid: str, admin: Admin, raw_body: RawBody, db: Db) -> dict[str, Any]:
    netid = _netid(netid)
    notes = _decision_notes(raw_body)
    with db.transaction() as conn:
        application = _pending_application(conn, netid)
        _decide(conn, application, "DENIED", utcnow(), notes, admin.netid)
    return {"ok": True}


def _netid(value: str) -> str:
    netid = value.strip()
    if not netid:
        raise ApiError(400, "netid is required")
    return netid


def _decision_notes(raw_body: bytes) -> str:
    notes = parse_json_object_or_empty(raw_body).get("decision_notes")
    if notes is None:
        return ""
    return notes if isinstance(notes, str) else str(notes)


def _user_changes(body: dict[str, Any]) -> dict[str, Any]:
    """The updatable fields of a PATCH body, validated and ready to store."""
    changes = {field: value for field, value in body.items() if field in UPDATABLE_FIELDS}
    if not changes:
        raise ApiError(400, "no updatable fields provided")

    if "roles" in changes:
        roles = [] if changes["roles"] is None else changes["roles"]
        if not isinstance(roles, list) or not all(
            isinstance(role, str) and role in ROLES for role in roles
        ):
            raise ApiError(400, "roles must be a list of PUBLIC/FUND/ADMIN")
        changes["roles"] = roles
    if "is_banned" in changes:
        if changes["is_banned"] is not None and not isinstance(changes["is_banned"], bool):
            raise ApiError(400, "is_banned must be a boolean")
        changes["is_banned"] = bool(changes["is_banned"])
    for field in TEXT_FIELDS & changes.keys():
        if changes[field] is not None and not isinstance(changes[field], str):
            raise ApiError(400, f"{field} must be a string")
    return changes


def _pending_application(conn: Connection, netid: str) -> dict[str, Any]:
    application = latest_application(conn, netid, for_update=True)
    if application is None or application["status"].upper() != "PENDING":
        raise ApiError(404, "Pending access request not found")
    return application


def _decide(
    conn: Connection,
    application: dict[str, Any],
    status: str,
    decided_at: datetime,
    notes: str,
    decided_by: str,
) -> None:
    conn.execute(
        """
        UPDATE user_access_applications
        SET status = %s, decided_at = %s, decision_notes = %s, decided_by = %s
        WHERE id = %s
        """,
        [status, decided_at, notes, decided_by, application["id"]],
    )
