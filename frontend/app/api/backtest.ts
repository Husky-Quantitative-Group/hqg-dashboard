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
  ticker: string;
  type: "Buy" | "Sell";
  shares: number;
  price: number;
};

export type Metrics = {
  // equity stats
  final_portfolio_value: number;
  fees: number;
  net_profit: number;
  volume: number;

  // ratios
  sharpe: number;
  sortino: number;
  calmar?: number | null;
  psr: number;

  // return
  total_pct_return: number;
  annualized_return?: number | null;

  // risk
  ann_vol: number;
  max_drawdown: number;
  max_drawdown_duration: number;
  var_95: number;
  cvar_95: number;

  // benchmark
  alpha: number;
  beta: number;
  total_orders: number;
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


export type BacktestResponse = {
  parameters: BacktestParameters;
  metrics: Metrics;
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
