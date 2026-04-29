import base64
import hashlib
from datetime import datetime
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from functools import lru_cache
from http.cookies import SimpleCookie
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
import jwt

APP_ENV = os.environ.get("APP_ENV", "prod").lower()
AUTH_COOKIE_MAX_AGE_SECONDS = int(os.environ.get("AUTH_COOKIE_MAX_AGE_SECONDS", "86400"))

CAS_BASE = "https://login.uconn.edu/cas"
CAS_NS = {"cas": "http://www.yale.edu/tp/cas"}

FRONTEND_BASE_URL = os.environ["FRONTEND_BASE_URL"].rstrip("/")  # eg. http://localhost:3000 OR https://hqg-dash.com
CAS_CALLBACK_URL = os.environ.get("CAS_CALLBACK_URL", FRONTEND_BASE_URL + "/api/auth/callback").rstrip("/")

JWT_PRIVATE_KEY_PARAMETER = os.environ["JWT_PRIVATE_KEY_PARAMETER"]
JWKS_BUCKET = os.environ["JWKS_BUCKET"]
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
USERS_TABLE = os.environ["USERS_TABLE"]
USER_ACCESS_APPLICATIONS_TABLE = os.environ["USER_ACCESS_APPLICATIONS_TABLE"]
ANALYTICS_TABLE = os.environ["ANALYTICS_TABLE"]
DAILY_USER_LOGINS_TABLE = os.environ["DAILY_USER_LOGINS_TABLE"]

dynamo = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
users_table = dynamo.Table(USERS_TABLE)
user_access_applications_table = dynamo.Table(USER_ACCESS_APPLICATIONS_TABLE)
analytics_table = dynamo.Table(ANALYTICS_TABLE)
daily_user_logins_table = dynamo.Table(DAILY_USER_LOGINS_TABLE)

@lru_cache(maxsize=1)
def _get_private_key() -> str:
    resp = ssm.get_parameter(Name=JWT_PRIVATE_KEY_PARAMETER, WithDecryption=True)
    return resp["Parameter"]["Value"]


@lru_cache(maxsize=1)
def _get_jwks() -> Dict[str, Any]:
    url = f"https://{JWKS_BUCKET}.s3.{AWS_REGION}.amazonaws.com/.well-known/jwks.json"
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_public_key(token: str):
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None

    kid = header.get("kid")
    jwks = _get_jwks()
    keys = jwks.get("keys") or []
    jwk = None

    if kid:
        jwk = next((key for key in keys if key.get("kid") == kid), None)
    elif len(keys) == 1:
        jwk = keys[0]

    if not jwk:
        return None

    try:
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    except Exception:
        return None


def _get_current_kid() -> Optional[str]:
    jwks = _get_jwks()
    keys = jwks.get("keys") or []
    if not keys:
        return None

    newest_key = None
    newest_time: Optional[float] = None

    for key in keys:
        created_at = key.get("created_at")
        if isinstance(created_at, str):
            try:
                parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                parsed = None
            if parsed and parsed.tzinfo is not None:
                ts = parsed.timestamp()
                if newest_time is None or ts > newest_time:
                    newest_time = ts
                    newest_key = key

    jwk = newest_key or keys[0]
    kid = jwk.get("kid")
    if kid:
        return kid

    try:
        canonical = json.dumps(
            {"e": jwk["e"], "kty": jwk["kty"], "n": jwk["n"]},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except KeyError:
        return None

    digest = hashlib.sha256(canonical).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

def _build_auth_cookie(token: str) -> str:
    is_prod = APP_ENV == "prod"
    same_site = "Strict" if is_prod else "Lax"
    secure = "; Secure" if is_prod else ""
    domain = "; Domain=.uconnquant.com" if is_prod else ""
    return f"hqg_auth_token={token}; Path=/; HttpOnly; SameSite={same_site}; Max-Age={AUTH_COOKIE_MAX_AGE_SECONDS}{domain}{secure}"

def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Authentication granter service Lambda.
    - GET /auth/login
    - GET /auth/callback
    - GET /auth/me
    - POST /auth/apply
    - GET /auth/apply/check
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

        roles = _get_user_roles(netid)
        token = mint_jwt(netid, roles)
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

        user = _load_user(netid)
        if not user or user.get("is_banned", False):
            return _json_response(403, {"message": "Forbidden"})

        _track_daily_user_login(netid)

        roles = user.get("roles") or []
        if not isinstance(roles, list):
            roles = [roles]
        display_name = user.get("full_name") or netid
        return _json_response(
            200,
            {
                "netid": netid,
                "roles": [str(role) for role in roles],
                "display_name": display_name,
            },
        )

    if route_key == "POST /auth/apply":
        token = _extract_token(event)
        if not token:
            return _json_response(401, {"message": "Unauthorized"})

        netid = _decode_netid(token)
        if not netid:
            return _json_response(401, {"message": "Unauthorized"})

        if _user_allowed(netid):
            return _json_response(409, {"message": "User already has access"})

        latest = _get_latest_application(netid)
        if latest and (latest.get("status") == "PENDING"):
            return _json_response(409, {"message": "Application already pending"})

        body = _parse_body(event)
        errors = _validate_application_inputs(body)
        if errors:
            return _json_response(400, {"message": "Invalid input", "errors": errors})

        item = {
            "netid": netid,
            "created_at": _now_iso(),
            "full_name": body.get("full_name", "").strip(),
            "discord_username": _null_if_empty(body.get("discord_username")),
            "linkedin_url": _null_if_empty(body.get("linkedin_url")),
            "github_url": _null_if_empty(body.get("github_url")),
            "uconn_email": body.get("uconn_email", "").strip(),
            "status": "PENDING",
        }
        user_access_applications_table.put_item(Item=item)
        return _json_response(201, item)

    if route_key == "GET /auth/apply/check":
        token = _extract_token(event)
        if not token:
            return _json_response(401, {"message": "Unauthorized"})

        netid = _decode_netid(token)
        if not netid:
            return _json_response(401, {"message": "Unauthorized"})

        if _user_allowed(netid):
            return _json_response(200, {"has_application": True, "status": "APPROVED"})

        latest = _get_latest_application(netid)
        if not latest:
            return _json_response(200, {"has_application": False})

        return _json_response(
            200,
            {
                "has_application": True,
                "status": latest.get("status"),
                "created_at": latest.get("created_at"),
            },
        )

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

def mint_jwt(netid: str, roles: Optional[List[str]] = None):
    """Returns a JSON web token with the user's encoded netid and expiry"""
    now = int(time.time())
    roles = roles or []
    payload = {
        "sub": netid, # subject
        "iat": now,
        "exp": now + AUTH_COOKIE_MAX_AGE_SECONDS,
        "roles": roles,
    }
    headers: Optional[Dict[str, str]] = None
    kid = _get_current_kid()
    if kid:
        headers = {"kid": kid}
    return jwt.encode(payload, _get_private_key(), algorithm="RS256", headers=headers)

# ----------------------------
# Cookie/JWT helpers
# ----------------------------

def _extract_token(event: Dict[str, Any]) -> Optional[str]:
    headers = _normalize_headers(event.get("headers") or {})
    return _token_from_cookies(event, headers)


def _decode_netid(token: str) -> Optional[str]:
    public_key = _get_public_key(token)
    if not public_key:
        return None

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
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


def _get_user_roles(netid: str) -> List[str]:
    resp = users_table.get_item(Key={"netid": netid})
    user = resp.get("Item") or {}
    roles = user.get("roles") or []
    if not isinstance(roles, list):
        roles = [roles]
    return [str(role) for role in roles]


def _load_user(netid: str) -> Optional[Dict[str, Any]]:
    resp = users_table.get_item(Key={"netid": netid})
    return resp.get("Item")


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


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw_body = event.get("body")
    if not raw_body:
        return {}
    try:
        return json.loads(raw_body)
    except json.JSONDecodeError:
        return {}


def _null_if_empty(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _validate_application_inputs(body: Dict[str, Any]) -> Dict[str, str]:
    errors: Dict[str, str] = {}

    full_name = (body.get("full_name") or "").strip()
    if not full_name:
        errors["full_name"] = "full_name is required"
    elif not re.match(r"^[A-Za-z][A-Za-z .'-]{1,99}$", full_name):
        errors["full_name"] = "full_name is invalid"

    uconn_email = (body.get("uconn_email") or "").strip()
    if not uconn_email:
        errors["uconn_email"] = "uconn_email is required"
    elif not re.match(r"^[A-Za-z0-9._%+-]+@uconn\.edu$", uconn_email, re.IGNORECASE):
        errors["uconn_email"] = "uconn_email must be a @uconn.edu address"

    discord = _null_if_empty(body.get("discord_username"))
    if discord and not re.match(r"^[A-Za-z0-9_.-]{2,32}$", discord):
        errors["discord_username"] = "discord_username is invalid"

    linkedin = _null_if_empty(body.get("linkedin_url"))
    if linkedin and not re.match(r"^https?://(www\.)?linkedin\.com/.*$", linkedin):
        errors["linkedin_url"] = "linkedin_url must be a linkedin.com URL"

    github = _null_if_empty(body.get("github_url"))
    if github and not re.match(r"^https?://(www\.)?github\.com/.*$", github):
        errors["github_url"] = "github_url must be a github.com URL"

    return errors


def _get_latest_application(netid: str) -> Optional[Dict[str, Any]]:
    resp = user_access_applications_table.query(
        KeyConditionExpression=Key("netid").eq(netid),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def _track_daily_user_login(netid: str) -> None:
    today = datetime.utcnow().date().isoformat()
    try:
        daily_user_logins_table.put_item(
            Item={"login_date": today, "netid": netid, "tracked_at": _now_iso()},
            ConditionExpression="attribute_not_exists(login_date) AND attribute_not_exists(netid)",
        )
    except ClientError as exc:
        if (exc.response.get("Error") or {}).get("Code") == "ConditionalCheckFailedException":
            return
        print(f"Failed to record daily login for {netid}: {exc}")
        return

    try:
        analytics_table.update_item(
            Key={"pk": "METRIC#users_logged_in", "sk": f"DAY#{today}"},
            UpdateExpression="SET #count = if_not_exists(#count, :zero) + :inc, #updated_at = :updated_at",
            ExpressionAttributeNames={"#count": "count", "#updated_at": "updated_at"},
            ExpressionAttributeValues={
                ":zero": 0,
                ":inc": 1,
                ":updated_at": _now_iso(),
            },
        )
    except ClientError as exc:
        print(f"Failed to increment daily logged-in users metric for {netid}: {exc}")
