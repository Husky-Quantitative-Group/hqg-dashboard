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

export type StrategyPermissions = {
  read: {
    public: boolean;
    users: string[];
  };
  write: {
    public: boolean;
    users: string[];
  };
};

export type StrategyPermissionsPatch = {
  read?: {
    public?: boolean;
    addUsers?: string[];
    removeUsers?: string[];
  };
  write?: {
    public?: boolean;
    addUsers?: string[];
    removeUsers?: string[];
  };
};

export const fetchStrategyPermissions = async (
  strategyId: string | number
): Promise<StrategyPermissions> => {
  const response = await coreApi.get<StrategyPermissions>(
    `/strategies/${strategyId}/permissions`
  );
  return response.data;
};

export const patchStrategyPermissions = async (
  strategyId: string | number,
  payload: StrategyPermissionsPatch
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.patch(`/strategies/${strategyId}/permissions`, payload);
  return response.data;
};

export const deleteStrategyPermissions = async (
  strategyId: string | number,
  payload: StrategyPermissionsPatch
): Promise<{ ok?: boolean }> => {
  const response = await coreApi.delete(`/strategies/${strategyId}/permissions`, {
    data: payload,
  });
  return response.data;
};

export type UserSearchResult = {
  netid: string;
  full_name?: string;
  uconn_email?: string;
};

export const searchUsers = async (query: string): Promise<UserSearchResult[]> => {
  const response = await coreApi.get<{ items?: UserSearchResult[] }>(
    `/users/search`,
    {
      params: { q: query },
    }
  );
  return response.data.items ?? [];
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
