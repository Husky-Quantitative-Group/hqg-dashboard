"""Settings from the environment and the session cookie attributes they control."""

from __future__ import annotations

import pytest

from hqg_dashboard.auth.session import session_cookie
from hqg_dashboard.config import Settings

REQUIRED = {
    "DATABASE_URL": "postgresql://hqg@db/hqg",
    "FRONTEND_BASE_URL": "http://localhost:5173/",
}


def test_defaults_match_the_aws_deployment():
    settings = Settings.from_env(REQUIRED)
    assert settings.frontend_base_url == "http://localhost:5173"
    assert settings.public_api_url == "http://localhost:5173/api"
    assert settings.cas_callback_url == "http://localhost:5173/api/auth/callback"
    assert settings.cas_base_url == "https://login.uconn.edu/cas"
    assert settings.is_prod
    assert settings.auth_cookie_domain == ".uconnquant.com"
    assert settings.auth_cookie_max_age_seconds == 86400


def test_production_settings():
    settings = Settings.from_env(
        {
            **REQUIRED,
            "FRONTEND_BASE_URL": "https://dashboard.uconnquant.com",
            "PUBLIC_API_URL": "https://api.uconnquant.com/",
            "BACKTEST_UPLOAD_MAX_BYTES": "1000",
        }
    )
    assert settings.public_api_url == "https://api.uconnquant.com"
    assert settings.cas_callback_url == "https://api.uconnquant.com/auth/callback"
    assert settings.backtest_upload_max_bytes == 1000


def test_development_cookies_have_no_domain():
    settings = Settings.from_env({**REQUIRED, "APP_ENV": "dev"})
    assert not settings.is_prod
    assert settings.auth_cookie_domain is None
    disabled = Settings.from_env({**REQUIRED, "AUTH_COOKIE_DOMAIN": ""})
    assert disabled.is_prod and disabled.auth_cookie_domain is None


@pytest.mark.parametrize("missing", ["DATABASE_URL", "FRONTEND_BASE_URL"])
def test_required_settings(missing):
    with pytest.raises(RuntimeError, match=missing):
        Settings.from_env({**REQUIRED, missing: " "})


def test_session_cookie_attributes_match_the_old_cookie():
    prod = Settings.from_env(REQUIRED)
    assert session_cookie("token", prod) == (
        "hqg_auth_token=token; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400; "
        "Domain=.uconnquant.com; Secure"
    )
    dev = Settings.from_env({**REQUIRED, "APP_ENV": "dev", "AUTH_COOKIE_MAX_AGE_SECONDS": "60"})
    assert (
        session_cookie("token", dev)
        == "hqg_auth_token=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=60"
    )
