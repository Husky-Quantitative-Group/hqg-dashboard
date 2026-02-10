import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { runBacktest, type BacktestResponse, type EquityCurve, type Metrics, type OhlcSeries, type Trade } from "~/api/backtest";
import { gzipJson, presignBacktestRunUpload, uploadPresignedPost } from "~/api/backtestMetrics";
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

type BacktestOrder = {
  id: string;
  timestamp: string;
  ticker: string;
  type: "Buy" | "Sell";
  price: number;
  amount: number;
};

type RunParameterState = Record<string, string>;

type BacktestParametersProps = {
  strategyName?: string;
  parameters: BacktestParameter[];
  isRunning: boolean;
  onRun: (values: RunParameterState) => void;
};

type BacktestMetricsProps = {
  metrics: BacktestMetric[];
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

type StrategyEquityChartProps = {
  strategyName?: string;
  stats: EquityStat[];
  candles: EquityCandle[];
  onSave: () => void;
  isSaving: boolean;
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

type BacktestOrdersTableProps = {
  orders: BacktestOrder[];
  showPlaceholder: boolean;
  animatePlaceholder: boolean;
};

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
  const { strategy, entrypoint, addToast } = useStrategyWorkspace();
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isSavingBacktest, setIsSavingBacktest] = useState(false);
  const [backtestData, setBacktestData] = useState<BacktestResponse | null>(null);
  const [lastRunParameters, setLastRunParameters] = useState<BacktestParameter[]>(DEFAULT_PARAMETERS);

  const handleRunBacktest = async (values: RunParameterState) => {
    if (isRunningBacktest) return;

    const strategyCode = entrypoint?.content ?? "";
    if (!strategyCode.trim()) {
      addToast("Entrypoint file is empty. Open the file to load its contents before running.", "warning");
      return;
    }

    const parsedStartingEquity = Number.parseFloat((values.startingEquity ?? "").replace(/,/g, ""));
    const initialCapital = Number.isFinite(parsedStartingEquity) ? parsedStartingEquity : 0;

    setIsRunningBacktest(true);
    addToast(`Queued backtest for ${values.name ?? "strategy"}`, "info");
    setLastRunParameters(
      DEFAULT_PARAMETERS.map((param) => ({
        ...param,
        value: values[param.id] ?? param.value,
      }))
    );

    try {
      const response = await runBacktest({
        strategy_code: strategyCode,
        start_date: values.startDate,
        end_date: values.endDate,
        initial_capital: initialCapital,
      });

      setBacktestData(response);
      addToast("Backtest finished", "success");
    } catch {
      addToast("Backtest failed", "warning");
    } finally {
      setIsRunningBacktest(false);
    }
  };


  const handleSaveResults = async () => {
    if (isSavingBacktest) return;
    if (!backtestData) {
      addToast("Run a backtest before saving.", "warning");
      return;
    }

    setIsSavingBacktest(true);
    addToast("Preparing upload…", "info");

    try {
      const presign = await presignBacktestRunUpload(strategy.id);

      const gz = await gzipJson(backtestData);

      await uploadPresignedPost(presign.s3.upload, gz, "run.json.gz");
      addToast(`Uploaded run ${presign.run_id}`, "success");
    } catch (error) {
      console.error("Failed to save backtest run", error);
      addToast("Save failed", "warning");
    } finally {
      setIsSavingBacktest(false);
    }
  };

  const showPlaceholder = !backtestData || isRunningBacktest;
  const animatePlaceholder = isRunningBacktest;
  const skeletonBaseColor = "#111a26";
  const skeletonHighlightColor = animatePlaceholder ? "#1d2a3f" : skeletonBaseColor;

  const metrics = useMemo(() => buildMetrics(backtestData?.metrics), [backtestData]);
  const candles = useMemo(
    () => buildCandles(backtestData?.ohlc, backtestData?.equity_curve),
    [backtestData]
  );
  const orders = useMemo(() => buildOrders(backtestData?.trades), [backtestData]);
  const equityStats = useMemo(
    () => buildEquityStats(backtestData, lastRunParameters),
    [backtestData, lastRunParameters]
  );

  return (
    <SkeletonTheme baseColor={skeletonBaseColor} highlightColor={skeletonHighlightColor}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Backtest</p>
            <h1 className="text-2xl font-semibold text-white">{strategy.name}</h1>
          </div>
          <p className="text-sm text-slate-400">Configure parameters, inspect metrics, and review orders.</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr] xl:grid-cols-[440px_1fr]">
          <div className="space-y-6">
            <BacktestParameters
              strategyName={strategy.name}
              parameters={lastRunParameters}
              isRunning={isRunningBacktest}
              onRun={handleRunBacktest}
            />
            <BacktestMetrics metrics={metrics} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
          </div>

          <div className="space-y-6">
            <StrategyEquityChart
              strategyName={strategy.name}
              stats={equityStats}
              candles={candles}
              onSave={handleSaveResults}
              isSaving={isSavingBacktest}
              showPlaceholder={showPlaceholder}
              animatePlaceholder={animatePlaceholder}
            />
            <BacktestOrdersTable orders={orders} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}

function BacktestParameters({ strategyName, parameters, isRunning, onRun }: BacktestParametersProps) {
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
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Parameters</p>
        <h2 className="text-lg font-semibold text-white">Backtest Parameters</h2>
        <p className="text-sm text-slate-400">{strategyName ? `Using ${strategyName}` : "Draft configuration"}</p>
      </header>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
        {parameters.map((param) => (
          <div key={param.id} className="space-y-1">
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
              isRunning ? "cursor-not-allowed bg-slate-700" : "bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:opacity-90"
            }`}
            disabled={isRunning}
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
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Metrics</p>
          <h2 className="text-lg font-semibold text-white">Performance Metrics</h2>
        </div>
      </header>
      <dl className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">{left.map(renderMetric)}</div>
        <div className="space-y-4">{right.map(renderMetric)}</div>
      </dl>
    </article>
  );
}

function StrategyEquityChart({ strategyName, stats, candles, onSave, isSaving, showPlaceholder, animatePlaceholder }: StrategyEquityChartProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [benchmarkEnabled, setBenchmarkEnabled] = useState(true);
  const [selectedBenchmark, setSelectedBenchmark] = useState("sp500");

  useEffect(() => {
    if (showPlaceholder || !chartContainerRef.current) {
      return;
    }

    const chart = createChart(chartContainerRef.current, {
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
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      borderVisible: false,
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

    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, showPlaceholder]);

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Strategy Equity</p>
          <h2 className="text-xl font-semibold text-white">{strategyName ?? "Active strategy"}</h2>
        </div>
	        <button
	          type="button"
	          onClick={onSave}
	          disabled={showPlaceholder || isSaving}
	          className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 ${
	            showPlaceholder || isSaving ? "cursor-not-allowed bg-slate-700/70 text-slate-300" : "bg-fuchsia-500 hover:bg-fuchsia-400"
	          }`}
	        >
	          {isSaving ? "Saving…" : "Save to Results"}
	        </button>
	      </header>

      <dl className="mt-6 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.id} className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-400">{stat.label}</dt>
            <dd className={`text-2xl font-semibold ${stat.accentClass}`}>
              {showPlaceholder ? <Skeleton width="80%" height={28} enableAnimation={animatePlaceholder} /> : stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {showPlaceholder ? (
        <div className="mt-5">
          <Skeleton width="30%" height={20} enableAnimation={animatePlaceholder} />
          <Skeleton height={320} className="mt-4" enableAnimation={animatePlaceholder} />
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <label className="inline-flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                checked={benchmarkEnabled}
                onChange={(event) => setBenchmarkEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-fuchsia-500 focus:ring-fuchsia-500"
              />
              Benchmark
            </label>
            <select
              value={selectedBenchmark}
              disabled={!benchmarkEnabled}
              onChange={(event) => setSelectedBenchmark(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="sp500">S&amp;P 500</option>
              <option value="nasdaq">NASDAQ 100</option>
              <option value="dow">Dow Jones</option>
            </select>
          </div>

          <div ref={chartContainerRef} className="mt-4 h-80 w-full" />
        </>
      )}
    </article>
  );
}

function BacktestOrdersTable({ orders, showPlaceholder, animatePlaceholder }: BacktestOrdersTableProps) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/40 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Orders</p>
          <h2 className="text-xl font-semibold text-white">Execution Log</h2>
        </div>
      </header>
      <div className="mt-4 overflow-x-auto">
        {showPlaceholder ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`order-skeleton-${index}`} height={32} enableAnimation={animatePlaceholder} />
            ))}
          </div>
        ) : (
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
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-3">{dateFormatter.format(new Date(order.timestamp))}</td>
                  <td className="px-3 py-3 font-semibold">{order.ticker}</td>
                  <td className="px-3 py-3">
                    <span className={`font-semibold ${order.type === "Buy" ? "text-emerald-400" : "text-rose-400"}`}>
                      {order.type}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono">{currencyFormatter.format(order.price)}</td>
                  <td className="px-3 py-3">{numberFormatter.format(order.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}

function toUnixTime(dateString: string): UTCTimestamp {
  const input = dateString.trim();

  let normalized = input;
  // Handle "YYYY-MM-DD HH:mm:ss" (common from pandas) deterministically as UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    normalized = `${input.replace(" ", "T")}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    normalized = `${input}T00:00:00Z`;
  }

  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    return Math.floor(new Date(input).getTime() / 1000) as UTCTimestamp;
  }

  return Math.floor(ms / 1000) as UTCTimestamp;
}

const DEFAULT_PARAMETERS: BacktestParameter[] = [
  { id: "name", label: "Name", value: "Backtest Trial 1", type: "text" },
  { id: "startingEquity", label: "Starting Equity", value: "100000", prefix: "$", type: "currency" },
  { id: "startDate", label: "Start Date", value: "2020-01-03", type: "date" },
  { id: "endDate", label: "End Date", value: "2024-01-03", type: "date" },
];

const toDecimal = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : null);

const formatNumber = (value: number | null, decimals = 2) =>
  value === null ? "—" : value.toFixed(decimals);

const formatPercent = (value: number | null, decimals = 2) => {
  if (value === null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
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

const buildCandlesFromOhlc = (ohlc?: OhlcSeries): EquityCandle[] => {
  if (!ohlc) return [];

  const entries = Object.entries(ohlc)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => toUnixTime(a.date) - toUnixTime(b.date));

  return entries.map(({ date, value }) => ({
    time: toUnixTime(date),
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
  }));
};

const buildCandlesFromEquityCurve = (equityCurve?: EquityCurve): EquityCandle[] => {
  if (!equityCurve) return [];

  const entries = Object.entries(equityCurve)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => toUnixTime(a.date) - toUnixTime(b.date));

  if (entries.length === 0) return [];

  const candles: EquityCandle[] = [];
  let previous = entries[0].value;
  for (const entry of entries) {
    const open = previous;
    const close = entry.value;
    candles.push({
      time: toUnixTime(entry.date),
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    });
    previous = close;
  }

  return candles;
};

const buildCandles = (ohlc?: OhlcSeries, equityCurve?: EquityCurve): EquityCandle[] => {
  const fromOhlc = buildCandlesFromOhlc(ohlc);
  if (fromOhlc.length > 0) return fromOhlc;
  return buildCandlesFromEquityCurve(equityCurve);
};

const buildOrders = (trades?: Trade[]): BacktestOrder[] => {
  if (!trades) return [];

  return trades.map((trade, index) => ({
    id: `${trade.timestamp}-${trade.symbol}-${index}`,
    timestamp: trade.timestamp,
    ticker: trade.symbol,
    type: trade.action === "buy" ? "Buy" : "Sell",
    price: trade.price,
    amount: trade.shares,
  }));
};

const buildEquityStats = (data: BacktestResponse | null, params: BacktestParameter[]): EquityStat[] => {
  if (!data) return [];

  const startingEquityParam = params.find((p) => p.id === "startingEquity")?.value ?? "0";
  const parsedStarting = Number.parseFloat(startingEquityParam.replace(/,/g, ""));
  const initialCapital = Number.isFinite(parsedStarting) ? parsedStarting : 0;

  const finalEquity = data.final_value ?? null;
  const cash = data.final_cash ?? null;
  const netProfit = finalEquity === null ? null : finalEquity - initialCapital;
  const returnPct = netProfit === null || initialCapital === 0 ? null : netProfit / initialCapital;

  const profitAccent = netProfit !== null && netProfit >= 0 ? "text-emerald-300" : "text-rose-300";
  const returnAccent = returnPct !== null && returnPct >= 0 ? "text-emerald-300" : "text-rose-300";

  const positionsCount = Array.isArray(data.final_positions) ? data.final_positions.length : 0;

  return [
    { id: "finalEquity", label: "Final Equity", value: formatMoney(finalEquity), accentClass: "text-white" },
    { id: "netProfit", label: "Net Profit", value: formatMoney(netProfit), accentClass: profitAccent },
    { id: "return", label: "Return", value: formatPercent(returnPct), accentClass: returnAccent },
    { id: "cash", label: "Cash", value: formatMoney(cash), accentClass: "text-white" },
    { id: "positions", label: "Positions", value: String(positionsCount), accentClass: "text-white" },
  ];
};
