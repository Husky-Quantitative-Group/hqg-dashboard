import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { PieChart } from "react-minimal-pie-chart";
import {
  fetchPortfolioAllocationEvents,
  fetchPortfolioAssetAllocations,
  fetchPortfolioEquity,
  fetchPortfolioExecutionEvents,
  fetchPortfolioMetrics,
  fetchPortfolioSnapshot,
  fetchPortfolioStrategyAllocations,
  type AssetAllocationsResponse,
  type EquityResponse,
  type MetricsResponse,
  type SnapshotData,
  type StrategyAllocationsResponse,
  type Timeframe,
} from "~/api/portfolio";
import { useUser } from "~/context/UserConext";

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
  type: "Rebalance" | "Order";
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
  data: LineData[];
  highlights: EquityHighlight[];
  timeframe: Exclude<Timeframe, null>;
  onChangeTimeframe: (timeframe: Exclude<Timeframe, null>) => void;
};

type PortfolioEventsTableProps = {
  events: PortfolioEvent[];
  isLoading: boolean;
};

type EventFilter = "all" | "order" | "rebalance";

type AllocationBreakdownProps = {
  view: AllocationView;
  slices: AllocationSlice[];
  isLoading: boolean;
  aumDisplay: string;
  onChangeView: (view: AllocationView) => void;
};

type PortfolioMetricsProps = {
  metrics: PortfolioMetric[];
  isLoading: boolean;
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

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const PIE_COLORS = [
  "#6366f1",
  "#22d3ee",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#facc15",
  "#f472b6",
  "#60a5fa",
  "#4ade80",
  "#94a3b8",
];

export default function Portfolio() {
  const { hasRole } = useUser();
  const [allocationView, setAllocationView] = useState<AllocationView>("strategy");
  const [timeframe, setTimeframe] = useState<Exclude<Timeframe, null>>("YTD");
  const [portfolioIdInput, setPortfolioIdInput] = useState("1");
  const [portfolioId, setPortfolioId] = useState<number>(1);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [latestSnapshot, setLatestSnapshot] = useState<SnapshotData | null>(null);
  const [equity, setEquity] = useState<EquityResponse["data"]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse["metrics"] | null>(null);
  const [assetAllocations, setAssetAllocations] = useState<AssetAllocationsResponse["allocations"]>({});
  const [strategyAllocations, setStrategyAllocations] = useState<StrategyAllocationsResponse["allocations"]>({});
  const [events, setEvents] = useState<PortfolioEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadPortfolio = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [
          snapshotResponse,
          equityResponse,
          metricsResponse,
          assetAllocationsResponse,
          strategyAllocationsResponse,
          executionEventsResponse,
          allocationEventsResponse,
        ] = await Promise.all([
          fetchPortfolioSnapshot(portfolioId, timeframe),
          fetchPortfolioEquity(portfolioId, timeframe),
          fetchPortfolioMetrics(portfolioId, timeframe),
          fetchPortfolioAssetAllocations(portfolioId, timeframe),
          fetchPortfolioStrategyAllocations(portfolioId),
          fetchPortfolioExecutionEvents(portfolioId, timeframe),
          fetchPortfolioAllocationEvents(portfolioId, timeframe),
        ]);

        if (cancelled) {
          return;
        }

        setLatestSnapshot(snapshotResponse.snapshots?.[0] ?? null);
        setEquity(equityResponse.data ?? []);
        setMetrics(metricsResponse.metrics ?? null);
        setAssetAllocations(assetAllocationsResponse.allocations ?? {});
        setStrategyAllocations(strategyAllocationsResponse.allocations ?? {});

        const executionEvents: PortfolioEvent[] = (executionEventsResponse.events ?? []).map((event, index) => ({
          id: `execution-${event.timestamp}-${event.symbol}-${index}`,
          timestamp: event.timestamp,
          type: "Order",
          action: `${event.action.toUpperCase()} ${event.quantity} ${event.symbol}`,
        }));

        const rebalanceEvents: PortfolioEvent[] = (allocationEventsResponse.events ?? []).map((event, index) => {
          const allocationCount = Object.keys(event.allocations?.allocations ?? {}).length;
          return {
            id: `allocation-${event.timestamp}-${index}`,
            timestamp: event.timestamp,
            type: "Rebalance",
            action: `Updated allocations across ${allocationCount} asset${allocationCount === 1 ? "" : "s"}`,
          };
        });

        const allEvents = [...executionEvents, ...rebalanceEvents].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setEvents(allEvents);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load portfolio data", loadError);
        if (axios.isAxiosError(loadError)) {
          const detail =
            typeof loadError.response?.data?.detail === "string"
              ? loadError.response?.data?.detail
              : "Failed to load portfolio data.";
          setError(detail);
        } else {
          setError("Failed to load portfolio data.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPortfolio();
    return () => {
      cancelled = true;
    };
  }, [portfolioId, timeframe]);

  const handlePortfolioIdInputChange = (nextValue: string) => {
    setPortfolioIdInput(nextValue);
    const next = Number(nextValue);
    if (Number.isInteger(next) && next > 0) {
      setPortfolioId(next);
    }
  };

  const lineSeriesData = useMemo<LineData[]>(
    () =>
      equity.map((point) => ({
        time: toUnixTime(point.timestamp),
        value: point.equity_value,
      })),
    [equity]
  );

  const highlights = useMemo<EquityHighlight[]>(() => {
    if (!latestSnapshot) {
      return [
        { id: "invested", label: "Invested Capital", value: "—", change: "No snapshot available", tone: "neutral" },
        { id: "equity", label: "Current Equity", value: "—", change: "No snapshot available", tone: "neutral" },
        { id: "profit", label: "Net Profit", value: "—", change: "No snapshot available", tone: "neutral" },
        { id: "return", label: "Return %", value: "—", change: "No snapshot available", tone: "neutral" },
      ];
    }

    const returnPct = latestSnapshot.return_pct * 100;
    const returnText = `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%`;
    return [
      {
        id: "invested",
        label: "Invested Capital",
        value: currencyFormatter.format(latestSnapshot.capital),
        change: `As of ${dateOnlyFormatter.format(new Date(latestSnapshot.as_of))}`,
        tone: "neutral",
      },
      {
        id: "equity",
        label: "Current Equity",
        value: currencyFormatter.format(latestSnapshot.equity),
        change: "",
        tone: "neutral",
      },
      {
        id: "profit",
        label: "Net Profit",
        value: currencyFormatter.format(latestSnapshot.net_profit),
        change: "",
        tone: latestSnapshot.net_profit >= 0 ? "positive" : "negative",
      },
      {
        id: "return",
        label: "Return %",
        value: returnText,
        change: "",
        tone: returnPct >= 0 ? "positive" : "negative",
      },
    ];
  }, [latestSnapshot]);

  const metricCards = useMemo<PortfolioMetric[]>(() => {
    if (!metrics) {
      return [
        { id: "sharpe", label: "Sharpe", value: "—", helper: "No data", trend: "neutral" },
        { id: "sortino", label: "Sortino", value: "—", helper: "No data", trend: "neutral" },
        { id: "cagr", label: "CAGR", value: "—", helper: "No data", trend: "neutral" },
        { id: "drawdown", label: "Max Drawdown", value: "—", helper: "No data", trend: "neutral" },
        { id: "alpha", label: "Alpha", value: "—", helper: "No data", trend: "neutral" },
        { id: "beta", label: "Beta", value: "—", helper: "No data", trend: "neutral" },
        { id: "vol", label: "Annual STD", value: "—", helper: "No data", trend: "neutral" },
      ];
    }

    return [
      { id: "sharpe", label: "Sharpe", value: metrics.sharpe.toFixed(2), helper: "", trend: metrics.sharpe >= 0 ? "up" : "down" },
      { id: "sortino", label: "Sortino", value: metrics.sortino.toFixed(2), helper: "", trend: metrics.sortino >= 0 ? "up" : "down" },
      { id: "cagr", label: "CAGR", value: `${(metrics.cagr * 100).toFixed(2)}%`, helper: "", trend: metrics.cagr >= 0 ? "up" : "down" },
      { id: "drawdown", label: "Max Drawdown", value: `${(metrics.max_drawdown * -100).toFixed(2)}%`, helper: "", trend: "down" },
      { id: "alpha", label: "Alpha", value: `${(metrics.alpha * 100).toFixed(2)}%`, helper: "", trend: metrics.alpha >= 0 ? "up" : "neutral" },
      { id: "beta", label: "Beta", value: metrics.beta.toFixed(2), helper: "", trend: "neutral" },
      { id: "vol", label: "Annual STD", value: `${(metrics.std * 100).toFixed(2)}%`, helper: "", trend: "neutral" },
    ];
  }, [metrics]);

  const aum = latestSnapshot?.equity ?? 0;
  const aumDisplay = aum > 0 ? currencyFormatter.format(aum) : "—";

  const strategySlices = useMemo<AllocationSlice[]>(() => {
    const entries = Object.entries(strategyAllocations ?? {});
    return entries.map(([name, weight], index) => ({
      id: `strategy-${name}`,
      label: name,
      value: Number((weight * 100).toFixed(1)),
      color: PIE_COLORS[index % PIE_COLORS.length],
      detail: `${(weight * 100).toFixed(1)}% target weight`,
    }));
  }, [strategyAllocations]);

  const stockSlices = useMemo<AllocationSlice[]>(() => {
    const entries = Object.entries(assetAllocations ?? {});
    const totalMarketValue = entries.reduce((sum, [, holding]) => sum + (holding.market_value ?? 0), 0);
    if (totalMarketValue <= 0) {
      return [];
    }

    return entries
      .map(([symbol, holding], index) => {
        const pct = (holding.market_value / totalMarketValue) * 100;
        return {
          id: `stock-${symbol}`,
          label: symbol,
          value: Number(pct.toFixed(1)),
          color: PIE_COLORS[index % PIE_COLORS.length],
          detail: `${holding.quantity} units • ${compactCurrencyFormatter.format(holding.market_value)}`,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [assetAllocations]);

  const slices = allocationView === "strategy" ? strategySlices : stockSlices;

  if (!hasRole("FUND") && !hasRole("ADMIN")) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-200">
        You do not have access to the portfolio.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Portfolio</p>
          <h1 className="text-3xl font-semibold text-white">Multi-Strategy Portfolio</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-500" htmlFor="portfolio-id-input">
            ID
          </label>
          <input
            id="portfolio-id-input"
            type="number"
            min={1}
            className="w-20 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 focus:border-indigo-400 focus:outline-none"
            value={portfolioIdInput}
            onChange={(event) => handlePortfolioIdInputChange(event.target.value)}
          />
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
        <div className="space-y-6">
          <PortfolioEquityChart
            data={lineSeriesData}
            highlights={highlights}
            timeframe={timeframe}
            onChangeTimeframe={setTimeframe}
          />
          <PortfolioEventsTable events={events} isLoading={isLoading} />
        </div>
        <div className="space-y-6">
          <PortfolioMetrics metrics={metricCards} isLoading={isLoading} />
          <AllocationBreakdown
            view={allocationView}
            slices={slices}
            isLoading={isLoading}
            aumDisplay={aumDisplay}
            onChangeView={setAllocationView}
          />
        </div>
      </div>
    </div>
  );
}

function PortfolioEquityChart({ data, highlights, timeframe, onChangeTimeframe }: PortfolioEquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    series.setData(data);
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
  }, [data]);

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Equity</p>
          <h2 className="text-xl font-semibold text-white">Portfolio Equity Curve</h2>
        </div>
        <div className="flex items-center gap-2">
          {(["3M", "6M", "YTD"] as const).map((item) => {
            const active = timeframe === item;
            return (
              <button
                key={item}
                type="button"
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                    : "border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white"
                }`}
                onClick={() => onChangeTimeframe(item)}
              >
                {item}
              </button>
            );
          })}
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
              {highlight.change ? <p className={`mt-1 text-xs ${toneClass}`}>{highlight.change}</p> : null}
            </div>
          );
        })}
      </div>

      <div ref={containerRef} className="mt-6 h-[480px] w-full overflow-hidden rounded-2xl border border-slate-900/50 bg-gradient-to-b from-slate-950 via-slate-950/90 to-transparent" />
    </article>
  );
}

function PortfolioEventsTable({ events, isLoading }: PortfolioEventsTableProps) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const badgeClasses: Record<PortfolioEvent["type"], string> = {
    Order: "text-emerald-300 bg-emerald-400/10 border border-emerald-500/40",
    Rebalance: "text-sky-300 bg-sky-400/10 border border-sky-500/40",
  };
  const orderCount = events.filter((event) => event.type === "Order").length;
  const rebalanceCount = events.filter((event) => event.type === "Rebalance").length;
  const filteredEvents = events.filter((event) => {
    if (filter === "order") {
      return event.type === "Order";
    }
    if (filter === "rebalance") {
      return event.type === "Rebalance";
    }
    return true;
  });

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Events</p>
          <h2 className="text-xl font-semibold text-white">Logs & Alerts</h2>
          <p className="text-sm text-slate-400">Execution and allocation events in the selected timeframe.</p>
          <p className="mt-1 text-xs text-slate-500">
            Orders: {orderCount} • Rebalances: {rebalanceCount}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: "all", label: "All" },
            { id: "order", label: "Orders" },
            { id: "rebalance", label: "Rebalances" },
          ].map((option) => {
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                    : "border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white"
                }`}
                onClick={() => setFilter(option.id as EventFilter)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
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
            {isLoading ? (
              <tr>
                <td className="px-4 py-3 text-slate-400" colSpan={3}>
                  Loading events...
                </td>
              </tr>
            ) : null}
            {!isLoading && events.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-400" colSpan={3}>
                  No events found for this timeframe.
                </td>
              </tr>
            ) : null}
            {!isLoading && events.length > 0 && filteredEvents.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-slate-400" colSpan={3}>
                  No events found for this filter.
                </td>
              </tr>
            ) : null}
            {filteredEvents.map((event, index) => (
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

function AllocationBreakdown({ view, slices, isLoading, aumDisplay, onChangeView }: AllocationBreakdownProps) {
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
        value: Number(otherValue.toFixed(1)),
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
            <p className="text-2xl font-semibold text-white">{aumDisplay}</p>
            <p className="text-xs text-slate-400">{isLoading ? "Loading..." : "Latest snapshot"}</p>
          </div>
        </div>

        <ul className="w-full space-y-3">
          {isLoading ? (
            <li className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
              Loading allocations...
            </li>
          ) : null}
          {!isLoading && displaySlices.length === 0 ? (
            <li className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
              No allocation data available.
            </li>
          ) : null}
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

function PortfolioMetrics({ metrics, isLoading }: PortfolioMetricsProps) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 shadow-xl">
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Risk</p>
        <h2 className="text-lg font-semibold text-white">Metrics</h2>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <div key={`metric-skeleton-${index}`} className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-600">Loading</p>
                <p className="mt-1 text-xl font-semibold text-slate-500">—</p>
                <p className="mt-1 text-xs text-slate-600">Fetching metrics</p>
              </div>
            ))
          : metrics.map((metric) => {
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
                  {metric.helper ? <p className={`mt-1 text-xs ${toneClass}`}>{metric.helper}</p> : null}
                </div>
              );
            })}
      </div>
    </article>
  );
}

function toUnixTime(dateString: string): UTCTimestamp {
  return Math.floor(new Date(dateString).getTime() / 1000) as UTCTimestamp;
}
