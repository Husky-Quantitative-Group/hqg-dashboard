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
  omega: number;
  treynor?: number | null;
  psr: number;

  // return
  total_pct_return: number;
  annualized_return?: number | null;
  best_day: number;
  worst_day: number;
  avg_daily_return: number;

  // risk
  ann_vol: number;
  max_drawdown: number;
  max_drawdown_duration: number;
  var_95: number;
  cvar_95: number;
  skewness: number;
  excess_kurtosis: number;
  tail_ratio: number;
  ulcer_index: number;
  ulcer_performance_index?: number | null;

  // benchmark-relative
  alpha: number;
  beta: number;
  information_ratio?: number | null;
  tracking_error?: number | null;

  // trade analysis
  total_orders: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  profit_factor?: number | null;
  expectancy: number;
};

export type BacktestCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type DrawdownPoint = {
  time: number;
  drawdown: number;
};

export type BenchmarkCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MonthlyReturn = {
  year: number;
  month: number;
  return_pct: number;
};

export type RollingMetricPoint = {
  time: number;
  rolling_sharpe: number | null;
  rolling_volatility: number | null;
  rolling_beta: number | null;
};

export type DrawdownEpisode = {
  rank: number;
  peak_date: number;
  valley_date: number;
  recovery_date: number | null;
  depth: number;
  duration_bars: number;
  recovery_bars: number | null;
};

export type AnnualReturn = {
  year: number;
  return_pct: number;
};

export type MonteCarloFanPoint = {
  time: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

export type MonteCarloResult = {
  fan_chart: MonteCarloFanPoint[];
  terminal_wealth_bins: number[];
  terminal_wealth_counts: number[];
  sharpe_bins: number[];
  sharpe_counts: number[];
  max_dd_bins: number[];
  max_dd_counts: number[];
  calmar_bins: number[];
  calmar_counts: number[];
  prob_positive: number;
  n_simulations: number;
};

export type ReturnDistribution = {
  bin_edges: number[];
  bin_counts: number[];
  mean: number;
  std: number;
  skewness: number;
  kurtosis: number;
};

export type StressPeriodResult = {
  name: string;
  start_date: number;
  end_date: number;
  strategy_return: number;
  benchmark_return: number | null;
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
  drawdown_series: DrawdownPoint[];
  benchmark_candles: BenchmarkCandle[];
  monthly_returns: MonthlyReturn[];
  rolling_metrics: RollingMetricPoint[];
  top_drawdowns: DrawdownEpisode[];
  annual_returns: AnnualReturn[];
  monte_carlo: MonteCarloResult | null;
  return_distribution: ReturnDistribution | null;
  stress_periods: StressPeriodResult[];
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
