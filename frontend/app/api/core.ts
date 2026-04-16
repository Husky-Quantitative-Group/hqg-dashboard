import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { coreApiBaseUrl } from "./runtime";

type AuthRetryConfig = InternalAxiosRequestConfig & {
  _authRetry?: boolean;
};

export const coreApi = axios.create({
  baseURL: coreApiBaseUrl,
  withCredentials: true,
});

let refreshPromise: Promise<void> | null = null;

export function refreshAuthSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = coreApi
      .post("/auth/refresh")
      .then(() => undefined)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export function attachAuthRefreshInterceptor(api: AxiosInstance) {
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const config = error.config as AuthRetryConfig | undefined;

      if (
        status !== 401 ||
        !config ||
        config._authRetry ||
        config.url?.includes("/auth/refresh") ||
        config.url?.includes("/auth/login")
      ) {
        return Promise.reject(error);
      }

      config._authRetry = true;
      await refreshAuthSession();
      return api(config);
    }
  );
}

attachAuthRefreshInterceptor(coreApi);
