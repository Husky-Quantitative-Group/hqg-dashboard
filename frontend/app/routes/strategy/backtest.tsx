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
type EquityChartType = "candles" | "line";

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
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

const EXECUTION_LOG_PAGE_SIZE = 25;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

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
            setIsRunningBacktest(false);
            addToast("Backtest finished", "success");
            console.log("[Backtest] Completed:", job);
          } else if (job.status === "FAILED" || job.status === "CANCELLED") {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setLatestBacktestData(null);
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
          setLatestBacktestStrategyVersion(null);
          setLatestBacktestStrategyCode(null);
          setIsRunningBacktest(false);
          addToast("Backtest failed", "warning");
          console.error("[Backtest] Polling error:", pollError);
        }
      }, POLL_INTERVAL_MS);
    } catch (submitError) {
      setLatestBacktestData(null);
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

        <BacktestOrdersTable orders={orders} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
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
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
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
            <dd className={`text-xl font-semibold leading-tight sm:text-2xl ${stat.accentClass}`}>
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

function BacktestOrdersTable({ orders, showPlaceholder, animatePlaceholder }: BacktestOrdersTableProps) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [orders]);

  const totalPages = Math.max(1, Math.ceil(orders.length / EXECUTION_LOG_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * EXECUTION_LOG_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + EXECUTION_LOG_PAGE_SIZE, orders.length);
  const visibleOrders = orders.slice(pageStart, pageEnd);

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Orders</p>
        </div>
        {!showPlaceholder ? (
          <div className="text-sm text-slate-400">
            {orders.length === 0 ? "0 entries" : `${pageStart + 1}-${pageEnd} of ${orders.length} entries`}
          </div>
        ) : null}
      </header>
      <div className="mt-4 overflow-x-auto">
        {showPlaceholder ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`order-skeleton-${index}`} height={32} enableAnimation={animatePlaceholder} />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-4 py-8 text-center text-sm text-slate-400">
            No execution log entries for this run.
          </div>
        ) : (
          <div className="space-y-4">
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

            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                <p className="text-sm text-slate-400">
                  Page {currentPage} of {totalPages}
                </p>
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
            ) : null}
          </div>
        )}
      </div>
    </article>
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

const axisValueFormatter = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

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
          tick={{ fill: "#cbd5f5", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          dataKey="equity"
          type="number"
          width={92}
          tickFormatter={(value) => axisValueFormatter(Number(value))}
          tick={{ fill: "#cbd5f5", fontSize: 12 }}
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
