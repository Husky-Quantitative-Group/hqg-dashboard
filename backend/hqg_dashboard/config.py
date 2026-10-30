"""Runtime settings, read once from environment variables (see .env.example)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_CAS_BASE_URL = "https://login.uconn.edu/cas"
PROD_COOKIE_DOMAIN = ".uconnquant.com"
MIB = 1024 * 1024


@dataclass(frozen=True)
class Settings:
    database_url: str
    # Browser origin of the dashboard: the only CORS origin and the post-login redirect.
    frontend_base_url: str
    # This API's base URL as browsers reach it. Signed storage URLs are built from it.
    public_api_url: str
    cas_callback_url: str
    app_env: str = "prod"
    cas_base_url: str = DEFAULT_CAS_BASE_URL
    auth_cookie_max_age_seconds: int = 86400
    auth_cookie_domain: str | None = None
    control_readiness_url: str = ""
    control_readiness_token: str = ""
    website_readiness_url: str = ""
    # The only proxy the readiness probes use; they ignore HTTPS_PROXY and the like.
    readiness_proxy_url: str = ""
    backtest_upload_max_bytes: int = 25 * MIB
    backtest_payload_max_bytes: int = 256 * MIB
    database_pool_size: int = 10

    @property
    def is_prod(self) -> bool:
        return self.app_env == "prod"

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Settings:
        def get(name: str, default: str = "") -> str:
            return environ.get(name, default).strip()

        def required(name: str) -> str:
            value = get(name)
            if not value:
                raise RuntimeError(f"The {name} environment variable is required")
            return value

        app_env = get("APP_ENV", "prod").lower()
        frontend_base_url = required("FRONTEND_BASE_URL").rstrip("/")
        # Defaults mirror the AWS deployment, where the Vite dev server proxied /api.
        public_api_url = (get("PUBLIC_API_URL") or f"{frontend_base_url}/api").rstrip("/")
        cas_callback_url = get("CAS_CALLBACK_URL") or f"{public_api_url}/auth/callback"
        default_cookie_domain = PROD_COOKIE_DOMAIN if app_env == "prod" else ""

        return cls(
            database_url=required("DATABASE_URL"),
            frontend_base_url=frontend_base_url,
            public_api_url=public_api_url,
            cas_callback_url=cas_callback_url.rstrip("/"),
            app_env=app_env,
            cas_base_url=get("CAS_BASE_URL", DEFAULT_CAS_BASE_URL).rstrip("/"),
            auth_cookie_max_age_seconds=int(get("AUTH_COOKIE_MAX_AGE_SECONDS", "86400")),
            auth_cookie_domain=get("AUTH_COOKIE_DOMAIN", default_cookie_domain) or None,
            control_readiness_url=get("CONTROL_READINESS_URL"),
            control_readiness_token=get("CONTROL_READINESS_TOKEN"),
            website_readiness_url=get("WEBSITE_READINESS_URL"),
            readiness_proxy_url=get("READINESS_PROXY_URL"),
            backtest_upload_max_bytes=int(get("BACKTEST_UPLOAD_MAX_BYTES", str(25 * MIB))),
            backtest_payload_max_bytes=int(get("BACKTEST_PAYLOAD_MAX_BYTES", str(256 * MIB))),
            database_pool_size=int(get("DATABASE_POOL_SIZE", "10")),
        )
