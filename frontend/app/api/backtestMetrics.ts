import { coreApi } from "./core";

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
