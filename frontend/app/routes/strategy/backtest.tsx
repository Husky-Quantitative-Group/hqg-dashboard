import { type FormEvent, useEffect, useRef, useState, useMemo } from "react";
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
import { runBacktest, type BacktestResponse, type EquityCurve, type Metrics, type Trade } from "~/api/backtest";
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
  const [hasHydratedResults, setHasHydratedResults] = useState(false);
  const [backtestData, setBacktestData] = useState<BacktestResponse | null>(null);

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
    setHasHydratedResults(false);
    addToast(`Queued backtest for ${values.name ?? "strategy"}`, "info");

    try {
      const response = await runBacktest({
        strategy_code: strategyCode,
        start_date: values.startDate ?? "",
        end_date: values.endDate ?? "",
        initial_capital: initialCapital,
      });

      setBacktestData(response);
      addToast("Backtest finished", "success");
      setHasHydratedResults(true);
    } catch {
      addToast("Backtest failed", "warning");
    } finally {
      setIsRunningBacktest(false);
    }
  };


  const handleSaveResults = () => {
    addToast("Saved backtest snapshot to results", "success");
  };

  const showPlaceholder = !hasHydratedResults || isRunningBacktest;
  const animatePlaceholder = isRunningBacktest;
  const skeletonBaseColor = "#111a26";
  const skeletonHighlightColor = animatePlaceholder ? "#1d2a3f" : skeletonBaseColor;

  const metrics = useMemo(() => buildMetrics(backtestData?.metrics), [backtestData]);
  const candles = useMemo(() => buildCandles(backtestData?.equity_curve), [backtestData]);
  const orders = useMemo(() => buildOrders(backtestData?.trades), [backtestData]);

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
              parameters={MOCK_PARAMETERS}
              isRunning={isRunningBacktest}
              onRun={handleRunBacktest}
            />
            <BacktestMetrics metrics={metrics} showPlaceholder={showPlaceholder} animatePlaceholder={animatePlaceholder} />
          </div>

          <div className="space-y-6">
            <StrategyEquityChart
              strategyName={strategy.name}
              stats={MOCK_EQUITY_STATS}
              candles={candles}
              onSave={handleSaveResults}
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

function StrategyEquityChart({ strategyName, stats, candles, onSave, showPlaceholder, animatePlaceholder }: StrategyEquityChartProps) {
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
          disabled={showPlaceholder}
          className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-500 ${
            showPlaceholder ? "cursor-not-allowed bg-slate-700/70 text-slate-300" : "bg-fuchsia-500 hover:bg-fuchsia-400"
          }`}
        >
          Save to Results
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
  return Math.floor(new Date(dateString).getTime() / 1000) as UTCTimestamp;
}

const MOCK_PARAMETERS: BacktestParameter[] = [
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
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(decimals)}%`;
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

const buildCandles = (equityCurve?: EquityCurve): EquityCandle[] => {
  if (!equityCurve) return [];

  const entries = Object.entries(equityCurve)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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

const MOCK_METRICS: BacktestMetric[] = [
  { id: "sharpe", label: "Sharpe", value: "4.42", column: "left" },
  { id: "alpha", label: "Alpha", value: "1.65", column: "left" },
  { id: "winRate", label: "Win Rate", value: "50%", column: "left" },
  { id: "orders", label: "Total Orders", value: "500", column: "left" },
  { id: "avgWin", label: "Avg Win %", value: "14.89%", column: "left" },
  { id: "linearityError", label: "Linearity Error", value: "0.08", column: "left" },
  { id: "sortino", label: "Sortino", value: "1.83", column: "right" },
  { id: "beta", label: "Beta", value: "2.59", column: "right" },
  { id: "psr", label: "PSR", value: "4.42", column: "right" },
  { id: "drawdown", label: "Drawdown", value: "15.51", column: "right" },
  { id: "avgLoss", label: "Avg Loss %", value: "2.5%", column: "right" },
  { id: "rateDrift", label: "Rate Drift", value: "+1.2", column: "right" },
];

const MOCK_EQUITY_STATS: EquityStat[] = [
  { id: "equity", label: "Equity", value: "$113,941.91", accentClass: "text-emerald-400" },
  { id: "fees", label: "Fees", value: "-$11.12", accentClass: "text-rose-400" },
  { id: "netProfit", label: "Net Profit", value: "$13,941.91", accentClass: "text-emerald-400" },
  { id: "return", label: "Return %", value: "13.94%", accentClass: "text-emerald-300" },
  { id: "volume", label: "Volume", value: "$500,000", accentClass: "text-emerald-300" },
];

const MOCK_CANDLES: EquityCandle[] = [
  { time: toUnixTime("2024-11-11"), open: 100000.00, high: 100140.63, low: 99631.04, close: 99875.02 },
  { time: toUnixTime("2024-11-12"), open: 99912.46, high: 100017.64, low: 99188.20, close: 99586.11 },
  { time: toUnixTime("2024-11-13"), open: 99615.40, high: 99988.85, low: 99285.22, close: 99609.24 },
  { time: toUnixTime("2024-11-14"), open: 99680.80, high: 99750.70, low: 98891.97, close: 99006.63 },
  { time: toUnixTime("2024-11-15"), open: 98401.19, high: 98443.30, low: 97406.33, close: 97699.40 },
  { time: toUnixTime("2024-11-18"), open: 97758.48, high: 98323.48, low: 97621.68, close: 98082.17 },
  { time: toUnixTime("2024-11-19"), open: 97689.91, high: 98579.60, low: 97444.27, close: 98470.92 },
  { time: toUnixTime("2024-11-20"), open: 98426.99, high: 98532.33, low: 97531.98, close: 98473.09 },
  { time: toUnixTime("2024-11-21"), open: 98863.68, high: 99242.12, low: 97976.32, close: 98998.98 },
  { time: toUnixTime("2024-11-22"), open: 98926.59, high: 99401.55, low: 98926.59, close: 99342.30 },
  { time: toUnixTime("2024-11-25"), open: 99724.07, high: 100197.87, low: 99251.94, close: 99642.36 },
  { time: toUnixTime("2024-11-26"), open: 99853.05, high: 100275.59, low: 99723.91, close: 100212.52 },
  { time: toUnixTime("2024-11-27"), open: 100087.37, high: 100188.06, low: 99600.76, close: 99831.58 },
  { time: toUnixTime("2024-11-29"), open: 99918.79, high: 100587.63, low: 99918.79, close: 100391.42 },
  { time: toUnixTime("2024-12-02"), open: 100520.07, high: 100744.23, low: 100440.52, close: 100637.23 },
  { time: toUnixTime("2024-12-03"), open: 100567.66, high: 100719.10, low: 100408.23, close: 100682.66 },
  { time: toUnixTime("2024-12-04"), open: 101007.35, high: 101347.68, low: 100868.72, close: 101291.93 },
  { time: toUnixTime("2024-12-05"), open: 101334.20, high: 101426.06, low: 101065.76, close: 101102.54 },
  { time: toUnixTime("2024-12-06"), open: 101206.88, high: 101516.26, low: 101183.59, close: 101354.83 },
  { time: toUnixTime("2024-12-09"), open: 101234.01, high: 101325.54, low: 100661.86, close: 100732.09 },
  { time: toUnixTime("2024-12-10"), open: 100810.97, high: 100940.94, low: 100349.98, close: 100433.53 },
  { time: toUnixTime("2024-12-11"), open: 100853.57, high: 101393.44, low: 100853.57, close: 101253.65 },
  { time: toUnixTime("2024-12-12"), open: 101088.89, high: 101178.59, low: 100705.46, close: 100705.46 },
  { time: toUnixTime("2024-12-13"), open: 100987.04, high: 101160.29, low: 100447.84, close: 100702.80 },
  { time: toUnixTime("2024-12-16"), open: 100914.15, high: 101270.29, low: 100836.76, close: 101085.40 },
  { time: toUnixTime("2024-12-17"), open: 100727.09, high: 100812.47, low: 100438.19, close: 100694.81 },
  { time: toUnixTime("2024-12-18"), open: 100645.55, high: 101028.65, low: 97652.30, close: 97725.03 },
  { time: toUnixTime("2024-12-19"), open: 98399.86, high: 98779.47, low: 97623.68, close: 97640.48 },
  { time: toUnixTime("2024-12-20"), open: 97223.10, high: 99553.99, low: 97061.67, close: 98701.75 },
  { time: toUnixTime("2024-12-23"), open: 98858.19, high: 99490.59, low: 98231.11, close: 99421.02 },
  { time: toUnixTime("2024-12-24"), open: 99596.76, high: 100519.90, low: 99543.67, close: 100518.90 },
  { time: toUnixTime("2024-12-26"), open: 100268.10, high: 100680.50, low: 99975.20, close: 100478.13 },
  { time: toUnixTime("2024-12-27"), open: 99955.23, high: 99955.23, low: 98736.70, close: 99367.27 },
  { time: toUnixTime("2024-12-30"), open: 98532.33, high: 98867.17, low: 97675.10, close: 98303.84 },
  { time: toUnixTime("2024-12-31"), open: 98516.86, high: 98683.28, low: 97670.11, close: 97882.63 },
  { time: toUnixTime("2025-01-02"), open: 98242.60, high: 98772.31, low: 97015.57, close: 97664.95 },
  { time: toUnixTime("2025-01-03"), open: 98039.73, high: 99009.46, low: 97999.62, close: 98895.13 },
  { time: toUnixTime("2025-01-06"), open: 99566.47, high: 100202.70, low: 99187.03, close: 99442.82 },
  { time: toUnixTime("2025-01-07"), open: 99740.38, high: 99863.87, low: 98033.24, close: 98338.62 },
  { time: toUnixTime("2025-01-08"), open: 98365.75, high: 98652.49, low: 97768.63, close: 98492.06 },
  { time: toUnixTime("2025-01-10"), open: 98027.75, high: 98027.75, low: 96653.61, close: 96974.13 },
  { time: toUnixTime("2025-01-13"), open: 96224.91, high: 97166.68, low: 96079.96, close: 97126.91 },
  { time: toUnixTime("2025-01-14"), open: 97510.51, high: 97721.03, low: 96614.33, close: 97238.24 },
  { time: toUnixTime("2025-01-15"), open: 98275.05, high: 99197.02, low: 98275.05, close: 99018.95 },
  { time: toUnixTime("2025-01-16"), open: 99246.95, high: 99264.92, low: 98699.59, close: 98809.76 },
  { time: toUnixTime("2025-01-17"), open: 99776.00, high: 100101.52, low: 99493.75, close: 99796.97 },
  { time: toUnixTime("2025-01-21"), open: 100087.54, high: 100709.79, low: 99967.05, close: 100672.01 },
  { time: toUnixTime("2025-01-22"), open: 101207.05, high: 101530.24, low: 101119.51, close: 101289.93 },
  { time: toUnixTime("2025-01-23"), open: 101122.68, high: 101828.47, low: 101095.22, close: 101828.13 },
  { time: toUnixTime("2025-01-24"), open: 101873.40, high: 101985.73, low: 101329.37, close: 101537.40 },
  { time: toUnixTime("2025-01-27"), open: 99337.31, high: 100138.30, low: 99235.46, close: 100056.92 },
  { time: toUnixTime("2025-01-28"), open: 100301.39, high: 101093.05, low: 99763.18, close: 100979.22 },
  { time: toUnixTime("2025-01-29"), open: 100812.80, high: 100898.17, low: 100068.23, close: 100506.75 },
  { time: toUnixTime("2025-01-30"), open: 100697.14, high: 101294.42, low: 100309.54, close: 101036.97 },
  { time: toUnixTime("2025-01-31"), open: 101463.34, high: 101864.75, low: 100367.29, close: 100527.06 },
  { time: toUnixTime("2025-02-03"), open: 99347.46, high: 100220.84, low: 98586.59, close: 99762.18 },
  { time: toUnixTime("2025-02-04"), open: 99821.60, high: 100559.51, low: 99700.61, close: 100482.95 },
  { time: toUnixTime("2025-02-05"), open: 100192.88, high: 100898.67, low: 99970.04, close: 100875.71 },
  { time: toUnixTime("2025-02-06"), open: 101054.44, high: 101250.99, low: 100631.90, close: 101243.33 },
  { time: toUnixTime("2025-02-07"), open: 101236.01, high: 101538.06, low: 100184.73, close: 100285.08 },
  { time: toUnixTime("2025-02-10"), open: 100624.74, high: 101073.75, low: 100598.78, close: 100958.25 },
  { time: toUnixTime("2025-02-11"), open: 100673.34, high: 101122.01, low: 100557.18, close: 100992.53 },
  { time: toUnixTime("2025-02-12"), open: 100269.93, high: 100901.00, low: 99902.48, close: 100717.44 },
  { time: toUnixTime("2025-02-13"), open: 100860.90, high: 101798.18, low: 100700.47, close: 101767.56 },
  { time: toUnixTime("2025-02-14"), open: 101775.05, high: 101973.92, low: 101643.57, close: 101760.23 },
  { time: toUnixTime("2025-02-18"), open: 101876.23, high: 102009.87, low: 101508.61, close: 102009.03 },
  { time: toUnixTime("2025-02-19"), open: 101812.32, high: 102306.09, low: 101702.32, close: 102251.51 },
  { time: toUnixTime("2025-02-20"), open: 102090.91, high: 102090.91, low: 101260.31, close: 101808.33 },
  { time: toUnixTime("2025-02-21"), open: 101751.41, high: 101763.40, low: 99995.01, close: 100071.06 },
  { time: toUnixTime("2025-02-24"), open: 100296.73, high: 100578.98, low: 99483.60, close: 99573.80 },
  { time: toUnixTime("2025-02-25"), open: 99565.14, high: 99730.23, low: 98329.63, close: 99107.82 },
  { time: toUnixTime("2025-02-26"), open: 99367.77, high: 100015.98, low: 98732.37, close: 99121.30 },
  { time: toUnixTime("2025-02-27"), open: 99551.00, high: 99747.54, low: 97502.35, close: 97548.79 },
  { time: toUnixTime("2025-02-28"), open: 97468.40, high: 99176.88, low: 97150.87, close: 99095.34 },
  { time: toUnixTime("2025-03-03"), open: 99325.50, high: 99621.06, low: 96705.70, close: 97351.58 },
  { time: toUnixTime("2025-03-04"), open: 96723.50, high: 97607.20, low: 95402.29, close: 96160.50 },
  { time: toUnixTime("2025-03-05"), open: 96213.92, high: 97532.48, low: 95564.72, close: 97233.59 },
  { time: toUnixTime("2025-03-06"), open: 96288.98, high: 96725.17, low: 95053.64, close: 95500.98 },
  { time: toUnixTime("2025-03-07"), open: 95292.78, high: 96241.38, low: 94298.92, close: 96028.20 },
  { time: toUnixTime("2025-03-10"), open: 94949.29, high: 94949.29, low: 92596.93, close: 93438.02 },
  { time: toUnixTime("2025-03-11"), open: 93256.46, high: 93799.82, low: 92004.31, close: 92730.90 },
  { time: toUnixTime("2025-03-12"), open: 93609.10, high: 93897.84, low: 92298.54, close: 93184.06 },
  { time: toUnixTime("2025-03-13"), open: 93103.35, high: 93158.77, low: 91608.89, close: 91889.64 },
  { time: toUnixTime("2025-03-14"), open: 92594.10, high: 93949.10, low: 92594.10, close: 93843.76 },
  { time: toUnixTime("2025-03-17"), open: 93788.17, high: 94918.50, low: 93713.62, close: 94445.87 },
  { time: toUnixTime("2025-03-18"), open: 94103.21, high: 94103.21, low: 93158.44, close: 93439.69 },
  { time: toUnixTime("2025-03-19"), open: 93734.42, high: 95115.05, low: 93565.17, close: 94448.70 },
  { time: toUnixTime("2025-03-20"), open: 93976.56, high: 95045.48, low: 93733.75, close: 94242.34 },
  { time: toUnixTime("2025-03-21"), open: 93707.13, high: 94374.64, low: 93247.30, close: 94320.05 },
  { time: toUnixTime("2025-03-24"), open: 95160.81, high: 96110.41, low: 95160.81, close: 95984.43 },
  { time: toUnixTime("2025-03-25"), open: 96124.06, high: 96306.95, low: 95865.44, close: 96135.54 },
  { time: toUnixTime("2025-03-26"), open: 96052.50, high: 96251.54, low: 94766.89, close: 95062.96 },
  { time: toUnixTime("2025-03-27"), open: 94787.36, high: 95397.13, low: 94376.30, close: 94748.59 },
  { time: toUnixTime("2025-03-28"), open: 94513.77, high: 94625.10, low: 92736.73, close: 92878.52 },
  { time: toUnixTime("2025-03-31"), open: 91995.99, high: 93654.37, low: 91343.95, close: 93392.92 },
  { time: toUnixTime("2025-04-01"), open: 93154.61, high: 94037.30, low: 92505.40, close: 93746.07 },
  { time: toUnixTime("2025-04-02"), open: 92875.52, high: 94781.87, low: 92721.08, close: 94376.80 },
  { time: toUnixTime("2025-04-03"), open: 91410.68, high: 91523.68, low: 89714.69, close: 89809.38 },
  { time: toUnixTime("2025-04-04"), open: 88072.28, high: 88072.28, low: 84373.74, close: 84443.31 },
  { time: toUnixTime("2025-04-07"), open: 82441.43, high: 87313.90, low: 80465.18, close: 84246.43 },
  { time: toUnixTime("2025-04-08"), open: 86431.87, high: 87661.72, low: 81719.66, close: 82923.72 },
  { time: toUnixTime("2025-04-09"), open: 82632.65, high: 91220.96, low: 82352.23, close: 90814.23 },
  { time: toUnixTime("2025-04-10"), open: 89087.61, high: 89087.61, low: 85128.79, close: 87671.37 },
  { time: toUnixTime("2025-04-11"), open: 87463.51, high: 89558.75, low: 86884.53, close: 89257.53 },
  { time: toUnixTime("2025-04-14"), open: 90565.60, high: 90856.83, low: 89168.66, close: 89966.65 },
  { time: toUnixTime("2025-04-15"), open: 90066.83, high: 90706.22, low: 89641.63, close: 89811.21 },
  { time: toUnixTime("2025-04-16"), open: 88798.04, high: 89322.10, low: 86884.87, close: 87798.68 },
  { time: toUnixTime("2025-04-17"), open: 88293.79, high: 88674.22, low: 87463.85, close: 87915.18 },
  { time: toUnixTime("2025-04-21"), open: 87087.07, high: 87087.07, low: 84901.80, close: 85843.24 },
  { time: toUnixTime("2025-04-22"), open: 86666.52, high: 88363.02, low: 86666.52, close: 87999.39 },
  { time: toUnixTime("2025-04-23"), open: 89799.40, high: 91027.08, low: 89137.87, close: 89465.56 },
  { time: toUnixTime("2025-04-24"), open: 89557.42, high: 91355.10, low: 89400.65, close: 91278.05 },
  { time: toUnixTime("2025-04-25"), open: 91360.59, high: 91999.31, low: 90796.92, close: 91951.05 },
  { time: toUnixTime("2025-04-28"), open: 92017.79, high: 92424.52, low: 91009.61, close: 92009.97 },
  { time: toUnixTime("2025-04-29"), open: 91679.12, high: 92728.90, low: 91626.37, close: 92543.84 },
  { time: toUnixTime("2025-04-30"), open: 91522.19, high: 92893.49, low: 90420.48, close: 92680.81 },
  { time: toUnixTime("2025-05-01"), open: 93614.10, high: 94176.10, low: 93151.61, close: 93264.61 },
  { time: toUnixTime("2025-05-02"), open: 93959.25, high: 94871.57, low: 93899.34, close: 94638.08 },
  { time: toUnixTime("2025-05-05"), open: 94116.35, high: 94583.33, low: 93769.53, close: 94034.14 },
  { time: toUnixTime("2025-05-06"), open: 93293.40, high: 94020.83, low: 92963.39, close: 93310.71 },
  { time: toUnixTime("2025-05-07"), open: 93431.70, high: 94106.54, low: 92840.24, close: 93716.28 },
  { time: toUnixTime("2025-05-08"), open: 94254.15, high: 95194.43, low: 93784.51, close: 94259.81 },
  { time: toUnixTime("2025-05-09"), open: 94521.26, high: 94721.63, low: 93930.46, close: 94192.74 },
  { time: toUnixTime("2025-05-12"), open: 96643.96, high: 97279.18, low: 96292.47, close: 97259.55 },
  { time: toUnixTime("2025-05-13"), open: 97425.30, high: 98298.85, low: 97273.36, close: 97964.51 },
  { time: toUnixTime("2025-05-14"), open: 98134.09, high: 98297.35, low: 97724.19, close: 98064.86 },
  { time: toUnixTime("2025-05-15"), open: 97686.08, high: 98591.25, low: 97608.53, close: 98470.09 },
  { time: toUnixTime("2025-05-16"), open: 98672.46, high: 99163.90, low: 98310.83, close: 99159.91 },
  { time: toUnixTime("2025-05-19"), open: 98236.27, high: 99330.16, low: 98116.61, close: 99246.78 },
  { time: toUnixTime("2025-05-20"), open: 98931.58, high: 99071.37, low: 98342.45, close: 98861.68 },
  { time: toUnixTime("2025-05-21"), open: 98357.76, high: 98826.90, low: 97038.54, close: 97266.54 },
  { time: toUnixTime("2025-05-22"), open: 97210.79, high: 97823.55, low: 96953.83, close: 97223.27 },
  { time: toUnixTime("2025-05-23"), open: 96222.74, high: 97015.24, low: 95981.77, close: 96571.06 },
  { time: toUnixTime("2025-05-27"), open: 97423.97, high: 98593.24, low: 97423.97, close: 98546.81 },
  { time: toUnixTime("2025-05-28"), open: 98613.38, high: 98852.69, low: 97886.79, close: 97997.79 },
  { time: toUnixTime("2025-05-29"), open: 98853.36, high: 98906.12, low: 97752.32, close: 98390.88 },
  { time: toUnixTime("2025-05-30"), open: 98249.42, high: 98556.80, low: 97250.73, close: 98382.89 },
  { time: toUnixTime("2025-06-02"), open: 98133.09, high: 98810.76, low: 97546.46, close: 98786.46 },
  { time: toUnixTime("2025-06-03"), open: 98830.06, high: 99542.18, low: 98670.96, close: 99359.45 },
  { time: toUnixTime("2025-06-04"), open: 99502.07, high: 99694.12, low: 99288.55, close: 99366.77 },
  { time: toUnixTime("2025-06-05"), open: 99614.07, high: 99847.56, low: 98541.15, close: 98842.38 },
  { time: toUnixTime("2025-06-06"), open: 99637.20, high: 100133.30, low: 99496.91, close: 99858.54 },
  { time: toUnixTime("2025-06-09"), open: 99929.60, high: 100207.19, low: 99755.69, close: 99950.41 },
  { time: toUnixTime("2025-06-10"), open: 100017.47, high: 100568.33, low: 99857.21, close: 100498.43 },
  { time: toUnixTime("2025-06-11"), open: 100674.34, high: 100841.09, low: 99891.16, close: 100222.67 },
  { time: toUnixTime("2025-06-12"), open: 100017.31, high: 100608.60, low: 99917.12, close: 100605.77 },
  { time: toUnixTime("2025-06-13"), open: 99861.87, high: 100287.91, low: 99240.29, close: 99469.28 },
  { time: toUnixTime("2025-06-16"), open: 99919.12, high: 100698.47, low: 99919.12, close: 100403.57 },
  { time: toUnixTime("2025-06-17"), open: 100054.75, high: 100239.48, low: 99433.17, close: 99564.98 },
  { time: toUnixTime("2025-06-18"), open: 99651.68, high: 100156.27, low: 99384.74, close: 99534.19 },
  { time: toUnixTime("2025-06-20"), open: 99847.06, high: 100155.44, low: 99063.05, close: 99317.34 },
  { time: toUnixTime("2025-06-23"), open: 99347.80, high: 100331.34, low: 98907.78, close: 100271.43 },
  { time: toUnixTime("2025-06-24"), open: 100871.21, high: 101546.05, low: 100838.60, close: 101386.62 },
  { time: toUnixTime("2025-06-25"), open: 101587.16, high: 101658.38, low: 101185.42, close: 101386.29 },
  { time: toUnixTime("2025-06-26"), open: 101717.96, high: 102290.95, low: 101637.75, close: 102199.42 },
  { time: toUnixTime("2025-06-27"), open: 102360.51, high: 102975.94, low: 102055.13, close: 102732.80 },
  { time: toUnixTime("2025-06-30"), open: 103070.47, high: 103431.93, low: 102764.42, close: 103263.35 },
  { time: toUnixTime("2025-07-01"), open: 102968.78, high: 103360.37, low: 102814.34, close: 103147.85 },
  { time: toUnixTime("2025-07-02"), open: 103079.12, high: 103640.29, low: 102986.09, close: 103637.30 },
  { time: toUnixTime("2025-07-03"), open: 103954.16, high: 104589.72, low: 103954.16, close: 104501.52 },
  { time: toUnixTime("2025-07-07"), open: 104163.52, high: 104213.94, low: 103197.61, close: 103679.90 },
  { time: toUnixTime("2025-07-08"), open: 103747.30, high: 103891.59, low: 103476.37, close: 103605.68 },
  { time: toUnixTime("2025-07-09"), open: 103902.07, high: 104331.94, low: 103704.03, close: 104233.75 },
  { time: toUnixTime("2025-07-10"), open: 104292.66, high: 104682.42, low: 104037.04, close: 104519.99 },
  { time: toUnixTime("2025-07-11"), open: 104107.60, high: 104336.60, low: 103806.71, close: 104175.33 },
  { time: toUnixTime("2025-07-14"), open: 104098.78, high: 104401.00, low: 103833.67, close: 104321.95 },
  { time: toUnixTime("2025-07-15"), open: 104766.79, high: 104879.13, low: 103874.61, close: 103909.23 },
  { time: toUnixTime("2025-07-16"), open: 104087.96, high: 104314.63, low: 103207.43, close: 104241.07 },
  { time: toUnixTime("2025-07-17"), open: 104236.08, high: 104923.23, low: 104217.27, close: 104801.24 },
  { time: toUnixTime("2025-07-18"), open: 105060.69, high: 105104.96, low: 104600.04, close: 104791.76 },
  { time: toUnixTime("2025-07-21"), open: 104924.06, high: 105445.63, low: 104908.25, close: 104938.37 },
  { time: toUnixTime("2025-07-22"), open: 104955.02, high: 105113.45, low: 104540.79, close: 105005.28 },
  { time: toUnixTime("2025-07-23"), open: 105292.85, high: 105854.36, low: 105136.25, close: 105825.56 },
  { time: toUnixTime("2025-07-24"), open: 105986.83, high: 106198.35, low: 105853.19, close: 105899.46 },
  { time: toUnixTime("2025-07-25"), open: 106010.29, high: 106439.82, low: 105985.66, close: 106320.33 },
  { time: toUnixTime("2025-07-28"), open: 106470.94, high: 106527.19, low: 106106.48, close: 106339.14 },
  { time: toUnixTime("2025-07-29"), open: 106602.92, high: 106663.49, low: 105908.94, close: 106024.44 },
  { time: toUnixTime("2025-07-30"), open: 106197.02, high: 106451.81, low: 105450.62, close: 105891.97 },
  { time: toUnixTime("2025-07-31"), open: 106959.06, high: 106959.06, low: 105305.17, close: 105500.71 },
  { time: toUnixTime("2025-08-01"), open: 104633.49, high: 104633.49, low: 103392.16, close: 103813.54 },
  { time: toUnixTime("2025-08-04"), open: 104374.37, high: 105355.92, low: 104374.37, close: 105343.44 },
  { time: toUnixTime("2025-08-05"), open: 105454.78, high: 105610.71, low: 104668.27, close: 104831.70 },
  { time: toUnixTime("2025-08-06"), open: 104999.95, high: 105724.38, low: 104863.65, close: 105595.07 },
  { time: toUnixTime("2025-08-07"), open: 106082.02, high: 106338.14, low: 105016.93, close: 105510.86 },
  { time: toUnixTime("2025-08-08"), open: 105764.15, high: 106428.84, low: 105764.15, close: 106333.81 },
  { time: toUnixTime("2025-08-11"), open: 106337.47, high: 106630.04, low: 105911.27, close: 106067.54 },
  { time: toUnixTime("2025-08-12"), open: 106429.01, high: 107284.08, low: 106272.40, close: 107270.93 },
  { time: toUnixTime("2025-08-13"), open: 107552.35, high: 107845.41, low: 107258.61, close: 107617.42 },
  { time: toUnixTime("2025-08-14"), open: 107399.07, high: 107739.57, low: 107192.88, close: 107650.04 },
  { time: toUnixTime("2025-08-15"), open: 107797.15, high: 107863.06, low: 107205.86, close: 107338.16 },
  { time: toUnixTime("2025-08-18"), open: 107258.61, high: 107430.53, low: 107136.79, close: 107327.35 },
  { time: toUnixTime("2025-08-19"), open: 107278.92, high: 107449.33, low: 106513.05, close: 106698.61 },
  { time: toUnixTime("2025-08-20"), open: 106619.56, high: 106649.18, low: 105575.10, close: 106439.16 },
  { time: toUnixTime("2025-08-21"), open: 106190.36, high: 106403.71, low: 105722.38, close: 106012.95 },
  { time: toUnixTime("2025-08-22"), open: 106252.93, high: 107822.28, low: 106252.93, close: 107622.91 },
  { time: toUnixTime("2025-08-25"), open: 107469.14, high: 107622.58, low: 107142.79, close: 107163.75 },
  { time: toUnixTime("2025-08-26"), open: 107100.02, high: 107647.21, low: 106995.50, close: 107606.77 },
  { time: toUnixTime("2025-08-27"), open: 107545.52, high: 107958.25, low: 107471.97, close: 107864.05 },
  { time: toUnixTime("2025-08-28"), open: 107904.66, high: 108310.56, low: 107623.74, close: 108204.55 },
  { time: toUnixTime("2025-08-29"), open: 107995.19, high: 108036.47, low: 107251.13, close: 107512.24 },
  { time: toUnixTime("2025-09-02"), open: 106534.52, high: 106784.65, low: 105853.36, close: 106768.01 },
  { time: toUnixTime("2025-09-03"), open: 107271.93, high: 107402.57, low: 106778.49, close: 107312.54 },
  { time: toUnixTime("2025-09-04"), open: 107451.33, high: 108215.87, low: 107274.59, close: 108208.21 },
  { time: toUnixTime("2025-09-05"), open: 108657.55, high: 108716.96, low: 107241.31, close: 107865.72 },
  { time: toUnixTime("2025-09-08"), open: 108141.81, high: 108317.88, low: 107895.51, close: 108092.88 },
  { time: toUnixTime("2025-09-09"), open: 108229.02, high: 108476.98, low: 107892.01, close: 108383.45 },
  { time: toUnixTime("2025-09-10"), open: 109010.53, high: 109105.05, low: 108445.53, close: 108706.81 },
  { time: toUnixTime("2025-09-11"), open: 109079.09, high: 109719.48, low: 108935.80, close: 109629.28 },
  { time: toUnixTime("2025-09-12"), open: 109682.37, high: 109841.30, low: 109496.48, close: 109576.36 },
  { time: toUnixTime("2025-09-15"), open: 109895.89, high: 110164.32, low: 109872.26, close: 110092.10 },
  { time: toUnixTime("2025-09-16"), open: 110239.38, high: 110286.98, low: 109839.64, close: 109950.31 },
  { time: toUnixTime("2025-09-17"), open: 109918.85, high: 110243.71, low: 109024.84, close: 109843.63 },
  { time: toUnixTime("2025-09-18"), open: 110284.65, high: 110783.08, low: 110035.68, close: 110369.69 },
  { time: toUnixTime("2025-09-19"), open: 110621.82, high: 111033.04, low: 110342.23, close: 110908.89 },
  { time: toUnixTime("2025-09-22"), open: 110741.14, high: 111483.38, low: 110637.79, close: 111398.00 },
  { time: toUnixTime("2025-09-23"), open: 111376.20, high: 111494.03, low: 110596.35, close: 110785.07 },
  { time: toUnixTime("2025-09-24"), open: 110999.26, high: 111047.02, low: 110199.94, close: 110469.71 },
  { time: toUnixTime("2025-09-25"), open: 109974.10, high: 110154.01, low: 109325.56, close: 109916.36 },
  { time: toUnixTime("2025-09-26"), open: 110093.76, high: 110652.77, low: 109911.53, close: 110565.07 },
  { time: toUnixTime("2025-09-29"), open: 110862.63, high: 111124.41, low: 110578.21, close: 110856.47 },
  { time: toUnixTime("2025-09-30"), open: 110772.93, high: 111356.40, low: 110520.13, close: 111309.97 },
  { time: toUnixTime("2025-10-01"), open: 110918.21, high: 111809.56, low: 110773.09, close: 111688.41 },
  { time: toUnixTime("2025-10-02"), open: 112023.08, high: 112033.56, low: 111389.35, close: 111757.47 },
  { time: toUnixTime("2025-10-03"), open: 111870.47, high: 112348.60, low: 111596.38, close: 111764.79 },
  { time: toUnixTime("2025-10-06"), open: 112065.52, high: 112326.13, low: 111797.91, close: 112172.36 },
  { time: toUnixTime("2025-10-07"), open: 112269.88, high: 112408.84, low: 111501.35, close: 111744.82 },
  { time: toUnixTime("2025-10-08"), open: 111899.26, high: 112427.98, low: 111803.07, close: 112396.03 },
  { time: toUnixTime("2025-10-09"), open: 112508.86, high: 112576.76, low: 111771.12, close: 112086.32 },
  { time: toUnixTime("2025-10-10"), open: 112175.85, high: 112540.48, low: 109018.68, close: 109047.47 },
  { time: toUnixTime("2025-10-13"), open: 110212.75, high: 110980.79, low: 110182.46, close: 110748.46 },
  { time: toUnixTime("2025-10-14"), open: 109879.24, high: 111180.82, low: 109090.08, close: 110575.22 },
  { time: toUnixTime("2025-10-15"), open: 111306.80, high: 111903.42, low: 110039.34, close: 111020.39 },
  { time: toUnixTime("2025-10-16"), open: 111319.29, high: 111657.45, low: 109737.79, close: 110321.59 },
  { time: toUnixTime("2025-10-17"), open: 110058.65, high: 111150.53, low: 109900.38, close: 110903.07 },
  { time: toUnixTime("2025-10-20"), open: 111336.43, high: 112240.09, low: 111336.43, close: 112086.65 },
  { time: toUnixTime("2025-10-21"), open: 112113.61, high: 112370.07, low: 111868.64, close: 112090.31 },
  { time: toUnixTime("2025-10-22"), open: 112190.00, high: 112196.82, low: 110764.60, close: 111492.03 },
  { time: toUnixTime("2025-10-23"), open: 111562.76, high: 112326.30, low: 111504.35, close: 112141.74 },
  { time: toUnixTime("2025-10-24"), open: 112701.41, high: 113284.55, low: 112701.41, close: 113027.93 },
  { time: toUnixTime("2025-10-27"), open: 113922.77, high: 114452.33, low: 113897.48, close: 114417.04 },
  { time: toUnixTime("2025-10-28"), open: 114792.82, high: 115018.49, low: 114343.32, close: 114678.82 },
  { time: toUnixTime("2025-10-29"), open: 115012.66, high: 115168.93, low: 114030.12, close: 114673.83 },
  { time: toUnixTime("2025-10-30"), open: 114173.07, high: 114510.07, low: 113510.55, close: 113538.01 },
  { time: toUnixTime("2025-10-31"), open: 114483.78, high: 114483.78, low: 113403.54, close: 113835.24 },
  { time: toUnixTime("2025-11-03"), open: 114536.20, high: 114536.20, low: 113509.38, close: 114031.11 },
  { time: toUnixTime("2025-11-04"), open: 112975.17, high: 113502.56, low: 112612.21, close: 112692.76 },
  { time: toUnixTime("2025-11-05"), open: 112663.13, high: 113661.83, low: 112552.30, close: 113104.48 },
  { time: toUnixTime("2025-11-06"), open: 112959.70, high: 113110.97, low: 111627.00, close: 111840.18 },
  { time: toUnixTime("2025-11-07"), open: 111438.44, high: 112003.11, low: 110361.03, close: 111981.31 },
  { time: toUnixTime("2025-11-10"), open: 112922.58, high: 113853.88, low: 112676.28, close: 113705.93 },
  { time: toUnixTime("2025-11-11"), open: 113426.51, high: 114083.70, low: 113280.56, close: 113941.91 }
];

const MOCK_ORDERS: BacktestOrder[] = [
  { id: "1", timestamp: "2024-01-30T16:00:00Z", ticker: "TSLA", type: "Buy", price: 1099.24, amount: 140 },
  { id: "2", timestamp: "2024-01-30T14:30:00Z", ticker: "TSLA", type: "Sell", price: 1120.12, amount: 80 },
  { id: "3", timestamp: "2024-01-29T16:00:00Z", ticker: "AAPL", type: "Buy", price: 195.35, amount: 200 },
  { id: "4", timestamp: "2024-01-28T16:00:00Z", ticker: "MSFT", type: "Buy", price: 402.14, amount: 120 },
  { id: "5", timestamp: "2024-01-27T16:00:00Z", ticker: "NVDA", type: "Sell", price: 598.21, amount: 60 },
];
