"""CAS login, the session cookie and access applications (formerly auth-granter).

These routes ran without the API Gateway authorizer, so they read the session
cookie themselves.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse

from ..auth.keys import SigningKeys
from ..auth.session import mint_session_token, session_cookie, session_netid
from ..dependencies import AppSettings, Cas, Db, Keys, RawBody, parse_json_object_or_empty
from ..errors import ApiError
from ..serialization import utcnow
from ..users import application_json, find_user, latest_application

router = APIRouter()

FULL_NAME = re.compile(r"[A-Za-z][A-Za-z .'-]{1,99}")
UCONN_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@uconn\.edu", re.IGNORECASE)
DISCORD_USERNAME = re.compile(r"[A-Za-z0-9_.-]{2,32}")
LINKEDIN_URL = re.compile(r"https?://(www\.)?linkedin\.com/.*")
GITHUB_URL = re.compile(r"https?://(www\.)?github\.com/.*")


@router.get("/auth/login")
def login(cas: Cas) -> RedirectResponse:
    return RedirectResponse(cas.login_url, status_code=302)


@router.get("/auth/callback", response_model=None)
def callback(
    settings: AppSettings, cas: Cas, db: Db, keys: Keys, ticket: str | None = None
) -> PlainTextResponse | RedirectResponse:
    if not ticket:
        return PlainTextResponse("Missing ticket", status_code=400)

    netid = cas.validate(ticket)
    if not netid:
        return PlainTextResponse("CAS validation failed", status_code=401)

    with db.transaction() as conn:
        user = find_user(conn, netid)
    roles = list(user["roles"]) if user else []
    token = mint_session_token(keys, netid, roles, settings.auth_cookie_max_age_seconds)
    return RedirectResponse(
        settings.frontend_base_url,
        status_code=302,
        headers={"Set-Cookie": session_cookie(token, settings)},
    )


@router.get("/auth/me")
def me(request: Request, db: Db, keys: Keys) -> dict[str, Any]:
    netid = _require_session(request, keys)
    with db.transaction() as conn:
        user = find_user(conn, netid)
    if user is None or user["is_banned"]:
        raise ApiError(403, "Forbidden")
    return {
        "netid": netid,
        "roles": list(user["roles"]),
        "display_name": user["full_name"] or netid,
    }


@router.post("/auth/apply")
def apply(request: Request, raw_body: RawBody, db: Db, keys: Keys) -> JSONResponse:
    netid = _require_session(request, keys)
    with db.transaction() as conn:
        user = find_user(conn, netid)
        if user and not user["is_banned"]:
            raise ApiError(409, "User already has access")

        latest = latest_application(conn, netid)
        if latest and latest["status"] == "PENDING":
            raise ApiError(409, "Application already pending")

        body = parse_json_object_or_empty(raw_body)
        errors = _validate_application(body)
        if errors:
            raise ApiError(400, "Invalid input", errors=errors)

        application = conn.execute(
            """
            INSERT INTO user_access_applications (
                netid, created_at, full_name, uconn_email,
                discord_username, linkedin_url, github_url, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'PENDING')
            RETURNING *
            """,
            [
                netid,
                utcnow().replace(microsecond=0),
                _text(body.get("full_name")),
                _text(body.get("uconn_email")),
                _text(body.get("discord_username")) or None,
                _text(body.get("linkedin_url")) or None,
                _text(body.get("github_url")) or None,
            ],
        ).fetchone()
    return JSONResponse(application_json(application), status_code=201)


@router.get("/auth/apply/check")
def check_application(request: Request, db: Db, keys: Keys) -> dict[str, Any]:
    netid = _require_session(request, keys)
    with db.transaction() as conn:
        user = find_user(conn, netid)
        if user and not user["is_banned"]:
            return {"has_application": True, "status": "APPROVED"}
        latest = latest_application(conn, netid)

    if latest is None:
        return {"has_application": False}
    application = application_json(latest)
    return {
        "has_application": True,
        "status": application["status"],
        "created_at": application["created_at"],
    }


def _require_session(request: Request, keys: SigningKeys) -> str:
    netid = session_netid(request, keys)
    if not netid:
        raise ApiError(401, "Unauthorized")
    return netid


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _validate_application(body: dict[str, Any]) -> dict[str, str]:
    errors: dict[str, str] = {}

    full_name = _text(body.get("full_name"))
    if not full_name:
        errors["full_name"] = "full_name is required"
    elif not FULL_NAME.fullmatch(full_name):
        errors["full_name"] = "full_name is invalid"

    uconn_email = _text(body.get("uconn_email"))
    if not uconn_email:
        errors["uconn_email"] = "uconn_email is required"
    elif not UCONN_EMAIL.fullmatch(uconn_email):
        errors["uconn_email"] = "uconn_email must be a @uconn.edu address"

    discord = _text(body.get("discord_username"))
    if discord and not DISCORD_USERNAME.fullmatch(discord):
        errors["discord_username"] = "discord_username is invalid"

    linkedin = _text(body.get("linkedin_url"))
    if linkedin and not LINKEDIN_URL.fullmatch(linkedin):
        errors["linkedin_url"] = "linkedin_url must be a linkedin.com URL"

    github = _text(body.get("github_url"))
    if github and not GITHUB_URL.fullmatch(github):
        errors["github_url"] = "github_url must be a github.com URL"

    return errors
