"""The public JWKS and a health check."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..dependencies import Db, Keys

router = APIRouter()


@router.get("/.well-known/jwks.json")
def jwks(keys: Keys) -> JSONResponse:
    # hqg-platform and hqg-backtester verify session cookies with these keys
    # (their HQG_DASH_JWKS_URL). The S3 object had the same cache lifetime.
    return JSONResponse(keys.jwks(), headers={"Cache-Control": "public, max-age=600"})


@router.get("/health")
def health(db: Db) -> dict[str, str]:
    with db.transaction() as conn:
        conn.execute("SELECT 1")
    return {"status": "healthy"}
