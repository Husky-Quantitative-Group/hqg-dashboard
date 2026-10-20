"""Test HTTP adapter for actual Lambda handlers with injected auth/readiness/faults."""

import asyncio
import base64
import json
import os

from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
import httpx

from aws_fixture import load
from control import Control
from packages import StrategySource


def create_app(store, control_url, website_url, dynamo, s3):
    accounts = load("account_handler", "aws/lambdas/accounts/main.py")
    strategies = load("strategy_handler", "aws/lambdas/strategies/main.py")
    artifacts = load("artifact_handler", "aws/lambdas/strategy_artifacts/main.py")
    faults = dict(backend=False, delay=0, response=None, lose_action_response=False)

    def readiness():
        try:
            with httpx.Client(
                timeout=0.3, trust_env=False, follow_redirects=False
            ) as client:
                for url, marker in (
                    (control_url, "hqg-account-control-ready"),
                    (website_url, "hqg-dashboard-app"),
                ):
                    result = client.get(url)
                    if result.status_code != 200 or marker not in result.text:
                        return False
            return True
        except Exception:
            return False

    api = Control(
        store, readiness, strategy_source=StrategySource(dynamo, s3, os.environ)
    )
    app = FastAPI()
    app.state.control, app.state.faults = api, faults

    @app.post("/test/login")
    async def login(request: Request):
        actor = (await request.json()).get("actor", "operator")
        response = JSONResponse({"netid": actor})
        response.set_cookie("test_actor", actor)
        return response

    @app.post("/test/faults")
    async def set_faults(request: Request):
        faults.update(await request.json())
        return faults

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH"])
    async def dispatch(path: str, request: Request):
        if faults["backend"]:
            return JSONResponse({}, status_code=503)
        parts, params = path.split("/"), {}
        if path.startswith("internal/v1/accounts/"):
            params["accountId"] = parts[3]
            operation = parts[4]
            template = f"internal/v1/accounts/{{accountId}}/{operation}"
            if operation == "strategy-packages":
                template += "/{sourceDigest}"
                params["sourceDigest"] = parts[5]
            target = lambda event: accounts.handle(event, api)
        elif path.startswith("accounts/"):
            params["accountId"] = parts[1]
            template = "accounts/{accountId}/" + parts[2]
            target = lambda event: accounts.handle(event, api)
        else:
            template = "strategies"
            if len(parts) > 1:
                template += "/{id}"
                params["id"] = parts[1]
            if len(parts) > 2:
                template += "/artifacts"
            if len(parts) > 3:
                template += "/{artifactId}"
                params["artifactId"] = "/".join(parts[3:])
            handler = artifacts.handler if len(parts) > 2 else strategies.handler
            target = lambda event: handler(event, None)
        event = {
            "requestContext": {
                "routeKey": request.method + " /" + template,
                "authorizer": {
                    "lambda": {
                        "netid": request.cookies.get("test_actor"),
                        "roles": ["FUND"],
                    }
                },
            },
            "pathParameters": params,
            "headers": dict(request.headers),
            "body": (await request.body()).decode(),
        }
        result = await asyncio.to_thread(target, event)
        if faults["delay"]:
            await asyncio.sleep(faults["delay"])
        if path.startswith("internal/") and faults["response"]:
            return JSONResponse(faults["response"])
        if (
            faults["lose_action_response"]
            and not path.startswith("internal/")
            and request.method != "GET"
            and result["statusCode"] == 200
        ):
            return JSONResponse({}, status_code=503)
        body = (
            base64.b64decode(result["body"])
            if result.get("isBase64Encoded")
            else result["body"]
        )
        return Response(
            body, status_code=result["statusCode"], headers=result.get("headers")
        )

    return app
