import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ChevronDown, ChevronUp, MessageSquareText, RefreshCw, Reply, Send, X } from "lucide-react";

import {
  createStrategyDiscussionComment,
  listStrategyDiscussionComments,
  type StrategyDiscussionComment,
} from "~/api/strategyDiscussion";
import { useUser } from "~/context/UserConext";
import { useStrategyWorkspace } from "./layout";

type Segment = {
  id: string;
  comments: StrategyDiscussionComment[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

type ReplyTarget = {
  commentId: string;
  authorDisplay: string;
  messageExcerpt: string;
};

const COMMENT_MAX_CHARS = 5000;
const PAGE_SIZE = 10;
const SPLIT_THRESHOLD = 20;

const markdownComponents: Components = {
  code: ({ inline, children, ...props }: any) =>
    inline ? (
      <code
        className="rounded-md border border-outline-variant/20 bg-black/30 px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface"
        {...props}
      >
        {children}
      </code>
    ) : (
      <pre className="overflow-x-auto rounded-xl border border-outline-variant/10 bg-black/35 px-5 py-4">
        <code className="block whitespace-pre text-sm leading-6 text-on-surface/90">{children}</code>
      </pre>
    ),
  p: ({ children }) => <p className="text-[14px] leading-7 text-on-surface/85">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-secondary underline decoration-secondary/30 underline-offset-4 transition hover:text-on-surface hover:decoration-secondary/60"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="space-y-2 pl-5 text-[14px] leading-7 text-on-surface/85 marker:text-secondary">{children}</ul>,
  ol: ({ children }) => <ol className="space-y-2 pl-5 text-[14px] leading-7 text-on-surface/85 marker:text-secondary">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="rounded-r-xl border-l-4 border-secondary/60 bg-white/[0.03] px-4 py-2 italic text-on-surface/85">
      {children}
    </blockquote>
  ),
};

function dedupeComments(comments: StrategyDiscussionComment[]): StrategyDiscussionComment[] {
  const map = new Map<string, StrategyDiscussionComment>();
  for (const comment of comments) {
    map.set(comment.comment_id, comment);
  }
  return Array.from(map.values()).sort((a, b) => a.comment_id.localeCompare(b.comment_id));
}

function normalizeSegment(segment: Segment): Segment {
  return {
    ...segment,
    comments: dedupeComments(segment.comments),
  };
}

function segmentStartId(segment: Segment): string {
  return segment.comments[0]?.comment_id ?? "";
}

function segmentEndId(segment: Segment): string {
  return segment.comments[segment.comments.length - 1]?.comment_id ?? "";
}

function mergeSegments(segments: Segment[]): Segment[] {
  const normalized = segments.map(normalizeSegment).filter((segment) => segment.comments.length > 0);
  normalized.sort((a, b) => segmentStartId(a).localeCompare(segmentStartId(b)));

  const merged: Segment[] = [];
  for (const segment of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(segment);
      continue;
    }

    if (segmentStartId(segment) <= segmentEndId(previous)) {
      merged[merged.length - 1] = {
        id: `${previous.id}-${segment.id}`,
        comments: dedupeComments([...previous.comments, ...segment.comments]),
        hasMoreBefore: previous.hasMoreBefore,
        hasMoreAfter: segment.hasMoreAfter,
      };
      continue;
    }

    merged.push(segment);
  }

  return merged;
}

function visibleCommentCount(segments: Segment[]): number {
  return dedupeComments(segments.flatMap((segment) => segment.comments)).length;
}

function initialsForComment(comment: StrategyDiscussionComment): string {
  const base = (comment.author_display?.trim() || comment.author_netid || "?").trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function makeReplyTarget(comment: StrategyDiscussionComment): ReplyTarget {
  return {
    commentId: comment.comment_id,
    authorDisplay: comment.author_display?.trim() || comment.author_netid,
    messageExcerpt: comment.message.trim().replace(/\s+/g, " ").slice(0, 140),
  };
}

function segmentFromResponse(
  key: string,
  comments: StrategyDiscussionComment[],
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
): Segment {
  return {
    id: key,
    comments: dedupeComments(comments),
    hasMoreBefore,
    hasMoreAfter,
  };
}

function CommentComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  replyTarget,
  onCancelReply,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
}) {
  const trimmedLength = value.trim().length;
  const isOverLimit = trimmedLength > COMMENT_MAX_CHARS;
  const isDisabled = isSubmitting || trimmedLength === 0 || isOverLimit;

  return (
    <section className="rounded-xl border border-outline-variant/15 bg-[#121215]/60 shadow-[0_20px_45px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-3 border-b border-outline-variant/10 bg-[rgba(24,24,21,0.65)] px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container-highest/60">
          <MessageSquareText className="h-5 w-5 text-secondary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-headline text-sm font-bold tracking-tight text-on-surface">Add to the discussion</h3>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {replyTarget ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-secondary/20 bg-secondary/8 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary/80">
                Replying to {replyTarget.authorDisplay}
              </div>
              <div className="mt-1 truncate text-sm text-on-surface-variant/85">{replyTarget.messageExcerpt}</div>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/15 bg-black/10 text-on-surface-variant/80 transition hover:text-on-surface"
              aria-label="Cancel reply"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={7}
          placeholder="Leave a comment"
          className="w-full resize-y rounded-xl border border-outline-variant/15 bg-black/20 px-4 py-3 text-sm leading-6 text-on-surface outline-none transition focus:border-secondary/45"
        />
        <div className="flex items-center justify-between gap-4">
          <span className={`text-xs ${isOverLimit ? "text-rose-400" : "text-on-surface-variant/80"}`}>
            {trimmedLength}/{COMMENT_MAX_CHARS}
          </span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isDisabled}
            className={`inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              isDisabled
                ? "cursor-not-allowed border border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
                : "border border-secondary/30 bg-secondary/90 text-black shadow-[0_12px_30px_rgba(125,181,255,0.2)] hover:brightness-110"
            }`}
          >
            <Send className="h-4 w-4" />
            {isSubmitting ? "Posting..." : replyTarget ? "Reply" : "Comment"}
          </button>
        </div>
      </div>
    </section>
  );
}

function CommentCard({
  comment,
  onReply,
  onJumpToParent,
  registerRef,
  isHighlighted,
}: {
  comment: StrategyDiscussionComment;
  onReply: (comment: StrategyDiscussionComment) => void;
  onJumpToParent: (commentId: string) => void;
  registerRef: (commentId: string, node: HTMLDivElement | null) => void;
  isHighlighted: boolean;
}) {
  const timestamp = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(comment.created_at)),
    [comment.created_at]
  );

  return (
    <div
      ref={(node) => registerRef(comment.comment_id, node)}
      id={`comment-${comment.comment_id}`}
      className="grid grid-cols-[44px_minmax(0,1fr)] gap-4"
    >
      <div className="flex justify-center pt-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-high text-xs font-bold uppercase tracking-wide text-on-surface">
          {initialsForComment(comment)}
        </div>
      </div>
      <article className="overflow-hidden rounded-xl border border-outline-variant/12 bg-[#121215]/55 shadow-[0_18px_38px_rgba(0,0,0,0.14)]">
        <div
          className={`flex items-start justify-between gap-4 border-b px-5 py-4 transition-all duration-700 ${
            isHighlighted
              ? "border-secondary/30 bg-secondary/12 shadow-[inset_0_0_0_1px_rgba(125,181,255,0.16)]"
              : "border-outline-variant/10 bg-black/10"
          }`}
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-on-surface">
              {comment.author_display?.trim() || comment.author_netid}
            </div>
            <div className="truncate text-xs text-on-surface-variant/80">{comment.author_netid}</div>
          </div>
          <time className="shrink-0 text-xs text-on-surface-variant/70">{timestamp}</time>
        </div>
        <div className="space-y-4 px-5 py-4">
          {comment.parent_preview ? (
            <button
              type="button"
              onClick={() => onJumpToParent(comment.parent_preview!.comment_id)}
              className="block w-full rounded-xl border border-outline-variant/15 bg-black/15 px-4 py-3 text-left transition hover:border-secondary/30 hover:bg-secondary/8"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary/75">
                Replying to {comment.parent_preview.author_display || comment.parent_preview.author_netid || "comment"}
              </div>
              <div className="mt-1 truncate text-sm text-on-surface-variant/85">{comment.parent_preview.message_excerpt}</div>
            </button>
          ) : null}

          <div className="space-y-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {comment.message}
            </ReactMarkdown>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/12 bg-black/10 px-3 py-2 text-sm font-medium text-on-surface-variant/85 transition hover:border-secondary/30 hover:text-on-surface"
            >
              <Reply className="h-4 w-4" />
              Reply
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function GapControls({
  canLoadNewer,
  canLoadOlder,
  isLoadingNewer,
  isLoadingOlder,
  onLoadNewer,
  onLoadOlder,
}: {
  canLoadNewer: boolean;
  canLoadOlder: boolean;
  isLoadingNewer: boolean;
  isLoadingOlder: boolean;
  onLoadNewer: () => void;
  onLoadOlder: () => void;
}) {
  if (!canLoadNewer && !canLoadOlder) return null;

  return (
    <div className="flex justify-center py-1">
      <div className="flex min-w-[280px] flex-col items-center gap-2 rounded-2xl border border-dashed border-outline-variant/20 bg-black/10 px-4 py-4">
        <button
          type="button"
          onClick={onLoadNewer}
          disabled={!canLoadNewer || isLoadingNewer}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
            !canLoadNewer || isLoadingNewer
              ? "cursor-not-allowed border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
              : "border-outline-variant/15 bg-black/15 text-on-surface hover:border-secondary/35 hover:text-secondary"
          }`}
        >
          <ChevronDown className="h-4 w-4" />
          {isLoadingNewer ? "Loading..." : "Load newer comments"}
        </button>

        <div className="flex flex-col items-center gap-1 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-outline-variant/35" />
          <span className="h-1.5 w-1.5 rounded-full bg-outline-variant/35" />
          <span className="h-1.5 w-1.5 rounded-full bg-outline-variant/35" />
        </div>

        <button
          type="button"
          onClick={onLoadOlder}
          disabled={!canLoadOlder || isLoadingOlder}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
            !canLoadOlder || isLoadingOlder
              ? "cursor-not-allowed border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
              : "border-outline-variant/15 bg-black/15 text-on-surface hover:border-secondary/35 hover:text-secondary"
          }`}
        >
          <ChevronUp className="h-4 w-4" />
          {isLoadingOlder ? "Loading..." : "Load older comments"}
        </button>
      </div>
    </div>
  );
}

export default function StrategyDiscussion() {
  const { strategy, addToast } = useStrategyWorkspace();
  const { user } = useUser();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({});
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);

  const commentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimeoutRef = useRef<number | null>(null);

  const setLoadingKey = useCallback((key: string, value: boolean) => {
    setLoadingKeys((current) => ({ ...current, [key]: value }));
  }, []);

  const registerCommentRef = useCallback((commentId: string, node: HTMLDivElement | null) => {
    commentRefs.current[commentId] = node;
  }, []);

  const scrollToComment = useCallback((commentId: string) => {
    const node = commentRefs.current[commentId];
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedCommentId(commentId);
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedCommentId((current) => (current === commentId ? null : current));
      highlightTimeoutRef.current = null;
    }, 2200);
    return true;
  }, []);

  const insertSegments = useCallback((incoming: Segment[]) => {
    setSegments((current) => mergeSegments([...current, ...incoming]));
  }, []);

  useEffect(() => {
    if (!pendingScrollId) return;
    if (!scrollToComment(pendingScrollId)) return;
    setPendingScrollId(null);
  }, [pendingScrollId, scrollToComment, segments]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const loadDiscussion = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const oldestResponse = await listStrategyDiscussionComments(strategy.id, {
        limit: PAGE_SIZE,
        order: "asc",
        includeTotal: true,
      });

      const nextTotal = oldestResponse.total_count ?? oldestResponse.items.length;
      setTotalCount(nextTotal);

      if (nextTotal <= SPLIT_THRESHOLD) {
        const fullResponse =
          oldestResponse.items.length >= nextTotal
            ? oldestResponse
            : await listStrategyDiscussionComments(strategy.id, {
                limit: SPLIT_THRESHOLD,
                order: "asc",
              });
        setSegments([
          segmentFromResponse(
            "full",
            fullResponse.items ?? [],
            false,
            false
          ),
        ]);
        return;
      }

      const newestResponse = await listStrategyDiscussionComments(strategy.id, {
        limit: PAGE_SIZE,
        order: "desc",
      });

      const oldestSegment = segmentFromResponse(
        "oldest",
        oldestResponse.items ?? [],
        false,
        Boolean(oldestResponse.has_more_after)
      );
      const newestSegment = segmentFromResponse(
        "newest",
        [...(newestResponse.items ?? [])].reverse(),
        Boolean(newestResponse.has_more_before),
        false
      );

      setSegments(mergeSegments([oldestSegment, newestSegment]));
    } catch (loadError) {
      console.error("Failed to load strategy discussion", loadError);
      setError("Failed to load discussion.");
      addToast("Failed to load discussion", "warning");
    } finally {
      setIsLoading(false);
    }
  }, [addToast, strategy.id]);

  useEffect(() => {
    void loadDiscussion();
  }, [loadDiscussion]);

  const loadOlderForSegment = useCallback(
    async (segmentIndex: number) => {
      const segment = segments[segmentIndex];
      const firstCommentId = segment?.comments[0]?.comment_id;
      if (!segment || !segment.hasMoreBefore || !firstCommentId) return;

      const key = `older-${segment.id}`;
      setLoadingKey(key, true);
      try {
        const response = await listStrategyDiscussionComments(strategy.id, {
          beforeCommentId: firstCommentId,
          limit: PAGE_SIZE,
        });
        const updated = [...segments];
        updated[segmentIndex] = {
          ...segment,
          comments: dedupeComments([...(response.items ?? []), ...segment.comments]),
          hasMoreBefore: Boolean(response.has_more_before),
        };
        setSegments(mergeSegments(updated));
      } catch (loadError) {
        console.error("Failed to load older comments", loadError);
        addToast("Failed to load older comments", "warning");
      } finally {
        setLoadingKey(key, false);
      }
    },
    [addToast, segments, setLoadingKey, strategy.id]
  );

  const loadNewerForSegment = useCallback(
    async (segmentIndex: number) => {
      const segment = segments[segmentIndex];
      const lastCommentId = segment?.comments[segment.comments.length - 1]?.comment_id;
      if (!segment || !segment.hasMoreAfter || !lastCommentId) return;

      const key = `newer-${segment.id}`;
      setLoadingKey(key, true);
      try {
        const response = await listStrategyDiscussionComments(strategy.id, {
          afterCommentId: lastCommentId,
          limit: PAGE_SIZE,
        });
        const updated = [...segments];
        updated[segmentIndex] = {
          ...segment,
          comments: dedupeComments([...segment.comments, ...(response.items ?? [])]),
          hasMoreAfter: Boolean(response.has_more_after),
        };
        setSegments(mergeSegments(updated));
      } catch (loadError) {
        console.error("Failed to load newer comments", loadError);
        addToast("Failed to load newer comments", "warning");
      } finally {
        setLoadingKey(key, false);
      }
    },
    [addToast, segments, setLoadingKey, strategy.id]
  );

  const jumpToParentComment = useCallback(
    async (commentId: string) => {
      if (scrollToComment(commentId)) return;

      const key = `jump-${commentId}`;
      setLoadingKey(key, true);
      try {
        const response = await listStrategyDiscussionComments(strategy.id, {
          aroundCommentId: commentId,
          beforeLimit: 10,
          afterLimit: 10,
        });
        insertSegments([
          segmentFromResponse(
            `anchor-${commentId}`,
            response.items ?? [],
            Boolean(response.has_more_before),
            Boolean(response.has_more_after)
          ),
        ]);
        setPendingScrollId(commentId);
      } catch (loadError) {
        console.error("Failed to jump to parent comment", loadError);
        addToast("Failed to open parent comment", "warning");
      } finally {
        setLoadingKey(key, false);
      }
    },
    [addToast, insertSegments, scrollToComment, setLoadingKey, strategy.id]
  );

  const handleSubmit = useCallback(async () => {
    const message = draft.trim();
    if (!message || isSubmitting) return;
    if (message.length > COMMENT_MAX_CHARS) {
      addToast("Comment is too long", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createStrategyDiscussionComment(strategy.id, {
        message,
        parent_comment_id: replyTarget?.commentId,
      });
      setSegments((current) => {
        if (current.length === 0) {
          return [segmentFromResponse("new-comment", [created], false, false)];
        }
        const updated = [...current];
        const lastIndex = updated.length - 1;
        updated[lastIndex] = {
          ...updated[lastIndex],
          comments: dedupeComments([...updated[lastIndex].comments, created]),
          hasMoreAfter: false,
        };
        return mergeSegments(updated);
      });
      setTotalCount((current) => current + 1);
      setDraft("");
      setReplyTarget(null);
      setPendingScrollId(created.comment_id);
      addToast(replyTarget ? "Reply posted" : "Comment posted", "success");
    } catch (submitError) {
      console.error("Failed to create discussion comment", submitError);
      addToast("Failed to post comment", "warning");
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, draft, isSubmitting, replyTarget, strategy.id]);

  const visibleCount = useMemo(() => visibleCommentCount(segments), [segments]);

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/12 bg-[#121215]/55 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">Discussion</h2>
          <p className="text-sm text-on-surface-variant/80">
            {totalCount || visibleCount} {(totalCount || visibleCount) === 1 ? "comment" : "comments"}
            {user?.display_name ? ` · signed in as ${user.display_name}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDiscussion()}
          disabled={isLoading}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
            isLoading
              ? "cursor-not-allowed border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
              : "border-outline-variant/15 bg-black/15 text-on-surface hover:border-secondary/35 hover:text-secondary"
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </section>

      {isLoading ? (
        <div className="rounded-xl border border-outline-variant/12 bg-[#121215]/50 px-5 py-6 text-sm text-on-surface-variant/80">
          Loading discussion...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/8 px-5 py-6 text-sm text-rose-200">{error}</div>
      ) : (
        <div className="space-y-4">
          {segments.length === 0 ? (
            <div className="rounded-xl border border-outline-variant/12 bg-[#121215]/50 px-5 py-8 text-center text-sm text-on-surface-variant/80">
              No comments yet.
            </div>
          ) : (
            segments.map((segment, index) => (
              <div key={segment.id} className="space-y-4">
                {segment.comments.map((comment) => (
                  <CommentCard
                    key={comment.comment_id}
                    comment={comment}
                    onReply={(target) => setReplyTarget(makeReplyTarget(target))}
                    onJumpToParent={(commentId) => void jumpToParentComment(commentId)}
                    registerRef={registerCommentRef}
                    isHighlighted={highlightedCommentId === comment.comment_id}
                  />
                ))}

                {index < segments.length - 1 ? (
                  <GapControls
                    canLoadNewer={segment.hasMoreAfter}
                    canLoadOlder={segments[index + 1].hasMoreBefore}
                    isLoadingNewer={Boolean(loadingKeys[`newer-${segment.id}`])}
                    isLoadingOlder={Boolean(loadingKeys[`older-${segments[index + 1].id}`])}
                    onLoadNewer={() => void loadNewerForSegment(index)}
                    onLoadOlder={() => void loadOlderForSegment(index + 1)}
                  />
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      <CommentComposer
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
      />
    </div>
  );
}
