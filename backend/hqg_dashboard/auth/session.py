"""The hqg_auth_token session cookie.

hqg-platform and hqg-backtester verify the same cookie against the published
JWKS, so the claims (sub, iat, exp, roles) and the kid header must not change.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import Request

from ..config import Settings
from .keys import SigningKeys

COOKIE_NAME = "hqg_auth_token"


@dataclass(frozen=True)
class Principal:
    """The authenticated caller, as API Gateway's authorizer context described them."""

    netid: str
    roles: tuple[str, ...]
    display_name: str

    @property
    def is_admin(self) -> bool:
        return "ADMIN" in self.roles


def mint_session_token(
    keys: SigningKeys, netid: str, roles: list[str], lifetime_seconds: int
) -> str:
    now = int(time.time())
    return keys.sign({"sub": netid, "iat": now, "exp": now + lifetime_seconds, "roles": roles})


def session_cookie(token: str, settings: Settings) -> str:
    same_site = "Strict" if settings.is_prod else "Lax"
    cookie = (
        f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite={same_site}; "
        f"Max-Age={settings.auth_cookie_max_age_seconds}"
    )
    if settings.auth_cookie_domain:
        cookie += f"; Domain={settings.auth_cookie_domain}"
    if settings.is_prod:
        cookie += "; Secure"
    return cookie


def session_netid(request: Request, keys: SigningKeys) -> str | None:
    """The NetID of a valid session cookie, or None."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    claims = keys.verify(token, require=["exp", "sub"])
    netid = claims.get("sub") if claims else None
    if not isinstance(netid, str):
        return None
    return netid.strip() or None
