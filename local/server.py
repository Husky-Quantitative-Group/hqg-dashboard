"""Mock dashboard: identical control handlers, local durable store and fake login."""

import json
import os
from pathlib import Path
import sqlite3
import sys
import threading

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx

ACCOUNTS_DIR = Path(__file__).parents[1] / "aws/lambdas/accounts"
sys.path.insert(0, str(ACCOUNTS_DIR))
from control import Control, Conflict, Forbidden, new_account
from strategies import Strategies
import main as account_lambda


class LocalStore:
    def __init__(self, path):
        self.path, self.lock = path, threading.Lock()
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS records (account_id TEXT, record TEXT, body TEXT, PRIMARY KEY(account_id, record))"
            )

    def get(self, account_id, record):
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT body FROM records WHERE account_id=? AND record=?",
                (account_id, record),
            ).fetchone()

            return json.loads(row[0]) if row else None

    def provision(self, state):
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR IGNORE INTO records VALUES (?, 'state', ?)",
                (state["account_id"], json.dumps(state)),
            )

    def commit(self, account_id, generation, state, extra):
        with self.lock, sqlite3.connect(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT body FROM records WHERE account_id=? AND record='state'",
                (account_id,),
            ).fetchone()

            if not row or json.loads(row[0])["generation"] != generation:
                raise Conflict("Concurrent update")

            db.execute(
                "UPDATE records SET body=? WHERE account_id=? AND record='state'",
                (json.dumps(state), account_id),
            )

            for record, body in extra.items():
                db.execute(
                    "INSERT INTO records VALUES (?, ?, ?)",
                    (account_id, record, json.dumps(body)),
                )


def create_app(store, provisioned, control_url, website_url):
    store.provision(provisioned)
    faults = {
        "backend": False,
        "delay": 0,
        "response": None,
        "lose_action_response": False,
    }

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

    strategies = Strategies(store.path)
    api = Control(store, readiness, strategy_source=strategies.package)
    app = FastAPI(title="Mock dashboard")
    app.state.control, app.state.faults = api, faults
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/control")
    async def control_probe():
        try:
            if faults["backend"]:
                raise RuntimeError("Control unavailable")
            api.account(provisioned["account_id"])
            return {"application": "hqg-account-control-ready"}

        except Exception:
            return JSONResponse({}, status_code=503)

    @app.post("/test/faults")
    async def set_faults(request: Request):
        faults.update(await request.json())
        return faults

    @app.post("/test/login")
    async def login(request: Request):
        body = await request.json()
        actor = body.get("actor", "operator")
        response = JSONResponse({"netid": actor, "roles": ["FUND"]})
        response.set_cookie("mock_operator", actor, httponly=True, samesite="lax")

        return response

    @app.get("/auth/me")
    async def me(request: Request):
        actor = request.cookies.get("mock_operator")

        return (
            JSONResponse({"netid": actor, "roles": ["FUND"], "display_name": actor})
            if actor
            else JSONResponse({}, status_code=401)
        )

    @app.api_route("/strategies", methods=["GET", "POST"])
    @app.api_route("/strategies/{strategy_id}", methods=["GET"])
    @app.api_route("/strategies/{strategy_id}/{operation}", methods=["GET", "POST"])
    @app.get("/strategies/{strategy_id}/artifacts/{artifact_path:path}")
    async def strategy_route(
        request: Request,
        strategy_id: str = "",
        operation: str = "",
        artifact_path: str = "",
    ):
        import asyncio

        try:
            body = await request.json() if request.method == "POST" else None
        except ValueError:
            return JSONResponse({"message": "Invalid JSON"}, status_code=400)
        return await asyncio.to_thread(
            strategy_response, request, strategy_id, operation, artifact_path, body
        )

    def strategy_response(request, strategy_id, operation, artifact_path, body=None):
        try:
            actor = request.cookies.get("mock_operator")
            api.authorize(api.account(provisioned["account_id"]), actor)
            if faults["backend"]:
                return JSONResponse({"message": "Control unavailable"}, status_code=503)
            if not strategy_id:
                return (
                    strategies.list()
                    if request.method == "GET"
                    else strategies.create(body, actor)
                )
            metadata = strategies.get(strategy_id)
            if not operation and not artifact_path:
                return metadata
            if operation == "permissions":
                return {
                    "canWrite": strategies.can_write(metadata, actor),
                    "read": {"public": False, "fund": True, "users": []},
                    "write": {"public": False, "users": [{"netid": metadata["owner"]}]},
                }
            if operation == "backtests":
                return {"items": []}
            if artifact_path:
                files = strategies.package(strategy_id, metadata["current_version"])[
                    "files"
                ]
                if artifact_path not in files:
                    raise HTTPException(404, "Artifact not found")
                return PlainTextResponse(files[artifact_path])
            if operation == "artifacts":
                if request.method == "POST":
                    return strategies.upload(strategy_id, body, actor)
                return {
                    "artifacts": list(
                        strategies.package(strategy_id, metadata["current_version"])[
                            "files"
                        ]
                    )
                }
            raise HTTPException(404, "Not found")
        except Forbidden as exc:
            return JSONResponse({"message": str(exc)}, status_code=403)
        except (ValueError, KeyError, TypeError) as exc:
            return JSONResponse({"message": str(exc)}, status_code=400)

    async def dispatch(accountId: str, operation: str, request: Request):
        import asyncio

        if faults["backend"]:
            return JSONResponse({"message": "Control unavailable"}, status_code=503)

        internal = request.url.path.startswith("/internal/")
        route = f"{request.method} /{'internal/v1/' if internal else ''}accounts/{{accountId}}/{operation}"
        event = {
            "requestContext": {
                "routeKey": route,
                "authorizer": {
                    "lambda": {"netid": request.cookies.get("mock_operator")}
                },
            },
            "pathParameters": {"accountId": accountId},
            "headers": dict(request.headers),
            "body": (await request.body()).decode(),
        }

        # Local service injects the same Control object used by the Lambda.
        result = await asyncio.to_thread(call, event)
        if faults["delay"]:
            await asyncio.sleep(faults["delay"])

        if internal and faults["response"]:
            return JSONResponse(faults["response"])

        if (
            not internal
            and faults["lose_action_response"]
            and request.method != "GET"
            and result["statusCode"] == 200
        ):
            return JSONResponse(
                {"message": "Response lost after commit"}, status_code=503
            )

        return JSONResponse(
            json.loads(result["body"]), status_code=result["statusCode"]
        )

    def call(event):
        # Handler accepts an injected service to avoid cross-account global state in tests.
        return account_lambda.handle(event, api)

    app.add_api_route(
        "/accounts/{accountId}/{operation}", dispatch, methods=["GET", "PUT", "POST"]
    )
    app.add_api_route(
        "/internal/v1/accounts/{accountId}/{operation}", dispatch, methods=["POST"]
    )

    return app


def from_environment():
    state = new_account(
        os.environ["HQG_ACCOUNT_ID"],
        os.environ["HQG_ENGINE_ID"],
        {"operator": ["control", "live"], "paper-operator": ["control"]},
        [],
        None,
        os.environ["DASHBOARD_SYNC_SECRET"],
    )

    return create_app(
        LocalStore(os.environ["MOCK_DASHBOARD_DB"]),
        state,
        os.environ["CONTROL_READINESS_URL"],
        os.environ["WEBSITE_READINESS_URL"],
    )
