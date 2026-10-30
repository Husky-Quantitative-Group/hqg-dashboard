"""Engine account control (formerly the accounts Lambda).

/accounts routes serve signed-in dashboard users. /internal routes serve the
engine's provider, which authenticates with its account's service secret.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from ..accounts.control import Conflict, Forbidden, Invalid
from ..dependencies import AccountControl, CurrentUser, RawBody

log = logging.getLogger(__name__)

router = APIRouter()

READY = {"application": "hqg-account-control-ready"}


@router.get("/accounts/{account_id}/status")
def status(
    account_id: str, user: CurrentUser, raw_body: RawBody, control: AccountControl
) -> Response:
    return _handle(raw_body, lambda _body: control.status(account_id, user.netid))


@router.put("/accounts/{account_id}/configuration")
def configure(
    account_id: str, user: CurrentUser, raw_body: RawBody, control: AccountControl
) -> Response:
    return _handle(
        raw_body,
        lambda body: control.change(account_id, user.netid, "configure", body, roles=user.roles),
    )


@router.post("/accounts/{account_id}/actions")
def act(account_id: str, user: CurrentUser, raw_body: RawBody, control: AccountControl) -> Response:
    return _handle(
        raw_body,
        lambda body: control.change(account_id, user.netid, "action", body, roles=user.roles),
    )


@router.post("/accounts/{account_id}/strategies")
def register_strategy(
    account_id: str, user: CurrentUser, raw_body: RawBody, control: AccountControl
) -> Response:
    return _handle(
        raw_body,
        lambda body: control.change(account_id, user.netid, "register", body, roles=user.roles),
    )


@router.get("/internal/v1/accounts/{account_id}/readiness")
def readiness(
    account_id: str, request: Request, raw_body: RawBody, control: AccountControl
) -> Response:
    def check(_body: Any) -> dict[str, str]:
        control.authenticate_service(account_id, _service_secret(request))
        return READY

    return _handle(raw_body, check)


@router.post("/internal/v1/accounts/{account_id}/sync")
def sync(account_id: str, request: Request, raw_body: RawBody, control: AccountControl) -> Response:
    return _handle(raw_body, lambda body: control.sync(account_id, _service_secret(request), body))


@router.get("/internal/v1/accounts/{account_id}/strategy-packages/{source_digest}")
def download_package(
    account_id: str,
    source_digest: str,
    request: Request,
    raw_body: RawBody,
    control: AccountControl,
) -> Response:
    return _handle(
        raw_body,
        lambda _body: control.download(account_id, _service_secret(request), source_digest),
    )


def _service_secret(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise Forbidden("Service authentication required")
    return authorization.removeprefix("Bearer ")


def _handle(raw_body: bytes, operation: Callable[[Any], Any]) -> Response:
    """Run an account operation, mapping its exceptions as the Lambda did."""
    try:
        body = json.loads(raw_body or b"{}")
        content = json.dumps(operation(body), allow_nan=False)
    except Forbidden as exc:
        return _message(403, exc)
    except Conflict as exc:
        return _message(409, exc)
    except (Invalid, ValueError, KeyError, TypeError, SyntaxError) as exc:
        return _message(400, exc)
    except Exception:
        log.exception("Account control failed")
        return JSONResponse({"message": "Account control unavailable"}, status_code=503)
    return Response(content, media_type="application/json")


def _message(status_code: int, exc: Exception) -> JSONResponse:
    return JSONResponse({"message": str(exc)}, status_code=status_code)
