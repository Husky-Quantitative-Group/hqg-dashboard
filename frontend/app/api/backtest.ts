import axios from "axios";

export const backtesterApi = axios.create({
  baseURL: "/backtester-api",
  withCredentials: true,
});

export type Trade = {
  timestamp: string;
  symbol: string;
  action: "buy" | "sell";
  shares: number;
  price: number;
  value: number;
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
  annualized_variance: number;
  annualized_std: number;
};

export type EquityCurve = Record<string, number>;

export type OhlcPoint = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type OhlcSeries = Record<string, OhlcPoint>;

export type BacktestResponse = {
  trades: Trade[];
  metrics: Metrics;
  equity_curve: EquityCurve;
  ohlc?: OhlcSeries;
  final_value: number;
  final_positions: Record<string, number>;
  final_cash: number;
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
