import { useMemo } from "react";
import { useStrategyWorkspace } from "./layout";

type StatusKey = "passed" | "failed" | "running";

const STATUS_STYLES: Record<StatusKey, { text: string; bg: string; border: string }> = {
  passed: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  failed: {
    text: "text-rose-500",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
  running: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

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
  const { runs, selectedRunId, selectRun } = useStrategyWorkspace();
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0], [runs, selectedRunId]);

  const surface = "border border-slate-800 bg-slate-950/40";
  const mutedColor = "text-slate-400";
  const headingColor = "text-slate-100";
  const listTitleColor = headingColor;
  const listSecondaryColor = "text-slate-300";
  const listValueColor = "text-slate-100";
  const winColor = "text-slate-200";
  const listActive = "border-fuchsia-500/60 bg-fuchsia-500/10";
  const listIdle = "border-slate-700/60 bg-slate-900/30";
  const listHover = "hover:border-fuchsia-500/50 hover:bg-slate-900/40";
  const logItemSurface = "border-slate-800/50 bg-slate-900/40 text-slate-200";
  const chartSurface = "border border-slate-800 bg-slate-950/40";
  const pnlColor = "text-emerald-300";
  const drawdownColor = "text-rose-300";
  const equityAccent = "#c084fc";
  const drawdownAccent = "#fb923c";

  if (!runs.length) {
    return (
      <div className={`rounded-2xl ${surface} p-12 text-center text-sm ${mutedColor}`}>
        No runs available for this strategy yet. Trigger a run to populate stats.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className={`rounded-2xl ${surface} p-5`}>
        <h3 className="text-base font-semibold">Recent runs</h3>
        <p className={`text-xs ${mutedColor}`}>Select a run to inspect metrics, logs, and charts.</p>
        <div className="mt-4 flex flex-col gap-3">
          {runs.map((run) => {
            const styles = STATUS_STYLES[run.status];
            const isActive = run.id === selectedRun?.id;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => selectRun(run.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isActive ? listActive : `${listIdle} ${listHover}`
                }`}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className={`font-semibold ${listTitleColor}`}>{run.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${styles.text} ${styles.bg} ${styles.border}`}>
                    {run.status}
                  </span>
                </div>
                <div className={`mt-1 text-xs ${listSecondaryColor}`}>
                  {dateFormatter.format(new Date(run.startedAt))} · {formatDuration(run.durationSeconds)}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <span className={`font-mono ${listValueColor}`}>{currencyFormatter.format(run.metrics.netPnl)}</span>
                  <span className={winColor}>Win {formatPercent(run.metrics.winRate, { showSign: true })}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="space-y-6">
        {selectedRun && (
          <article className={`rounded-2xl ${surface} p-6`}>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-xs uppercase tracking-[0.3em] ${mutedColor}`}>Selected run</p>
                <h2 className={`text-2xl font-semibold ${headingColor}`}>{selectedRun.label}</h2>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
                STATUS_STYLES[selectedRun.status].text
              } ${STATUS_STYLES[selectedRun.status].bg} ${STATUS_STYLES[selectedRun.status].border}`}>
                {selectedRun.status}
              </span>
            </header>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className={`text-xs ${mutedColor}`}>Started</div>
                <div className={`text-sm font-semibold ${headingColor}`}>
                  {dateFormatter.format(new Date(selectedRun.startedAt))}
                </div>
              </div>
              <div>
                <div className={`text-xs ${mutedColor}`}>Duration</div>
                <div className={`text-sm font-semibold ${headingColor}`}>{formatDuration(selectedRun.durationSeconds)}</div>
              </div>
            </div>

            <p className={`mt-4 text-sm leading-relaxed ${mutedColor}`}>{selectedRun.summary}</p>
          </article>
        )}

        {selectedRun && (
          <div className="grid gap-4 lg:grid-cols-2">
            <article className={`rounded-2xl ${surface} p-5`}>
              <h3 className="text-base font-semibold">Run metrics</h3>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className={mutedColor}>Net PnL</dt>
                  <dd className={`font-mono text-lg ${pnlColor}`}>{currencyFormatter.format(selectedRun.metrics.netPnl)}</dd>
                </div>
                <div>
                  <dt className={mutedColor}>Sharpe</dt>
                  <dd className={`text-lg font-semibold ${headingColor}`}>{selectedRun.metrics.sharpe.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className={mutedColor}>Win rate</dt>
                  <dd className={`text-lg font-semibold ${headingColor}`}>
                    {formatPercent(selectedRun.metrics.winRate, { showSign: true })}
                  </dd>
                </div>
                <div>
                  <dt className={mutedColor}>Max drawdown</dt>
                  <dd className={`text-lg font-semibold ${drawdownColor}`}>
                    {formatPercent(-selectedRun.metrics.maxDrawdown, { showSign: true })}
                  </dd>
                </div>
                <div>
                  <dt className={mutedColor}>Trades</dt>
                  <dd className={`text-lg font-semibold ${headingColor}`}>{selectedRun.metrics.trades}</dd>
                </div>
              </dl>
            </article>

            <article className={`rounded-2xl ${surface} p-5`}>
              <h3 className="text-base font-semibold">Logs</h3>
              <ul className="mt-4 space-y-2 text-sm">
                {selectedRun.logs.map((log, index) => (
                  <li key={`${log}-${index}`} className={`rounded-xl border px-3 py-2 ${logItemSurface}`}>
                    {log}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        )}

        {selectedRun && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Equity curve"
              data={selectedRun.equityCurve}
              accent={equityAccent}
              subtitle="Mark-to-market"
              surfaceClass={chartSurface}
              mutedColor={mutedColor}
              direction="up"
            />
            <ChartCard
              title="Drawdown"
              data={selectedRun.drawdown}
              accent={drawdownAccent}
              subtitle="% from peak"
              surfaceClass={chartSurface}
              mutedColor={mutedColor}
              direction="down"
            />
          </div>
        )}
      </section>
    </div>
  );
}

type ChartCardProps = {
  title: string;
  data: number[];
  accent: string;
  subtitle: string;
  surfaceClass: string;
  mutedColor: string;
  direction: "up" | "down";
};

function ChartCard({ title, data, accent, subtitle, surfaceClass, mutedColor, direction }: ChartCardProps) {
  if (!data.length) {
    return (
      <article className={`rounded-2xl ${surfaceClass} p-5`}>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className={`text-xs ${mutedColor} mt-2`}>No data for this run.</p>
      </article>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, 1);
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className={`rounded-2xl ${surfaceClass} p-5`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className={`text-xs ${mutedColor}`}>{subtitle}</p>
        </div>
        <span className="text-sm font-mono text-slate-500">{direction === "up" ? "↗" : "↘"}</span>
      </div>
      <svg viewBox="0 0 100 40" className="mt-4 h-32 w-full" preserveAspectRatio="none" role="img" aria-label={`${title} chart`}>
        <polyline fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points} />
      </svg>
    </article>
  );
}
