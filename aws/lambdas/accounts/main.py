import json
import os
import urllib.request
from urllib.parse import urlsplit

from admin import provision
from control import Control, Conflict, Forbidden, Invalid, uuid
from store import DynamoStore
from packages import StrategySource
from hqg_permissions import get_roles_from_event


def readiness():
    # No cached generic /health response can grant permission.
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect()
        )

        for prefix in ("CONTROL", "WEBSITE"):
            url, expected = (
                os.environ[f"{prefix}_READINESS_URL"],
                os.environ[f"{prefix}_READINESS_CONTENT"],
            )

            if not url.startswith("https://") or not expected:
                return False

            with opener.open(
                urllib.request.Request(
                    url,
                    headers=(
                        {
                            "Authorization": "Bearer "
                            + os.environ.get("CONTROL_READINESS_TOKEN", "")
                        }
                        if prefix == "CONTROL"
                        else {}
                    ),
                ),
                timeout=0.8,
            ) as response:
                if (
                    response.status != 200
                    or expected not in response.read(1_000_000).decode()
                ):
                    return False

        return True
    except Exception:
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_service = None


def service():
    global _service
    if _service is None:
        import boto3

        _service = Control(
            DynamoStore(boto3.client("dynamodb"), os.environ["ACCOUNTS_TABLE"]),
            readiness,
            strategy_source=StrategySource(
                boto3.resource("dynamodb"), boto3.client("s3"), os.environ
            ),
        )
    return _service


def handler(event, _context):
    return handle(event, service())


def handle(event, api):
    try:
        route = event["requestContext"]["routeKey"]
        authorizer = event["requestContext"].get("authorizer", {})
        actor = authorizer.get("lambda", authorizer).get("netid")
        if route == "POST /admin/engine-accounts":
            if (
                not isinstance(actor, str)
                or not actor.strip()
                or "ADMIN" not in get_roles_from_event(event)
            ):
                raise Forbidden("Administrator permission required")
            return provision_account(
                api.store, actor, json.loads(event.get("body") or "{}")
            )

        account_id = event["pathParameters"]["accountId"]
        body = json.loads(event.get("body") or "{}")

        if route.startswith(("GET /internal/", "POST /internal/")):
            token = event.get("headers", {}).get("authorization", "")
            if not token.startswith("Bearer "):
                raise Forbidden("Service authentication required")
            secret = token[7:]
            if route == "GET /internal/v1/accounts/{accountId}/readiness":
                api.authenticate_service(account_id, secret)
                result = {"application": "hqg-account-control-ready"}
            elif route == "POST /internal/v1/accounts/{accountId}/sync":
                result = api.sync(account_id, secret, body)
            elif route == "GET /internal/v1/accounts/{accountId}/strategy-packages/{sourceDigest}":
                result = api.download(account_id, secret, event["pathParameters"]["sourceDigest"])
            else:
                return response(404, {"message": "Not found"})

        elif route == "GET /accounts/{accountId}/status":
            result = api.status(account_id, actor)

        elif route in (
            "PUT /accounts/{accountId}/configuration",
            "POST /accounts/{accountId}/actions",
            "POST /accounts/{accountId}/strategies",
        ):
            result = api.change(
                account_id,
                actor,
                (
                    "configure"
                    if route.startswith("PUT")
                    else "register" if route.endswith("/strategies") else "action"
                ),
                body,
                roles=get_roles_from_event(event),
            )

        else:
            return response(404, {"message": "Not found"})
        return response(200, result)

    except Forbidden as exc:
        return response(403, {"message": str(exc)})
    except Conflict as exc:
        return response(409, {"message": str(exc)})
    except (Invalid, ValueError, KeyError, TypeError, SyntaxError) as exc:
        return response(400, {"message": str(exc)})
    except Exception:
        return response(503, {"message": "Account control unavailable"})


def provision_account(store, actor, body):
    fields = ("account_id", "engine_id", "netid")
    if not isinstance(body, dict) or not all(
        isinstance(body.get(field), str) and body[field].strip() for field in fields
    ):
        raise Invalid("account_id, engine_id and netid are required")
    account_id = uuid(body["account_id"].strip())
    engine_id = uuid(body["engine_id"].strip())
    netid = body["netid"].strip()
    live = body.get("allow_live", False)
    if type(live) is not bool:
        raise Invalid("allow_live must be a boolean")

    secret = os.environ.get("CONTROL_READINESS_TOKEN", "")
    readiness_url = urlsplit(os.environ.get("CONTROL_READINESS_URL", ""))
    if not secret.strip() or readiness_url.scheme != "https" or not readiness_url.netloc:
        return response(503, {
            "message": "Configure the control readiness URL and token before provisioning"
        })
    if not readiness_url.path.rstrip("/").endswith(f"/accounts/{account_id}/readiness"):
        raise Invalid("Account UUID must match the configured control readiness URL")

    try:
        provision(store, account_id, engine_id, netid, secret, live, actor=actor)
    except Conflict as exc:
        raise Conflict("Account already exists; provisioning cannot overwrite it") from exc
    return response(
        201,
        {
            "account_id": account_id,
            "engine_id": engine_id,
            "netid": netid,
            "allow_live": live,
            "state": "paused",
        },
    )


def response(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, allow_nan=False),
    }
