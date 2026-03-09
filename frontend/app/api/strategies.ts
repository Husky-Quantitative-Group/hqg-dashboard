import { coreApi } from "./core";

export type Strategy = {
  id: string;
  name: string;
  entrypoint?: string;
  current_version?: number;
  created_at?: string;
  updated_at?: string;
  owner?: string;
  owner_display?: string;
  project_id: string;
  project_name: string;
  metrics?: {
    sharpe_ratio?: number;
    sortino?: number;
    max_drawdown?: number;
    annualized_return?: number;
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

export const grantStrategyReadPublic = async (
  strategyId: string | number
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.post(`/strategies/${strategyId}/permissions/read`, {
    principal: "ROLE#PUBLIC",
  });
  return response.data;
};

export const fetchStrategyReadPublic = async (
  strategyId: string | number
): Promise<boolean> => {
  const response = await coreApi.get<{ isPublic?: boolean }>(
    `/strategies/${strategyId}/permissions/read/public`
  );
  return response.data.isPublic === true;
};

export const revokeStrategyReadPublic = async (
  strategyId: string | number
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.delete(`/strategies/${strategyId}/permissions/read`, {
    data: { principal: "ROLE#PUBLIC" },
  });
  return response.data;
};

export const fetchStrategyWritePublic = async (
  strategyId: string | number
): Promise<boolean> => {
  const response = await coreApi.get<{ isPublic?: boolean }>(
    `/strategies/${strategyId}/permissions/write/public`
  );
  return response.data.isPublic === true;
};

export const grantStrategyWritePublic = async (
  strategyId: string | number
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.post(`/strategies/${strategyId}/permissions/write`, {
    principal: "ROLE#PUBLIC",
  });
  return response.data;
};

export const revokeStrategyWritePublic = async (
  strategyId: string | number
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.delete(`/strategies/${strategyId}/permissions/write`, {
    data: { principal: "ROLE#PUBLIC" },
  });
  return response.data;
};

export type CreateStrategyRequest = {
  sourceStrategyId: string;
  name: string;
  description?: string;
  readmeContent: string;
  tags?: string[];
};

export const createStrategy = async (payload: CreateStrategyRequest): Promise<Strategy> => {
  const response = await coreApi.post<Strategy>("/strategies", {
    source_strategy_id: payload.sourceStrategyId,
    name: payload.name,
    description: payload.description ?? "",
    readme_content: payload.readmeContent,
    tags: payload.tags ?? [],
    // owner is inferred by the backend from the auth token
  });
  return response.data;
};
