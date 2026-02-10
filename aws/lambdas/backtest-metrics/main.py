import json
import os
import secrets
import time
import gzip
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb")

BACKTESTS_BUCKET = os.environ.get("BACKTESTS_BUCKET", "")
BACKTEST_METRICS_TABLE = os.environ.get("BACKTEST_METRICS_TABLE", "")

_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def handler(event, _context):
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "POST /strategies/{id}/backtests/presign":
        return presign_backtest_upload(event)

    if route_key == "GET /strategies/{id}/backtests":
        return list_backtest_runs(event)

    if route_key == "POST /strategies/{id}/backtests":
        return finalize_backtest_run(event)

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

    expires_in = 20 # 20 second TTL
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

def list_backtest_runs(event):
    if not BACKTEST_METRICS_TABLE:
        return _json(500, {"message": "BACKTEST_METRICS_TABLE is not configured"})

    strategy_id = (event.get("pathParameters") or {}).get("id")
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _netid_from_authorizer(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    query_params = event.get("queryStringParameters") or {}
    try:
        limit = int(query_params.get("limit") or 25)
    except Exception:
        limit = 25
    limit = max(1, min(limit, 200))

    cursor = query_params.get("cursor")
    exclusive_start_key = None
    if isinstance(cursor, str) and cursor.strip():
        try:
            exclusive_start_key = json.loads(cursor)
        except Exception:
            return _json(400, {"message": "invalid cursor"})

    table = dynamo.Table(BACKTEST_METRICS_TABLE)
    try:
        query_kwargs = {
            "KeyConditionExpression": Key("strategy_id").eq(strategy_id),
            "ScanIndexForward": False,
            "Limit": limit,
        }
        if exclusive_start_key:
            query_kwargs["ExclusiveStartKey"] = exclusive_start_key

        resp = table.query(**query_kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        return _json(500, {"message": f"Failed to query runs: {code or 'error'}"})

    items = _clean_decimals(resp.get("Items", []))
    next_cursor = resp.get("LastEvaluatedKey")

    return _json(
        200,
        {
            "strategy_id": strategy_id,
            "items": items,
            "next_cursor": next_cursor,
        },
    )

def finalize_backtest_run(event):
    if not BACKTESTS_BUCKET:
        return _json(500, {"message": "BACKTESTS_BUCKET is not configured"})
    if not BACKTEST_METRICS_TABLE:
        return _json(500, {"message": "BACKTEST_METRICS_TABLE is not configured"})

    strategy_id = (event.get("pathParameters") or {}).get("id")
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _netid_from_authorizer(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _json(400, {"message": "invalid JSON body"})

    run_id = body.get("run_id") or body.get("runId")
    if not isinstance(run_id, str) or not run_id.strip():
        return _json(400, {"message": "run_id is required"})
    run_id = run_id.strip()

    backtest_params = body.get("backtest_params") or body.get("backtestParams") or {}
    if not isinstance(backtest_params, dict):
        return _json(400, {"message": "backtest_params must be an object"})

    name = (backtest_params.get("name") or "").strip()
    start_date = (backtest_params.get("start_date") or "").strip()
    end_date = (backtest_params.get("end_date") or "").strip()
    initial_capital = backtest_params.get("initial_capital")
    if not name or not start_date or not end_date:
        return _json(400, {"message": "backtest_params must include name, start_date, end_date"})
    if not isinstance(initial_capital, (int, float)) or not (initial_capital == initial_capital):
        return _json(400, {"message": "backtest_params.initial_capital must be a number"})

    strategy_version = body.get("strategy_version") or body.get("strategyVersion")

    expected_key = f"strategies/{strategy_id}/runs/{run_id}/run.json.gz"
    provided_key = body.get("s3_key") or body.get("s3Key")
    if isinstance(provided_key, str) and provided_key.strip() and provided_key.strip() != expected_key:
        return _json(400, {"message": "s3_key does not match expected key for this run"})

    # Verify object exists before writing DynamoDB record.
    try:
        s3.head_object(Bucket=BACKTESTS_BUCKET, Key=expected_key)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return _json(400, {"message": "S3 object not found for run_id"})
        return _json(500, {"message": f"Failed to verify S3 object: {code or 'error'}"})

    # Load the saved payload to compute metrics to store in DynamoDB.
    try:
        obj = s3.get_object(Bucket=BACKTESTS_BUCKET, Key=expected_key)
        compressed = obj["Body"].read()
        payload = json.loads(gzip.decompress(compressed).decode("utf-8"))
    except Exception as exc:
        return _json(500, {"message": f"Failed to load saved payload: {exc}"})

    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    if not isinstance(metrics, dict):
        return _json(400, {"message": "Saved payload is missing metrics"})

    trades = payload.get("trades") if isinstance(payload, dict) else None
    trades_count = len(trades) if isinstance(trades, list) else 0

    final_value = payload.get("final_value") if isinstance(payload, dict) else None
    if not isinstance(final_value, (int, float)) or not (final_value == final_value):
        final_value = None

    net_pnl = (final_value - float(initial_capital)) if final_value is not None else None

    sharpe = metrics.get("sharpe_ratio")
    win_rate = metrics.get("win_rate")
    max_drawdown = metrics.get("max_drawdown")

    now = _now()
    item = {
        "strategy_id": strategy_id,
        "run_id": run_id,
        "time_created": now,
        "user": netid,
        "strategy_version": strategy_version,
        "backtest_params": {
            "name": name,
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": _to_decimal(initial_capital),
        },
        "metrics": _clean_numbers(metrics),
        "net_pnl": _to_decimal(net_pnl),
        "sharpe": _to_decimal(sharpe),
        "win_rate": _to_decimal(win_rate),
        "max_drawdown": _to_decimal(max_drawdown),
        "trades_count": _to_decimal(trades_count),
        "s3_bucket": BACKTESTS_BUCKET,
        "s3_key": expected_key,
    }

    item = {k: v for k, v in item.items() if v is not None}

    table = dynamo.Table(BACKTEST_METRICS_TABLE)
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(strategy_id) AND attribute_not_exists(run_id)",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return _json(409, {"message": "Run already finalized"})
        return _json(500, {"message": f"Failed to write DynamoDB item: {code or 'error'}"})

    return _json(201, _clean_decimals(item))

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

def _to_decimal(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if not (value == value):
            return None
        return Decimal(str(value))
    return None

def _clean_numbers(data):
    if isinstance(data, list):
        return [_clean_numbers(item) for item in data]
    if isinstance(data, dict):
        return {k: _clean_numbers(v) for k, v in data.items()}
    if isinstance(data, (int, float)):
        return _to_decimal(data)
    return data

def _clean_decimals(data):
    if isinstance(data, list):
        return [_clean_decimals(item) for item in data]
    if isinstance(data, dict):
        return {k: _clean_decimals(v) for k, v in data.items()}
    if isinstance(data, Decimal):
        return int(data) if data % 1 == 0 else float(data)
    return data

def _now():
    return datetime.now(timezone.utc).isoformat()

def _json(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
