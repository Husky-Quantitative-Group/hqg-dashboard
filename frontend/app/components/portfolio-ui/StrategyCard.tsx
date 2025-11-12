import { useState } from "react";
import { Card, CardContent, CardHeader } from "./card";
import { Badge } from "./badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { TrendingUp, Calendar, User, Activity, ArrowUpRight, ArrowDownRight, Settings, AlertTriangle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip } from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

interface EquityDataPoint {
  date: string;
  value: number;
}

interface Event {
  id: number;
  type: string;
  timestamp: string;
  description: string;
  details: string;
}

interface Trade {
  id: number;
  date: string;
  symbol: string;
  action: string;
  quantity: number;
  price: number;
  pnl: number | null;
}

interface BacktestResults {
  trades: Trade[];
  performance: {
    totalTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    avgHoldTime: string;
  };
}

interface Strategy {
  id: number;
  name: string;
  user: string;
  status: string;
  label: string;
  sortinoRatio: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  daysRunning: number;
  equityData: EquityDataPoint[];
  events: Event[];
  backtestResults: BacktestResults;
}

interface StrategyCardProps {
  strategy: Strategy;
}

const statusConfig = {
  live: { emoji: "🟢", label: "Live", color: "text-emerald-600 bg-emerald-50" },
  paused: { emoji: "🟠", label: "Paused", color: "text-orange-600 bg-orange-50" },
  paper: { emoji: "⚪", label: "Paper", color: "text-slate-600 bg-slate-50" }
};

const eventIcons = {
  trade: Activity,
  parameter: Settings,
  alert: AlertTriangle,
};

export function StrategyCard({ strategy }: StrategyCardProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const isPositive = strategy.totalReturn > 0;
  const status = statusConfig[strategy.status as keyof typeof statusConfig] || statusConfig.paper;

  // Sample data points for display (every 7th day for readability)
  const sampledData = strategy.equityData.filter((_, index) => index % 7 === 0 || index === strategy.equityData.length - 1);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-lg">
          <p className="text-sm text-slate-600">{payload[0].payload.date}</p>
          <p className="font-semibold text-slate-900">${payload[0].value.toFixed(2)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="hover:shadow-lg transition-shadow bg-slate-900/50 backdrop-blur border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="mb-2 truncate text-slate-100">{strategy.name}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={status.color}
              >
                {status.emoji} {status.label}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {strategy.label}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className={`flex items-center gap-1 ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
              <TrendingUp className="size-4" />
              <span className="font-semibold">
                {isPositive ? "+" : ""}{strategy.totalReturn.toFixed(1)}%
              </span>
            </div>
            <span className="text-xs text-slate-500">Total Return</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="backtest">Backtest</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Equity Curve */}
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <div className="mb-2">
                <span className="text-sm text-slate-400">Equity Curve</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={sampledData}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    width={45}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={isPositive ? "#10b981" : "#ef4444"}
                    strokeWidth={2}
                    dot={false}
                    animationDuration={500}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-sm text-slate-400 mb-1">Sortino</div>
                <div className="font-semibold text-slate-100">{strategy.sortinoRatio.toFixed(2)}</div>
              </div>
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-sm text-slate-400 mb-1">Sharpe</div>
                <div className="font-semibold text-slate-100">{strategy.sharpeRatio.toFixed(2)}</div>
              </div>
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-sm text-slate-400 mb-1">Max DD</div>
                <div className="font-semibold text-red-400">{strategy.maxDrawdown.toFixed(1)}%</div>
              </div>
            </div>

            {/* Footer Info */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-slate-400">
                <User className="size-4" />
                <span className="text-sm">{strategy.user}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Calendar className="size-4" />
                <span className="text-sm">{strategy.daysRunning} days</span>
              </div>
            </div>
          </TabsContent>

          {/* Events Tab */}
          <TabsContent value="events" className="mt-4">
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {strategy.events.map((event) => {
                const Icon = eventIcons[event.type as keyof typeof eventIcons] || Activity;
                const iconColor = event.type === "alert" ? "text-orange-400" : event.type === "parameter" ? "text-blue-400" : "text-emerald-400";
                const bgColor = event.type === "alert" ? "bg-orange-500/10" : event.type === "parameter" ? "bg-blue-500/10" : "bg-emerald-500/10";

                return (
                  <div key={event.id} className="flex gap-3 p-3 bg-slate-950/50 rounded-lg hover:bg-slate-900/50 transition-colors border border-slate-800">
                    <div className={`${bgColor} ${iconColor} p-2 rounded-lg h-fit`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-slate-200">{event.description}</p>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{event.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-400">{event.details}</p>
                    </div>
                  </div>
                );
              })}
              {strategy.events.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <Activity className="size-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No recent events</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Backtest Tab */}
          <TabsContent value="backtest" className="mt-4 space-y-4">
            {/* Performance Metrics */}
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <h4 className="mb-3 text-slate-100">Performance Summary</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Total Trades</div>
                  <div className="font-semibold text-slate-100">{strategy.backtestResults.performance.totalTrades}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Win Rate</div>
                  <div className="font-semibold text-emerald-400">{strategy.backtestResults.performance.winRate}%</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Avg Win</div>
                  <div className="font-semibold text-emerald-400">${strategy.backtestResults.performance.avgWin}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Avg Loss</div>
                  <div className="font-semibold text-red-400">${strategy.backtestResults.performance.avgLoss}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Profit Factor</div>
                  <div className="font-semibold text-slate-100">{strategy.backtestResults.performance.profitFactor}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Avg Hold Time</div>
                  <div className="font-semibold text-slate-100">{strategy.backtestResults.performance.avgHoldTime}</div>
                </div>
              </div>
            </div>

            {/* Recent Trades Table */}
            <div>
              <h4 className="mb-3 text-slate-100">Recent Trades</h4>
              <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/50">
                <div className="max-h-[250px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-slate-900">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {strategy.backtestResults.trades.map((trade) => (
                        <TableRow key={trade.id}>
                          <TableCell className="text-xs">{trade.date}</TableCell>
                          <TableCell className="font-medium text-xs">{trade.symbol}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={trade.action === "BUY" ? "text-emerald-600 border-emerald-200" : trade.action === "SELL" ? "text-red-600 border-red-200" : "text-orange-600 border-orange-200"}
                            >
                              {trade.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">{trade.quantity}</TableCell>
                          <TableCell className="text-right text-xs">${trade.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-xs">
                            {trade.pnl !== null ? (
                              <span className={trade.pnl >= 0 ? "text-emerald-600 flex items-center justify-end gap-1" : "text-red-600 flex items-center justify-end gap-1"}>
                                {trade.pnl >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                                ${Math.abs(trade.pnl).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
