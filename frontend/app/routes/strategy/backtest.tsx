import Editor from "@monaco-editor/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  ResponsiveContainer,
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
import { fetchStrategyArtifactContent } from "~/api/strategyArtifacts";
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
type EquityChartType = "candles" | "line" | "allocation";

type RunParameterState = Record<string, string>;

type BacktestParametersProps = {
  parameters: BacktestParameter[];
  isRunning: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  onRun: (values: RunParameterState) => void;
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
  onSave: () => void;
  isSaving: boolean;
  isSaveDisabled: boolean;
  saveDisabledReason?: string;
  isViewingSaved: boolean;
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
    files,
    entrypoint,
    addToast,
    isSaving: isWorkspaceSaving,
    latestBacktestData,
    setLatestBacktestData,
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
  } = useStrategyWorkspace();

  const configFile = files.find(
    (f) => f.path === "config.json" || f.path.endsWith("/config.json")
  );
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isSavingBacktest, setIsSavingBacktest] = useState(false);
  const [latestBacktestLogs, setLatestBacktestLogs] = useState<string[]>([]);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) clearInterval(pollIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!configFile || !strategy || configFile.content) return;
    fetchStrategyArtifactContent(strategy.id, configFile.path)
      .then((content) => { if (content) updateFileContent(configFile.path, content); })
      .catch(() => {});
  }, [configFile, strategy]);

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

    let configParams: Record<string, unknown> | undefined;
    const configContent = configFile?.content?.trim();
    if (configContent) {
      try {
        const parsed = JSON.parse(configContent);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          addToast("config.json must be a JSON object.", "warning");
          return;
        }
        configParams = parsed as Record<string, unknown>;
      } catch {
        addToast("config.json is not valid JSON. Fix it before running a backtest.", "warning");
        return;
      }
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
        config_params: configParams,
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
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="space-y-6">
            <BacktestParameters
              parameters={lastRunParameters}
              isRunning={isRunningBacktest}
              isDisabled={isRunningBacktest || isWorkspaceSaving}
              disabledReason={isWorkspaceSaving ? "Saving changes…" : undefined}
              onRun={handleRunBacktest}
            />
            <BacktestMetrics metrics={metrics} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
          </div>

          <div className="min-h-full">
            <StrategyEquityChart
              stats={equityStats}
              candles={candles}
              orders={orders}
              startingEquity={chartStartingEquity}
              onSave={handleSaveResults}
              isSaving={isSavingBacktest}
              isSaveDisabled={isSaveDisabled}
              saveDisabledReason={saveDisabledReason}
              isViewingSaved={activeBacktestSource === "saved"}
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

function BacktestParameters({ parameters, isRunning, isDisabled, disabledReason, onRun }: BacktestParametersProps) {
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
    <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header>
        <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Parameters</p>
      </header>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
        {parameters.map((param) => (
          <div key={param.id} className={`space-y-1 ${param.id === "startingEquity" ? "md:col-span-2" : ""}`}>
            <label htmlFor={param.id} className="text-sm font-medium text-slate-200">
              {param.label}
            </label>
            <div className="relative">
              {param.prefix ? (
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
                  {param.prefix}
                </span>
              ) : null}
              <input
                id={param.id}
                name={param.id}
                type={param.type === "date" ? "date" : "text"}
                value={formState[param.id] ?? ""}
                onChange={(event) => updateField(param.id, event.target.value)}
                className={`w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none focus:ring-0 ${
                  param.prefix ? "pl-7" : ""
                }`}
              />
            </div>
          </div>
        ))}
        <div className="md:col-span-2">
          <button
            type="submit"
            className={`w-full rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 ${
              isDisabled
                ? "cursor-not-allowed bg-slate-700"
                : "bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:opacity-90"
            }`}
            disabled={isDisabled}
          >
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Loading…
              </span>
            ) : (
              "Run Backtest"
            )}
          </button>
          {isDisabled && !isRunning && disabledReason ? (
            <p className="mt-2 text-xs text-slate-400">{disabledReason}</p>
          ) : null}
        </div>
      </form>
    </article>
  );
}

function BacktestMetrics({ metrics, showPlaceholder, animatePlaceholder }: BacktestMetricsProps) {
  const left = metrics.filter((metric) => metric.column === "left");
  const right = metrics.filter((metric) => metric.column === "right");

  const renderMetric = (metric: BacktestMetric) => (
    <div key={metric.id}>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{metric.label}</dt>
      <dd className="text-2xl font-semibold text-white">
        {showPlaceholder ? (
          <Skeleton width="70%" height={28} enableAnimation={animatePlaceholder} />
        ) : (
          metric.value
        )}
      </dd>
    </div>
  );

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Metrics</p>
        </div>
      </header>
      <dl className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">{left.map(renderMetric)}</div>
        <div className="space-y-4">{right.map(renderMetric)}</div>
      </dl>
    </article>
  );
}

function StrategyEquityChart({
  stats,
  candles,
  orders,
  startingEquity,
  onSave,
  isSaving,
  isSaveDisabled,
  saveDisabledReason,
  isViewingSaved,
  showPlaceholder,
  animatePlaceholder,
}: StrategyEquityChartProps) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverLineRef = useRef<HTMLDivElement | null>(null);
  const hoverDotRef = useRef<HTMLDivElement | null>(null);
  const [chartType, setChartType] = useState<EquityChartType>("candles");
  const linePoints = useMemo(() => buildLinePoints(candles), [candles]);
  const allocationSeries = useMemo(
    () => buildAllocationSeries(candles, orders, startingEquity),
    [candles, orders, startingEquity]
  );

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
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });

    observer.observe(chartContainer);

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
        `<div class="text-xs uppercase tracking-[0.18em] text-slate-400">${formatTooltipDate(param.time)}</div>`,
        `<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-200">`,
        `<span class="text-slate-400">Open</span><span class="text-right font-mono">${currencyFormatter.format(seriesDatum.open)}</span>`,
        `<span class="text-slate-400">High</span><span class="text-right font-mono">${currencyFormatter.format(seriesDatum.high)}</span>`,
        `<span class="text-slate-400">Low</span><span class="text-right font-mono">${currencyFormatter.format(seriesDatum.low)}</span>`,
        `<span class="text-slate-400">Close</span><span class="text-right font-mono">${currencyFormatter.format(seriesDatum.close)}</span>`,
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

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [candles, chartType, showPlaceholder]);

  return (
    <article className="flex h-full min-h-[720px] flex-col rounded-3xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Strategy Equity</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <span>Graph</span>
            <select
              value={chartType}
              onChange={(event) => setChartType(event.target.value as EquityChartType)}
              className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="candles">Candles</option>
              <option value="line">Line</option>
              <option value="allocation">Allocation</option>
            </select>
          </label>
          <div
            className="group relative self-start"
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
              className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 ${
                isSaveDisabled
                  ? "cursor-not-allowed bg-slate-700/70 text-slate-300"
                  : "bg-fuchsia-500 hover:bg-fuchsia-400"
              }`}
            >
              {isViewingSaved ? "Saved Run" : isSaving ? "Saving…" : "Save to Results"}
            </button>
            {isSaveDisabled && saveDisabledReason ? (
              <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-72 rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm text-slate-200 opacity-0 shadow-xl transition duration-150 group-hover:opacity-100 group-focus:opacity-100">
                {saveDisabledReason}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <dl className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {stats.map((stat) => (
          <div key={stat.id} className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">{stat.label}</dt>
            <dd
              className={`${stat.id === "volume" ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"} font-semibold leading-tight ${stat.accentClass}`}
            >
              {showPlaceholder ? <Skeleton width="80%" height={28} enableAnimation={animatePlaceholder} /> : stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {showPlaceholder ? (
        <div className="mt-5 flex-1">
          <Skeleton width="30%" height={20} enableAnimation={animatePlaceholder} />
          <Skeleton height="100%" className="mt-4 min-h-[420px]" enableAnimation={animatePlaceholder} />
        </div>
      ) : chartType === "allocation" ? (
        <div className="mt-5 min-h-[420px] flex-1 overflow-hidden rounded-2xl">
          <RechartsAllocationChart series={allocationSeries} />
        </div>
      ) : chartType === "line" ? (
        <div className="mt-5 min-h-[420px] flex-1 overflow-hidden rounded-2xl">
          <RechartsEquityLineChart data={linePoints} />
        </div>
      ) : (
        <div ref={chartFrameRef} className="relative mt-5 min-h-[420px] flex-1 overflow-hidden rounded-2xl">
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
            className="pointer-events-none absolute left-0 top-0 z-10 w-56 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-3 opacity-0 shadow-xl transition-opacity duration-75"
          />
        </div>
      )}
    </article>
  );
}

function BacktestOrdersTable({ orders, logs, showPlaceholder, animatePlaceholder }: BacktestOrdersTableProps) {
  const [activeTab, setActiveTab] = useState<ExecutionPanelTab>("orders");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageSize, setPageSize] = useState(DEFAULT_EXECUTION_LOG_PAGE_SIZE);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "buy" | "sell">("all");

  useEffect(() => {
    setPage(1);
    setPageInput("1");
  }, [orders, pageSize, symbolFilter, actionFilter, activeTab]);

  const filteredOrders = useMemo(() => {
    const normalizedSymbol = symbolFilter.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSymbol = !normalizedSymbol || order.symbol.toLowerCase().includes(normalizedSymbol);
      const normalizedAction = String(order.action).toLowerCase();
      const matchesAction = actionFilter === "all" || normalizedAction === actionFilter;
      return matchesSymbol && matchesAction;
    });
  }, [actionFilter, orders, symbolFilter]);

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
    setPageInput(String(currentPage));
  }, [currentPage]);

  const applyPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }
    setPage(Math.min(totalPages, Math.max(1, parsed)));
  };

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Execution</p>
        </div>
      </header>

      <div className="mt-5 space-y-5">
        <div className="inline-flex rounded-2xl border border-slate-800 bg-slate-900/30 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {[
            { id: "orders" as const, label: "Orders" },
            { id: "logs" as const, label: "Logs" },
            { id: "warnings" as const, label: "Warnings" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? "bg-[linear-gradient(135deg,rgba(14,165,233,0.18),rgba(168,85,247,0.16))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {showPlaceholder && activeTab !== "logs" ? (
          <ExecutionPlaceholder animatePlaceholder={animatePlaceholder} />
        ) : activeTab === "logs" ? (
          animatePlaceholder ? (
            <ExecutionPlaceholder animatePlaceholder={true} />
          ) : logs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 py-8 text-center text-sm text-slate-400">
              No logs for this run.
            </div>
          ) : (
            <div className="space-y-4">
              <ExecutionFilters pageSize={pageSize} onPageSizeChange={setPageSize} />

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                <div>{`${logPageStart + 1}–${logPageStart + visibleLogs.length} of ${logs.length} entries`}</div>
                <div>{`${logs.length} total entries`}</div>
              </div>

              <div className="space-y-1 font-mono text-xs text-slate-300">
                {visibleLogs.map((line, i) => (
                  <div key={logPageStart + i} className="rounded-lg bg-slate-900/60 px-3 py-1.5 leading-relaxed">
                    {line}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
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
                    className="w-16 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-center text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
                  />
                  <span>of {totalLogPages}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={currentLogPage === 1}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalLogPages, current + 1))}
                    disabled={currentLogPage === totalLogPages}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )
        ) : activeTab === "warnings" ? (
          <ExecutionPlaceholder animatePlaceholder={false} label="Warnings panel coming soon." />
        ) : filteredOrders.length === 0 ? (
          <div className="space-y-4">
            <ExecutionFilters
              symbolFilter={symbolFilter}
              actionFilter={actionFilter}
              pageSize={pageSize}
              onSymbolFilterChange={setSymbolFilter}
              onActionFilterChange={setActionFilter}
              onPageSizeChange={setPageSize}
            />
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 py-8 text-center text-sm text-slate-400">
              {orders.length === 0 ? "No execution log entries for this run." : "No orders match the current filters."}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ExecutionFilters
              symbolFilter={symbolFilter}
              actionFilter={actionFilter}
              pageSize={pageSize}
              onSymbolFilterChange={setSymbolFilter}
              onActionFilterChange={setActionFilter}
              onPageSizeChange={setPageSize}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
              <div>{`${pageStart + 1}-${pageEnd} of ${filteredOrders.length} filtered orders`}</div>
              <div>{`${orders.length} total entries`}</div>
            </div>

            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Date · Time</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const isBuy = String(order.action).toLowerCase() === "buy";
                  const orderType = isBuy ? "Buy" : "Sell";
                  return (
                    <tr key={order.id} className="border-t border-slate-800 text-slate-200">
                      <td className="px-3 py-3">{dateFormatter.format(new Date(order.timestamp))}</td>
                      <td className="px-3 py-3 font-semibold">{order.symbol}</td>
                      <td className="px-3 py-3">
                        <span className={`font-semibold ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                          {orderType}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono">{currencyFormatter.format(order.price)}</td>
                      <td className="px-3 py-3">{numberFormatter.format(order.shares)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
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
                  className="w-16 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-center text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
                />
                <span>of {totalPages}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={currentPage === 1}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                >
                  Next
                </button>
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
  symbolFilter?: string;
  actionFilter?: "all" | "buy" | "sell";
  onSymbolFilterChange?: (value: string) => void;
  onActionFilterChange?: (value: "all" | "buy" | "sell") => void;
};

function ExecutionFilters({
  pageSize,
  onPageSizeChange,
  symbolFilter,
  actionFilter,
  onSymbolFilterChange,
  onActionFilterChange,
}: ExecutionFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-y border-slate-800 py-4">
      {symbolFilter !== undefined && onSymbolFilterChange !== undefined && (
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Ticker</span>
          <input
            type="text"
            value={symbolFilter}
            onChange={(event) => onSymbolFilterChange(event.target.value)}
            placeholder="Filter symbol"
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
          />
        </label>
      )}

      {actionFilter !== undefined && onActionFilterChange !== undefined && (
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Side</span>
          <select
            value={actionFilter}
            onChange={(event) => onActionFilterChange(event.target.value as "all" | "buy" | "sell")}
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
          >
            <option value="all">All</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
      )}

      <label className="space-y-1">
        <span className="text-xs uppercase tracking-[0.22em] text-slate-500">Show</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number.parseInt(event.target.value, 10))}
          className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
        >
          {EXECUTION_LOG_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} rows
            </option>
          ))}
        </select>
      </label>
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

const toDecimal = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : null);

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
  const sharpe = toDecimal(metrics?.sharpe_ratio);
  const sortino = toDecimal(metrics?.sortino);
  const alpha = toDecimal(metrics?.alpha);
  const beta = toDecimal(metrics?.beta);
  const psr = toDecimal(metrics?.psr);
  const winRate = toDecimal(metrics?.win_rate);
  const maxDrawdown = toDecimal(metrics?.max_drawdown);
  const totalOrders = toDecimal(metrics?.total_orders);
  const avgWin = toDecimal(metrics?.avg_win);
  const avgLoss = toDecimal(metrics?.avg_loss);
  const totalReturn = toDecimal(metrics?.total_return);
  const annualizedReturn = toDecimal(metrics?.annualized_return);

  return [
    { id: "sharpe", label: "Sharpe", value: formatNumber(sharpe), column: "left" },
    { id: "sortino", label: "Sortino", value: formatNumber(sortino), column: "left" },
    { id: "alpha", label: "Alpha", value: formatNumber(alpha), column: "left" },
    { id: "beta", label: "Beta", value: formatNumber(beta), column: "left" },
    { id: "psr", label: "PSR", value: formatNumber(psr), column: "left" },
    { id: "winRate", label: "Win Rate", value: formatPercent(winRate), column: "left" },
    { id: "totalReturn", label: "Total Return", value: formatPercent(totalReturn), column: "right" },
    { id: "annualizedReturn", label: "Ann. Return", value: formatPercent(annualizedReturn), column: "right" },
    { id: "maxDrawdown", label: "Max Drawdown", value: formatPercent(maxDrawdown), column: "right" },
    { id: "totalOrders", label: "Total Orders", value: totalOrders === null ? "—" : numberFormatter.format(totalOrders), column: "right" },
    { id: "avgWin", label: "Avg Win %", value: formatPercent(avgWin), column: "right" },
    { id: "avgLoss", label: "Avg Loss %", value: formatPercent(avgLoss), column: "right" },
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
      const direction = String(order.action).toLowerCase() === "buy" ? 1 : -1;
      const shares = direction * order.shares;
      const nextQuantity = (holdings.get(order.symbol) ?? 0) + shares;

      if (Math.abs(nextQuantity) < 1e-9) {
        holdings.delete(order.symbol);
      } else {
        holdings.set(order.symbol, nextQuantity);
      }

      latestPrices.set(order.symbol, order.price);
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
    id: order.id || `${order.timestamp}-${order.symbol}-${index}`,
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

function RechartsEquityLineChart({ data }: { data: EquityLinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical horizontal />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
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
    </ResponsiveContainer>
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
}: {
  series: { data: AllocationPoint[]; keys: string[] };
}) {
  if (!series.data.length || !series.keys.length) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 text-sm text-slate-400">
        No allocation snapshots could be derived from this run&apos;s orders.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[420px] gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
      <div className="min-h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical horizontal />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) => axisDateFormatter.format(new Date(Number(value) * 1000))}
              tick={{ fill: "#cbd5f5", fontSize: chartAxisFontSize, fontFamily: chartAxisFontFamily }}
              tickLine={false}
              axisLine={false}
              minTickGap={42}
            />
            <YAxis
              type="number"
              width={64}
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
        </ResponsiveContainer>
      </div>
      <aside className="rounded-2xl border border-slate-800/60 bg-slate-900/30 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Legend</p>
        <div className="mt-3 space-y-2">
          {series.keys.map((key, index) => (
            <div key={key} className="flex items-center gap-3 text-sm text-slate-200">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}
              />
              <span>{key}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

const buildEquityStats = (data: BacktestResponse | null): EquityStat[] => {
  if (!data) return [];

  const finalEquity = toDecimal(data.equity_stats?.equity);
  const fees = toDecimal(data.equity_stats?.fees);
  const netProfit = toDecimal(data.equity_stats?.net_profit);
  const returnPct = toDecimal(data.equity_stats?.return_pct);
  const volume = toDecimal(data.equity_stats?.volume);

  const profitAccent = netProfit !== null && netProfit >= 0 ? "text-emerald-300" : "text-rose-300";
  const returnAccent = returnPct !== null && returnPct >= 0 ? "text-emerald-300" : "text-rose-300";

  return [
    { id: "finalEquity", label: "Final Equity", value: formatMoney(finalEquity), accentClass: "text-white" },
    { id: "netProfit", label: "Net Profit", value: formatMoney(netProfit), accentClass: profitAccent },
    { id: "return", label: "Return", value: formatPercentValue(returnPct), accentClass: returnAccent },
    { id: "fees", label: "Fees", value: formatMoney(fees), accentClass: "text-white" },
    { id: "volume", label: "Volume", value: volume === null ? "—" : numberFormatter.format(volume), accentClass: "text-white" },
  ];
};
