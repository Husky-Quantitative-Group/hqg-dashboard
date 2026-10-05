import { useCallback, useEffect, useState } from "react";
import { coreApi } from "~/api/core";

type Mode = "paper" | "live";
type Strategy = {
    strategy_id: string;
    version: number;
    source_digest: string;
    allocation?: number;
};
type Configuration = {
    modes: Record<
        Mode,
        { portfolio_id: string; enabled: boolean; strategies: Strategy[] }
    >;
};
type ObservedMode = {
    state: string;
    gate_open: boolean;
    incident_id: string;
    stop_reason: string | null;
    reconciled: boolean;
    outstanding_orders: unknown[];
    order_outcomes: unknown[];
    last_successful_cycle: number | null;
};
type Status = {
    account_id: string;
    control_version: number;
    configuration_revision: number;
    configuration_digest: string | null;
    configuration: Configuration | null;
    approved_strategies: Strategy[];
    modes: Record<Mode, { desired_state: string; stop_version: number }>;
    observed: {
        control_version: number;
        configuration_digest: string | null;
        sync_error?: string | null;
        boot_id: string;
        worker_session: string | null;
        modes: Record<Mode, ObservedMode>;
    } | null;
    online: boolean;
    pending: boolean;
    last_sync: number | null;
};
const modes: Mode[] = ["paper", "live"];

export default function EngineControl() {
    const [accountId, setAccountId] = useState(
        import.meta.env.ENGINE_ACCOUNT_ID ??
            "00000000-0000-4000-8000-000000000001",
    );
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [enableLive, setEnableLive] = useState(false);
    const [pendingRequest, setPendingRequest] = useState<{
        path: string;
        body: unknown;
        method: "post" | "put";
    } | null>(null);
    const refresh = useCallback(async () => {
        try {
            const { data } = await coreApi.get<Status>(
                `/accounts/${accountId}/status`,
            );
            setStatus(data);
        } catch (err) {
            setStatus(null);
            setError(message(err));
        }
    }, [accountId]);
    useEffect(() => {
        setStatus(null);
        setPendingRequest(null);
        void refresh();
        const timer = setInterval(refresh, 2000);
        return () => clearInterval(timer);
    }, [refresh]);

    async function send(request: NonNullable<typeof pendingRequest>) {
        setBusy(true);
        setError("");
        try {
            await coreApi.request({
                url: request.path,
                method: request.method,
                data: request.body,
            });
            setPendingRequest(null);
            await refresh();
        } catch (err) {
            // Preserve the exact key and payload after a lost response.
            setPendingRequest(request);
            setError(message(err));
        } finally {
            setBusy(false);
        }
    }
    function action(action: string, mode?: Mode) {
        if (!status) return;
        const body = {
            idempotency_key: crypto.randomUUID(),
            expected_control_version: status.control_version,
            action,
            mode,
            incident_id: mode
                ? status.observed?.modes[mode].incident_id
                : undefined,
        };
        void send({
            path: `/accounts/${accountId}/actions`,
            method: "post",
            body,
        });
    }
    function configure() {
        if (!status) return;
        const configuration: Configuration = {
            modes: Object.fromEntries(
                modes.map((mode) => [
                    mode,
                    {
                        portfolio_id:
                            status.configuration?.modes[mode].portfolio_id ??
                            crypto.randomUUID(),
                        enabled: mode === "paper" || enableLive,
                        strategies:
                            mode === "paper" || enableLive
                                ? status.approved_strategies.map(
                                      (strategy) => ({
                                          ...strategy,
                                          allocation:
                                              1 /
                                              status.approved_strategies.length,
                                      }),
                                  )
                                : [],
                    },
                ]),
            ) as Configuration["modes"],
        };
        void send({
            path: `/accounts/${accountId}/configuration`,
            method: "put",
            body: {
                idempotency_key: crypto.randomUUID(),
                expected_control_version: status.control_version,
                configuration,
            },
        });
    }
    const paused =
        status?.online &&
        modes.every(
            (mode) =>
                status.modes[mode].desired_state === "paused" &&
                status.observed?.modes[mode].gate_open === false &&
                status.observed.modes[mode].reconciled &&
                status.observed.control_version >=
                    status.modes[mode].stop_version,
        );
    const button =
        "rounded border border-slate-600 px-4 py-2 disabled:opacity-40";
    return (
        <div className="mx-auto max-w-4xl space-y-6 text-slate-100">
            <h1 className="text-2xl font-semibold">Engine control</h1>
            <label className="block">
                Account{" "}
                <input
                    className="ml-3 w-96 rounded bg-slate-900 p-2"
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                />
            </label>
            {error && (
                <p role="alert" className="text-rose-300">
                    {error}
                </p>
            )}
            {pendingRequest && (
                <div className="flex gap-3">
                    <button
                        className={button}
                        disabled={busy}
                        onClick={() => void send(pendingRequest)}
                    >
                        Retry same request
                    </button>
                    <button
                        className={button}
                        disabled={busy}
                        onClick={() => setPendingRequest(null)}
                    >
                        Discard request
                    </button>
                </div>
            )}
            {status && (
                <>
                    <p>
                        {status.online
                            ? "Engine connected"
                            : "Engine offline — execution unknown"}{" "}
                        · Control version {status.control_version} ·{" "}
                        {status.pending
                            ? "Action pending acknowledgement"
                            : "Acknowledged"}
                    </p>
                    {status.observed?.sync_error && (
                        <p className="text-rose-300">
                            Sync: {status.observed.sync_error}
                        </p>
                    )}
                    <p>
                        Configuration revision {status.configuration_revision} ·
                        Last sync{" "}
                        {status.last_sync
                            ? new Date(status.last_sync * 1000).toLocaleString()
                            : "Never"}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <label>
                            <input
                                type="checkbox"
                                checked={enableLive}
                                onChange={(event) =>
                                    setEnableLive(event.target.checked)
                                }
                            />{" "}
                            Include live mode
                        </label>
                        <button
                            className={button}
                            disabled={busy || !!pendingRequest || !paused}
                            onClick={configure}
                        >
                            Configure approved strategies
                        </button>
                        <button
                            className={`${button} border-rose-500`}
                            disabled={busy}
                            onClick={() => action("stop_all")}
                        >
                            Stop All
                        </button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        {modes.map((mode) => {
                            const observed = status.observed?.modes[mode];
                            const enabled =
                                status.configuration?.modes[mode].enabled;
                            const canResume =
                                status.online &&
                                enabled &&
                                !status.pending &&
                                observed?.gate_open === false &&
                                observed.reconciled &&
                                status.observed?.configuration_digest ===
                                    status.configuration_digest;
                            return (
                                <article
                                    key={mode}
                                    className="space-y-3 rounded border border-slate-700 p-5"
                                >
                                    <h2 className="text-xl capitalize">
                                        {mode}
                                    </h2>
                                    <p>
                                        Desired:{" "}
                                        {status.modes[mode].desired_state}
                                    </p>
                                    <p>
                                        Observed:{" "}
                                        {status.online
                                            ? (observed?.state ?? "unknown")
                                            : "offline / unknown"}
                                    </p>
                                    <p>
                                        Execution:{" "}
                                        {status.online && observed?.gate_open
                                            ? "enabled"
                                            : "blocked"}
                                    </p>
                                    <p>
                                        {!enabled
                                            ? "Mode disabled"
                                            : (observed?.stop_reason ??
                                              "Healthy")}
                                    </p>
                                    <p>
                                        Orders:{" "}
                                        {observed?.reconciled
                                            ? "reconciled"
                                            : "cleanup pending / uncertain"}
                                    </p>
                                    {!!observed?.outstanding_orders.length && (
                                        <pre className="overflow-auto text-xs">
                                            {JSON.stringify(
                                                observed.outstanding_orders,
                                                null,
                                                2,
                                            )}
                                        </pre>
                                    )}
                                    {!!observed?.order_outcomes?.length && (
                                        <details>
                                            <summary>
                                                Recent order outcomes
                                            </summary>
                                            <pre className="overflow-auto text-xs">
                                                {JSON.stringify(
                                                    observed.order_outcomes,
                                                    null,
                                                    2,
                                                )}
                                            </pre>
                                        </details>
                                    )}
                                    <p className="break-all text-xs">
                                        Incident:{" "}
                                        {observed?.incident_id ?? "Unknown"}
                                    </p>
                                    <p className="text-xs">
                                        Last cycle:{" "}
                                        {observed?.last_successful_cycle
                                            ? new Date(
                                                  observed.last_successful_cycle *
                                                      1000,
                                              ).toLocaleString()
                                            : "Never"}
                                    </p>
                                    <div className="flex gap-3">
                                        <button
                                            className={button}
                                            disabled={
                                                busy ||
                                                !!pendingRequest ||
                                                !canResume
                                            }
                                            onClick={() =>
                                                action("resume", mode)
                                            }
                                        >
                                            Start / Resume
                                        </button>
                                        <button
                                            className={button}
                                            disabled={busy}
                                            onClick={() => action("stop", mode)}
                                        >
                                            Stop
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    <p className="break-all text-xs text-slate-400">
                        Provider boot: {status.observed?.boot_id ?? "Unknown"} ·
                        Worker session:{" "}
                        {status.observed?.worker_session ?? "Unknown"}
                    </p>
                    <p className="text-sm text-slate-400">
                        Stopping blocks new orders and attempts cancellation.
                        Existing positions remain. Health recovery requires an
                        explicit Resume for each mode.
                    </p>
                </>
            )}
        </div>
    );
}
function message(error: unknown): string {
    const failure = error as {
        response?: { data?: { message?: string } };
        message?: string;
    };
    return (
        failure.response?.data?.message ??
        failure.message ??
        "Control request failed"
    );
}
