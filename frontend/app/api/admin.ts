import { coreApi } from "./core";

export type AdminUser = {
  netid: string;
  full_name?: string;
  uconn_email?: string;
  roles?: string[];
  is_banned?: boolean;
  joined_at?: string;
  notes?: string;
  [key: string]: unknown;
};

export type AccessRequest = {
  netid: string;
  created_at?: string;
  status?: "pending" | "approved" | "denied" | string;
  full_name?: string;
  uconn_email?: string;
  discord_username?: string;
  linkedin_url?: string;
  github_url?: string;
  decision_notes?: string;
  decided_at?: string;
  decided_by?: string;
  [key: string]: unknown;
};

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await coreApi.get("/admin/users");
  const data = response.data as { items?: AdminUser[] } | AdminUser[];
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

export async function fetchAdminAccessRequests(): Promise<AccessRequest[]> {
  const response = await coreApi.get("/admin/access-requests");
  const data = response.data as { items?: AccessRequest[] } | AccessRequest[];
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}
