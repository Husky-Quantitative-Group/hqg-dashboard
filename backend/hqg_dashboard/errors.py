"""Error responses in the JSON shape the Lambdas and API Gateway produced."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)


class ApiError(Exception):
    """An error response with the body {"message": message, **extra}."""

    def __init__(self, status_code: int, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.extra = extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"message": exc.message, **exc.extra}, status_code=exc.status_code)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        # Unknown routes. API Gateway answered these with {"message": "Not Found"}.
        return JSONResponse(
            {"message": exc.detail}, status_code=exc.status_code, headers=exc.headers
        )


class UnhandledErrorMiddleware:
    """Answer crashes with API Gateway's JSON 500, from inside the CORS middleware.

    Starlette's built-in crash handler sits outside all middleware, so its
    responses lack CORS headers and the browser cannot read them.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_and_track(message: Message) -> None:
            nonlocal response_started
            response_started = response_started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, receive, send_and_track)
        except Exception:
            log.exception("Unhandled error in %s %s", scope["method"], scope["path"])
            if response_started:
                raise
            response = JSONResponse({"message": "Internal Server Error"}, status_code=500)
            await response(scope, receive, send)
