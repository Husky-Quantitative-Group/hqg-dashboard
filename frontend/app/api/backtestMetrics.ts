import { coreApi } from "./core";

// API for S3 upload

export type PresignedPost = {
  url: string;
  fields: Record<string, string>;
};

export type BacktestPresignResponse = {
  strategy_id: string;
  run_id: string;
  created_by: string;
  s3: {
    bucket: string;
    key: string;
    expires_in: number;
    upload: {
      method: "POST";
      url: string;
      fields: Record<string, string>;
    };
  };
};

export const presignBacktestRunUpload = async (
  strategyId: string | number
): Promise<BacktestPresignResponse> => {
  const response = await coreApi.post<BacktestPresignResponse>(
    `/strategies/${strategyId}/backtests/presign`
  );
  return response.data;
};

export const gzipJson = async (value: unknown): Promise<Blob> => {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream is not supported in this browser.");
  }

  const json = JSON.stringify(value);
  const gzBlob = await new Response(
    new Blob([json], { type: "application/json" })
      .stream()
      .pipeThrough(new CompressionStream("gzip"))
  ).blob();

  return gzBlob;
};

export const uploadPresignedPost = async (
  presigned: PresignedPost,
  file: Blob,
  filename: string
): Promise<void> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields)) {
    form.append(key, value);
  }
  form.append("file", file, filename);

  const res = await fetch(presigned.url, { method: "POST", body: form });
  if (res.status === 204) {
    return;
  }

  const text = await res.text();
  throw new Error(`S3 upload failed (${res.status}): ${text || "Unknown error"}`);
};

// API for DynamoDB upload

export type BacktestParams = {
  start_date: string;
  end_date: string;
  initial_capital: number;
};

export type FinalizeBacktestRunRequest = {
  run_id: string;
  backtest_params: BacktestParams;
  strategy_version?: number | string;
  s3_key?: string;
};

export type FinalizeBacktestRunResponse = {
  strategy_id: string;
  run_id: string;
  name?: string;
  time_created: string;
  user: string;
  strategy_version?: number | string;
  backtest_params: BacktestParams;
  metrics: Record<string, unknown>;
  net_pnl?: number;
  sharpe?: number;
  win_rate?: number;
  max_drawdown?: number;
  trades_count?: number;
  s3_bucket: string;
  s3_key: string;
};

export const finalizeBacktestRun = async (
  strategyId: string | number,
  payload: FinalizeBacktestRunRequest
): Promise<FinalizeBacktestRunResponse> => {
  const response = await coreApi.post<FinalizeBacktestRunResponse>(
    `/strategies/${strategyId}/backtests`,
    payload
  );
  return response.data;
};

// API for listing backtests on results tab

export type BacktestRunItem = FinalizeBacktestRunResponse;

export type ListBacktestRunsResponse = {
  strategy_id: string;
  items: BacktestRunItem[];
  next_cursor?: Record<string, unknown> | null;
};

export const listBacktestRuns = async (
  strategyId: string | number,
  options?: { limit?: number; cursor?: Record<string, unknown> | null }
): Promise<ListBacktestRunsResponse> => {
  const params: Record<string, string> = {};
  if (options?.limit) params.limit = String(options.limit);
  if (options?.cursor) params.cursor = JSON.stringify(options.cursor);

  const response = await coreApi.get<ListBacktestRunsResponse>(
    `/strategies/${strategyId}/backtests`,
    { params }
  );
  return response.data;
};

// API for fetching specific backtest result

export type GetBacktestRunResponse = {
  strategy_id: string;
  run_id: string;
  item: BacktestRunItem;
  s3: {
    bucket: string;
    key: string;
    expires_in: number;
    download_url: string;
  };
};

export const getBacktestRun = async (
  strategyId: string | number,
  runId: string
): Promise<GetBacktestRunResponse> => {
  const response = await coreApi.get<GetBacktestRunResponse>(
    `/strategies/${strategyId}/backtests/${runId}`
  );
  return response.data;
};

// compress json files

export const gunzipJson = async <T = unknown>(compressed: ArrayBuffer): Promise<T> => {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not supported in this browser.");
  }

  const decompressed = await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))
  ).text();

  return JSON.parse(decompressed) as T;
};
