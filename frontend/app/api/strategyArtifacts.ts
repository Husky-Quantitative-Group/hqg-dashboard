import { coreApi } from "./core";

export type StrategyFile = {
  path: string;
  language: string;
  content: string;
  isEntrypoint?: boolean;
};

export const fetchStrategyArtifacts = async (strategyId: string | number): Promise<string[]> => {
  const response = await coreApi.get<{ artifacts: string[] }>(`/strategies/${strategyId}/artifacts`);
  return response.data.artifacts ?? [];
};

export const fetchStrategyArtifactContent = async (
  strategyId: string | number,
  artifactId: string
): Promise<string> => {
  const response = await coreApi.get<string>(`/strategies/${strategyId}/artifacts/${artifactId}`, {
    responseType: "text",
    transformResponse: [(data) => data], // return raw text
  });

  return response.data;
};

export const uploadStrategyArtifacts = async (
  strategyId: string | number,
  files: StrategyFile[]
): Promise<{ ok?: boolean; version?: number; artifacts?: string[] }> => {
  const payload = {
    files: files.map((file) => ({
      artifactId: file.path,
      content: file.content ?? "",
    })),
  };
  const response = await coreApi.post(`/strategies/${strategyId}/artifacts`, payload);
  return response.data;
};

export const fetchStrategyWriteAccess = async (
  strategyId: string | number
): Promise<boolean> => {
  const response = await coreApi.get<{ write?: { public?: boolean; fund?: boolean; users?: Array<{ netid?: string }> } }>(
    `/strategies/${strategyId}/permissions`
  );
  const write = response.data.write;
  if (!write) {
    return false;
  }
  const hasAnyUsers = Array.isArray(write.users) && write.users.length > 0;
  return write.public === true || write.fund === true || hasAnyUsers;
};
