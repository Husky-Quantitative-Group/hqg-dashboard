"""Administrative provisioning and safe provider replacement using AWS credentials."""

import argparse
import copy
import os
import time
from uuid import uuid4

from control import Conflict, new_account, uuid
from store import DynamoStore


def provision(store, account_id, engine_id, netid, secret, live=False):
    if not netid.strip() or not secret:
        raise ValueError("An explicit NetID and nonempty service secret are required")
    grants = ["control"] + (["live"] if live else [])
    state = new_account(account_id, engine_id, {netid: grants}, [], None, secret)
    store.commit(
        state["account_id"],
        None,
        state,
        {
            "audit#"
            + str(uuid4()): {
                "actor": netid,
                "kind": "provision",
                "timestamp": time.time(),
            }
        },
    )


def authorize_replacement(store, account_id, actor):
    account_id = uuid(account_id)
    state = store.get(account_id, "state")
    if not actor.strip():
        raise ValueError("An audit actor is required")
    if not state or time.time() - (state.get("last_sync") or 0) <= 15:
        raise Conflict(
            "Stop the previous provider and wait for its heartbeat to expire"
        )
    updated = copy.deepcopy(state)
    updated.update(
        boot_id=None,
        observed=None,
        last_sync=None,
        control_version=state["control_version"] + 1,
        generation=state["generation"] + 1,
    )
    for mode in updated["modes"].values():
        mode.update(
            desired_state="paused",
            resume_incident_id=None,
            stop_version=updated["control_version"],
        )
        mode.pop("resume_version", None)
    store.commit(
        account_id,
        state["generation"],
        updated,
        {
            "audit#"
            + str(uuid4()): {
                "actor": actor,
                "kind": "authorize_replacement_boot",
                "control_version": updated["control_version"],
                "timestamp": time.time(),
            }
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("provision")
    create.add_argument("--account-id", required=True)
    create.add_argument("--engine-id", required=True)
    create.add_argument("--netid", required=True)
    create.add_argument("--allow-live", action="store_true")
    create.add_argument("--secret-env", default="DASHBOARD_SYNC_SECRET")
    replace = commands.add_parser("authorize-replacement")
    replace.add_argument("--account-id", required=True)
    replace.add_argument("--actor", required=True)
    args = parser.parse_args()
    import boto3

    store = DynamoStore(boto3.client("dynamodb"), args.table)
    try:
        if args.command == "provision":
            provision(
                store,
                args.account_id,
                args.engine_id,
                args.netid,
                os.environ[args.secret_env],
                args.allow_live,
            )
        else:
            authorize_replacement(store, args.account_id, args.actor)
    except (Conflict, ValueError, KeyError) as exc:
        parser.error(str(exc))
    print("Account operation completed. Both modes are paused and require Resume.")


if __name__ == "__main__":
    main()
