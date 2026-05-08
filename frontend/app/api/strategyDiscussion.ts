import { coreApi } from "./core";

export type StrategyDiscussionComment = {
  strategy_id: string;
  comment_id: string;
  message: string;
  author_netid: string;
  author_display?: string;
  created_at: string;
  updated_at: string;
};

export type ListStrategyDiscussionResponse = {
  strategy_id: string;
  items: StrategyDiscussionComment[];
  next_cursor?: Record<string, unknown> | null;
  total_count?: number | null;
};

export type ListStrategyDiscussionOptions = {
  limit?: number;
  cursor?: Record<string, unknown> | null;
  order?: "asc" | "desc";
  includeTotal?: boolean;
};

export const listStrategyDiscussionComments = async (
  strategyId: string | number,
  options?: ListStrategyDiscussionOptions
): Promise<ListStrategyDiscussionResponse> => {
  const params: Record<string, string> = {};
  if (options?.limit) params.limit = String(options.limit);
  if (options?.cursor) params.cursor = JSON.stringify(options.cursor);
  if (options?.order) params.order = options.order;
  if (options?.includeTotal) params.include_total = "true";

  const response = await coreApi.get<ListStrategyDiscussionResponse>(
    `/strategies/${strategyId}/discussion`,
    { params }
  );
  return response.data;
};

export type CreateStrategyDiscussionCommentRequest = {
  message: string;
};

export const createStrategyDiscussionComment = async (
  strategyId: string | number,
  payload: CreateStrategyDiscussionCommentRequest
): Promise<StrategyDiscussionComment> => {
  const response = await coreApi.post<StrategyDiscussionComment>(
    `/strategies/${strategyId}/discussion`,
    payload
  );
  return response.data;
};
