import json
import os
from typing import Any, Dict


STRATEGY_DISCUSSION_TABLE = os.environ.get("STRATEGY_DISCUSSION_TABLE", "")
READ_PERMISSIONS_TABLE = os.environ.get("STRATEGIES_READ_PERMISSIONS_TABLE", "")
WRITE_PERMISSIONS_TABLE = os.environ.get("STRATEGIES_WRITE_PERMISSIONS_TABLE", "")


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Strategy discussion service Lambda.
    - GET /strategies/{id}/discussion
    - POST /strategies/{id}/discussion
    """
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /strategies/{id}/discussion":
        return list_discussion_comments(event)

    if route_key == "POST /strategies/{id}/discussion":
        return create_discussion_comment(event)

    return _json(404, {"message": "Not found"})


def list_discussion_comments(_event: Dict[str, Any]) -> Dict[str, Any]:
    return _json(501, {"message": "strategy discussion list is not implemented"})


def create_discussion_comment(_event: Dict[str, Any]) -> Dict[str, Any]:
    return _json(501, {"message": "strategy discussion create is not implemented"})


def _json(code: int, body: Any) -> Dict[str, Any]:
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
