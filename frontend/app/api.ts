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
  baseURL: "http://localhost:5000",
});

export const fetchStrategies = async (): Promise<Strategy[]> => {
  const response = await apiClient.get<Strategy[]>("/api/strategies");
  return response.data;
};
