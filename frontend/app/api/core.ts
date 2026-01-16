import axios from "axios";

const CORE_API_BASE_URL = import.meta.env.VITE_CORE_API ?? "http://localhost:5000";
const CORE_API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";
const AUTH_TOKEN_KEY = "hqg_auth_token";

const getAuthToken = (): string => {
  if (typeof window === "undefined") return "";

  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${AUTH_TOKEN_KEY}=`));
  if (!match) return "";

  return decodeURIComponent(match.split("=").slice(1).join("="));
};

export const coreApi = axios.create({
  baseURL: CORE_API_BASE_URL,
  headers: CORE_API_TOKEN ? { "x-api-token": CORE_API_TOKEN } : undefined,
  withCredentials: true,
});

coreApi.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (!token) return config;

  config.headers = config.headers ?? {};
  if (!config.headers.Authorization && !config.headers.authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});
