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

export type FileOperation =
  | { op: "put"; artifactId: string; content: string }
  | { op: "delete"; artifactId: string };

export const commitStrategyChanges = async (
  strategyId: string | number,
  changes: FileOperation[]
): Promise<{ ok?: boolean; version?: number; artifacts?: string[] }> => {
  const payload = { changes };
  const response = await coreApi.post(`/strategies/${strategyId}/artifacts`, payload);
  return response.data;
};

export type FileRestrictions = {
  lockedFiles: string[];
  allowedExtensions: string[];
};

export const DEFAULT_FILE_RESTRICTIONS: FileRestrictions = {
  lockedFiles: ["README.md", "main.py", "requirements.txt"],
  allowedExtensions: [".py", ".md", ".txt"],
};

export const fetchFileRestrictions = async (): Promise<FileRestrictions> => {
  try {
    const response = await coreApi.get<FileRestrictions>(`/config/file-restrictions`);
    return response.data;
  } catch (error) {
    console.error("Failed to fetch file restrictions:", error);
    return DEFAULT_FILE_RESTRICTIONS;
  }
};