import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminAnalyticsPoint, AdminAnalyticsTimeseries } from "~/api/admin";

type AdminAnalyticsPanelProps = {
  data?: AdminAnalyticsTimeseries | null;
  loading?: boolean;
  days: number;
  onDaysChange: (days: number) => void;
};

const RANGE_OPTIONS = [30, 90, 180, 365] as const;

const CHARTS: Array<{
  key: keyof AdminAnalyticsTimeseries["series"];
  title: string;
  subtitle: string;
  accent: string;
}> = [
  {
    key: "total_strategies",
    title: "Total Strategies",
    subtitle: "Cumulative strategies created site-wide",
    accent: "#34d399",
  },
  {
    key: "total_backtests",
    title: "Total Backtests",
    subtitle: "Cumulative backtest runs finalized site-wide",
    accent: "#f59e0b",
  },
  {
    key: "total_users",
    title: "Total Users",
    subtitle: "Cumulative approved users over time",
    accent: "#60a5fa",
  },
  {
    key: "users_logged_in",
    title: "Users Logged In",
    subtitle: "Unique authenticated users per day",
    accent: "#f472b6",
  },
];

export default function AdminAnalyticsPanel({
  data,
  loading,
  days,
  onDaysChange,
}: AdminAnalyticsPanelProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-400">
        Loading analytics...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        Analytics unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Analytics</h2>
          <p className="text-sm text-slate-400">
            Telemetry-style trend lines across the selected time window.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDaysChange(option)}
              className={
                "rounded-lg px-3 py-2 text-xs font-medium transition " +
                (days === option
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white")
              }
            >
              {option}D
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {CHARTS.map((chart) => {
          const series = data.series[chart.key];
          const latest = series.length ? series[series.length - 1].value : 0;
          return (
            <section
              key={chart.key}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{chart.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{chart.subtitle}</div>
                </div>
                <div
                  className="text-right text-3xl font-semibold"
                  style={{ color: chart.accent }}
                >
                  {latest.toLocaleString()}
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id={`fill-${chart.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chart.accent} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={chart.accent} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#94a3b8", fontSize: 12 }}
                      tickFormatter={(value) =>
                        new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#020617",
                        border: "1px solid rgba(51, 65, 85, 0.9)",
                        borderRadius: "0.75rem",
                        color: "#e2e8f0",
                      }}
                      labelStyle={{ color: "#cbd5e1" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={chart.accent}
                      fill={`url(#fill-${chart.key})`}
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
