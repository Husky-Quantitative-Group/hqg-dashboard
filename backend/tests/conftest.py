"""Shared fixtures. The tests need a disposable PostgreSQL database:

    TEST_DATABASE_URL=postgresql://hqg:hqg@localhost:5432/hqg_test python -m pytest

Each run recreates its schema and each test starts with empty tables, so the
database name must contain "test".
"""

from __future__ import annotations

import os
import socket
from collections.abc import Callable, Iterator, Sequence
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from hqg_dashboard.accounts import admin
from hqg_dashboard.accounts.control import Control
from hqg_dashboard.app import create_app
from hqg_dashboard.auth.session import COOKIE_NAME, mint_session_token
from hqg_dashboard.config import Settings
from hqg_dashboard.db import Database, migrate
from support import (
    ACCOUNT,
    API_URL,
    ENGINE,
    FRONTEND_URL,
    PACKAGE,
    SERVICE_SECRET,
    FakeCas,
    add_user,
    seed_package,
)

SignIn = Callable[..., dict[str, str]]


@pytest.fixture(autouse=True)
def no_external_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # PostgreSQL connections are opened by libpq, outside Python's socket module.
    def denied(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Dashboard tests may not access the network")

    monkeypatch.setattr(socket.socket, "connect", denied)
    monkeypatch.setattr(socket, "getaddrinfo", denied)


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.fail("Set TEST_DATABASE_URL to a disposable PostgreSQL database", pytrace=False)
    if "test" not in conninfo_to_dict(url).get("dbname", ""):
        pytest.fail("The TEST_DATABASE_URL database name must contain 'test'", pytrace=False)
    return url


@pytest.fixture(scope="session")
def database(database_url: str) -> Iterator[Database]:
    db = Database(database_url, max_size=4)
    db.open()
    with db.transaction() as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
    migrate(db)
    yield db
    db.close()


@pytest.fixture
def db(database: Database) -> Database:
    """The test database with every table emptied."""
    with database.transaction() as conn:
        tables = [
            sql.Identifier(row["tablename"])
            for row in conn.execute(
                """
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
                """
            )
        ]
        conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY").format(sql.SQL(", ").join(tables)))
        conn.execute("SELECT setval('strategy_id_seq', 1, false)")
    return database


@pytest.fixture
def settings(database_url: str) -> Settings:
    """Production settings, apart from the URLs."""
    return Settings(
        database_url=database_url,
        frontend_base_url=FRONTEND_URL,
        public_api_url=API_URL,
        cas_callback_url=f"{API_URL}/auth/callback",
        auth_cookie_domain=".uconnquant.com",
        database_pool_size=4,
    )


@pytest.fixture
def app(db: Database, settings: Settings) -> FastAPI:
    return create_app(settings, cas=FakeCas(settings), readiness=lambda: True)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, base_url=API_URL, follow_redirects=False) as client:
        yield client


@pytest.fixture
def session_headers(client: TestClient) -> Callable[..., dict[str, str]]:
    """Headers carrying a valid session cookie for any NetID, member or not."""

    def session_headers(netid: str, roles: Sequence[str] = ()) -> dict[str, str]:
        token = mint_session_token(client.app.state.keys, netid, list(roles), 3600)
        return {"Cookie": f"{COOKIE_NAME}={token}"}

    return session_headers


@pytest.fixture
def sign_in(db: Database, session_headers: Callable[..., dict[str, str]]) -> SignIn:
    """Create (or replace) a member and return headers carrying their session cookie."""

    def sign_in(netid: str, roles: Sequence[str] = ("PUBLIC",), **profile: Any) -> dict[str, str]:
        add_user(db, netid, roles, **profile)
        return session_headers(netid, roles)

    return sign_in


@pytest.fixture
def services(client: TestClient, db: Database) -> tuple[Any, Any, Control]:
    """The app's account control, with ACCOUNT provisioned for "operator" and PACKAGE
    saved as version 1 of the "sample" strategy."""
    control = client.app.state.control
    admin.provision(control.store, ACCOUNT, ENGINE, "operator", SERVICE_SECRET)
    seed_package(db, PACKAGE)
    return control.store, control.strategy_source, control
