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