import axios from "axios";

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
  baseURL: "/api",
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
