import { coreApi } from "./core";

export type Strategy = {
  id: string;
  name: string;
  entrypoint?: string;
  current_version?: number;
  created_at?: string;
  updated_at?: string;
  owner?: string;
  project_id: string;
  project_name: string;
  metrics?: {
    sharpe?: number;
    sortino?: number;
    max_drawdown?: number;
    cagr?: number;
  };
  description?: string;
  tags?: string[];
};

export const fetchStrategies = async (): Promise<Strategy[]> => {
  const response = await coreApi.get<Strategy[]>("/strategies");
  return response.data;
};

export const fetchStrategyById = async (strategyId: string | number): Promise<Strategy> => {
  const response = await coreApi.get<Strategy>(`/strategies/${strategyId}`);
  return response.data;
};

export type CreateStrategyRequest = {
  sourceStrategyId: string;
  name: string;
  description?: string;
  tags?: string[];
  owner?: string;
};

export const createStrategy = async (payload: CreateStrategyRequest): Promise<Strategy> => {
  const response = await coreApi.post<Strategy>("/strategies", {
    source_strategy_id: payload.sourceStrategyId,
    name: payload.name,
    description: payload.description ?? "",
    tags: payload.tags ?? [],
    owner: payload.owner ?? "",
  });
  return response.data;
};
