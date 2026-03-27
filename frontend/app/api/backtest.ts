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

export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type JobRecord = {
  job_id: string;
  status: JobStatus;
  submitted_at: string;
  started_at?: string;
  completed_at?: string;
  result?: BacktestResponse;
  error?: string;
  logs: string[];
};

export const submitBacktest = async (payload: BacktestRequest): Promise<string> => {
  const response = await backtesterApi.post<{ job_id: string }>("", payload);
  return response.data.job_id;
};

export const getBacktestJob = async (jobId: string): Promise<JobRecord> => {
  const response = await backtesterApi.get<JobRecord>(`/${jobId}`);
  return response.data;
};
