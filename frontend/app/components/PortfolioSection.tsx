import { useState } from "react";
import { Filter, ArrowUpDown } from "lucide-react";
import { Button } from "./portfolio-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./portfolio-ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./portfolio-ui/select";
import { Badge } from "./portfolio-ui/badge";
import { Slider } from "./portfolio-ui/slider";
import { StrategyCard } from "./portfolio-ui/StrategyCard";

// Generate equity data with dates
function generateEquityData(days: number, volatility: number = 0.02, trend: number = 0.001) {
  const data = [];
  let value = 100;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    value = value * (1 + trend + (Math.random() - 0.5) * volatility);
    data.push({
      date: date.toISOString().split('T')[0],
      value: parseFloat(value.toFixed(2))
    });
  }
  return data;
}

// Mock data
const mockStrategies = [
  {
    id: 1,
    name: "Momentum Alpha V3",
    user: "Sarah Chen",
    status: "live",
    label: "maximal sharpe",
    sortinoRatio: 2.4,
    totalReturn: 47.2,
    sharpeRatio: 1.8,
    maxDrawdown: -12.3,
    daysRunning: 342,
    equityData: generateEquityData(342, 0.025, 0.0012),
    events: [
      { id: 1, type: "trade", timestamp: "2024-11-12 09:34:21", description: "BUY 100 AAPL @ $178.32", details: "Entry signal: Momentum breakout" },
      { id: 2, type: "alert", timestamp: "2024-11-12 08:15:00", description: "High volatility detected", details: "VIX > 20" },
      { id: 3, type: "parameter", timestamp: "2024-11-11 16:00:00", description: "Updated stop loss: 2% → 2.5%", details: "Risk adjustment" },
      { id: 4, type: "trade", timestamp: "2024-11-11 14:22:18", description: "SELL 150 TSLA @ $242.15", details: "Exit signal: Take profit" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-15", symbol: "AAPL", action: "BUY", quantity: 100, price: 175.20, pnl: null },
        { id: 2, date: "2024-10-18", symbol: "AAPL", action: "SELL", quantity: 100, price: 178.50, pnl: 330.00 },
        { id: 3, date: "2024-10-20", symbol: "TSLA", action: "BUY", quantity: 150, price: 235.80, pnl: null },
        { id: 4, date: "2024-10-25", symbol: "TSLA", action: "SELL", quantity: 150, price: 242.15, pnl: 952.50 },
        { id: 5, date: "2024-11-01", symbol: "NVDA", action: "BUY", quantity: 50, price: 485.30, pnl: null },
      ],
      performance: {
        totalTrades: 45,
        winRate: 67.8,
        avgWin: 1250,
        avgLoss: -580,
        profitFactor: 2.15,
        avgHoldTime: "3.2 days"
      }
    }
  },
  {
    id: 2,
    name: "Mean Reversion Pro",
    user: "Michael Torres",
    status: "paper",
    label: "systematic safety",
    sortinoRatio: 1.9,
    totalReturn: 28.5,
    sharpeRatio: 1.5,
    maxDrawdown: -8.7,
    daysRunning: 198,
    equityData: generateEquityData(198, 0.015, 0.0008),
    events: [
      { id: 1, type: "parameter", timestamp: "2024-11-10 10:00:00", description: "Rebalance threshold: 5% → 4%", details: "Strategy optimization" },
      { id: 2, type: "trade", timestamp: "2024-11-09 11:45:32", description: "BUY 200 SPY @ $445.20", details: "Mean reversion signal" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-01", symbol: "SPY", action: "BUY", quantity: 200, price: 440.10, pnl: null },
        { id: 2, date: "2024-10-05", symbol: "SPY", action: "SELL", quantity: 200, price: 445.20, pnl: 1020.00 },
      ],
      performance: {
        totalTrades: 32,
        winRate: 71.9,
        avgWin: 890,
        avgLoss: -420,
        profitFactor: 2.45,
        avgHoldTime: "2.1 days"
      }
    }
  },
  {
    id: 3,
    name: "Volatility Arbitrage",
    user: "Sarah Chen",
    status: "live",
    label: "maximal sharpe",
    sortinoRatio: 3.1,
    totalReturn: 62.8,
    sharpeRatio: 2.2,
    maxDrawdown: -15.2,
    daysRunning: 425,
    equityData: generateEquityData(425, 0.028, 0.0013),
    events: [
      { id: 1, type: "trade", timestamp: "2024-11-12 10:15:44", description: "BUY 50 VXX @ $42.80", details: "Volatility spike expected" },
      { id: 2, type: "alert", timestamp: "2024-11-12 09:00:00", description: "Portfolio heat exceeded 80%", details: "Risk limit warning" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-10", symbol: "VXX", action: "BUY", quantity: 50, price: 40.20, pnl: null },
        { id: 2, date: "2024-10-12", symbol: "VXX", action: "SELL", quantity: 50, price: 42.80, pnl: 130.00 },
      ],
      performance: {
        totalTrades: 58,
        winRate: 65.5,
        avgWin: 1580,
        avgLoss: -720,
        profitFactor: 2.05,
        avgHoldTime: "1.8 days"
      }
    }
  },
  {
    id: 4,
    name: "Low Beta Shield",
    user: "Alex Kumar",
    status: "paused",
    label: "systematic safety",
    sortinoRatio: 1.6,
    totalReturn: 18.3,
    sharpeRatio: 1.3,
    maxDrawdown: -5.4,
    daysRunning: 521,
    equityData: generateEquityData(521, 0.008, 0.0003),
    events: [
      { id: 1, type: "alert", timestamp: "2024-11-11 15:30:00", description: "Strategy paused by user", details: "Manual intervention" },
      { id: 2, type: "trade", timestamp: "2024-11-11 09:22:10", description: "SELL 300 TLT @ $95.40", details: "Rebalancing" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-08", symbol: "TLT", action: "BUY", quantity: 300, price: 93.80, pnl: null },
        { id: 2, date: "2024-10-15", symbol: "TLT", action: "SELL", quantity: 300, price: 95.40, pnl: 480.00 },
      ],
      performance: {
        totalTrades: 28,
        winRate: 75.0,
        avgWin: 620,
        avgLoss: -280,
        profitFactor: 2.80,
        avgHoldTime: "5.4 days"
      }
    }
  },
  {
    id: 5,
    name: "Trend Following Plus",
    user: "Emma Watson",
    status: "paper",
    label: "balanced growth",
    sortinoRatio: 2.1,
    totalReturn: 34.6,
    sharpeRatio: 1.6,
    maxDrawdown: -10.1,
    daysRunning: 267,
    equityData: generateEquityData(267, 0.020, 0.0010),
    events: [
      { id: 1, type: "parameter", timestamp: "2024-11-10 12:00:00", description: "Trend filter: 50 SMA → 55 SMA", details: "Optimization test" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-12", symbol: "QQQ", action: "BUY", quantity: 100, price: 368.50, pnl: null },
        { id: 2, date: "2024-10-20", symbol: "QQQ", action: "SELL", quantity: 100, price: 375.20, pnl: 670.00 },
      ],
      performance: {
        totalTrades: 38,
        winRate: 68.4,
        avgWin: 1050,
        avgLoss: -520,
        profitFactor: 2.25,
        avgHoldTime: "4.1 days"
      }
    }
  },
  {
    id: 6,
    name: "Statistical Arbitrage X",
    user: "Michael Torres",
    status: "live",
    label: "maximal sharpe",
    sortinoRatio: 2.7,
    totalReturn: 53.4,
    sharpeRatio: 2.0,
    maxDrawdown: -11.8,
    daysRunning: 389,
    equityData: generateEquityData(389, 0.022, 0.0011),
    events: [
      { id: 1, type: "trade", timestamp: "2024-11-12 11:05:18", description: "PAIR: LONG GOOG / SHORT META", details: "Spread: 2.5 sigma" },
      { id: 2, type: "parameter", timestamp: "2024-11-09 14:30:00", description: "Correlation threshold: 0.85 → 0.88", details: "Tighter pair selection" },
    ],
    backtestResults: {
      trades: [
        { id: 1, date: "2024-10-05", symbol: "GOOG", action: "BUY", quantity: 75, price: 138.20, pnl: null },
        { id: 2, date: "2024-10-05", symbol: "META", action: "SHORT", quantity: 80, price: 485.30, pnl: null },
      ],
      performance: {
        totalTrades: 52,
        winRate: 66.7,
        avgWin: 1320,
        avgLoss: -640,
        profitFactor: 2.10,
        avgHoldTime: "2.8 days"
      }
    }
  },
];

export function PortfolioSection() {
  const [userFilter, setUserFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortinoRange, setSortinoRange] = useState<number[]>([0, 5]);
  const [sortBy, setSortBy] = useState<string>("longest");

  // Get unique values for filters
  const users = ["all", ...new Set(mockStrategies.map((s) => s.user))];
  const labels = ["all", ...new Set(mockStrategies.map((s) => s.label))];

  // Filter and sort strategies
  let filteredStrategies = mockStrategies.filter((strategy) => {
    if (userFilter !== "all" && strategy.user !== userFilter) return false;
    if (typeFilter !== "all" && strategy.status !== typeFilter) return false;
    if (labelFilter !== "all" && strategy.label !== labelFilter) return false;
    if (strategy.sortinoRatio < sortinoRange[0] || strategy.sortinoRatio > sortinoRange[1]) return false;
    return true;
  });

  // Sort strategies
  filteredStrategies = [...filteredStrategies].sort((a, b) => {
    if (sortBy === "alphabetical") {
      return a.name.localeCompare(b.name);
    } else if (sortBy === "longest") {
      return b.daysRunning - a.daysRunning;
    } else if (sortBy === "return") {
      return b.totalReturn - a.totalReturn;
    }
    return 0;
  });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-slate-100">Live Portfolio Strategies</h1>
        <p className="text-slate-400">
          Transparent view of all algorithmic strategies across users
        </p>
      </div>

      {/* Filters and Sort Section */}
      <Card className="mb-6 bg-slate-900/50 backdrop-blur border-slate-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-100">
            <Filter className="size-5" />
            Filters & Sort
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* User Filter */}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">User</label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user} value={user}>
                      {user === "all" ? "All Users" : user}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Type Filter */}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Status</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="live">🟢 Live</SelectItem>
                  <SelectItem value="paused">🟠 Paused</SelectItem>
                  <SelectItem value="paper">⚪ Paper</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Label Filter */}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Category</label>
              <Select value={labelFilter} onValueChange={setLabelFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  {labels.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label === "all" ? "All Categories" : label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sortino Ratio Filter */}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">
                Sortino Ratio: {sortinoRange[0].toFixed(1)} - {sortinoRange[1].toFixed(1)}
              </label>
              <Slider
                value={sortinoRange}
                onValueChange={setSortinoRange}
                max={5}
                step={0.1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>0</span>
                <span>5</span>
              </div>
            </div>

            {/* Sort By */}
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Sort By</label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="longest">Longest Running</SelectItem>
                  <SelectItem value="alphabetical">Alphabetical</SelectItem>
                  <SelectItem value="return">Highest Return</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active Filters Summary */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-400">Active filters:</span>
            {userFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30">
                User: {userFilter}
              </Badge>
            )}
            {typeFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30">
                Type: {typeFilter}
              </Badge>
            )}
            {labelFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30">
                Category: {labelFilter}
              </Badge>
            )}
            {(sortinoRange[0] !== 0 || sortinoRange[1] !== 5) && (
              <Badge variant="secondary" className="gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30">
                Sortino: {sortinoRange[0].toFixed(1)} - {sortinoRange[1].toFixed(1)}
              </Badge>
            )}
            {(userFilter !== "all" || typeFilter !== "all" || labelFilter !== "all" || sortinoRange[0] !== 0 || sortinoRange[1] !== 5) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setUserFilter("all");
                  setTypeFilter("all");
                  setLabelFilter("all");
                  setSortinoRange([0, 5]);
                }}
              >
                Clear All
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Count */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-slate-400">
          Showing <span className="font-semibold text-slate-200">{filteredStrategies.length}</span> {filteredStrategies.length === 1 ? "strategy" : "strategies"}
        </p>
        <div className="flex items-center gap-2 text-slate-400">
          <ArrowUpDown className="size-4" />
          <span className="text-sm">Sorted by: {sortBy === "longest" ? "Longest Running" : sortBy === "alphabetical" ? "Alphabetical" : "Highest Return"}</span>
        </div>
      </div>

      {/* Strategy Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredStrategies.map((strategy) => (
          <StrategyCard key={strategy.id} strategy={strategy} />
        ))}
      </div>

      {/* Empty State */}
      {filteredStrategies.length === 0 && (
        <Card className="p-12 text-center bg-slate-900/50 border-slate-800">
          <p className="text-slate-400">No strategies match your filters. Try adjusting your criteria.</p>
        </Card>
      )}
    </div>
  );
}
