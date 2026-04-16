import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { coreApiBaseUrl } from "./runtime";

type AuthRetryConfig = InternalAxiosRequestConfig & {
  _authRetry?: boolean;
};

type RefreshResponse = {
  expires_at?: number;
};

export const coreApi = axios.create({
  baseURL: coreApiBaseUrl,
  withCredentials: true,
});

let refreshPromise: Promise<void> | null = null;
let authSessionExpiresAtMs: number | null = null;

export function noteAuthSessionExpiresAt(expiresAtSeconds?: number) {
  if (typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds)) {
    authSessionExpiresAtMs = null;
    return;
  }

  authSessionExpiresAtMs = expiresAtSeconds * 1000;
}

export function shouldRefreshAuthSession(bufferMs: number): boolean {
  return authSessionExpiresAtMs === null || authSessionExpiresAtMs - Date.now() <= bufferMs;
}

export function refreshAuthSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = coreApi
      .post<RefreshResponse>("/auth/refresh")
      .then((response) => {
        noteAuthSessionExpiresAt(response.data?.expires_at);
      })
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
