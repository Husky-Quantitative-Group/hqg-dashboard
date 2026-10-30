"""Signed upload and download URLs for backtest payloads (formerly S3 presigned URLs).

The browser posts a gzipped backtest result as multipart form data, exactly as
it posted to S3, and later fetches it with a plain GET. Each URL carries a
short-lived token, signed with the JWT keys, that names one object key. Its
audience keeps it from ever passing as a session token, and it has no subject.
"""

from __future__ import annotations

import time
from urllib.parse import quote

from .auth.keys import SigningKeys

# Reported as s3.bucket and s3_bucket, which clients received from the AWS API.
BACKTESTS_BUCKET = "backtests"
CONTENT_TYPE = "application/gzip"
URL_LIFETIME_SECONDS = 20
UPLOAD_AUDIENCE = "hqg:backtest-upload"
DOWNLOAD_AUDIENCE = "hqg:backtest-download"


def payload_key(strategy_id: str, run_id: str) -> str:
    return f"strategies/{strategy_id}/runs/{run_id}/run.json.gz"


def upload_form(keys: SigningKeys, api_url: str, key: str) -> dict[str, object]:
    """Where and how to POST a payload: an S3-style presigned POST."""
    return {
        "method": "POST",
        "url": f"{api_url}/storage/backtests",
        "fields": {
            "key": key,
            "Content-Type": CONTENT_TYPE,
            "token": _token(keys, UPLOAD_AUDIENCE, key),
        },
    }


def download_url(keys: SigningKeys, api_url: str, key: str) -> str:
    return f"{api_url}/storage/backtests/{quote(key)}?token={_token(keys, DOWNLOAD_AUDIENCE, key)}"


def signed_key(keys: SigningKeys, token: str, audience: str) -> str | None:
    """The object key a valid, unexpired token grants access to, or None."""
    claims = keys.verify(token, audience=audience, require=["exp", "aud", "key"])
    key = claims.get("key") if claims else None
    return key if isinstance(key, str) else None


def _token(keys: SigningKeys, audience: str, key: str) -> str:
    now = int(time.time())
    return keys.sign({"aud": audience, "key": key, "iat": now, "exp": now + URL_LIFETIME_SECONDS})
