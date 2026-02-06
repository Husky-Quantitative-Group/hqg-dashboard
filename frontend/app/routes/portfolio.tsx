import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { PieChart } from "react-minimal-pie-chart";
import mockSpyCandles from "../data/mock-spy-candles.json";
import type {
  EquityPoint,
  SnapshotResponse,
  MetricsResponse,
  ExecutionEvent,
  AllocationEvent,
} from "../api";
import {
  getEquity,
  getSnapshot,
  getMetrics,
  getStrategyAllocations,
  getAssetAllocations,
  getExecutionEvents,
  getAllocationEvents,
} from "../api";

type EquityHighlight = {
  id: string;
  label: string;
  value: string;
  change: string;
  tone: "positive" | "negative" | "neutral";
};

type PortfolioEvent = {
  id: string;
  timestamp: string;
  type: "Rebalance" | "Order" | "Dividend" | "Alert";
  action: string;
};

type AllocationView = "strategy" | "stock";

type AllocationSlice = {
  id: string;
  label: string;
  value: number;
  color: string;
  detail: string;
};

type PortfolioMetric = {
  id: string;
  label: string;
  value: string;
  helper: string;
  trend: "up" | "down" | "neutral";
};

type PortfolioEquityChartProps = {
  candles: CandlestickData[];
  highlights: EquityHighlight[];
};

type PortfolioEventsTableProps = {
  events: PortfolioEvent[];
};

type AllocationBreakdownProps = {
  view: AllocationView;
  slices: AllocationSlice[];
  onChangeView: (view: AllocationView) => void;
};

type PortfolioMetricsProps = {
  metrics: PortfolioMetric[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const AUM_DISPLAY = currencyFormatter.format(25600000);
const AUM_DELTA = "+12.4% YTD";

export default function Portfolio() {
  const [allocationView, setAllocationView] = useState<AllocationView>("strategy");
  
  // port selection
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [availablePortfolios, setAvailablePortfolios] = useState<Array<{ id: number; name: string }>>([]);
  
  const [selectedTimeframe, setSelectedTimeframe] = useState<"3M" | "6M" | "YTD" | null>(null);
  
  // loading states
  const [isLoadingEquity, setIsLoadingEquity] = useState(false);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [isLoadingStrategyAllocations, setIsLoadingStrategyAllocations] = useState(false);
  const [isLoadingAssetAllocations, setIsLoadingAssetAllocations] = useState(false);
  const [isLoadingExecutionEvents, setIsLoadingExecutionEvents] = useState(false);
  const [isLoadingAllocationEvents, setIsLoadingAllocationEvents] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  
  // error states
  const [equityError, setEquityError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  
  // portfolio data 
  const [equityData, setEquityData] = useState<EquityPoint[]>([]);
  const [snapshotData, setSnapshotData] = useState<SnapshotResponse | null>(null);
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);
  const [strategyAllocations, setStrategyAllocations] = useState<Record<string, number>>({});
  const [assetAllocations, setAssetAllocations] = useState<Record<string, number>>({});
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [allocationEvents, setAllocationEvents] = useState<AllocationEvent[]>([]);

  const handleAllocationViewChange = (nextView: AllocationView) => {
    setAllocationView(nextView);
  };

  useEffect(() => {
    if (!selectedPortfolioId) {
      return;
    }

    const fetchPortfolioData = async () => {
      const tfDependentCalls = [
        async () => {
          setIsLoadingEquity(true);
          setEquityError(null);
          try {
            const data = await getEquity(selectedPortfolioId, selectedTimeframe || undefined);
            setEquityData(data.data);
          } 
          catch (error) {
            setEquityError(error instanceof Error ? error.message : "Failed to load equity data");
            console.error("Error fetching equity:", error);
          } 
          finally {
            setIsLoadingEquity(false);
          }
        },

        async () => {
          setIsLoadingSnapshot(true);
          setSnapshotError(null);
          try {
            const data = await getSnapshot(selectedPortfolioId, selectedTimeframe || undefined);
            setSnapshotData(data);
          } 
          catch (error) {
            setSnapshotError(error instanceof Error ? error.message : "Failed to load snapshot");
            console.error("Error fetching snapshot:", error);
          } 
          finally {
            setIsLoadingSnapshot(false);
          }
        },

        async () => {
          setIsLoadingMetrics(true);
          setMetricsError(null);
          try {
            const data = await getMetrics(selectedPortfolioId, selectedTimeframe || undefined);
            setMetricsData(data);
          } 
          catch (error) {
            setMetricsError(error instanceof Error ? error.message : "Failed to load metrics");
            console.error("Error fetching metrics:", error);
          } 
          finally {
            setIsLoadingMetrics(false);
          }
        },

        async () => {
          setIsLoadingExecutionEvents(true);
          setEventsError(null);
          try {
            const data = await getExecutionEvents(selectedPortfolioId, selectedTimeframe || undefined);
            setExecutionEvents(data.events);
          } 
          catch (error) {
            setEventsError(error instanceof Error ? error.message : "Failed to load execution events");
            console.error("Error fetching execution events:", error);
          } 
          finally {
            setIsLoadingExecutionEvents(false);
          }
        },

        async () => {
          setIsLoadingAllocationEvents(true);
          setEventsError(null);
          try {
            const data = await getAllocationEvents(selectedPortfolioId, selectedTimeframe || undefined);
            setAllocationEvents(data.events);
          } 
          catch (error) {
            setEventsError(error instanceof Error ? error.message : "Failed to load allocation events");
            console.error("Error fetching allocation events:", error);
          } 
          finally {
            setIsLoadingAllocationEvents(false);
          }
        },
      ];

      const tfIndependentCalls = [
        async () => {
          setIsLoadingStrategyAllocations(true);
          setAllocationsError(null);
          try {
            const data = await getStrategyAllocations(selectedPortfolioId);
            setStrategyAllocations(data.allocations);
          } 
          catch (error) {
            setAllocationsError(error instanceof Error ? error.message : "Failed to load strategy allocations");
            console.error("Error fetching strategy allocations:", error);
          } 
          finally {
            setIsLoadingStrategyAllocations(false);
          }
        },

        async () => {
          setIsLoadingAssetAllocations(true);
          setAllocationsError(null);
          try {
            const data = await getAssetAllocations(selectedPortfolioId);
            setAssetAllocations(data.allocations);
          } 
          catch (error) {
            setAllocationsError(error instanceof Error ? error.message : "Failed to load asset allocations");
            console.error("Error fetching asset allocations:", error);
          } 
          finally {
            setIsLoadingAssetAllocations(false);
          }
        },
      ];

      await Promise.all([...tfDependentCalls, ...tfIndependentCalls].map((call) => call()));
    };

    void fetchPortfolioData();
  }, [selectedPortfolioId, selectedTimeframe]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Portfolio</p>
          <h1 className="text-3xl font-semibold text-white">Multi-Strategy Portfolio</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:text-white"
          >
            Download CSV
          </button>
          <button
            type="button"
            className="rounded-xl bg-indigo-500/80 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-500"
          >
            Edit Allocations
          </button>
          <button
            type="button"
            className="rounded-xl border border-rose-500/60 bg-rose-700/70 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-500/40 transition hover:bg-rose-600"
          >
            Stop Trading
          </button>
          <button
            type="button"
            className="rounded-xl border border-red-600/70 bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-600/40 transition hover:bg-red-600"
          >
            Liquidate
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
        <div className="space-y-6">
          <PortfolioEquityChart candles={PORTFOLIO_CANDLES} highlights={PORTFOLIO_HIGHLIGHTS} />
          <PortfolioEventsTable events={PORTFOLIO_EVENTS} />
        </div>
        <div className="space-y-6">
          <PortfolioMetrics metrics={PORTFOLIO_METRICS} />
          <AllocationBreakdown view={allocationView} slices={ALLOCATION_DATA[allocationView]} onChangeView={handleAllocationViewChange} />
        </div>
      </div>
    </div>
  );
}

function PortfolioEquityChart({ candles, highlights }: PortfolioEquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineSeriesData = useMemo<LineData[]>(
    () => candles.map((candle) => ({ time: candle.time, value: candle.close })),
    [candles]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#34d399",
      lineWidth: 3,
      crosshairMarkerVisible: true,
      priceLineVisible: false,
    });

    series.setData(lineSeriesData);
    chart.timeScale().fitContent();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth });
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      chart.remove();
    };
  }, [lineSeriesData]);

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Equity</p>
          <h2 className="text-xl font-semibold text-white">Portfolio Equity Curve</h2>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-slate-800 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white">3M</button>
          <button className="rounded-lg border border-slate-800 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white">6M</button>
          <button className="rounded-lg border border-slate-800 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white">YTD</button>
        </div>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {highlights.map((highlight) => {
          const toneClass =
            highlight.tone === "positive"
              ? "text-emerald-400"
              : highlight.tone === "negative"
                ? "text-rose-400"
                : "text-slate-400";

          return (
            <div key={highlight.id} className="rounded-xl border border-slate-900/70 bg-slate-950/50 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{highlight.label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{highlight.value}</p>
              <p className={`mt-1 text-xs ${toneClass}`}>{highlight.change}</p>
            </div>
          );
        })}
      </div>

      <div ref={containerRef} className="mt-6 h-[480px] w-full overflow-hidden rounded-2xl border border-slate-900/50 bg-gradient-to-b from-slate-950 via-slate-950/90 to-transparent" />
    </article>
  );
}

function PortfolioEventsTable({ events }: PortfolioEventsTableProps) {
  const badgeClasses: Record<PortfolioEvent["type"], string> = {
    Order: "text-emerald-300 bg-emerald-400/10 border border-emerald-500/40",
    Rebalance: "text-sky-300 bg-sky-400/10 border border-sky-500/40",
    Dividend: "text-amber-300 bg-amber-400/10 border border-amber-500/30",
    Alert: "text-rose-300 bg-rose-400/10 border border-rose-500/40",
  };

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Events</p>
          <h2 className="text-xl font-semibold text-white">Logs & Alerts</h2>
          <p className="text-sm text-slate-400">Every trade, rebalance, and alert in the last week.</p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-700 hover:text-white"
        >
          View Journal
        </button>
      </header>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-900/60">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={event.id} className={index % 2 === 0 ? "bg-slate-950/30" : "bg-slate-950/10"}>
                <td className="px-4 py-3 text-slate-200">{dateFormatter.format(new Date(event.timestamp))}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${badgeClasses[event.type]}`}>
                    {event.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">{event.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function AllocationBreakdown({ view, slices, onChangeView }: AllocationBreakdownProps) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [view, slices]);

  const displaySlices = useMemo(() => {
    if (showAll || slices.length <= 2) {
      return slices;
    }

    const [primary, ...rest] = slices;
    if (!primary || rest.length === 0) {
      return slices;
    }

    const otherValue = rest.reduce((sum, slice) => sum + slice.value, 0);
    return [
      primary,
      {
        id: `${view}-other`,
        label: "Other",
        value: otherValue,
        color: "#475569",
        detail: `${rest.length} allocations hidden`,
      },
    ];
  }, [showAll, slices, view]);

  const pieChartData = useMemo(
    () =>
      displaySlices.map((slice) => ({
        title: slice.label,
        value: slice.value,
        color: slice.color,
      })),
    [displaySlices]
  );

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Allocation</p>
          <h2 className="text-xl font-semibold text-white">Breakdown</h2>
          <p className="text-sm text-slate-400">Compare the active sleeves by strategy or single names.</p>
        </div>
        <select
          value={view}
          onChange={(event) => onChangeView(event.target.value as AllocationView)}
          className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
        >
          <option value="strategy">By Strategy</option>
          <option value="stock">By Stock</option>
        </select>
      </header>

      <div className="mt-6 flex flex-col items-center gap-6">
        <div className="relative h-56 w-56">
          <PieChart
            data={pieChartData}
            totalValue={100}
            startAngle={-90}
            lineWidth={35}
            segmentsStyle={{ transition: "stroke 0.3s", cursor: "pointer" }}
            animate
            background="#020617"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">AUM</p>
            <p className="text-2xl font-semibold text-white">{AUM_DISPLAY}</p>
            <p className="text-xs text-emerald-400">{AUM_DELTA}</p>
          </div>
        </div>

        <ul className="w-full space-y-3">
          {displaySlices.map((slice) => (
            <li
              key={slice.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
                <div>
                  <p className="text-sm font-medium text-white">{slice.label}</p>
                  <p className="text-xs text-slate-400">{slice.detail}</p>
                </div>
              </div>
              <p className="text-sm font-semibold text-white">{slice.value}%</p>
            </li>
          ))}
        </ul>

        {slices.length > 2 && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="w-full rounded-xl border border-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:text-white"
          >
            {showAll ? "Show Less" : "View More"}
          </button>
        )}
      </div>
    </article>
  );
}

function PortfolioMetrics({ metrics }: PortfolioMetricsProps) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 shadow-xl">
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Risk</p>
        <h2 className="text-lg font-semibold text-white">Metrics</h2>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {metrics.map((metric) => {
          const toneClass =
            metric.trend === "up"
              ? "text-emerald-400"
              : metric.trend === "down"
                ? "text-rose-400"
                : "text-slate-400";

          return (
            <div key={metric.id} className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{metric.label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{metric.value}</p>
              <p className={`mt-1 text-xs ${toneClass}`}>{metric.helper}</p>
            </div>
          );
        })}
      </div>
    </article>
  );
}

const PORTFOLIO_HIGHLIGHTS: EquityHighlight[] = [
  { id: "invested", label: "Invested Capital", value: currencyFormatter.format(24200000), change: "Active sleeves deployed", tone: "neutral" },
  { id: "equity", label: "Current Equity", value: AUM_DISPLAY, change: "+$1.4M vs. 90d start", tone: "positive" },
  { id: "profit", label: "Net Profit (90d)", value: "+$1.34M", change: "After fees & carry", tone: "positive" },
  { id: "return", label: "Return % (90d)", value: "+5.4%", change: "Benchmark +2.3%", tone: "positive" },
];

const PORTFOLIO_EVENTS: PortfolioEvent[] = [
  { id: "evt-001", timestamp: "2025-05-22T13:34:00Z", type: "Rebalance", action: "Shifted +1.5% toward Market Neutral sleeve" },
  { id: "evt-002", timestamp: "2025-05-22T10:15:00Z", type: "Order", action: "Executed 8-lot buy program across MegaCap Momentum basket" },
  { id: "evt-003", timestamp: "2025-05-21T21:40:00Z", type: "Alert", action: "Risk engine flagged variance spike in Crypto overlay" },
  { id: "evt-004", timestamp: "2025-05-21T17:02:00Z", type: "Dividend", action: "Received cash distribution from preferred sleeve" },
  { id: "evt-005", timestamp: "2025-05-21T14:08:00Z", type: "Order", action: "Scaled out of China ADR exposure (-60 bps)" },
  { id: "evt-006", timestamp: "2025-05-20T23:11:00Z", type: "Rebalance", action: "Topped up Statistical Arbitrage capital after drawdown" },
];

const ALLOCATION_DATA: Record<AllocationView, AllocationSlice[]> = {
  strategy: [
    { id: "market-neutral", label: "Market Neutral", value: 32, color: "#6366f1", detail: `${compactCurrencyFormatter.format(8100000)} • 7 strategies` },
    { id: "stat-arb", label: "Statistical Arbitrage", value: 24, color: "#22d3ee", detail: `${compactCurrencyFormatter.format(6100000)} • intraday` },
    { id: "momentum", label: "Momentum", value: 18, color: "#f97316", detail: `${compactCurrencyFormatter.format(4500000)} • swing` },
    { id: "event", label: "Event Driven", value: 11, color: "#a855f7", detail: `${compactCurrencyFormatter.format(2700000)} • catalysts` },
    { id: "macro", label: "Macro Overlay", value: 9, color: "#14b8a6", detail: `${compactCurrencyFormatter.format(2300000)} • futures` },
    { id: "cash", label: "Cash", value: 6, color: "#facc15", detail: `${compactCurrencyFormatter.format(1500000)} liquidity` },
  ],
  stock: [
    { id: "aapl", label: "Apple", value: 18, color: "#f472b6", detail: `${compactCurrencyFormatter.format(4600000)} / 180 bps` },
    { id: "msft", label: "Microsoft", value: 14, color: "#60a5fa", detail: `${compactCurrencyFormatter.format(3600000)} / 140 bps` },
    { id: "nvda", label: "NVIDIA", value: 12, color: "#4ade80", detail: `${compactCurrencyFormatter.format(3100000)} / 120 bps` },
    { id: "basket", label: "Diversified Basket", value: 56, color: "#94a3b8", detail: "45 additional names" },
  ],
};

const PORTFOLIO_METRICS: PortfolioMetric[] = [
  { id: "sharpe", label: "Sharpe", value: "1.48", helper: "+0.05 vs target", trend: "up" },
    { id: "sortino", label: "Sortino", value: "2.11", helper: "Downside-protected", trend: "up" },
  { id: "cagr", label: "CAGR", value: "18.2%", helper: "3Y rolling compounded", trend: "up" },
  { id: "drawdown", label: "Max Drawdown", value: "-8.6%", helper: "Last 12 months", trend: "down" },
  { id: "alpha", label: "Alpha", value: "+4.3%", helper: "vs. MSCI World", trend: "up" },
  { id: "beta", label: "Beta", value: "0.41", helper: "vs. SPX", trend: "neutral" },
  { id: "vol", label: "Annual STD", value: "10.4%", helper: "Blend target 11%", trend: "neutral" },
  { id: "orders", label: "Orders", value: "312", helper: "Trailing 30 days", trend: "up" },
];

function toUnixTime(dateString: string): UTCTimestamp {
  return Math.floor(new Date(dateString).getTime() / 1000) as UTCTimestamp;
}

const PORTFOLIO_CANDLES: CandlestickData[] = mockSpyCandles.map((candle) => ({
  time: toUnixTime(candle.date),
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
}));
