import axios from "axios";
import { attachAuthRefreshInterceptor } from "./core";
import { engineApiOrigin, isProd } from "./runtime";

const engineApiBaseUrl = isProd ? engineApiOrigin : engineApiOrigin;

export const engineApi = axios.create({
  baseURL: engineApiBaseUrl,
  withCredentials: true,
});

attachAuthRefreshInterceptor(engineApi);

export type Timeframe = "3M" | "6M" | "YTD" | null;

export type TradeResponse = {
  success: boolean;
  message: string;
};

export type SnapshotData = {
  equity: number;
  capital: number;
  net_profit: number;
  return_pct: number;
  as_of: string;
};

export type SnapshotResponse = {
  snapshots: SnapshotData[];
};

export type EquityPoint = {
  timestamp: string;
  equity_value: number;
};

export type EquityResponse = {
  data: EquityPoint[];
};

export type MetricsResponse = {
  metrics: {
    sharpe: number;
    sortino: number;
    cagr: number;
    max_drawdown: number;
    alpha: number;
    beta: number;
    std: number;
  };
};

export type AssetHolding = {
  quantity: number;
  market_value: number;
};

export type AssetAllocationsResponse = {
  allocations: Record<string, AssetHolding>;
};

export type StrategyAllocationsResponse = {
  allocations: Record<string, number>;
};

export type ExecutionEvent = {
  action: "buy" | "sell";
  symbol: string;
  quantity: number;
  timestamp: string;
};

export type ExecutionEventsResponse = {
  events: ExecutionEvent[];
};

export type AllocationEvent = {
  timestamp: string;
  allocations: AssetAllocationsResponse;
};

export type AllocationEventsResponse = {
  events: AllocationEvent[];
};

type TimeframeQuery = {
  timeframe?: Exclude<Timeframe, null>;
};

function withTimeframe(timeframe?: Timeframe): TimeframeQuery | undefined {
  if (!timeframe) {
    return undefined;
  }
  return { timeframe };
}

export const fetchPortfolioSnapshot = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<SnapshotResponse> => {
  const response = await engineApi.get<SnapshotResponse>(`/portfolio/${portfolioId}/snapshot`, {
    params: withTimeframe(timeframe),
  });
  return response.data;
};

export const fetchPortfolioEquity = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<EquityResponse> => {
  const response = await engineApi.get<EquityResponse>(`/portfolio/${portfolioId}/equity`, {
    params: withTimeframe(timeframe),
  });
  return response.data;
};

export const fetchPortfolioMetrics = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<MetricsResponse> => {
  const response = await engineApi.get<MetricsResponse>(`/portfolio/${portfolioId}/metrics`, {
    params: withTimeframe(timeframe),
  });
  return response.data;
};

export const fetchPortfolioAssetAllocations = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<AssetAllocationsResponse> => {
  const response = await engineApi.get<AssetAllocationsResponse>(
    `/portfolio/${portfolioId}/allocations/assets`,
    { params: withTimeframe(timeframe) }
  );
  return response.data;
};

export const fetchPortfolioStrategyAllocations = async (
  portfolioId: string | number
): Promise<StrategyAllocationsResponse> => {
  const response = await engineApi.get<StrategyAllocationsResponse>(
    `/portfolio/${portfolioId}/allocations/strategies`
  );
  return response.data;
};

export const fetchPortfolioExecutionEvents = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<ExecutionEventsResponse> => {
  const response = await engineApi.get<ExecutionEventsResponse>(
    `/portfolio/${portfolioId}/events/executions`,
    { params: withTimeframe(timeframe) }
  );
  return response.data;
};

export const fetchPortfolioAllocationEvents = async (
  portfolioId: string | number,
  timeframe?: Timeframe
): Promise<AllocationEventsResponse> => {
  const response = await engineApi.get<AllocationEventsResponse>(
    `/portfolio/${portfolioId}/events/allocations`,
    { params: withTimeframe(timeframe) }
  );
  return response.data;
};

export const stopPortfolioTrading = async (portfolioId: string | number): Promise<TradeResponse> => {
  const response = await engineApi.post<TradeResponse>(`/portfolio/${portfolioId}/stop`);
  return response.data;
};

export const resumePortfolioTrading = async (portfolioId: string | number): Promise<TradeResponse> => {
  const response = await engineApi.post<TradeResponse>(`/portfolio/${portfolioId}/resume`);
  return response.data;
};

export const liquidatePortfolio = async (portfolioId: string | number): Promise<TradeResponse> => {
  const response = await engineApi.post<TradeResponse>(`/portfolio/${portfolioId}/liquidate`);
  return response.data;
};
