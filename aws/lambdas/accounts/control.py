"""Account control shared by the Lambda and offline tests."""

import copy
import hashlib
import json
import time
from uuid import UUID

MODES = ("paper", "live")


def digest(value):
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                value, sort_keys=True, separators=(",", ":"), allow_nan=False
            ).encode()
        ).hexdigest()
    )


class Conflict(Exception):
    pass


class Invalid(Exception):
    pass


class Forbidden(Exception):
    pass


def uuid(value):
    return str(UUID(value))


def validate_configuration(config, approved):
    if set(config) != {"modes"} or set(config["modes"]) != set(MODES):
        raise Invalid("Configuration must contain explicit paper and live modes")
    portfolios = set()
    for mode, spec in config["modes"].items():
        if (
            set(spec) != {"portfolio_id", "enabled", "strategies"}
            or type(spec["enabled"]) is not bool
        ):
            raise Invalid("Invalid mode configuration")

        portfolios.add(uuid(spec["portfolio_id"]))

        if not spec["enabled"] and spec["strategies"]:
            raise Invalid("Disabled mode cannot contain strategies")
        if spec["enabled"] and not spec["strategies"]:
            raise Invalid("Enabled mode requires an approved strategy")

        total = 0
        seen = set()

        for strategy in spec["strategies"]:
            if set(strategy) != {
                "strategy_id",
                "version",
                "source_digest",
                "allocation",
            }:
                raise Invalid("Invalid strategy configuration")

            identity = {
                k: strategy[k] for k in ("strategy_id", "version", "source_digest")
            }

            if identity not in approved or strategy["strategy_id"] in seen:
                raise Invalid("Strategy version is not installed and approved")

            seen.add(strategy["strategy_id"])
            weight = strategy["allocation"]

            if type(weight) not in (int, float) or not 0 < weight <= 1:
                raise Invalid("Allocation must be positive and at most one")

            total += weight

        if total > 1:
            raise Invalid("Allocations exceed one")

    if len(portfolios) != 2:
        raise Invalid("Paper and live must have separate portfolio UUIDs")


def new_account(account_id, engine_id, users, approved, image_digest, service_secret):
    return dict(
        account_id=uuid(account_id),
        engine_instance_id=uuid(engine_id),
        users=users,
        approved_strategies=approved,
        image_digest=image_digest,
        service_secret_hash=hashlib.sha256(service_secret.encode()).hexdigest(),
        boot_id=None,
        generation=0,
        control_version=0,
        configuration_revision=0,
        configuration_digest=None,
        configuration=None,
        observed=None,
        last_sync=None,
        modes={
            m: {
                "desired_state": "paused",
                "resume_incident_id": None,
                "stop_version": 0,
            }
            for m in MODES
        },
    )


class Control:
    def __init__(self, store, readiness, ttl=15, strategy_source=None):
        self.store, self.readiness, self.ttl = store, readiness, ttl
        # Injected only by tests; production artifact integration remains unimplemented.
        self.strategy_source = strategy_source

    def account(self, account_id):
        state = self.store.get(account_id, "state")

        if not state:
            raise Forbidden("Account unavailable")

        return state

    def authorize(self, state, actor, live=False):
        grants = state["users"].get(actor, [])

        if "control" not in grants or (live and "live" not in grants):
            raise Forbidden("Account permission required")

    def fresh_pause(self, state, mode):
        observed = state.get("observed") or {}
        status = (observed.get("modes") or {}).get(mode, {})

        return (
            time.time() - (state.get("last_sync") or 0) <= self.ttl
            and status.get("gate_open") is False
            and status.get("reconciled") is True
            and observed.get("control_version", -1)
            >= state["modes"][mode]["stop_version"]
        )

    def change(self, account_id, actor, kind, body):
        state = self.account(account_id)
        self.authorize(
            state,
            actor,
            body.get("mode") == "live" and body.get("action") in ("start", "resume"),
        )

        key = uuid(body["idempotency_key"])
        fingerprint = digest({"actor": actor, "kind": kind, "body": body})
        existing = self.store.get(account_id, "action#" + key)

        if existing:
            if existing["fingerprint"] != fingerprint:
                raise Conflict("Idempotency key reused with a different payload")

            return existing["result"]

        if (
            type(body["expected_control_version"]) is not int
            or body["expected_control_version"] != state["control_version"]
        ):
            raise Conflict("Control version changed; refresh status")

        updated = copy.deepcopy(state)
        version = state["control_version"] + 1
        extra = {}

        if kind == "register":
            if self.strategy_source is None:
                raise Invalid("Strategy registration is not available in this deployment")
            if any(
                state["modes"][m]["desired_state"] != "paused"
                or not self.fresh_pause(state, m)
                for m in MODES
            ):
                raise Conflict(
                    "Pause and reconcile both modes before registering strategies"
                )
            from src.control.packages import validate_package

            if type(body["version"]) is not int:
                raise Invalid("An explicit saved version is required")
            package = self.strategy_source(body["strategy_id"], body["version"])
            identity, _ = validate_package(package)
            for approved in state["approved_strategies"]:
                if (approved["strategy_id"], approved["version"]) == (
                    identity["strategy_id"],
                    identity["version"],
                ):
                    if approved != identity:
                        raise Conflict("Registered versions are immutable")
                    break
            else:
                if len(state["approved_strategies"]) >= 32:
                    raise Invalid(
                        "Account supports at most 32 registered versions"
                    )
                updated["approved_strategies"].append(identity)
                extra["package#" + identity["source_digest"]] = package

        elif kind == "configure":
            config = body["configuration"]
            validate_configuration(config, state["approved_strategies"])
            self.authorize(state, actor, config["modes"]["live"]["enabled"])

            if any(
                state["modes"][m]["desired_state"] != "paused"
                or not self.fresh_pause(state, m)
                for m in MODES
            ):
                raise Conflict(
                    "Both modes must acknowledge pause and reconcile orders before configuring"
                )

            revision = state["configuration_revision"] + 1
            updated.update(
                configuration=copy.deepcopy(config),
                configuration_revision=revision,
                configuration_digest=digest(config),
            )
            extra["revision#" + str(revision)] = {
                "configuration": config,
                "digest": digest(config),
            }
        else:
            action, mode = body["action"], body.get("mode")
            if action not in ("start", "resume", "stop", "stop_all") or (
                action != "stop_all" and mode not in MODES
            ):
                raise Invalid("Action requires an explicit mode")

            for m in MODES if action == "stop_all" else (mode,):
                desired = updated["modes"][m]
                if action in ("stop", "stop_all"):
                    desired.update(
                        desired_state="paused",
                        resume_incident_id=None,
                        stop_version=version,
                    )
                else:
                    config = state["configuration"]
                    if not config or not config["modes"][m]["enabled"]:
                        raise Conflict("Mode is unconfigured or disabled")

                    observed = state["observed"] or {}
                    incident = (observed.get("modes", {}).get(m) or {}).get(
                        "incident_id"
                    )

                    if (
                        not self.fresh_pause(state, m)
                        or not incident
                        or body.get("incident_id") != incident
                        or observed.get("configuration_digest")
                        != state["configuration_digest"]
                        or not self.readiness()
                        or any(
                            {
                                k: s[k]
                                for k in ("strategy_id", "version", "source_digest")
                            }
                            not in observed.get("approved_strategies", [])
                            for s in config["modes"][m]["strategies"]
                        )
                    ):
                        raise Conflict(
                            "Resume requires fresh health, applied configuration, reconciled pause and the current incident"
                        )

                    desired.update(
                        desired_state="running",
                        resume_incident_id=incident,
                        resume_version=version,
                    )

        updated.update(control_version=version, generation=state["generation"] + 1)
        result = {
            "action_id": key,
            "control_version": version,
            "configuration_revision": updated["configuration_revision"],
            "state": "pending",
        }
        extra["action#" + key] = {"fingerprint": fingerprint, "result": result}
        extra["audit#" + key] = {
            "actor": actor,
            "kind": kind,
            "body": body,
            "control_version": version,
            "timestamp": time.time(),
        }

        try:
            self.store.commit(account_id, state["generation"], updated, extra)
        except Conflict:
            existing = self.store.get(account_id, "action#" + key)
            if existing and existing["fingerprint"] == fingerprint:
                return existing["result"]
            raise

        return result

    def status(self, account_id, actor):
        state = self.account(account_id)
        self.authorize(state, actor)

        state.pop("service_secret_hash", None)
        state.pop("users", None)
        state["online"] = time.time() - (state.get("last_sync") or 0) <= self.ttl

        observed = state.get("observed") or {}
        state["pending"] = (
            not state["online"]
            or observed.get("control_version", -1) < state["control_version"]
        )

        return state

    def sync(self, account_id, secret, body):
        import hmac

        state = self.account(account_id)
        if not hmac.compare_digest(
            hashlib.sha256(secret.encode()).hexdigest(), state["service_secret_hash"]
        ):
            raise Forbidden("Invalid service credential")

        if (
            body["account_id"] != account_id
            or body["engine_instance_id"] != state["engine_instance_id"]
            or state["boot_id"] not in (None, body["boot_id"])
        ):
            raise Forbidden("Account, engine or provider boot mismatch")

        uuid(body["boot_id"])
        uuid(body["request_id"])

        if (
            body["image_digest"] != state["image_digest"]
            or (
                body["approved_strategies"] != state["approved_strategies"]
                and not (
                    self.strategy_source is not None
                    and isinstance(body["approved_strategies"], list)
                    and all(
                        item in state["approved_strategies"]
                        for item in body["approved_strategies"]
                    )
                    and len({digest(item) for item in body["approved_strategies"]})
                    == len(body["approved_strategies"])
                )
            )
            or set(body["modes"]) != set(MODES)
            or type(body["control_version"]) is not int
            or not 0 <= body["control_version"] <= state["control_version"]
        ):
            raise Invalid("Invalid sync contract or installed image")

        for status in body["modes"].values():
            uuid(status["incident_id"])

            if (
                type(status["gate_open"]) is not bool
                or type(status["reconciled"]) is not bool
                or status["state"]
                not in ("unconfigured", "paused", "running", "failed")
            ):
                raise Invalid("Invalid observed mode")

        ready = self.readiness()
        updated = copy.deepcopy(state)
        updated.update(
            boot_id=body["boot_id"],
            observed=body,
            last_sync=time.time(),
            generation=state["generation"] + 1,
        )

        self.store.commit(account_id, state["generation"], updated, {})

        result = {
            "account_id": account_id,
            "boot_id": body["boot_id"],
            "request_id": body["request_id"],
            "control_version": state["control_version"],
            "configuration_revision": state["configuration_revision"],
            "configuration_digest": state["configuration_digest"],
            "configuration": state["configuration"],
            "modes": state["modes"],
            "dashboard_ready": ready,
            "permission_ttl_seconds": self.ttl,
        }
        if self.strategy_source is not None:
            result["strategy_packages"] = {}
            for item in state["approved_strategies"]:
                package = self.store.get(account_id, "package#" + item["source_digest"])
                if package is not None:
                    result["strategy_packages"][item["source_digest"]] = package
        return result
