import { coreApi } from "./core";

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

export type BacktestResponse = {
  trades: Trade[];
  metrics: Metrics;
  equity_curve: EquityCurve;
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
  const response = await coreApi.post<BacktestResponse>("/backtest", {
    strategy_code: payload.strategy_code,
    start_date: payload.start_date,
    end_date: payload.end_date,
    initial_capital: payload.initial_capital,
  });
  return response.data;
};
