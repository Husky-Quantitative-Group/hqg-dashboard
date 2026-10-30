"""The API application. Serve it with: uvicorn --factory hqg_dashboard.app:create_app"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .accounts.control import Control
from .accounts.packages import StrategySource
from .accounts.readiness import ReadinessProbe
from .accounts.store import PostgresStore
from .auth.cas import CasClient
from .auth.keys import KeyRotationThread, SigningKeys
from .config import Settings
from .db import Database, migrate
from .errors import UnhandledErrorMiddleware, install_error_handlers
from .routes import ROUTERS


def create_app(
    settings: Settings | None = None,
    *,
    cas: CasClient | None = None,
    readiness: Callable[[], bool] | None = None,
) -> FastAPI:
    """Build the app. Tests inject fakes for the CAS server and readiness probes."""
    settings = settings or Settings.from_env()
    _configure_logging()

    db = Database(settings.database_url, max_size=settings.database_pool_size)
    keys = SigningKeys(db, settings.auth_cookie_max_age_seconds)
    key_rotation = KeyRotationThread(keys)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        db.open()
        migrate(db)
        keys.rotate_if_due()
        key_rotation.start()
        try:
            yield
        finally:
            key_rotation.stop()
            db.close()

    app = FastAPI(
        title="HQG Dashboard API",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.db = db
    app.state.keys = keys
    app.state.cas = cas or CasClient(settings.cas_base_url, settings.cas_callback_url)
    app.state.control = Control(
        PostgresStore(db),
        readiness
        or ReadinessProbe(
            settings.control_readiness_url,
            settings.control_readiness_token,
            settings.website_readiness_url,
        ),
        strategy_source=StrategySource(db),
    )

    install_error_handlers(app)
    app.add_middleware(UnhandledErrorMiddleware)
    # Added last, so it wraps everything: the API Gateway CORS configuration.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_base_url],
        allow_credentials=True,
        allow_methods=["OPTIONS", "GET", "POST", "PATCH", "PUT"],
        allow_headers=["content-type"],
        max_age=300,
    )
    for router in ROUTERS:
        app.include_router(router)
    return app


def _configure_logging() -> None:
    """Log this package's INFO messages alongside uvicorn's own."""
    logger = logging.getLogger("hqg_dashboard")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
