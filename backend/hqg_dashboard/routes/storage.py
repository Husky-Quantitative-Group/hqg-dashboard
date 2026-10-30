"""Signed backtest payload uploads and downloads (formerly the backtests S3 bucket)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..db import Database
from ..dependencies import AppSettings, Db, Keys
from ..errors import ApiError
from ..serialization import utcnow
from ..storage import CONTENT_TYPE, DOWNLOAD_AUDIENCE, UPLOAD_AUDIENCE, signed_key

router = APIRouter()

# Room for the multipart boundaries and the key, Content-Type and token fields.
FORM_OVERHEAD_BYTES = 64 * 1024


@router.post("/storage/backtests", status_code=204)
async def upload_payload(request: Request, settings: AppSettings, db: Db, keys: Keys) -> Response:
    """Store a payload posted as an S3-style form: the signed fields, then "file"."""
    max_bytes = settings.backtest_upload_max_bytes
    declared_length = request.headers.get("content-length", "")
    if declared_length.isdigit() and int(declared_length) > max_bytes + FORM_OVERHEAD_BYTES:
        raise ApiError(413, "Upload is too large")

    async with request.form(max_files=1, max_fields=10) as form:
        token, file = form.get("token"), form.get("file")
        key = None
        if isinstance(token, str):
            key = await run_in_threadpool(signed_key, keys, token, UPLOAD_AUDIENCE)
        if key is None or form.get("key") != key:
            raise ApiError(403, "Upload URL is invalid or expired")
        if not isinstance(file, UploadFile):
            raise ApiError(400, "file is required")
        content = await file.read(max_bytes + 1)

    if len(content) > max_bytes:
        raise ApiError(413, "Upload is too large")
    await run_in_threadpool(_store, db, key, content)
    return Response(status_code=204)


@router.get("/storage/backtests/{key:path}")
def download_payload(key: str, db: Db, keys: Keys, token: str = "") -> Response:
    if signed_key(keys, token, DOWNLOAD_AUDIENCE) != key:
        raise ApiError(403, "Download URL is invalid or expired")
    with db.transaction() as conn:
        row = conn.execute("SELECT content FROM backtest_payloads WHERE key = %s", [key]).fetchone()
    if row is None:
        raise ApiError(404, "Not found")
    return Response(
        row["content"],
        media_type=CONTENT_TYPE,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


def _store(db: Database, key: str, content: bytes) -> None:
    # Like an S3 PUT, a second upload to the same key replaces the first.
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO backtest_payloads (key, content, uploaded_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (key) DO UPDATE
                SET content = EXCLUDED.content, uploaded_at = EXCLUDED.uploaded_at
            """,
            [key, content, utcnow()],
        )
