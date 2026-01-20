import os
from http.cookies import SimpleCookie
from typing import Any, Dict, Optional

import boto3
import jwt

dynamo = boto3.resource("dynamodb")

USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])
JWT_SECRET = os.environ["JWT_SECRET"]


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    token = extract_token(event)
    if not token:
        return {"isAuthorized": False, "context": {"error": "unauthorized"}}
    
    netid = decode_netid(token)
    if not netid:
        return {"isAuthorized": False, "context": {"error": "unauthorized"}}
    
    if not user_allowed(netid):
        return {"isAuthorized": False, "context": {"error": "forbidden"}}
    
    return {"isAuthorized": True, "context": {"netid": netid}}


def extract_token(event: Dict[str, Any]) -> Optional[str]:
    """Return the JWT from the hqg_auth_token cookie."""
    headers = _normalize_headers(event.get("headers") or {})
    cookie_token = _token_from_cookies(event, headers)
    if cookie_token:
        return cookie_token

    return None


def decode_netid(token: str) -> Optional[str]:
    """Decode JWT and return the netid (sub) when valid."""
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        return None

    netid = payload.get("sub")
    if not isinstance(netid, str):
        return None

    netid = netid.strip()
    return netid or None

def user_allowed(netid: str) -> bool:
    """Return True if the user exists and is not banned."""
    resp = USERS_TABLE.get_item(Key={"netid": netid})
    user = resp.get("Item")
    if not user:
        return False

    return not user.get("is_banned", False)

# HELPERS

def _normalize_headers(headers: Dict[str, Any]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for key, value in headers.items():
        if key is None or value is None:
            continue
        normalized[str(key).lower()] = str(value)
    return normalized


def _token_from_cookies(event: Dict[str, Any], headers: Dict[str, str]) -> Optional[str]:
    cookie_header = headers.get("cookie")
    if cookie_header:
        token = _cookie_value(cookie_header, "hqg_auth_token")
        if token:
            return token

    cookies = event.get("cookies") or []
    for cookie_entry in cookies:
        token = _cookie_value(cookie_entry, "hqg_auth_token")
        if token:
            return token

    return None


def _cookie_value(cookie_header: str, name: str) -> Optional[str]:
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return None
    if name not in cookie:
        return None
    return cookie[name].value or None

