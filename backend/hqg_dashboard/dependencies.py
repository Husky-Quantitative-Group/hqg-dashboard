"""FastAPI dependencies shared by the routers."""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import Depends, Request

from .accounts.control import Control
from .auth.cas import CasClient
from .auth.keys import SigningKeys
from .auth.session import Principal, session_netid
from .config import Settings
from .db import Database
from .errors import ApiError
from .users import find_user


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_keys(request: Request) -> SigningKeys:
    return request.app.state.keys


def get_cas(request: Request) -> CasClient:
    return request.app.state.cas


def get_control(request: Request) -> Control:
    return request.app.state.control


AppSettings = Annotated[Settings, Depends(get_settings)]
Db = Annotated[Database, Depends(get_db)]
Keys = Annotated[SigningKeys, Depends(get_keys)]
Cas = Annotated[CasClient, Depends(get_cas)]
AccountControl = Annotated[Control, Depends(get_control)]


async def read_body(request: Request) -> bytes:
    return await request.body()


# Endpoints are synchronous and cannot await the body, so it is read up front and
# parsed (with parse_json) at the point where the old Lambda parsed it.
RawBody = Annotated[bytes, Depends(read_body)]


def parse_json(raw: bytes) -> Any:
    """Parse a JSON request body. An empty body counts as an empty object."""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise ApiError(400, "invalid JSON body") from exc


def parse_json_object(raw: bytes) -> dict[str, Any]:
    body = parse_json(raw)
    if not isinstance(body, dict):
        raise ApiError(400, "body must be an object")
    return body


def parse_json_object_or_empty(raw: bytes) -> dict[str, Any]:
    """Parse a body leniently: anything but a JSON object counts as an empty object."""
    try:
        body = parse_json(raw)
    except ApiError:
        return {}
    return body if isinstance(body, dict) else {}


def current_user(request: Request, db: Db, keys: Keys) -> Principal:
    """Authorize a request the way API Gateway's cookie authorizer did."""
    # API Gateway rejected requests without a Cookie header before calling the authorizer.
    if "cookie" not in request.headers:
        raise ApiError(401, "Unauthorized")

    netid = session_netid(request, keys)
    user = None
    if netid:
        with db.transaction() as conn:
            user = find_user(conn, netid)
    if user is None or user["is_banned"]:
        raise ApiError(403, "Forbidden")

    return Principal(
        netid=netid,
        roles=tuple(user["roles"]),
        display_name=user["full_name"] or netid,
    )


CurrentUser = Annotated[Principal, Depends(current_user)]
