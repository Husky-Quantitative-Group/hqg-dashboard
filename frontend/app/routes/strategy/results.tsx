import { useStrategyWorkspace } from "./layout";

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

function formatDuration(seconds: number) {
  if (!seconds && seconds !== 0) {
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
  const { runs } = useStrategyWorkspace();
  const surface = "border border-slate-800 bg-slate-950/40";
  const mutedColor = "text-slate-400";
  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  if (!sortedRuns.length) {
    return (
      <div className={`rounded-2xl ${surface} p-12 text-center text-sm ${mutedColor}`}>
        No runs available for this strategy yet. Trigger a run to populate stats.
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
            {sortedRuns.map((run) => {
              const pnlClass = run.metrics.netPnl >= 0 ? "text-emerald-400" : "text-rose-400";
              return (
                <tr key={run.name}>
                  <td className="px-4 py-4 align-top font-mono text-slate-300">{run.id}</td>
                  <td className="px-4 py-4 align-top font-semibold text-white">{run.parameterName}</td>
                  <td className="px-4 py-4 align-top text-slate-200">{run.strategyVersion}</td>
                  <td className="px-4 py-4 align-top text-sm text-slate-300">
                    <div>{dateFormatter.format(new Date(run.startedAt))}</div>
                    <div className="text-xs text-slate-500">{formatDuration(run.durationSeconds)}</div>
                  </td>
                  <td className="px-4 py-4 align-top text-xs text-slate-300">
                    <div>
                      <span className="text-slate-500">Name:</span> {run.parameterName}
                    </div>
                    <div>
                      <span className="text-slate-500">Start:</span> {run.parameterStartDate}
                    </div>
                    <div>
                      <span className="text-slate-500">End:</span> {run.parameterEndDate}
                    </div>
                    <div>
                      <span className="text-slate-500">Equity:</span> {currencyFormatter.format(run.startingEquity)}
                    </div>
                  </td>
                  <td className={`px-4 py-4 align-top font-mono ${pnlClass}`}>
                    {currencyFormatter.format(run.metrics.netPnl)}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-white">{run.metrics.sharpe.toFixed(2)}</td>
                  <td className="px-4 py-4 align-top font-semibold text-emerald-300">
                    {formatPercent(run.metrics.winRate)}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-rose-300">
                    {formatPercent(-run.metrics.maxDrawdown)}
                  </td>
                  <td className="px-4 py-4 align-top font-semibold text-slate-200">{run.metrics.trades}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
