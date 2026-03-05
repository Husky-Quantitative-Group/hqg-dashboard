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

from wonderwords import RandomWord

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb")
_WORD_GENERATOR = RandomWord()

BACKTESTS_BUCKET = os.environ.get("BACKTESTS_BUCKET", "")
BACKTEST_METRICS_TABLE = os.environ.get("BACKTEST_METRICS_TABLE", "")
WRITE_PERMISSIONS_TABLE = os.environ.get("STRATEGIES_WRITE_PERMISSIONS_TABLE", "")
STRATEGIES_TABLE = os.environ.get("STRATEGIES_TABLE", "")

_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def handler(event, _context):
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "POST /strategies/{id}/backtests/presign":
        return presign_backtest_upload(event)

    if route_key == "GET /strategies/{id}/backtests":
        return list_backtest_runs(event)

    if route_key == "GET /strategies/{id}/backtests/{backtestId}":
        return get_backtest_run(event)

    if route_key == "POST /strategies/{id}/backtests":
        return dynamo_backtest_write(event)

    return _json(404, {"message": "Not found"})

def presign_backtest_upload(event):
    ctx = _require_strategy_context(event, require_bucket=True)
    if isinstance(ctx, dict):
        return ctx
    strategy_id, netid = ctx
    if not _has_write_permission(strategy_id, netid):
        return _json(403, {"message": "forbidden"})

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
    ctx = _require_strategy_context(event, require_table=True)
    if isinstance(ctx, dict):
        return ctx
    strategy_id, _netid = ctx

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

def get_backtest_run(event):
    ctx = _require_strategy_context(event, require_table=True, require_bucket=True)
    if isinstance(ctx, dict):
        return ctx
    strategy_id, _netid = ctx

    run_id = (event.get("pathParameters") or {}).get("backtestId")
    if not run_id:
        return _json(400, {"message": "backtestId is required"})

    table = dynamo.Table(BACKTEST_METRICS_TABLE)
    try:
        resp = table.get_item(Key={"strategy_id": strategy_id, "run_id": run_id})
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        return _json(500, {"message": f"Failed to load run: {code or 'error'}"})

    item = resp.get("Item")
    if not item:
        return _json(404, {"message": "Not found"})

    bucket = item.get("s3_bucket") or BACKTESTS_BUCKET
    key = item.get("s3_key") or f"strategies/{strategy_id}/runs/{run_id}/run.json.gz"

    expires_in = 20 # 20 second TTL for download link
    try:
        download_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        return _json(500, {"message": f"Failed to presign download: {code or 'error'}"})

    item = _clean_decimals(item)

    return _json(
        200,
        {
            "strategy_id": strategy_id,
            "run_id": run_id,
            "item": item,
            "s3": {
                "bucket": bucket,
                "key": key,
                "expires_in": expires_in,
                "download_url": download_url,
            },
        },
    )

def dynamo_backtest_write(event):
    ctx = _require_strategy_context(
        event,
        require_table=True,
        require_bucket=True,
        require_strategies_table=True,
    )
    if isinstance(ctx, dict):
        return ctx
    strategy_id, netid = ctx
    if not _has_write_permission(strategy_id, netid):
        return _json(403, {"message": "forbidden"})

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

    start_date = (backtest_params.get("start_date") or "").strip()
    end_date = (backtest_params.get("end_date") or "").strip()
    initial_capital = backtest_params.get("initial_capital")
    if not start_date or not end_date:
        return _json(400, {"message": "backtest_params must include start_date and end_date"})
    if not isinstance(initial_capital, (int, float)) or not (initial_capital == initial_capital):
        return _json(400, {"message": "backtest_params.initial_capital must be a number"})
    initial_capital_decimal = _to_decimal(initial_capital)
    if initial_capital_decimal is None:
        return _json(400, {"message": "backtest_params.initial_capital must be a finite number"})

    strategy_version = body.get("strategy_version") or body.get("strategyVersion")
    strategy_version_key = _strategy_version_key(strategy_version)
    normalized_start_date = _normalize_date_value(start_date)
    normalized_end_date = _normalize_date_value(end_date)
    if not normalized_start_date or not normalized_end_date:
        return _json(400, {"message": "backtest_params.start_date and end_date must be valid dates"})

    table = dynamo.Table(BACKTEST_METRICS_TABLE)
    try:
        strategy_runs = _list_strategy_runs(table, strategy_id)
        duplicate_item = _find_duplicate_run(
            strategy_runs,
            run_id=run_id,
            strategy_version_key=strategy_version_key,
            start_date=normalized_start_date,
            end_date=normalized_end_date,
            initial_capital=initial_capital_decimal,
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        return _json(500, {"message": f"Failed to check duplicate runs: {code or 'error'}"})
    if duplicate_item:
        return _json(
            409,
            {
                "message": "Duplicate run already exists for this strategy version and parameters",
                "duplicate_run_id": duplicate_item.get("run_id"),
            },
        )

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

    orders = payload.get("orders") if isinstance(payload, dict) else None
    total_orders_metric = _finite_number_or_none(metrics.get("total_orders"))
    trades_count = total_orders_metric if total_orders_metric is not None else (len(orders) if isinstance(orders, list) else 0)

    equity_stats = payload.get("equity_stats") if isinstance(payload, dict) else None
    net_pnl = _finite_number_or_none(equity_stats.get("net_profit")) if isinstance(equity_stats, dict) else None
    if net_pnl is None and isinstance(equity_stats, dict):
        equity_value = _finite_number_or_none(equity_stats.get("equity"))
        if equity_value is not None:
            net_pnl = equity_value - float(initial_capital)

    sharpe = metrics.get("sharpe_ratio")
    win_rate = metrics.get("win_rate")
    max_drawdown = metrics.get("max_drawdown")
    strategy_metadata_metrics = _strategy_metadata_metrics(metrics)

    now = _now()
    item = {
        "strategy_id": strategy_id,
        "run_id": run_id,
        "name": _generate_backtest_name(len(strategy_runs)),
        "time_created": now,
        "user": netid,
        "strategy_version": strategy_version,
        "backtest_params": {
            "start_date": normalized_start_date,
            "end_date": normalized_end_date,
            "initial_capital": initial_capital_decimal,
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

    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(strategy_id) AND attribute_not_exists(run_id)",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            metadata_warning = _update_strategy_metadata(strategy_id, strategy_metadata_metrics)
            if metadata_warning:
                return _json(500, {"message": metadata_warning})

            try:
                existing = table.get_item(Key={"strategy_id": strategy_id, "run_id": run_id}).get("Item")
            except ClientError:
                existing = None

            if existing:
                return _json(200, _clean_decimals(existing))
            return _json(409, {"message": "Run already finalized"})
        return _json(500, {"message": f"Failed to write DynamoDB item: {code or 'error'}"})

    metadata_warning = _update_strategy_metadata(strategy_id, strategy_metadata_metrics)
    if metadata_warning:
        return _json(500, {"message": metadata_warning})

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

def _require_strategy_context(event, *, require_table=False, require_bucket=False, require_strategies_table=False):
    if require_table and not BACKTEST_METRICS_TABLE:
        return _json(500, {"message": "BACKTEST_METRICS_TABLE is not configured"})
    if require_bucket and not BACKTESTS_BUCKET:
        return _json(500, {"message": "BACKTESTS_BUCKET is not configured"})
    if require_strategies_table and not STRATEGIES_TABLE:
        return _json(500, {"message": "STRATEGIES_TABLE is not configured"})

    strategy_id = (event.get("pathParameters") or {}).get("id")
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _netid_from_authorizer(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    return strategy_id, netid

def _has_write_permission(strategy_id, netid):
    if not WRITE_PERMISSIONS_TABLE:
        return False
    principal = f"USER#{netid}"
    table = dynamo.Table(WRITE_PERMISSIONS_TABLE)
    resp = table.get_item(Key={"strategy_id": strategy_id, "principal": principal})
    return "Item" in resp

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

def _finite_number_or_none(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:
        return float(value)
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

def _strategy_version_key(value):
    if value is None:
        return ""
    return str(value).strip()

def _strategy_metadata_metrics(metrics):
    if not isinstance(metrics, dict):
        return {}

    result = {}
    for key, raw_value in metrics.items():
        value = _to_decimal(raw_value)
        if value is not None:
            result[key] = value

    return result

def _update_strategy_metadata(strategy_id, strategy_metadata_metrics):
    if not STRATEGIES_TABLE:
        print("Strategy metadata update skipped: STRATEGIES_TABLE is not configured")
        return "STRATEGIES_TABLE is not configured"

    strategy_table = dynamo.Table(STRATEGIES_TABLE)
    update_kwargs = {
        "Key": {"id": strategy_id},
        "ConditionExpression": "attribute_exists(#id)",
        "ExpressionAttributeNames": {"#id": "id", "#metrics": "metrics"},
    }
    if strategy_metadata_metrics:
        update_kwargs["UpdateExpression"] = "SET #metrics = :metrics"
        update_kwargs["ExpressionAttributeValues"] = {":metrics": strategy_metadata_metrics}
    else:
        update_kwargs["UpdateExpression"] = "REMOVE #metrics"

    try:
        strategy_table.update_item(**update_kwargs)
    except ClientError as exc:
        err = exc.response.get("Error") or {}
        code = err.get("Code") or "error"
        message = err.get("Message") or ""
        print(f"Failed to update strategy metadata for strategy_id={strategy_id}: {code} {message}")
        return f"Failed to update strategy metadata: {code}"

    return None

def _normalize_date_value(value):
    if not isinstance(value, str):
        return ""
    return value.split("T")[0].strip()

def _list_strategy_runs(table, strategy_id):
    resp = table.query(
        KeyConditionExpression=Key("strategy_id").eq(strategy_id),
        ConsistentRead=True,
        ScanIndexForward=False,
    )
    return resp.get("Items", [])

def _find_duplicate_run(items, *, run_id, strategy_version_key, start_date, end_date, initial_capital):
    for item in items:
        if item.get("run_id") == run_id:
            continue

        item_strategy_version_key = _strategy_version_key(item.get("strategy_version"))
        if item_strategy_version_key != strategy_version_key:
            continue

        params = item.get("backtest_params")
        if not isinstance(params, dict):
            continue

        if _normalize_date_value(params.get("start_date")) != start_date:
            continue
        if _normalize_date_value(params.get("end_date")) != end_date:
            continue

        item_initial_capital = _to_decimal(params.get("initial_capital"))
        if item_initial_capital is None:
            continue
        if item_initial_capital == initial_capital:
            return item

    return None

def _generate_backtest_name(existing_runs_count):
    if not isinstance(existing_runs_count, int) or existing_runs_count < 0:
        existing_runs_count = 0

    capped = existing_runs_count % (26 * 26)
    first = chr(ord("a") + (capped // 26))
    second = chr(ord("a") + (capped % 26))

    adjective = _WORD_GENERATOR.word(starts_with=first, include_parts_of_speech=["adjectives"])
    noun = _WORD_GENERATOR.word(starts_with=second, include_parts_of_speech=["nouns"])

    return f"{adjective.strip().title()} {noun.strip().title()}"

def _now():
    return datetime.now(timezone.utc).isoformat()

def _json(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
