import json
import os
import secrets
import time

import boto3


s3 = boto3.client("s3")

BACKTESTS_BUCKET = os.environ.get("BACKTESTS_BUCKET", "")

_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def handler(event, _context):
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "POST /strategies/{id}/backtests/presign":
        return presign_backtest_upload(event)

    return _json(404, {"message": "Not found"})


def presign_backtest_upload(event):
    if not BACKTESTS_BUCKET:
        return _json(500, {"message": "BACKTESTS_BUCKET is not configured"})

    strategy_id = (event.get("pathParameters") or {}).get("id")
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _netid_from_authorizer(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    run_id = _ulid()
    key = f"strategies/{strategy_id}/runs/{run_id}/run.json.gz"

    expires_in = 60 # 1 minute TTL, will tweak to minimize exposure
    content_type = "application/gzip"

    presigned = s3.generate_presigned_post(
        Bucket=BACKTESTS_BUCKET,
        Key=key,
        Fields={
            "key": key,
            "Content-Type": content_type,
        },
        Conditions=[
            {"key": key},
            {"Content-Type": content_type},
        ],
        ExpiresIn=expires_in,
    )

    return _json(
        200,
        {
            "strategy_id": strategy_id,
            "run_id": run_id,
            "created_by": netid,
            "s3": {
                "bucket": BACKTESTS_BUCKET,
                "key": key,
                "expires_in": expires_in,
                "upload": {
                    "method": "POST",
                    "url": presigned["url"],
                    "fields": presigned["fields"],
                },
            },
        },
    )


def _netid_from_authorizer(event):
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}

    if isinstance(authorizer.get("lambda"), dict):
        netid = authorizer["lambda"].get("netid")
        if isinstance(netid, str) and netid.strip():
            return netid.strip()

    # Fallback for other shapes / configs
    netid = authorizer.get("netid")
    if isinstance(netid, str) and netid.strip():
        return netid.strip()

    return None


def _ulid():
    ts_ms = int(time.time() * 1000)
    ts_str = _encode_crockford(ts_ms, 10)
    rand_str = _encode_crockford(secrets.randbits(80), 16)
    return ts_str + rand_str


def _encode_crockford(value, length):
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD_BASE32[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def _json(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
