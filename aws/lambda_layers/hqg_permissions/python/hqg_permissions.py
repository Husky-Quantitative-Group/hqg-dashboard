import json
from typing import Iterable, List


def get_roles_from_event(event) -> List[str]:
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}

    roles_raw = authorizer.get("roles")
    if not roles_raw and isinstance(authorizer.get("lambda"), dict):
        roles_raw = authorizer.get("lambda", {}).get("roles")

    if isinstance(roles_raw, str):
        try:
            roles = json.loads(roles_raw)
        except json.JSONDecodeError:
            roles = []
    elif isinstance(roles_raw, list):
        roles = roles_raw
    else:
        roles = []

    return [str(role) for role in roles if isinstance(role, (str, int))]


def role_principals(roles: Iterable[str]) -> List[str]:
    principals: List[str] = []
    for role in roles:
        if not isinstance(role, str):
            continue
        role = role.strip()
        if not role or role == "ADMIN":
            continue
        principals.append(f"ROLE#{role}")
    return principals


def has_read_permission(strategy_id: str, netid: str, roles, read_table, write_table) -> bool:
    if "ADMIN" in roles:
        return True
    principal = f"USER#{netid}"
    for table in (read_table, write_table):
        resp = table.get_item(Key={"strategy_id": strategy_id, "principal": principal})
        if "Item" in resp:
            return True
        public_resp = table.get_item(
            Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"}
        )
        if "Item" in public_resp:
            return True
        for role_principal in role_principals(roles):
            role_resp = table.get_item(
                Key={"strategy_id": strategy_id, "principal": role_principal}
            )
            if "Item" in role_resp:
                return True
    return False


def has_write_permission(strategy_id: str, netid: str, roles, write_table) -> bool:
    if "ADMIN" in roles:
        return True
    principal = f"USER#{netid}"
    resp = write_table.get_item(Key={"strategy_id": strategy_id, "principal": principal})
    if "Item" in resp:
        return True
    public_resp = write_table.get_item(
        Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"}
    )
    if "Item" in public_resp:
        return True
    for role_principal in role_principals(roles):
        role_resp = write_table.get_item(
            Key={"strategy_id": strategy_id, "principal": role_principal}
        )
        if "Item" in role_resp:
            return True
    return False
