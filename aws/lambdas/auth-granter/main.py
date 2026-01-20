import json
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http.cookies import SimpleCookie
from typing import Any, Dict, Optional

import boto3
import jwt

APP_ENV = os.environ.get("APP_ENV", "prod").lower()

CAS_BASE = "https://login.uconn.edu/cas"
CAS_NS = {"cas": "http://www.yale.edu/tp/cas"}

FRONTEND_BASE_URL = os.environ["FRONTEND_BASE_URL"] # eg. http://localhost:3000 OR https://hqg-dash.com
CAS_CALLBACK_URL = FRONTEND_BASE_URL + "/api/auth/callback"

JWT_SECRET = os.environ["JWT_SECRET"]
USERS_TABLE = os.environ["USERS_TABLE"]

dynamo = boto3.resource("dynamodb")
users_table = dynamo.Table(USERS_TABLE)

def _build_auth_cookie(token: str) -> str:
    is_dev = APP_ENV == "dev"
    same_site = "Lax" if is_dev else "None"
    secure = "" if is_dev else "; Secure"
    return f"hqg_auth_token={token}; Path=/; HttpOnly; SameSite={same_site}{secure}"

def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Authentication granter service Lambda.
    - GET /auth/login
    - GET /auth/callback
    - GET /auth/me
    """

    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /auth/login":
        service = urllib.parse.quote(CAS_CALLBACK_URL, safe="")

        redirect_url = f"{CAS_BASE}/login?service={service}"
        return {
            "statusCode": 302,
            "headers": {
                "Location": redirect_url
            }
        }

    if route_key == "GET /auth/callback":
        qs = event.get("queryStringParameters") or {}
        ticket = qs.get("ticket")
        if not ticket:
            return {"statusCode": 400, "body": "Missing ticket"}

        netid = validate_cas_ticket(ticket)
        if not netid:
            return {"statusCode": 401, "body": "CAS validation failed"}

        token = mint_jwt(netid)
        cookie = _build_auth_cookie(token)
        return {
            "statusCode": 302,
            "headers": {
                "Location": FRONTEND_BASE_URL,
                "Set-Cookie": cookie,
            },
        }

    if route_key == "GET /auth/me":
        token = _extract_token(event)
        if not token:
            return _json_response(401, {"message": "Unauthorized"})

        netid = _decode_netid(token)
        if not netid:
            return _json_response(401, {"message": "Unauthorized"})

        if not _user_allowed(netid):
            return _json_response(403, {"message": "Forbidden"})

        return _json_response(200, {"netid": netid})

    return {"statusCode": 404, "body": "Not found"}

def validate_cas_ticket(ticket) -> str | None:
    """Validates sent ticket with CAS server, returns NetId"""
    service_enc = urllib.parse.quote(CAS_CALLBACK_URL, safe="")
    validate_url = f"{CAS_BASE}/serviceValidate?service={service_enc}&ticket={urllib.parse.quote(ticket, safe='')}"

    with urllib.request.urlopen(validate_url, timeout=5) as resp:
        xml = resp.read().decode("utf-8", errors="replace")

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None

    success = root.find("cas:authenticationSuccess", CAS_NS)
    if success is None:
        return None

    return success.findtext("cas:user", default="", namespaces=CAS_NS) or None

def mint_jwt(netid: str):
    """Returns a JSON web token with the user's encoded netid and expiry"""
    now = int(time.time())
    payload = {
        "sub": netid, # subject
        "iat": now,
        "exp": now + 60 * 60 * 24,  # 24 hours
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

# ----------------------------
# Cookie/JWT helpers
# ----------------------------

def _extract_token(event: Dict[str, Any]) -> Optional[str]:
    headers = _normalize_headers(event.get("headers") or {})
    return _token_from_cookies(event, headers)


def _decode_netid(token: str) -> Optional[str]:
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


def _user_allowed(netid: str) -> bool:
    resp = users_table.get_item(Key={"netid": netid})
    user = resp.get("Item")
    if not user:
        return False

    return not user.get("is_banned", False)


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


def _json_response(status_code: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }
