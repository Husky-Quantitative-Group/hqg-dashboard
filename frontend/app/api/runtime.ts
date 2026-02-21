function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const isProd = import.meta.env.IS_PROD === "1";
const coreApiUrl = trimToUndefined(import.meta.env.CORE_API_URL);
const backtesterUrl = trimToUndefined(import.meta.env.BACKTESTER_URL);

export const coreApiBaseUrl = isProd && coreApiUrl ? coreApiUrl : "/api";
export const backtesterApiOrigin =
  isProd && backtesterUrl ? backtesterUrl.replace(/\/+$/, "") : "/backtester-api";
