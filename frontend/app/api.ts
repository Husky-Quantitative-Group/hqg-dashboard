import axios from "axios";

export interface Strategy {
  _id: string;
  strategyId: string;
  name: string;
  description?: string;
  owner?: string;
  project: string;
  repository: string;
  branch: string;
  githubPath: string;
  htmlUrl: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "",
});

export const fetchStrategies = async (): Promise<Strategy[]> => {
  const response = await apiClient.get<Strategy[]>("/api/strategies");
  return response.data;
};
