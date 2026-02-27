import axios from "axios";
import { backtesterApiOrigin, isProd } from "./runtime";

const BACKTESTER_ENDPOINT = "/api/v1/backtest";
const backtesterApiBaseUrl = isProd
  ? `${backtesterApiOrigin}${BACKTESTER_ENDPOINT}`
  : backtesterApiOrigin;

export const backtesterApi = axios.create({
  baseURL: backtesterApiBaseUrl,
  withCredentials: true,
});

export type BacktestOrder = {
  id: string;
  timestamp: string;
  symbol: string;
  action: "Buy" | "Sell" | "buy" | "sell";
  shares: number;
  price: number;
};

export type Metrics = {
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_orders: number;
  sortino: number;
  alpha: number;
  beta: number;
  psr: number;
  avg_win: number;
  avg_loss: number;
  annualized_variance?: number;
  annualized_std?: number;
};

export type BacktestCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BacktestParameters = {
  name: string;
  starting_equity: number;
  start_date: string;
  end_date: string;
};

export type EquityStats = {
  equity: number;
  fees: number;
  net_profit: number;
  return_pct: number;
  volume: number;
};

export type BacktestResponse = {
  parameters: BacktestParameters;
  metrics: Metrics;
  equity_stats: EquityStats;
  candles: BacktestCandle[];
  orders: BacktestOrder[];
};

export type BacktestRequest = {
  strategy_code: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
};

export const runBacktest = async (payload: BacktestRequest): Promise<BacktestResponse> => {
  const response = await backtesterApi.post<BacktestResponse>("", payload);
  return response.data;
};
