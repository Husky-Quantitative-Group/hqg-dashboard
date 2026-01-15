import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from typing import Any, Dict

CAS_BASE = "https://login.uconn.edu/cas"
CAS_NS = {"cas": "http://www.yale.edu/tp/cas"}

CAS_CALLBACK_URL = os.environ["CAS_CALLBACK_URL"] # eg. abcdef.amazon-aws.com/dev/auth/callback
FRONTEND_BASE_URL = os.environ["FRONTEND_BASE_URL"] # eg. http://localhost:3000 OR https://hqg-dash.com

def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Authentication granter service Lambda.
    - GET /auth/login
    - GET /auth/callback
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

        # TODO: jwt minting

        return {
            "statusCode": 302,
            "headers": {
                "Location": f"{FRONTEND_BASE_URL}?netid={netid}"
            }
        }

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
