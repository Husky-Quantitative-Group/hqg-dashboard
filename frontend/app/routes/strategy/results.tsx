import { useMemo, useState } from "react";
import { getBacktestRun, gunzipJson, type BacktestRunItem } from "~/api/backtestMetrics";
import { useStrategyWorkspace } from "./layout";
import { useNavigate } from "react-router-dom";
import type { BacktestResponse } from "~/api/backtest";

const currencyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatPercent(value: number, options?: { showSign?: boolean }) {
  const percent = (value * 100).toFixed(1);
  if (options?.showSign) {
    if (value > 0) return `+${percent}%`;
    if (value < 0) return `${percent}%`;
  }
  return `${percent}%`;
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) {
    return "—";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) {
    return `${remainder}s`;
  }
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export default function StrategyResults() {
  const navigate = useNavigate();
  const {
    strategy,
    addToast,
    setLatestBacktestData,
    setLatestBacktestStrategyVersion,
    setLatestBacktestStrategyCode,
    setLastBacktestParamValues,
    setActiveBacktestSource,
    setActiveSavedRunId,
    savedBacktestRuns,
    isSavedBacktestRunsLoading,
  } = useStrategyWorkspace();
  const surface = "border border-slate-800 bg-slate-950/40";
  const mutedColor = "text-slate-400";
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const sortedRuns = useMemo(() => {
    const runs = savedBacktestRuns ?? [];
    return [...runs].sort((a, b) => new Date(b.time_created).getTime() - new Date(a.time_created).getTime());
  }, [savedBacktestRuns]);

  const openRun = async (run: BacktestRunItem) => {
    if (loadingRunId) return;
    setLoadingRunId(run.run_id);
    addToast("Loading run…", "info");

    try {
      const resp = await getBacktestRun(strategy.id, run.run_id);
      const raw = await fetch(resp.s3.download_url).then((r) => r.arrayBuffer());
      const backtest = await gunzipJson<BacktestResponse>(raw);

      setLatestBacktestData(backtest);
      setLatestBacktestStrategyVersion(resp.item.strategy_version ?? null);
      setLatestBacktestStrategyCode(null);
      setActiveBacktestSource("saved");
      setActiveSavedRunId(run.run_id);

      const params = resp.item.backtest_params;
      setLastBacktestParamValues({
        name: params?.name ?? "",
        startingEquity: params?.initial_capital !== undefined ? String(params.initial_capital) : "",
        startDate: params?.start_date ?? "",
        endDate: params?.end_date ?? "",
      });

      navigate("../backtest");
    } catch (error) {
      console.error("Failed to open saved run", error);
      addToast("Failed to open run", "warning");
    } finally {
      setLoadingRunId(null);
    }
  };

  if (!sortedRuns.length && !isSavedBacktestRunsLoading) {
    return (
      <div className={`rounded-2xl ${surface} p-12 text-center text-sm ${mutedColor}`}>
        No runs available for this strategy yet. Save a backtest to see it here.
      </div>
    );
  }

  return (
    <section className={`rounded-3xl ${surface} p-6 shadow-xl`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Results</p>
          <h1 className="text-2xl font-semibold text-white">Strategy Runs</h1>
        </div>
        <p className={`text-sm ${mutedColor}`}>Latest executions with their parameter sets and key metrics.</p>
      </header>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">ID</th>
              <th className="px-4 py-3 text-left font-medium">Run</th>
              <th className="px-4 py-3 text-left font-medium">Strategy Version</th>
              <th className="px-4 py-3 text-left font-medium">Started</th>
              <th className="px-4 py-3 text-left font-medium">Parameters</th>
              <th className="px-4 py-3 text-left font-medium">Net PnL</th>
              <th className="px-4 py-3 text-left font-medium">Sharpe</th>
              <th className="px-4 py-3 text-left font-medium">Win Rate</th>
              <th className="px-4 py-3 text-left font-medium">Drawdown</th>
              <th className="px-4 py-3 text-left font-medium">Trades</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 text-slate-200">
            {isSavedBacktestRunsLoading ? (
              <tr>
                <td className="px-4 py-6 text-sm text-slate-400" colSpan={10}>
                  Loading…
                </td>
              </tr>
            ) : null}

            {sortedRuns.map((run) => {
              const pnl = run.net_pnl ?? 0;
              const pnlClass = pnl >= 0 ? "text-emerald-400" : "text-rose-400";
              const name = run.backtest_params?.name ?? "Untitled";
              const start = run.backtest_params?.start_date ?? "—";
              const end = run.backtest_params?.end_date ?? "—";
              const equity = run.backtest_params?.initial_capital ?? 0;
              const drawdown = typeof run.max_drawdown === "number" ? -run.max_drawdown : null;
              return (
                <tr
                  key={run.run_id}
                  className="cursor-pointer transition hover:bg-slate-900/30"
                  onClick={() => void openRun(run)}
                  aria-busy={loadingRunId === run.run_id}
                >
                  <td className="px-4 py-4 align-top font-mono text-slate-300">{run.run_id.slice(0, 10)}</td>
                  <td className="px-4 py-4 align-top font-semibold text-white">{name}</td>
                  <td className="px-4 py-4 align-top text-slate-200">{run.strategy_version ?? "—"}</td>
                  <td className="px-4 py-4 align-top text-sm text-slate-300">
                    <div>{dateFormatter.format(new Date(run.time_created))}</div>
                    <div className="text-xs text-slate-500">{formatDuration()}</div>
                  </td>
                  <td className="px-4 py-4 align-top text-xs text-slate-300">
                    <div>
                      <span className="text-slate-500">Name:</span> {name}
                    </div>
                    <div>
                      <span className="text-slate-500">Start:</span> {start}
                    </div>
                    <div>
                      <span className="text-slate-500">End:</span> {end}
                    </div>
                    <div>
                      <span className="text-slate-500">Equity:</span> {currencyFormatter.format(equity)}
                    </div>
                  </td>
                  <td className={`px-4 py-4 align-top font-mono ${pnlClass}`}>
                    {currencyFormatter.format(pnl)}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-white">
                    {typeof run.sharpe === "number" ? run.sharpe.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-emerald-300">
                    {typeof run.win_rate === "number" ? formatPercent(run.win_rate) : "—"}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-rose-300">
                    {drawdown === null ? "—" : formatPercent(drawdown)}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-slate-200">
                    {typeof run.trades_count === "number" ? run.trades_count : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
