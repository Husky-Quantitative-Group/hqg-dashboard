import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
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
    setLatestBacktestLogs,
    setLatestBacktestStrategyVersion,
    setLatestBacktestStrategyCode,
    setLastBacktestParamValues,
    setActiveBacktestSource,
    setActiveSavedRunId,
    savedBacktestRuns,
    isSavedBacktestRunsLoading,
  } = useStrategyWorkspace();
  const [entriesCount, setEntriesCount] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  const sortedRuns = useMemo(() => {
    const runs = savedBacktestRuns ?? [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    
    const filtered = normalizedSearch
      ? runs.filter((run) => (run.name ?? "").toLowerCase().includes(normalizedSearch))
      : runs;
    
    return [...filtered].sort((a, b) => new Date(b.time_created).getTime() - new Date(a.time_created).getTime());
  }, [savedBacktestRuns, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / entriesCount));
  const startIdx = (currentPage - 1) * entriesCount;
  const endIdx = Math.min(startIdx + entriesCount, sortedRuns.length);
  const paginatedRuns = sortedRuns.slice(startIdx, endIdx);
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, entriesCount]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handlePageChange = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    setCurrentPage(nextPage);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) handlePageChange(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) handlePageChange(currentPage + 1);
  };

  const handlePageJump = () => {
    const pageNum = Number.parseInt(pageInput, 10);
    if (!Number.isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      handlePageChange(pageNum);
      setPageInput(String(pageNum));
      return;
    }
    setPageInput(String(currentPage));
  };

  const handlePageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handlePageJump();
    } else if (event.key === "Escape") {
      setPageInput(String(currentPage));
    }
  };

  const openRun = async (run: BacktestRunItem) => {
    if (loadingRunId) return;
    setLoadingRunId(run.run_id);
    addToast("Loading run…", "info");

    try {
      const resp = await getBacktestRun(strategy.id, run.run_id);
      const raw = await fetch(resp.s3.download_url).then((r) => r.arrayBuffer());
      const backtest = await gunzipJson<BacktestResponse>(raw);

      setLatestBacktestData(backtest);
      setLatestBacktestLogs([]);
      setLatestBacktestStrategyVersion(resp.item.strategy_version ?? null);
      setLatestBacktestStrategyCode(null);
      setActiveBacktestSource("saved");
      setActiveSavedRunId(run.run_id);

      const params = resp.item.backtest_params;
      setLastBacktestParamValues({
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

  return (
    <section className="glass-card ghost-border light-catch rounded-xl overflow-hidden w-full flex flex-col min-h-[600px]">
      <div className="flex justify-between items-center bg-[#181818]/60 border-b border-white/5 px-6 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-on-surface tracking-wide uppercase">Backtest Results</h3>
          <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary-fixed-dim text-[10px] font-bold border border-secondary/20">
            Showing {sortedRuns.length === 0 ? 0 : startIdx + 1}-{endIdx} of {sortedRuns.length}
          </span>
        </div>
        <div className="flex items-center bg-surface-container-highest/50 border border-outline-variant/30 rounded-lg px-3 py-1">
          <svg
            className="text-on-surface-variant text-lg mr-2 w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            className="bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-xs text-on-surface placeholder-on-surface-variant/90 w-48 py-1"
            placeholder="Search backtests..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      <div className="table-wrapper no-scrollbar">
        <table className="table-container min-w-[1180px]">
          <colgroup>
            <col className="w-[220px]" />
            <col className="w-[100px]" />
            <col className="w-[150px]" />
            <col className="w-[220px]" />
            <col className="w-[82px]" />
            <col className="w-[82px]" />
            <col className="w-[82px]" />
            <col className="w-[82px]" />
            <col className="w-[82px]" />
            <col className="w-[70px]" />
          </colgroup>
          <thead className="table-header">
            <tr>
              <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Name</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Version</th>
              <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Started</th>
              <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Parameters</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">CAGR</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Sharpe</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Drawdown</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Volatility</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">VAR (95%)</th>
              <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-[0.05em] text-[#9caec2]">Beta</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {isSavedBacktestRunsLoading ? (
              <tr>
                <td className="px-4 py-3 text-sm text-on-surface-variant" colSpan={10}>
                  Loading…
                </td>
              </tr>
            ) : null}

            {sortedRuns.length === 0 && !isSavedBacktestRunsLoading ? (
              <tr>
                <td className="px-4 py-3 text-sm text-on-surface-variant text-center" colSpan={10}>
                  {searchTerm ? "No backtests match your search." : "No runs available for this strategy yet. Save a backtest to see it here."}
                </td>
              </tr>
            ) : null}

            {paginatedRuns.map((run, index) => {
              const name = run.name ?? "—";
              const start = run.backtest_params?.start_date ?? "—";
              const end = run.backtest_params?.end_date ?? "—";
              const equity = run.backtest_params?.initial_capital ?? 0;
              const annualizedReturn = typeof run.annualized_return === "number" ? run.annualized_return : null;
              const drawdown = typeof run.max_drawdown === "number" ? run.max_drawdown : null;

              return (
                <tr
                  key={run.run_id}
                  className={`table-row-striped table-row-hover cursor-pointer ${
                    index % 2 === 0 ? "table-row-even" : "table-row-odd"
                  }`}
                  onClick={() => void openRun(run)}
                  aria-busy={loadingRunId === run.run_id}
                >
                  <td className="px-4 py-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-on-surface">{name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-xs font-mono text-primary-dim bg-primary/5 px-2 py-0.5 rounded border border-primary/20">
                      {run.strategy_version ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-on-surface">
                      {dateFormatter.format(new Date(run.time_created))}
                      <span className="text-on-surface-variant/70 ml-1">{formatDuration()}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
                        <span className="w-9">Start:</span>
                        <span className="text-on-surface font-medium">{start}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/80">
                        <span className="w-9">End:</span>
                        <span className="text-on-surface font-medium opacity-85">{end}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/80">
                        <span className="w-9">Equity:</span>
                        <span className="text-on-surface font-medium opacity-85">{currencyFormatter.format(equity)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-sm font-bold ${annualizedReturn && annualizedReturn > 0 ? "text-emerald-400" : "text-error"}`}>
                      {annualizedReturn !== null ? formatPercent(annualizedReturn, { showSign: true }) : <span className="text-on-surface-variant/50">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-on-surface">
                    {typeof run.sharpe === "number" ? run.sharpe.toFixed(2) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-error-dim">
                    {drawdown !== null ? formatPercent(drawdown) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-on-surface">
                    {typeof run.ann_vol === "number" ? formatPercent(run.ann_vol) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-on-surface">
                    {typeof run.var_95 === "number" ? formatPercent(run.var_95) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-on-surface">
                    {typeof run.beta === "number" ? run.beta.toFixed(2) : <span className="text-on-surface-variant/50">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 border-t border-white/5 flex justify-between items-center bg-[#0a0a0a]/20 gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-widest font-bold">
            Show
          </span>
          <select
            value={entriesCount}
            onChange={(event) => setEntriesCount(Number(event.target.value))}
            className="px-2 py-1 bg-surface-container-highest/50 border border-outline-variant/30 rounded text-[10px] text-on-surface cursor-pointer hover:bg-surface-container-highest transition-colors focus:outline-none focus:ring-0"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-widest font-bold">
            entries
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="px-2 py-1 rounded border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-bold uppercase"
            >
              ← Prev
            </button>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-on-surface-variant/70 font-bold">Page</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={handlePageJump}
                onKeyDown={handlePageInputKeyDown}
                className="w-10 px-1 py-1 bg-surface-container-highest/50 border border-outline-variant/30 rounded text-[10px] text-on-surface text-center focus:outline-none focus:ring-1 focus:ring-secondary/50"
                style={{
                  MozAppearance: "textfield",
                  appearance: "textfield",
                }}
              />
              <style>{`
                input[type="number"]::-webkit-outer-spin-button,
                input[type="number"]::-webkit-inner-spin-button {
                  -webkit-appearance: none;
                  margin: 0;
                }
              `}</style>
              <span className="text-[10px] text-on-surface-variant/70 font-bold">
                of {totalPages}
              </span>
            </div>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages}
              className="px-2 py-1 rounded border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-bold uppercase"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
