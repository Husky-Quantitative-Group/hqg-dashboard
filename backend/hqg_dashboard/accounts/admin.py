"""Administrative account provisioning and safe provider replacement.

Run through the CLI: python -m hqg_dashboard provision-account | authorize-replacement
"""

import copy
import time
from uuid import uuid4

from .control import Conflict, new_account, uuid


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
            "audit#" + str(uuid4()): {
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
        raise Conflict("Stop the previous provider and wait for its heartbeat to expire")
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
            "audit#" + str(uuid4()): {
                "actor": actor,
                "kind": "authorize_replacement_boot",
                "control_version": updated["control_version"],
                "timestamp": time.time(),
            }
        },
    )
