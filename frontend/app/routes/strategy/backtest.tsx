import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import {
  submitBacktest,
  getBacktestJob,
  type BacktestCandle,
  type BacktestOrder,
  type BacktestResponse,
  type Metrics,
} from "~/api/backtest";
import { finalizeBacktestRun, gzipJson, presignBacktestRunUpload, uploadPresignedPost } from "~/api/backtestMetrics";
import { useStrategyWorkspace } from "./layout";

type BacktestParameter = {
  id: string;
  label: string;
  value: string;
  type: "text" | "currency" | "date";
  prefix?: string;
};

type BacktestMetric = {
  id: string;
  label: string;
  value: string;
  column: "left" | "right";
};

type EquityStat = {
  id: string;
  label: string;
  value: string;
  accentClass: string;
};

type EquityCandle = CandlestickData;
type EquityLinePoint = {
  time: number;
  equity: number;
};
type AllocationPoint = {
  time: number;
  [symbol: string]: number;
};
type EquityChartType = "candles" | "line";
type EquityChartRange = "1D" | "1W" | "1M" | "1Y" | "5Y" | "ALL";

type RunParameterState = Record<string, string>;

type BacktestParametersProps = {
  parameters: BacktestParameter[];
  isRunning: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  onRun: (values: RunParameterState) => void;
  onSave: () => void;
  isSaving: boolean;
  isSaveDisabled: boolean;
  saveDisabledReason?: string;
  showSaveButton: boolean;
  isViewingSaved: boolean;
};

type BacktestMetricsProps = {
  metrics: BacktestMetric[];
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

type StrategyEquityChartProps = {
  stats: EquityStat[];
  candles: EquityCandle[];
  orders: BacktestOrder[];
  startingEquity: number;
  isWriteForbidden: boolean;
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

type BacktestOrdersTableProps = {
  orders: BacktestOrder[];
  logs: string[];
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

type ExecutionPanelTab = "orders" | "logs" | "warnings";

const DEFAULT_EXECUTION_LOG_PAGE_SIZE = 10;
const EXECUTION_LOG_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const ALLOCATION_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#f59e0b",
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const chartAxisFontFamily =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const chartAxisFontSize = 12;

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function StrategyBacktest() {
  const {
    strategy,
    entrypoint,
    addToast,
    isSaving: isWorkspaceSaving,
    latestBacktestData,
    setLatestBacktestData,
    latestBacktestLogs,
    setLatestBacktestLogs,
    setLatestBacktestStrategyVersion,
    latestBacktestStrategyCode,
    setLatestBacktestStrategyCode,
    savedEntrypointContent,
    lastBacktestParamValues,
    setLastBacktestParamValues,
    savedBacktestRuns,
    refreshSavedBacktestRuns,
    activeBacktestSource,
    setActiveBacktestSource,
    setActiveSavedRunId,
    isWriteForbidden,
  } = useStrategyWorkspace();
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isSavingBacktest, setIsSavingBacktest] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) clearInterval(pollIntervalRef.current);
    };
  }, []);
  const backtestData = latestBacktestData;
  const currentEntrypointContent = typeof entrypoint?.content === "string" ? entrypoint.content : null;
  const lastRunParameters = useMemo(
    () =>
      DEFAULT_PARAMETERS.map((param) => ({
        ...param,
        value: (lastBacktestParamValues[param.id] ?? "").trim() || param.value,
      })),
    [lastBacktestParamValues]
  );

  const handleRunBacktest = async (values: RunParameterState) => {
    if (isRunningBacktest) return;
    if (isWorkspaceSaving) {
      addToast("Please wait for your strategy changes to finish saving before running a backtest.", "info");
      return;
    }

    const strategyCode = entrypoint?.content ?? "";
    if (!strategyCode.trim()) {
      addToast("Entrypoint file is empty. Open the file to load its contents before running.", "warning");
      return;
    }

    const parsedStartingEquity = Number.parseFloat((values.startingEquity ?? "").replace(/,/g, ""));
    const initialCapital = Number.isFinite(parsedStartingEquity) ? parsedStartingEquity : 0;

    setIsRunningBacktest(true);
    setActiveBacktestSource("live");
    setActiveSavedRunId(null);
    setLatestBacktestData(null);
    setLatestBacktestLogs([]);
    setLatestBacktestStrategyCode(strategyCode);
    setLatestBacktestStrategyVersion(
      savedEntrypointContent !== null && strategyCode === savedEntrypointContent ? strategy.current_version ?? null : null
    );
    addToast("Queued backtest", "info");
    setLastBacktestParamValues(values);

    try {
      const jobId = await submitBacktest({
        strategy_code: strategyCode,
        start_date: values.startDate,
        end_date: values.endDate,
        initial_capital: initialCapital,
      });

      const POLL_INTERVAL_MS = 2000;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const job = await getBacktestJob(jobId);
          if (job.status === "COMPLETED") {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setLatestBacktestData(job.result!);
            setLatestBacktestLogs(job.logs ?? []);
            setIsRunningBacktest(false);
            addToast("Backtest finished", "success");
            console.log("[Backtest] Completed:", job);
          } else if (job.status === "FAILED" || job.status === "CANCELLED") {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setLatestBacktestData(null);
            setLatestBacktestLogs(job.logs ?? []);
            setLatestBacktestStrategyVersion(null);
            setLatestBacktestStrategyCode(null);
            setIsRunningBacktest(false);
            addToast("Backtest failed", "warning");
            console.error("[Backtest] Job failed:", job.error ?? "(no error details)", job);
          }
          // PENDING / RUNNING → keep polling
        } catch (pollError) {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setLatestBacktestData(null);
          setLatestBacktestLogs([]);
          setLatestBacktestStrategyVersion(null);
          setLatestBacktestStrategyCode(null);
          setIsRunningBacktest(false);
          addToast("Backtest failed", "warning");
          console.error("[Backtest] Polling error:", pollError);
        }
      }, POLL_INTERVAL_MS);
    } catch (submitError) {
      setLatestBacktestData(null);
      setLatestBacktestLogs([]);
      setLatestBacktestStrategyVersion(null);
      setLatestBacktestStrategyCode(null);
      setIsRunningBacktest(false);
      addToast("Backtest failed", "warning");
      console.error("[Backtest] Submission error:", submitError);
    }
  };


  const handleSaveResults = async () => {
    if (isSavingBacktest) return;
    if (isWriteForbidden) {
      addToast("You do not have write access to save results.", "warning");
      return;
    }
    if (!backtestData) {
      addToast("Run a backtest before saving.", "warning");
      return;
    }
    if (activeBacktestSource === "saved") {
      addToast("This is an existing saved run. Run a new backtest to save again.", "info");
      return;
    }
    if (!latestBacktestStrategyCode) {
      addToast("Code snapshot missing for this run. Please run the backtest again.", "warning");
      return;
    }
    if (!currentEntrypointContent || latestBacktestStrategyCode !== currentEntrypointContent) {
      addToast("Save blocked: strategy code has changed since this backtest ran. Re-run backtest to save results.", "warning");
      return;
    }
    if (!savedEntrypointContent || latestBacktestStrategyCode !== savedEntrypointContent) {
      addToast(
        "Save blocked: save a strategy version with the exact code used for this backtest before saving results.",
        "warning"
      );
      return;
    }
    if (strategy.current_version === null || strategy.current_version === undefined) {
      addToast("Save blocked: strategy version is unavailable. Save strategy code and try again.", "warning");
      return;
    }

    const responseInitialCapital = backtestData.parameters?.starting_equity;
    const fallbackInitialCapital = Number.parseFloat((lastBacktestParamValues.startingEquity ?? "0").replace(/,/g, ""));
    const initialCapital = Number.isFinite(responseInitialCapital) ? responseInitialCapital : fallbackInitialCapital;
    const normalizedInitialCapital = Number.isFinite(initialCapital) ? initialCapital : 0;
    const startDate = normalizeDateValue(lastBacktestParamValues.startDate ?? backtestData.parameters?.start_date);
    const endDate = normalizeDateValue(lastBacktestParamValues.endDate ?? backtestData.parameters?.end_date);

    setIsSavingBacktest(true);
    addToast("Preparing upload…", "info");

    try {
      const presign = await presignBacktestRunUpload(strategy.id);

      const gz = await gzipJson(backtestData);

      await uploadPresignedPost(presign.s3.upload, gz, "run.json.gz");

      const finalizePayload: Parameters<typeof finalizeBacktestRun>[1] = {
        run_id: presign.run_id,
        s3_key: presign.s3.key,
        backtest_params: {
          start_date: startDate,
          end_date: endDate,
          initial_capital: normalizedInitialCapital,
        },
      };

      finalizePayload.strategy_version = strategy.current_version;

      await finalizeBacktestRun(strategy.id, finalizePayload);

      await refreshSavedBacktestRuns();
      setActiveBacktestSource("saved");
      setActiveSavedRunId(presign.run_id);
      addToast(`Saved run ${presign.run_id}`, "success");
    } catch (error) {
      console.error("Failed to save backtest run", error);
      addToast("Save failed", "warning");
    } finally {
      setIsSavingBacktest(false);
    }
  };

  const showPlaceholder = !backtestData || isRunningBacktest;
  const animatePlaceholder = isRunningBacktest;
  const saveDisabledReason = useMemo(() => {
    if (!backtestData) {
      return "Run a backtest before saving.";
    }
    if (activeBacktestSource === "saved") {
      return "This run is already saved.";
    }
    if (!latestBacktestStrategyCode) {
      return "Run a new backtest to capture the strategy code snapshot.";
    }
    if (!currentEntrypointContent || latestBacktestStrategyCode !== currentEntrypointContent) {
      return "Strategy code changed after this run. Re-run backtest before saving results.";
    }
    if (!savedEntrypointContent || latestBacktestStrategyCode !== savedEntrypointContent) {
      return "Save a strategy version with this exact code before saving results.";
    }
    if (strategy.current_version === null || strategy.current_version === undefined) {
      return "Save a strategy version before saving results.";
    }
    const responseInitialCapital = backtestData.parameters?.starting_equity;
    const fallbackInitialCapital = Number.parseFloat((lastBacktestParamValues.startingEquity ?? "0").replace(/,/g, ""));
    const initialCapital = Number.isFinite(responseInitialCapital) ? responseInitialCapital : fallbackInitialCapital;
    const normalizedInitialCapital = Number.isFinite(initialCapital) ? initialCapital : 0;
    const startDate = normalizeDateValue(lastBacktestParamValues.startDate ?? backtestData.parameters?.start_date);
    const endDate = normalizeDateValue(lastBacktestParamValues.endDate ?? backtestData.parameters?.end_date);
    const strategyVersionKey = String(strategy.current_version);
    const duplicateRun = savedBacktestRuns.find((run) => {
      if (String(run.strategy_version ?? "") !== strategyVersionKey) return false;
      const params = run.backtest_params;
      if (!params) return false;
      const runInitialCapital = toFiniteNumber(params.initial_capital);
      return (
        normalizeDateValue(params.start_date) === startDate &&
        normalizeDateValue(params.end_date) === endDate &&
        runInitialCapital !== null &&
        runInitialCapital === normalizedInitialCapital
      );
    });
    if (duplicateRun) {
      return `Duplicate saved run exists (${duplicateRun.run_id.slice(0, 10)}).`;
    }
    return undefined;
  }, [
    activeBacktestSource,
    backtestData,
    currentEntrypointContent,
    lastBacktestParamValues.endDate,
    lastBacktestParamValues.startDate,
    lastBacktestParamValues.startingEquity,
    latestBacktestStrategyCode,
    savedBacktestRuns,
    savedEntrypointContent,
    strategy.current_version,
  ]);
  const isSaveDisabled = showPlaceholder || isSavingBacktest || !!saveDisabledReason;
  const skeletonBaseColor = "#111a26";
  const skeletonHighlightColor = animatePlaceholder ? "#1d2a3f" : skeletonBaseColor;

  const metrics = useMemo(() => buildMetrics(backtestData?.metrics), [backtestData]);
  const candles = useMemo(() => buildCandles(backtestData?.candles), [backtestData]);
  const orders = useMemo(() => buildOrders(backtestData?.orders), [backtestData]);
  const equityStats = useMemo(() => buildEquityStats(backtestData), [backtestData]);
  const chartStartingEquity = useMemo(() => {
    const responseEquity = backtestData?.parameters?.starting_equity;
    if (typeof responseEquity === "number" && Number.isFinite(responseEquity)) {
      return responseEquity;
    }
    const parsed = Number.parseFloat((lastBacktestParamValues.startingEquity ?? "0").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }, [backtestData, lastBacktestParamValues.startingEquity]);

  return (
    <SkeletonTheme baseColor={skeletonBaseColor} highlightColor={skeletonHighlightColor}>
      <div className="space-y-3">
        <div className="grid gap-6 xl:grid-cols-[294px_minmax(0,1fr)]">
          <div className="max-w-[294px] space-y-4">
            <BacktestParameters
              parameters={lastRunParameters}
              isRunning={isRunningBacktest}
              isDisabled={isRunningBacktest || isWorkspaceSaving}
              disabledReason={isWorkspaceSaving ? "Saving changes…" : undefined}
              onRun={handleRunBacktest}
              onSave={handleSaveResults}
              isSaving={isSavingBacktest}
              isSaveDisabled={isSaveDisabled}
              saveDisabledReason={saveDisabledReason}
              showSaveButton={isRunningBacktest || !!backtestData}
              isViewingSaved={activeBacktestSource === "saved"}
            />
            <BacktestMetrics metrics={metrics} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
          </div>

          <div className="min-h-full">
            <StrategyEquityChart
              stats={equityStats}
              candles={candles}
              orders={orders}
              startingEquity={chartStartingEquity}
              isWriteForbidden={isWriteForbidden}
              showPlaceholder={showPlaceholder}
              animatePlaceholder={animatePlaceholder}
            />
          </div>
        </div>

        <BacktestOrdersTable orders={orders} logs={latestBacktestLogs} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
      </div>
    </SkeletonTheme>
  );
}

function BacktestParameters({
  parameters,
  isRunning,
  isDisabled,
  disabledReason,
  onRun,
  onSave,
  isSaving,
  isSaveDisabled,
  saveDisabledReason,
  showSaveButton,
  isViewingSaved,
}: BacktestParametersProps) {
  const [formState, setFormState] = useState<RunParameterState>(() =>
    parameters.reduce<RunParameterState>((acc, param) => {
      acc[param.id] = param.value;
      return acc;
    }, {})
  );

  useEffect(() => {
    setFormState(
      parameters.reduce<RunParameterState>((acc, param) => {
        acc[param.id] = param.value;
        return acc;
      }, {})
    );
  }, [parameters]);

  const updateField = (id: string, value: string) => {
    setFormState((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRun(formState);
  };

  return (
    <article className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-4 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-200/80">Parameters</p>
        <span className="material-symbols-outlined text-sm text-slate-400">settings_input_component</span>
      </header>
      <form onSubmit={handleSubmit} className="grid gap-4 p-5 md:grid-cols-2">
        {parameters.map((param) => (
          <div key={param.id} className={`space-y-2 ${param.id === "startingEquity" ? "md:col-span-2" : ""}`}>
            <label
              htmlFor={param.id}
              className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400"
            >
              {param.label}
            </label>
            <div className="relative">
              {param.prefix ? (
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-slate-400">
                  {param.prefix}
                </span>
              ) : null}
              {param.type === "date" ? (
                <span className="pointer-events-none absolute inset-y-0 right-2 bottom-0.5 flex items-center text-slate-400/80">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-[19px] w-[19px]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
                    <path d="M7.5 3.5v4" />
                    <path d="M16.5 3.5v4" />
                    <path d="M3.5 9.5h17" />
                  </svg>
                </span>
              ) : null}
              <input
                id={param.id}
                name={param.id}
                type={param.type === "date" ? "date" : "text"}
                value={formState[param.id] ?? ""}
                onChange={(event) => updateField(param.id, event.target.value)}
                style={param.type === "date" ? { colorScheme: "dark" } : undefined}
                className={`h-10 w-full rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-3 ${param.type === "date" ? "text-xs" : "text-sm"} text-slate-100 outline-none transition focus:border-violet-400 focus:ring-0 ${
                  param.type === "date"
                    ? "pr-8 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:w-4 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                    : ""
                } ${
                  param.prefix ? "pl-7" : ""
                }`}
              />
            </div>
          </div>
        ))}
        <div className="pt-1 md:col-span-2">
          {!showSaveButton ? (
            <div className="min-w-0">
              <button
                type="submit"
                className={`flex w-full items-center justify-center gap-1.5 rounded px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-fixed ${
                  isDisabled
                    ? "cursor-not-allowed bg-slate-700 text-slate-300"
                    : "bg-secondary-fixed text-on-secondary-fixed shadow-[0_0_20px_rgba(199,210,254,0.2)] hover:brightness-110"
                }`}
                disabled={isDisabled}
              >
                <span className="material-symbols-outlined text-base">bolt</span>
                {isRunning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Running
                  </span>
                ) : (
                  "Run"
                )}
              </button>
            </div>
          ) : (
            <div
              className="grid items-start gap-3 transition-[grid-template-columns] duration-300 ease-out"
              style={{ gridTemplateColumns: "1fr 1fr" }}
            >
              <div className="min-w-0">
                <button
                  type="submit"
                  className={`flex w-full items-center justify-center gap-1.5 rounded px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-fixed ${
                    isDisabled
                      ? "cursor-not-allowed bg-slate-700 text-slate-300"
                      : "bg-secondary-fixed text-on-secondary-fixed shadow-[0_0_20px_rgba(199,210,254,0.2)] hover:brightness-110"
                  }`}
                  disabled={isDisabled}
                >
                  <span className="material-symbols-outlined text-base">bolt</span>
                  {isRunning ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Running
                    </span>
                  ) : (
                    "Run"
                  )}
                </button>
              </div>

              <div className="min-w-0 overflow-hidden transition-[opacity,transform] duration-300 ease-out translate-x-0 opacity-100">
                <div
                  className="group relative"
                  tabIndex={isSaveDisabled && saveDisabledReason ? 0 : -1}
                  aria-label={isSaveDisabled && saveDisabledReason ? saveDisabledReason : undefined}
                >
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={isSaveDisabled}
                    aria-label={
                      isSaveDisabled && saveDisabledReason
                        ? `${isViewingSaved ? "Saved Run" : isSaving ? "Saving" : "Save to Results"}: ${saveDisabledReason}`
                        : undefined
                    }
                    className={`flex w-full items-center justify-center gap-1.5 rounded border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] transition ${
                      isSaveDisabled
                        ? "cursor-not-allowed border-emerald-500/10 bg-emerald-500/5 text-emerald-200/40"
                        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">save</span>
                    {isViewingSaved ? "Saved" : isSaving ? "Saving" : "Save"}
                  </button>
                  {isSaveDisabled && saveDisabledReason ? (
                    <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition duration-150 group-hover:opacity-100 group-focus:opacity-100">
                      {saveDisabledReason}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
          {isDisabled && !isRunning && disabledReason ? (
            <p className="mt-2 text-xs text-slate-400">{disabledReason}</p>
          ) : null}
        </div>
      </form>
    </article>
  );
}

function BacktestMetrics({ metrics, showPlaceholder, animatePlaceholder }: BacktestMetricsProps) {
  const allMetrics = [...metrics.filter((metric) => metric.column === "left"), ...metrics.filter((metric) => metric.column === "right")];

  const renderMetric = (metric: BacktestMetric) => (
    <div key={metric.id} className="flex items-center justify-between border-b border-[rgba(148,163,184,0.1)] py-1">
      <dt className="pr-3 text-[12px] text-slate-300/75">{metric.label}</dt>
      <dd className="text-[13px] font-bold text-slate-100">
        {showPlaceholder ? (
          <Skeleton width={68} height={18} enableAnimation={animatePlaceholder} />
        ) : (
          metric.value
        )}
      </dd>
    </div>
  );

  return (
    <article className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-4 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-200/80">Strategy Metrics</p>
        <span className="material-symbols-outlined text-sm text-slate-400">monitoring</span>
      </header>
      <dl className="px-4 pt-2 pb-4">
        <div>{allMetrics.map(renderMetric)}</div>
      </dl>
    </article>
  );
}

function StrategyEquityChart({
  stats,
  candles,
  orders,
  startingEquity,
  showPlaceholder,
  animatePlaceholder,
}: StrategyEquityChartProps) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverLineRef = useRef<HTMLDivElement | null>(null);
  const hoverDotRef = useRef<HTMLDivElement | null>(null);
  const [chartType, setChartType] = useState<EquityChartType>("candles");
  const [chartRange, setChartRange] = useState<EquityChartRange>("ALL");
  const [visibleTimeDomain, setVisibleTimeDomain] = useState<[number, number] | null>(null);
  const allocationSeries = useMemo(
    () => buildAllocationSeries(candles, orders, startingEquity),
    [candles, orders, startingEquity]
  );
  const filteredCandles = useMemo(() => filterCandlesByRange(candles, chartRange), [candles, chartRange]);
  const linePoints = useMemo(() => buildLinePoints(filteredCandles), [filteredCandles]);
  const filteredAllocationSeries = useMemo(
    () => ({
      keys: allocationSeries.keys,
      data: downsampleAllocationPoints(
        filterAllocationPointsByDomain(
          allocationSeries.data,
          visibleTimeDomain ?? buildNumericTimeDomain(candles, chartRange)
        ),
        240
      ),
    }),
    [allocationSeries.data, allocationSeries.keys, candles, chartRange, visibleTimeDomain]
  );
  const lineDomain = useMemo(() => buildNumericTimeDomain(filteredCandles), [filteredCandles]);

  useEffect(() => {
    if (chartType !== "candles") {
      return;
    }
    if (
      showPlaceholder ||
      !chartContainerRef.current ||
      !chartFrameRef.current ||
      !tooltipRef.current ||
      !hoverLineRef.current ||
      !hoverDotRef.current
    ) {
      return;
    }

    const chartContainer = chartContainerRef.current;
    const chartFrame = chartFrameRef.current;
    const tooltip = tooltipRef.current;
    const hoverLine = hoverLineRef.current;
    const hoverDot = hoverDotRef.current;

    const chart = createChart(chartContainer, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#cbd5f5",
        fontFamily: chartAxisFontFamily,
        fontSize: chartAxisFontSize,
      },
      localization: {
        priceFormatter: formatCompactAxisValue,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 80,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        tickMarkFormatter: formatChartTickMark,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: false,
          labelVisible: false,
        },
        horzLine: {
          visible: false,
          labelVisible: false,
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      borderVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    series.setData(candles);

    const visibleRange = buildVisibleTimeRange(candles, chartRange);
    if (visibleRange) {
      chart.timeScale().setVisibleRange(visibleRange);
      setVisibleTimeDomain([Number(visibleRange.from), Number(visibleRange.to)]);
    } else {
      chart.timeScale().fitContent();
      setVisibleTimeDomain(buildNumericTimeDomain(candles));
    }

    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });

    observer.observe(chartContainer);

    const handleVisibleTimeRangeChange = (newRange: { from?: unknown; to?: unknown } | null) => {
      if (!newRange) return;
      const from = extractNumericTime(newRange.from);
      const to = extractNumericTime(newRange.to);
      if (from === null || to === null) return;
      setVisibleTimeDomain([from, to]);
    };

    const handleCrosshairMove = (param: {
      point?: { x: number; y: number };
      time?: unknown;
      seriesData: Map<unknown, unknown>;
    }) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainer.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainer.clientHeight
      ) {
        tooltip.style.opacity = "0";
        hoverLine.style.opacity = "0";
        hoverDot.style.opacity = "0";
        return;
      }

      const seriesDatum = param.seriesData.get(series) as BacktestCandle | undefined;
      if (!seriesDatum) {
        tooltip.style.opacity = "0";
        hoverLine.style.opacity = "0";
        hoverDot.style.opacity = "0";
        return;
      }

      tooltip.innerHTML = [
        `<div class="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-300/80">${formatTooltipDate(param.time)}</div>`,
        `<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-100">`,
        `<span class="text-slate-400">Open</span><span class="text-right font-mono font-semibold">${currencyFormatter.format(seriesDatum.open)}</span>`,
        `<span class="text-slate-400">High</span><span class="text-right font-mono font-semibold">${currencyFormatter.format(seriesDatum.high)}</span>`,
        `<span class="text-slate-400">Low</span><span class="text-right font-mono font-semibold">${currencyFormatter.format(seriesDatum.low)}</span>`,
        `<span class="text-slate-400">Close</span><span class="text-right font-mono font-semibold">${currencyFormatter.format(seriesDatum.close)}</span>`,
        `</div>`,
      ].join("");

      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const offset = 12;
      const left = Math.max(
        8,
        Math.min(chartFrame.clientWidth - tooltipWidth - 8, param.point.x + offset)
      );
      const top = Math.max(
        8,
        Math.min(chartFrame.clientHeight - tooltipHeight - 8, param.point.y + offset)
      );

      tooltip.style.transform = `translate(${left}px, ${top}px)`;
      tooltip.style.opacity = "1";

      const hoverX = Math.max(0, Math.min(chartContainer.clientWidth, param.point.x));
      const plottedHoverY = series.priceToCoordinate(seriesDatum.close);

      hoverLine.style.transform = `translateX(${hoverX}px)`;
      hoverLine.style.opacity = "1";
      const fallbackHoverY = Math.max(0, Math.min(chartContainer.clientHeight, param.point.y));
      const clampedHoverY =
        plottedHoverY === null
          ? fallbackHoverY
          : Math.max(0, Math.min(chartContainer.clientHeight, plottedHoverY));
      hoverDot.style.transform = `translate(${hoverX}px, ${clampedHoverY}px)`;
      hoverDot.style.opacity = "1";
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
      chart.remove();
    };
  }, [candles, chartRange, chartType, showPlaceholder]);

  useEffect(() => {
    if (chartType === "line") {
      setVisibleTimeDomain(buildNumericTimeDomain(filteredCandles));
    }
  }, [chartType, filteredCandles]);

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3">
      <dl className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        {stats.map((stat) => (
          <div
            key={stat.id}
            className={`flex flex-col items-center justify-center rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] px-4 py-3 text-center shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl ${
              stat.id === "return" ? "border-violet-500/20" : ""
            }`}
          >
            <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">{stat.label}</dt>
            <dd
              className={`${stat.id === "volume" ? "text-sm" : "text-sm"} font-bold leading-tight ${stat.accentClass}`}
            >
              {showPlaceholder && animatePlaceholder ? (
                <Skeleton width="80%" height={28} enableAnimation={animatePlaceholder} />
              ) : (
                stat.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <article className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-6 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-200">Strategy Equity</span>
            <div className="flex rounded border border-[rgba(148,163,184,0.12)] bg-[rgba(17,23,38,0.95)] p-0.5">
              {[
                { id: "candles" as const, label: "Candles" },
                { id: "line" as const, label: "Line" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setChartType(option.id)}
                  className={`rounded px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
                    chartType === option.id
                      ? "bg-[rgba(28,36,54,0.95)] text-slate-100"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  className="peer h-4 w-4 appearance-none rounded border border-[rgba(148,163,184,0.3)] bg-[rgba(17,23,38,0.95)] transition-all cursor-pointer checked:border-violet-500 checked:bg-violet-500"
                />
                <span className="material-symbols-outlined pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] text-slate-950 opacity-0 peer-checked:opacity-100">
                  check
                </span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 transition-colors group-hover:text-slate-200">
                Compare with S&amp;P 500
              </span>
            </label>
          </div>
          <div className="flex rounded border border-[rgba(148,163,184,0.12)] bg-[rgba(17,23,38,0.95)] p-0.5">
            {(["1D", "1W", "1M", "1Y", "5Y", "ALL"] as EquityChartRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setChartRange(range)}
                className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
                  chartRange === range
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </header>

        {showPlaceholder ? (
          <div className="flex-1 p-6">
            <Skeleton width="30%" height={20} enableAnimation={animatePlaceholder} />
            <Skeleton height="100%" className="mt-3 min-h-[380px]" enableAnimation={animatePlaceholder} />
          </div>
        ) : (
          <div className="flex-1 grid gap-2 [grid-template-rows:minmax(270px,1fr)_220px] pl-4 pt-3 pb-3">
            {chartType === "line" ? (
              <div className="h-[380px] min-h-[270px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.08),transparent_35%),rgba(9,13,22,0.65)]">
                <RechartsEquityLineChart
                  data={linePoints}
                  xDomain={lineDomain}
                  onVisibleDomainChange={setVisibleTimeDomain}
                />
              </div>
            ) : (
              <div
                ref={chartFrameRef}
                className="relative h-[380px] min-h-[270px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.08),transparent_35%),rgba(9,13,22,0.65)]"
              >
                <div ref={chartContainerRef} className="h-full w-full" />
                <div
                  ref={hoverLineRef}
                  className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px -translate-x-1/2 bg-slate-200/20 opacity-0 transition-opacity duration-75"
                />
                <div
                  ref={hoverDotRef}
                  className="pointer-events-none absolute z-[6] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-fuchsia-400 opacity-0 shadow-[0_0_0_4px_rgba(217,70,239,0.18)] transition-opacity duration-75"
                />
                <div
                  ref={tooltipRef}
                  className="pointer-events-none absolute left-0 top-0 z-10 w-56 rounded-xl border border-[rgba(148,163,184,0.16)] bg-[rgba(10,14,23,0.94)] px-3 py-3 opacity-0 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl transition-opacity duration-75"
                />
              </div>
            )}

            <div className="min-h-[220px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_bottom,rgba(129,140,248,0.05),transparent_40%),rgba(9,13,22,0.45)] pt-1 pb-1">
              <RechartsAllocationChart series={filteredAllocationSeries} xDomain={visibleTimeDomain ?? lineDomain} />
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

function BacktestOrdersTable({ orders, logs, showPlaceholder, animatePlaceholder }: BacktestOrdersTableProps) {
  const [activeTab, setActiveTab] = useState<ExecutionPanelTab>("orders");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageSize, setPageSize] = useState(DEFAULT_EXECUTION_LOG_PAGE_SIZE);
  const [tickerFilter, setSymbolFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "buy" | "sell">("all");

  useEffect(() => {
    setPage(1);
    setPageInput("1");
  }, [orders, pageSize, tickerFilter, typeFilter, activeTab]);

  const filteredOrders = useMemo(() => {
    const normalizedTicker = tickerFilter.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesTicker = !normalizedTicker || order.ticker.toLowerCase().includes(normalizedTicker);
      const normalizedType = String(order.type).toLowerCase();
      const matchesType = typeFilter === "all" || normalizedType === typeFilter;
      return matchesTicker && matchesType;
    });
  }, [typeFilter, orders, tickerFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filteredOrders.length);
  const visibleOrders = filteredOrders.slice(pageStart, pageEnd);

  const totalLogPages = Math.max(1, Math.ceil(logs.length / pageSize));
  const currentLogPage = Math.min(page, totalLogPages);
  const logPageStart = (currentLogPage - 1) * pageSize;
  const visibleLogs = logs.slice(logPageStart, logPageStart + pageSize);

  useEffect(() => {
    setPageInput(String(activeTab === "logs" ? currentLogPage : currentPage));
  }, [activeTab, currentLogPage, currentPage]);

  const applyPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    const maxPages = activeTab === "logs" ? totalLogPages : totalPages;
    if (!Number.isFinite(parsed)) {
      setPageInput(String(activeTab === "logs" ? currentLogPage : currentPage));
      return;
    }
    setPage(Math.min(maxPages, Math.max(1, parsed)));
  };

  return (
    <article className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-slate-400">list_alt</span>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-300/80">Execution Log</h3>
          </div>
          <div className="inline-flex rounded border border-[rgba(148,163,184,0.1)] bg-[rgba(17,23,38,0.95)] p-0.5">
            {[
              { id: "orders" as const, label: "Orders" },
              { id: "logs" as const, label: "Logs" },
              { id: "warnings" as const, label: "Warnings" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded px-4 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-all ${
                  activeTab === tab.id
                    ? "bg-[rgba(28,36,54,0.95)] text-slate-100"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab === "orders" ? (
            <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary-fixed-dim text-[10px] font-bold border border-secondary/20">
              Showing {filteredOrders.length === 0 ? 0 : pageStart + 1}-{pageEnd} of {filteredOrders.length}
            </span>
          ) : activeTab === "logs" && !animatePlaceholder ? (
            <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary-fixed-dim text-[10px] font-bold border border-secondary/20">
              Showing {logs.length === 0 ? 0 : logPageStart + 1}-{logPageStart + visibleLogs.length} of {logs.length}
            </span>
          ) : null}
        </div>

        {activeTab === "orders" && (
          <ExecutionFilters
            tickerFilter={tickerFilter}
            typeFilter={typeFilter}
            pageSize={pageSize}
            onTickerFilterChange={setSymbolFilter}
            onTypeFilterChange={setTypeFilter}
            onPageSizeChange={setPageSize}
            showPageSize={false}
          />
        )}
      </header>

      <div className="space-y-4 p-0">
        {showPlaceholder && activeTab !== "logs" ? (
          <div className="p-6">
            <ExecutionPlaceholder
              animatePlaceholder={animatePlaceholder}
              label={activeTab === "orders" ? "Run backtest to view orders" : "Panel coming soon."}
            />
          </div>
        ) : activeTab === "logs" ? (
          animatePlaceholder ? (
            <div className="p-6">
              <ExecutionPlaceholder animatePlaceholder={true} />
            </div>
          ) : logs.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">No logs for this run.</div>
          ) : (
            <div className="space-y-0">
              <div className="space-y-1 px-6 py-4 font-mono text-xs text-slate-300">
                {visibleLogs.map((line, i) => (
                  <div key={logPageStart + i} className="rounded bg-[rgba(17,23,38,0.8)] px-3 py-2 leading-relaxed">
                    {line}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.2)] px-6 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  Showing {visibleLogs.length} of {logs.length} Log Lines
                </span>
                <div className="flex items-center gap-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={currentLogPage === 1}
                      className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.7)] px-2 py-1 text-[10px] font-bold uppercase text-slate-300 transition-colors hover:bg-[rgba(28,36,54,0.95)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ← Prev
                    </button>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>Page</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={pageInput}
                        onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ""))}
                        onBlur={applyPageInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyPageInput();
                          }
                        }}
                        className="w-12 rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-1.5 py-0.5 text-center text-xs text-slate-100 outline-none focus:border-violet-400"
                      />
                      <span>of {totalLogPages}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.min(totalLogPages, current + 1))}
                      disabled={currentLogPage === totalLogPages}
                      className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.7)] px-2 py-1 text-[10px] font-bold uppercase text-slate-300 transition-colors hover:bg-[rgba(28,36,54,0.95)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : activeTab === "warnings" ? (
          <div className="p-6">
            <ExecutionPlaceholder animatePlaceholder={false} label="Warnings panel coming soon." />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">
            {orders.length === 0 ? "No execution log entries for this run." : "No orders match the current filters."}
          </div>
        ) : (
          <div className="space-y-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[rgba(148,163,184,0.1)] bg-[rgba(17,23,38,0.3)]">
                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Timestamp</th>
                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Asset</th>
                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Type</th>
                    <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Price</th>
                    <th className="px-6 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Shares</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order, index) => {
                    const isBuy = String(order.type).toLowerCase() === "buy";
                    const orderType = isBuy ? "BUY" : "SELL";
                    return (
                      <tr
                        key={order.id}
                        className={`h-10 border-b border-[rgba(148,163,184,0.05)] transition-colors hover:bg-[rgba(148,163,184,0.05)] ${
                          index % 2 === 0 ? "bg-[rgba(255,255,255,0.015)]" : "bg-transparent"
                        }`}
                      >
                        <td className="px-6 py-2 font-mono text-xs leading-none text-slate-100 align-middle">
                          {dateFormatter.format(new Date(order.timestamp))}
                        </td>
                        <td className="px-6 py-2 text-xs font-bold leading-none text-slate-100 align-middle">{order.ticker}</td>
                        <td className="px-6 py-2 align-middle">
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold ${
                              isBuy
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {orderType}
                          </span>
                        </td>
                        <td className="px-6 py-2 text-xs leading-none text-slate-100 align-middle">{currencyFormatter.format(order.price)}</td>
                        <td className="px-6 py-2 text-right text-xs font-bold leading-none text-slate-100 align-middle">
                          {numberFormatter.format(order.shares)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.2)] px-6 py-2.5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number.parseInt(event.target.value, 10))}
                  className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-2 py-0.5 pr-7 text-xs text-slate-100 outline-none focus:border-violet-400"
                >
                  {EXECUTION_LOG_PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span>trades</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={currentPage === 1}
                    className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.7)] px-2 py-1 text-[10px] font-bold uppercase text-slate-300 transition-colors hover:bg-[rgba(28,36,54,0.95)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ← Prev
                  </button>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>Page</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={pageInput}
                      onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ""))}
                      onBlur={applyPageInput}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyPageInput();
                        }
                      }}
                      className="w-12 rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-1.5 py-0.5 text-center text-xs text-slate-100 outline-none focus:border-violet-400"
                    />
                    <span>of {totalPages}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.7)] px-2 py-1 text-[10px] font-bold uppercase text-slate-300 transition-colors hover:bg-[rgba(28,36,54,0.95)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

type ExecutionFiltersProps = {
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  tickerFilter?: string;
  typeFilter?: "all" | "buy" | "sell";
  onTickerFilterChange?: (value: string) => void;
  onTypeFilterChange?: (value: "all" | "buy" | "sell") => void;
  showPageSize?: boolean;
};

function ExecutionFilters({
  pageSize,
  onPageSizeChange,
  tickerFilter,
  typeFilter,
  onTickerFilterChange,
  onTypeFilterChange,
  showPageSize = true,
}: ExecutionFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tickerFilter !== undefined && onTickerFilterChange !== undefined && (
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-slate-400">filter_list</span>
          <input
            type="text"
            value={tickerFilter}
            onChange={(event) => onTickerFilterChange(event.target.value)}
            placeholder="Asset"
            className="w-24 rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 outline-none placeholder:text-slate-400 focus:border-violet-400"
          />
        </div>
      )}

      {typeFilter !== undefined && onTypeFilterChange !== undefined && (
        <select
          value={typeFilter}
          onChange={(event) => onTypeFilterChange(event.target.value as "all" | "buy" | "sell")}
          className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-1 py-1.25 pr-9 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 outline-none focus:border-violet-400"
        >
          <option value="all">Type</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      )}

      {showPageSize ? (
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number.parseInt(event.target.value, 10))}
          className="rounded border border-[rgba(148,163,184,0.2)] bg-[rgba(17,23,38,0.95)] px-3 py-1 pr-9 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 outline-none focus:border-violet-400"
        >
          {EXECUTION_LOG_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} Rows
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function ExecutionPlaceholder({
  animatePlaceholder,
  label = "Panel coming soon.",
}: {
  animatePlaceholder: boolean;
  label?: string;
}) {
  return animatePlaceholder ? (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={`execution-skeleton-${index}`} height={32} enableAnimation={animatePlaceholder} />
      ))}
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 py-10 text-center text-sm text-slate-400">
      {label}
    </div>
  );
}

const DEFAULT_PARAMETERS: BacktestParameter[] = [
  { id: "startingEquity", label: "Starting Equity", value: "100000", prefix: "$", type: "currency" },
  { id: "startDate", label: "Start Date", value: "2020-01-03", type: "date" },
  { id: "endDate", label: "End Date", value: "2024-12-31", type: "date" },
];

const normalizeDateValue = (value?: string) => {
  if (!value) return "";
  return value.split("T")[0]?.trim() ?? "";
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const toDecimal = (value: number | null | undefined) => (Number.isFinite(value) ? (value as number) : null);

const formatNumber = (value: number | null, decimals = 2) =>
  value === null ? "—" : value.toFixed(decimals);

const formatPercent = (value: number | null, decimals = 2) => {
  if (value === null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
};

const formatPercentValue = (value: number | null, decimals = 2) => {
  if (value === null) return "—";
  return `${value.toFixed(decimals)}%`;
};

const formatMoney = (value: number | null) => (value === null ? "—" : currencyFormatter.format(value));

const buildMetrics = (metrics?: Metrics): BacktestMetric[] => {
  const sharpe = toDecimal(metrics?.sharpe);
  const sortino = toDecimal(metrics?.sortino);
  const calmar = toDecimal(metrics?.calmar);
  const alpha = toDecimal(metrics?.alpha);
  const beta = toDecimal(metrics?.beta);
  const psr = toDecimal(metrics?.psr);
  const maxDrawdown = toDecimal(metrics?.max_drawdown);
  const maxDrawdownDuration = toDecimal(metrics?.max_drawdown_duration);
  const totalOrders = toDecimal(metrics?.total_orders);
  const totalReturn = toDecimal(metrics?.total_pct_return);
  const annualizedReturn = toDecimal(metrics?.annualized_return);
  const annVol = toDecimal(metrics?.ann_vol);
  const var95 = toDecimal(metrics?.var_95);
  const cvar95 = toDecimal(metrics?.cvar_95);

  return [
    { id: "sharpe", label: "Sharpe", value: formatNumber(sharpe), column: "left" },
    { id: "sortino", label: "Sortino", value: formatNumber(sortino), column: "left" },
    { id: "calmar", label: "Calmar", value: formatNumber(calmar), column: "left" },
    { id: "alpha", label: "Alpha", value: formatNumber(alpha), column: "left" },
    { id: "beta", label: "Beta", value: formatNumber(beta), column: "left" },
    { id: "psr", label: "PSR", value: formatNumber(psr), column: "left" },
    { id: "totalReturn", label: "Total Return", value: formatPercent(totalReturn), column: "right" },
    { id: "annualizedReturn", label: "CAGR", value: formatPercent(annualizedReturn), column: "right" },
    { id: "annVol", label: "Ann. Volatility", value: formatPercent(annVol), column: "right" },
    { id: "maxDrawdown", label: "Max Drawdown", value: formatPercent(maxDrawdown), column: "right" },
    { id: "maxDrawdownDuration", label: "Max DD Duration", value: maxDrawdownDuration === null ? "—" : `${numberFormatter.format(maxDrawdownDuration)} bars`, column: "right" },
    { id: "var95", label: "VaR (95%)", value: formatPercent(var95), column: "right" },
    { id: "cvar95", label: "CVaR (95%)", value: formatPercent(cvar95), column: "right" },
    { id: "totalOrders", label: "Total Orders", value: totalOrders === null ? "—" : numberFormatter.format(totalOrders), column: "left" },
  ];
};

const toCandleTime = (time: number): UTCTimestamp => Math.floor(time) as UTCTimestamp;

const buildCandles = (candles?: BacktestCandle[]): EquityCandle[] => {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  return [...candles]
    .sort((a, b) => a.time - b.time)
    .map((candle) => ({
      time: toCandleTime(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
};

const buildLinePoints = (candles?: EquityCandle[]): EquityLinePoint[] => {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  return [...candles]
    .sort((a, b) => Number(a.time) - Number(b.time))
    .map((candle) => ({
      time: Number(candle.time),
      equity: candle.close,
    }));
};

const getChartRangeWindowSeconds = (range: EquityChartRange): number | null => {
  switch (range) {
    case "1D":
      return 60 * 60 * 24;
    case "1W":
      return 60 * 60 * 24 * 7;
    case "1M":
      return 60 * 60 * 24 * 30;
    case "1Y":
      return 60 * 60 * 24 * 365;
    case "5Y":
      return 60 * 60 * 24 * 365 * 5;
    case "ALL":
    default:
      return null;
  }
};

const filterCandlesByRange = (candles: EquityCandle[], range: EquityChartRange): EquityCandle[] => {
  if (!candles.length) return [];
  const windowSeconds = getChartRangeWindowSeconds(range);
  if (windowSeconds === null) return candles;
  const latestTime = Number(candles[candles.length - 1]?.time ?? 0);
  const threshold = latestTime - windowSeconds;
  const filtered = candles.filter((candle) => Number(candle.time) >= threshold);
  return filtered.length ? filtered : candles;
};

const buildVisibleTimeRange = (
  candles: EquityCandle[],
  range: EquityChartRange
): { from: UTCTimestamp; to: UTCTimestamp } | null => {
  if (!candles.length) return null;
  const windowSeconds = getChartRangeWindowSeconds(range);
  if (windowSeconds === null) return null;
  const latestTime = Number(candles[candles.length - 1]?.time ?? 0);
  const earliestTime = Number(candles[0]?.time ?? 0);
  const from = Math.max(earliestTime, latestTime - windowSeconds);
  return {
    from: toCandleTime(from),
    to: toCandleTime(latestTime),
  };
};

const filterAllocationPointsByRange = (points: AllocationPoint[], range: EquityChartRange): AllocationPoint[] => {
  if (!points.length) return [];
  const windowSeconds = getChartRangeWindowSeconds(range);
  if (windowSeconds === null) return points;
  const latestTime = points[points.length - 1]?.time ?? 0;
  const threshold = latestTime - windowSeconds;
  const filtered = points.filter((point) => point.time >= threshold);
  return filtered.length ? filtered : points;
};

const filterAllocationPointsByDomain = (points: AllocationPoint[], domain: [number, number] | null): AllocationPoint[] => {
  if (!points.length || domain === null) return points;
  const [from, to] = domain;
  const filtered = points.filter((point) => point.time >= from && point.time <= to);
  return filtered.length ? filtered : points;
};

const downsampleAllocationPoints = (points: AllocationPoint[], maxPoints: number): AllocationPoint[] => {
  if (points.length <= maxPoints || maxPoints < 3) return points;

  const bucketSize = (points.length - 2) / (maxPoints - 2);
  const sampled: AllocationPoint[] = [points[0]];

  for (let i = 0; i < maxPoints - 2; i += 1) {
    const start = Math.floor(1 + i * bucketSize);
    const end = Math.floor(1 + (i + 1) * bucketSize);
    const index = Math.min(points.length - 2, Math.max(start, end - 1));
    sampled.push(points[index]);
  }

  sampled.push(points[points.length - 1]);
  return sampled;
};

const buildNumericTimeDomain = (
  candles: EquityCandle[],
  range?: EquityChartRange
): [number, number] | null => {
  if (!candles.length) return null;
  if (!range || range === "ALL") {
    return [Number(candles[0]?.time ?? 0), Number(candles[candles.length - 1]?.time ?? 0)];
  }
  const visibleRange = buildVisibleTimeRange(candles, range);
  if (!visibleRange) return null;
  return [Number(visibleRange.from), Number(visibleRange.to)];
};

const extractNumericTime = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  if (value && typeof value === "object" && "year" in value && "month" in value && "day" in value) {
    const businessDay = value as { year: number; month: number; day: number };
    return Math.floor(new Date(businessDay.year, businessDay.month - 1, businessDay.day).getTime() / 1000);
  }
  return null;
};

function useMeasuredChartSize<T extends HTMLDivElement>() {
  const containerRef = useRef<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRefs = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      frameRef.current = null;
      const nextWidth = Math.floor(node.clientWidth);
      const nextHeight = Math.floor(node.clientHeight);
      setSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();

    const scheduleUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(updateSize);
    };

    const observer = new ResizeObserver(() => {
      scheduleUpdate();
    });

    observer.observe(node);

    const sidebar = document.getElementById("sidebar");
    const clearScheduledUpdates = () => {
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current = [];
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const scheduleSettledUpdates = () => {
      clearScheduledUpdates();
      timeoutRefs.current = [
        setTimeout(scheduleUpdate, 0),
        setTimeout(scheduleUpdate, 120),
        setTimeout(scheduleUpdate, 320),
        setTimeout(scheduleUpdate, 760),
      ];
    };

    const handleSidebarTransitionStart = (event: TransitionEvent) => {
      if (event.propertyName !== "width") return;
      clearScheduledUpdates();
      scheduleUpdate();
      intervalRef.current = setInterval(scheduleUpdate, 80);
      timeoutRefs.current = [
        setTimeout(() => {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }, 820),
      ];
    };

    const handleSidebarTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "width") return;
      scheduleSettledUpdates();
    };

    const handleWindowResize = () => {
      scheduleSettledUpdates();
    };

    sidebar?.addEventListener("transitionstart", handleSidebarTransitionStart);
    sidebar?.addEventListener("transitionend", handleSidebarTransitionEnd);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      observer.disconnect();
      sidebar?.removeEventListener("transitionstart", handleSidebarTransitionStart);
      sidebar?.removeEventListener("transitionend", handleSidebarTransitionEnd);
      window.removeEventListener("resize", handleWindowResize);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      clearScheduledUpdates();
    };
  }, []);

  return { containerRef, size };
}

const buildAllocationSeries = (
  candles: EquityCandle[],
  orders: BacktestOrder[],
  startingEquity: number
) => {
  if (!Array.isArray(candles) || candles.length === 0 || !Number.isFinite(startingEquity) || startingEquity <= 0) {
    return {
      data: [] as AllocationPoint[],
      keys: [] as string[],
    };
  }

  const timeline = [...candles].sort((a, b) => Number(a.time) - Number(b.time)).map((candle) => Number(candle.time));
  const initialSnapshot: AllocationPoint = {
    time: timeline[0] ?? 0,
    Cash: 100,
  };

  if (!Array.isArray(orders) || orders.length === 0) {
    return {
      data: timeline.map((time) => ({ time, Cash: 100 })),
      keys: ["Cash"],
    };
  }

  const sortedOrders = [...orders].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const holdings = new Map<string, number>();
  const latestPrices = new Map<string, number>();
  let cash = startingEquity;
  const snapshots: AllocationPoint[] = [];

  for (let index = 0; index < sortedOrders.length; ) {
    const timestamp = sortedOrders[index].timestamp;

    while (index < sortedOrders.length && sortedOrders[index].timestamp === timestamp) {
      const order = sortedOrders[index];
      const direction = String(order.type).toLowerCase() === "buy" ? 1 : -1;
      const shares = direction * order.shares;
      const nextQuantity = (holdings.get(order.ticker) ?? 0) + shares;

      if (Math.abs(nextQuantity) < 1e-9) {
        holdings.delete(order.ticker);
      } else {
        holdings.set(order.ticker, nextQuantity);
      }

      latestPrices.set(order.ticker, order.price);
      cash -= shares * order.price;
      index += 1;
    }

    const assetValues = new Map<string, number>();
    let totalValue = Math.max(cash, 0);

    for (const [symbol, quantity] of holdings.entries()) {
      const price = latestPrices.get(symbol);
      if (!price || !Number.isFinite(price)) continue;
      const marketValue = Math.max(quantity * price, 0);
      if (marketValue <= 0) continue;
      assetValues.set(symbol, marketValue);
      totalValue += marketValue;
    }

    if (totalValue <= 0) {
      continue;
    }

    const point: AllocationPoint = { time: Math.floor(new Date(timestamp).getTime() / 1000) };
    for (const [symbol, marketValue] of assetValues.entries()) {
      point[symbol] = (marketValue / totalValue) * 100;
    }
    point.Cash = (Math.max(cash, 0) / totalValue) * 100;
    snapshots.push(point);
  }

  const normalizedSnapshots = [initialSnapshot, ...snapshots]
    .sort((a, b) => a.time - b.time)
    .filter((point, index, items) => index === 0 || point.time !== items[index - 1]?.time);

  const keys = Array.from(
    normalizedSnapshots.reduce((acc, point) => {
      Object.keys(point).forEach((key) => {
        if (key !== "time") acc.add(key);
      });
      return acc;
    }, new Set<string>())
  ).sort((a, b) => {
    if (a === "Cash") return 1;
    if (b === "Cash") return -1;
    return a.localeCompare(b);
  });

  const data: AllocationPoint[] = [];
  let snapshotIndex = 0;
  let activeSnapshot = normalizedSnapshots[0];

  for (const time of timeline) {
    while (
      snapshotIndex + 1 < normalizedSnapshots.length &&
      normalizedSnapshots[snapshotIndex + 1] &&
      normalizedSnapshots[snapshotIndex + 1].time <= time
    ) {
      snapshotIndex += 1;
      activeSnapshot = normalizedSnapshots[snapshotIndex];
    }

    data.push(allocationPointFromSnapshot(time, activeSnapshot, keys));
  }

  return { data, keys };
};

const allocationPointFromSnapshot = (time: number, snapshot: AllocationPoint, keys: string[]) => {
  const point: AllocationPoint = { time };
  for (const key of keys) {
    point[key] = snapshot[key] ?? 0;
  }
  return point;
};

const buildOrders = (orders?: BacktestOrder[]): BacktestOrder[] => {
  if (!Array.isArray(orders)) return [];

  return orders.map((order, index) => ({
    ...order,
    id: order.id || `${order.timestamp}-${order.ticker}-${index}`,
  }));
};

const formatTooltipDate = (value: unknown) => {
  if (typeof value === "number") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value * 1000));
  }

  if (typeof value === "string") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  }

  if (
    value &&
    typeof value === "object" &&
    "year" in value &&
    "month" in value &&
    "day" in value
  ) {
    const businessDay = value as { year: number; month: number; day: number };
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(businessDay.year, businessDay.month - 1, businessDay.day));
  }

  return "Unknown date";
};

const axisDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

const formatCompactAxisValue = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${trimTrailingZeros(value / 1_000_000)}m`;
  }
  if (abs >= 1_000) {
    return `${trimTrailingZeros(value / 1_000)}k`;
  }
  return trimTrailingZeros(value);
};

const trimTrailingZeros = (value: number) =>
  value.toFixed(1).replace(/\.0$/, "");

const formatChartTickMark = (time: unknown) => {
  if (typeof time === "number") {
    return axisDateFormatter.format(new Date(time * 1000));
  }
  if (
    time &&
    typeof time === "object" &&
    "year" in time &&
    "month" in time &&
    "day" in time
  ) {
    const businessDay = time as { year: number; month: number; day: number };
    return axisDateFormatter.format(new Date(businessDay.year, businessDay.month - 1, businessDay.day));
  }
  if (typeof time === "string") {
    return axisDateFormatter.format(new Date(time));
  }
  return null;
};

function RechartsEquityLineTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: EquityLinePoint }>;
  label?: number;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-3 shadow-xl">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{formatTooltipDate(label ?? point.time)}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-200">
        <span className="text-slate-400">Equity</span>
        <span className="text-right font-mono">{currencyFormatter.format(point.equity)}</span>
      </div>
    </div>
  );
}

function RechartsEquityLineChart({
  data,
  xDomain,
  onVisibleDomainChange,
}: {
  data: EquityLinePoint[];
  xDomain?: [number, number] | null;
  onVisibleDomainChange?: (domain: [number, number] | null) => void;
}) {
  const { containerRef, size } = useMeasuredChartSize<HTMLDivElement>();
  const baseDomain = useMemo<[number, number] | null>(() => {
    if (xDomain) {
      return xDomain;
    }
    if (!data.length) {
      return null;
    }
    return [data[0]!.time, data[data.length - 1]!.time];
  }, [data, xDomain]);
  const [visibleDomain, setVisibleDomain] = useState<[number, number] | null>(baseDomain);

  useEffect(() => {
    setVisibleDomain(baseDomain);
  }, [baseDomain]);

  useEffect(() => {
    onVisibleDomainChange?.(visibleDomain);
  }, [onVisibleDomainChange, visibleDomain]);

  const applyWheelZoom = (clientX: number, deltaY: number, target: HTMLDivElement) => {
    if (!baseDomain || !visibleDomain || size.width <= 0) {
      return false;
    }

    const [baseStart, baseEnd] = baseDomain;
    const [currentStart, currentEnd] = visibleDomain;
    const currentSpan = currentEnd - currentStart;
    const baseSpan = baseEnd - baseStart;

    if (currentSpan <= 0 || baseSpan <= 0) {
      return false;
    }

    const rect = target.getBoundingClientRect();
    const relativeX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const anchorRatio = rect.width > 0 ? relativeX / rect.width : 0.5;
    const anchorTime = currentStart + currentSpan * anchorRatio;
    const zoomFactor = deltaY < 0 ? 0.85 : 1.15;
    const minSpan = Math.max(1, baseSpan / Math.min(Math.max(data.length, 1), 100));
    const nextSpan = Math.min(baseSpan, Math.max(minSpan, currentSpan * zoomFactor));

    let nextStart = anchorTime - nextSpan * anchorRatio;
    let nextEnd = anchorTime + nextSpan * (1 - anchorRatio);

    if (nextStart < baseStart) {
      nextStart = baseStart;
      nextEnd = baseStart + nextSpan;
    }
    if (nextEnd > baseEnd) {
      nextEnd = baseEnd;
      nextStart = baseEnd - nextSpan;
    }

    setVisibleDomain([nextStart, nextEnd]);
    return true;
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      const didZoom = applyWheelZoom(event.clientX, event.deltaY, node);
      if (!didZoom) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    node.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleNativeWheel);
    };
  }, [applyWheelZoom, visibleDomain, baseDomain, size.width]);

  return (
    <div ref={containerRef} className="h-full w-full min-w-0 overflow-hidden">
      {size.width > 0 && size.height > 0 ? (
        <LineChart
          key={`line-${size.width}-${size.height}`}
          width={size.width}
          height={size.height}
          data={data}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical horizontal />
          <XAxis
            dataKey="time"
            type="number"
            domain={visibleDomain ?? ["dataMin", "dataMax"]}
            allowDataOverflow
            padding={{ left: 0, right: 0 }}
            tickFormatter={(value) => axisDateFormatter.format(new Date(Number(value) * 1000))}
            tick={{ fill: "#cbd5f5", fontSize: chartAxisFontSize, fontFamily: chartAxisFontFamily }}
            tickLine={false}
            axisLine={false}
            minTickGap={42}
          />
          <YAxis
            dataKey="equity"
            type="number"
            orientation="right"
            width={80}
            tickFormatter={(value) => formatCompactAxisValue(Number(value))}
            tick={{ fill: "#cbd5f5", fontSize: chartAxisFontSize, fontFamily: chartAxisFontFamily }}
            tickLine={false}
            axisLine={false}
            domain={["auto", "auto"]}
          />
          <RechartsTooltip
            content={<RechartsEquityLineTooltip />}
            cursor={{ stroke: "rgba(226,232,240,0.28)", strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="equity"
            stroke="#7dd3fc"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              fill: "#d946ef",
              stroke: "#020617",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      ) : null}
    </div>
  );
}

function RechartsAllocationTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: number;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const rows = payload
    .map((entry) => ({
      key: String(entry.dataKey ?? ""),
      value: typeof entry.value === "number" ? entry.value : 0,
    }))
    .filter((entry) => entry.key && entry.value > 0.01)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-3 shadow-xl">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{formatTooltipDate(label)}</div>
      <div className="mt-2 space-y-1 text-sm text-slate-200">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="text-slate-400">{row.key}</span>
            <span className="font-mono">{row.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RechartsAllocationChart({
  series,
  xDomain,
}: {
  series: { data: AllocationPoint[]; keys: string[] };
  xDomain?: [number, number] | null;
}) {
  const { containerRef, size } = useMeasuredChartSize<HTMLDivElement>();

  if (!series.data.length || !series.keys.length) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 text-sm text-slate-400">
        No allocation snapshots could be derived from this run&apos;s orders.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[220px] grid-rows-[minmax(0,1fr)_auto] gap-2 px-2 pb-2">
      <div ref={containerRef} className="min-h-[0] w-full min-w-0 overflow-hidden">
        {size.width > 0 && size.height > 0 ? (
          <AreaChart
            key={`allocation-${size.width}-${size.height}`}
            width={size.width}
            height={size.height}
            data={series.data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical horizontal />
            <XAxis
              dataKey="time"
              type="number"
              domain={xDomain ?? ["dataMin", "dataMax"]}
              allowDataOverflow
              padding={{ left: 0, right: 0 }}
              tickFormatter={(value) => formatChartTickMark(Number(value)) ?? ""}
              tick={{ fill: "#cbd5f5", fontSize: chartAxisFontSize, fontFamily: chartAxisFontFamily }}
              tickLine={false}
              axisLine={false}
              minTickGap={42}
            />
            <YAxis
              type="number"
              orientation="right"
              width={80}
              ticks={[25, 50, 75, 100]}
              tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
              tick={{ fill: "#cbd5f5", fontSize: chartAxisFontSize, fontFamily: chartAxisFontFamily }}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
            />
            <RechartsTooltip
              content={<RechartsAllocationTooltip />}
              cursor={{ stroke: "rgba(226,232,240,0.28)", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {series.keys.map((key, index) => (
              <Area
                key={key}
                type="stepAfter"
                dataKey={key}
                stackId="allocation"
                stroke={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]}
                fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]}
                fillOpacity={0.72}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2 pt-0.5 pb-1 text-xs text-slate-200">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Legend</span>
        {series.keys.map((key, index) => (
          <div key={key} className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}
            />
            <span>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const buildEquityStats = (data: BacktestResponse | null): EquityStat[] => {
  if (!data) {
    return [
      { id: "finalEquity", label: "Final Equity", value: "—", accentClass: "text-white" },
      { id: "netProfit", label: "Net Profit", value: "—", accentClass: "text-white" },
      { id: "return", label: "Return", value: "—", accentClass: "text-white" },
      { id: "fees", label: "Fees", value: "—", accentClass: "text-white" },
      { id: "volume", label: "Volume", value: "—", accentClass: "text-white" },
    ];
  }

  const m = data.metrics;
  const finalEquity = toDecimal(m?.final_portfolio_value);
  const fees = toDecimal(m?.fees);
  const netProfit = toDecimal(m?.net_profit);
  const returnPct = toDecimal(m?.total_pct_return);
  const volume = toDecimal(m?.volume);

  const profitAccent = netProfit !== null && netProfit >= 0 ? "text-emerald-300" : "text-rose-300";
  const returnAccent = returnPct !== null && returnPct >= 0 ? "text-emerald-300" : "text-rose-300";

  return [
    { id: "finalEquity", label: "Final Equity", value: formatMoney(finalEquity), accentClass: "text-white" },
    { id: "netProfit", label: "Net Profit", value: formatMoney(netProfit), accentClass: profitAccent },
    { id: "return", label: "Return", value: formatPercent(returnPct), accentClass: returnAccent },
    { id: "fees", label: "Fees", value: formatMoney(fees), accentClass: "text-white" },
    { id: "volume", label: "Volume", value: volume === null ? "—" : numberFormatter.format(volume), accentClass: "text-white" },
  ];
};
