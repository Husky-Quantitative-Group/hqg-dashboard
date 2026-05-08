import { coreApi } from "./core";

export type StrategyDiscussionComment = {
  strategy_id: string;
  comment_id: string;
  message: string;
  author_netid: string;
  author_display?: string;
  created_at: string;
  updated_at: string;
  parent_comment_id?: string;
  parent_preview?: {
    comment_id: string;
    author_display?: string;
    author_netid?: string;
    message_excerpt: string;
  };
};

export type ListStrategyDiscussionResponse = {
  strategy_id: string;
  items: StrategyDiscussionComment[];
  next_cursor?: Record<string, unknown> | null;
  total_count?: number | null;
  has_more_before?: boolean;
  has_more_after?: boolean;
  anchor_comment_id?: string | null;
};

export type ListStrategyDiscussionOptions = {
  limit?: number;
  cursor?: Record<string, unknown> | null;
  order?: "asc" | "desc";
  includeTotal?: boolean;
  beforeCommentId?: string;
  afterCommentId?: string;
  aroundCommentId?: string;
  beforeLimit?: number;
  afterLimit?: number;
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
  if (options?.beforeCommentId) params.before_comment_id = options.beforeCommentId;
  if (options?.afterCommentId) params.after_comment_id = options.afterCommentId;
  if (options?.aroundCommentId) params.around_comment_id = options.aroundCommentId;
  if (typeof options?.beforeLimit === "number") params.before_limit = String(options.beforeLimit);
  if (typeof options?.afterLimit === "number") params.after_limit = String(options.afterLimit);

  const response = await coreApi.get<ListStrategyDiscussionResponse>(
    `/strategies/${strategyId}/discussion`,
    { params }
  );
  return response.data;
};

export type CreateStrategyDiscussionCommentRequest = {
  message: string;
  parent_comment_id?: string;
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
