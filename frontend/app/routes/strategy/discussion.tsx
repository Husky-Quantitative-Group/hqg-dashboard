import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ChevronDown, ChevronUp, MessageSquareText, RefreshCw, Send } from "lucide-react";

import {
  createStrategyDiscussionComment,
  listStrategyDiscussionComments,
  type StrategyDiscussionComment,
} from "~/api/strategyDiscussion";
import { useUser } from "~/context/UserConext";
import { useStrategyWorkspace } from "./layout";

type Cursor = Record<string, unknown> | null;
type DiscussionMode = "full" | "split";

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

function hasOverlap(a: StrategyDiscussionComment[], b: StrategyDiscussionComment[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const ids = new Set(a.map((comment) => comment.comment_id));
  return b.some((comment) => ids.has(comment.comment_id));
}

function initialsForComment(comment: StrategyDiscussionComment): string {
  const base = (comment.author_display?.trim() || comment.author_netid || "?").trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function CommentComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
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
            {isSubmitting ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </section>
  );
}

function CommentCard({ comment }: { comment: StrategyDiscussionComment }) {
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
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-4">
      <div className="flex justify-center pt-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-high text-xs font-bold uppercase tracking-wide text-on-surface">
          {initialsForComment(comment)}
        </div>
      </div>
      <article className="overflow-hidden rounded-xl border border-outline-variant/12 bg-[#121215]/55 shadow-[0_18px_38px_rgba(0,0,0,0.14)]">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/10 bg-black/10 px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-on-surface">
              {comment.author_display?.trim() || comment.author_netid}
            </div>
            <div className="truncate text-xs text-on-surface-variant/80">{comment.author_netid}</div>
          </div>
          <time className="shrink-0 text-xs text-on-surface-variant/70">{timestamp}</time>
        </div>
        <div className="px-5 py-4">
          <div className="space-y-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {comment.message}
            </ReactMarkdown>
          </div>
        </div>
      </article>
    </div>
  );
}

function GapControls({
  canLoadFromTop,
  canLoadFromBottom,
  isLoadingTop,
  isLoadingBottom,
  onLoadFromTop,
  onLoadFromBottom,
}: {
  canLoadFromTop: boolean;
  canLoadFromBottom: boolean;
  isLoadingTop: boolean;
  isLoadingBottom: boolean;
  onLoadFromTop: () => void;
  onLoadFromBottom: () => void;
}) {
  if (!canLoadFromTop && !canLoadFromBottom) return null;

  return (
    <div className="my-2 rounded-xl border border-dashed border-outline-variant/20 bg-black/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onLoadFromTop}
          disabled={!canLoadFromTop || isLoadingTop}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
            !canLoadFromTop || isLoadingTop
              ? "cursor-not-allowed border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
              : "border-outline-variant/15 bg-black/15 text-on-surface hover:border-secondary/35 hover:text-secondary"
          }`}
        >
          <ChevronDown className="h-4 w-4" />
          {isLoadingTop ? "Loading..." : "Load newer comments"}
        </button>

        <div className="text-xs uppercase tracking-[0.18em] text-on-surface-variant/65">Conversation gap</div>

        <button
          type="button"
          onClick={onLoadFromBottom}
          disabled={!canLoadFromBottom || isLoadingBottom}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
            !canLoadFromBottom || isLoadingBottom
              ? "cursor-not-allowed border-outline-variant/10 bg-surface-container-high/40 text-on-surface-variant/45"
              : "border-outline-variant/15 bg-black/15 text-on-surface hover:border-secondary/35 hover:text-secondary"
          }`}
        >
          <ChevronUp className="h-4 w-4" />
          {isLoadingBottom ? "Loading..." : "Load older comments"}
        </button>
      </div>
    </div>
  );
}

export default function StrategyDiscussion() {
  const { strategy, addToast } = useStrategyWorkspace();
  const { user } = useUser();

  const [mode, setMode] = useState<DiscussionMode>("full");
  const [fullComments, setFullComments] = useState<StrategyDiscussionComment[]>([]);
  const [olderComments, setOlderComments] = useState<StrategyDiscussionComment[]>([]);
  const [newerComments, setNewerComments] = useState<StrategyDiscussionComment[]>([]);
  const [olderCursor, setOlderCursor] = useState<Cursor>(null);
  const [newerCursor, setNewerCursor] = useState<Cursor>(null);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTopGap, setIsLoadingTopGap] = useState(false);
  const [isLoadingBottomGap, setIsLoadingBottomGap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const visibleCount = mode === "full" ? fullComments.length : dedupeComments([...olderComments, ...newerComments]).length;

  const collapseToFull = useCallback((comments: StrategyDiscussionComment[]) => {
    const merged = dedupeComments(comments);
    setMode("full");
    setFullComments(merged);
    setOlderComments([]);
    setNewerComments([]);
    setOlderCursor(null);
    setNewerCursor(null);
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
        if (oldestResponse.next_cursor) {
          const fullResponse = await listStrategyDiscussionComments(strategy.id, {
            limit: SPLIT_THRESHOLD,
            order: "asc",
          });
          setMode("full");
          setFullComments(fullResponse.items ?? []);
        } else {
          setMode("full");
          setFullComments(oldestResponse.items ?? []);
        }
        setOlderComments([]);
        setNewerComments([]);
        setOlderCursor(null);
        setNewerCursor(null);
        return;
      }

      const newestResponse = await listStrategyDiscussionComments(strategy.id, {
        limit: PAGE_SIZE,
        order: "desc",
      });

      const initialOlder = oldestResponse.items ?? [];
      const initialNewer = [...(newestResponse.items ?? [])].reverse();

      if (hasOverlap(initialOlder, initialNewer)) {
        collapseToFull([...initialOlder, ...initialNewer]);
        return;
      }

      setMode("split");
      setFullComments([]);
      setOlderComments(initialOlder);
      setNewerComments(initialNewer);
      setOlderCursor(oldestResponse.next_cursor ?? null);
      setNewerCursor(newestResponse.next_cursor ?? null);
    } catch (loadError) {
      console.error("Failed to load strategy discussion", loadError);
      setError("Failed to load discussion.");
      addToast("Failed to load discussion", "warning");
    } finally {
      setIsLoading(false);
    }
  }, [addToast, collapseToFull, strategy.id]);

  useEffect(() => {
    void loadDiscussion();
  }, [loadDiscussion]);

  const loadNewerGap = useCallback(async () => {
    if (!olderCursor || isLoadingTopGap) return;
    setIsLoadingTopGap(true);
    try {
      const response = await listStrategyDiscussionComments(strategy.id, {
        limit: PAGE_SIZE,
        order: "asc",
        cursor: olderCursor,
      });
      const nextOlder = dedupeComments([...olderComments, ...(response.items ?? [])]);
      if (hasOverlap(nextOlder, newerComments) || !response.next_cursor) {
        collapseToFull([...nextOlder, ...newerComments]);
        return;
      }
      setOlderComments(nextOlder);
      setOlderCursor(response.next_cursor ?? null);
    } catch (loadError) {
      console.error("Failed to load newer gap comments", loadError);
      addToast("Failed to load newer comments", "warning");
    } finally {
      setIsLoadingTopGap(false);
    }
  }, [addToast, collapseToFull, isLoadingTopGap, newerComments, olderComments, olderCursor, strategy.id]);

  const loadOlderGap = useCallback(async () => {
    if (!newerCursor || isLoadingBottomGap) return;
    setIsLoadingBottomGap(true);
    try {
      const response = await listStrategyDiscussionComments(strategy.id, {
        limit: PAGE_SIZE,
        order: "desc",
        cursor: newerCursor,
      });
      const nextPageAscending = [...(response.items ?? [])].reverse();
      const nextNewer = dedupeComments([...nextPageAscending, ...newerComments]);
      if (hasOverlap(olderComments, nextNewer) || !response.next_cursor) {
        collapseToFull([...olderComments, ...nextNewer]);
        return;
      }
      setNewerComments(nextNewer);
      setNewerCursor(response.next_cursor ?? null);
    } catch (loadError) {
      console.error("Failed to load older gap comments", loadError);
      addToast("Failed to load older comments", "warning");
    } finally {
      setIsLoadingBottomGap(false);
    }
  }, [addToast, collapseToFull, isLoadingBottomGap, newerComments, newerCursor, olderComments, strategy.id]);

  const handleSubmit = useCallback(async () => {
    const message = draft.trim();
    if (!message || isSubmitting) return;
    if (message.length > COMMENT_MAX_CHARS) {
      addToast("Comment is too long", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createStrategyDiscussionComment(strategy.id, { message });
      setTotalCount((current) => current + 1);

      if (mode === "full") {
        setFullComments((previous) => dedupeComments([...previous, created]));
      } else {
        setNewerComments((previous) => dedupeComments([...previous, created]));
      }

      setDraft("");
      addToast("Comment posted", "success");
    } catch (submitError) {
      console.error("Failed to create discussion comment", submitError);
      addToast("Failed to post comment", "warning");
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, draft, isSubmitting, mode, strategy.id]);

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
          {mode === "full" ? (
            fullComments.length === 0 ? (
              <div className="rounded-xl border border-outline-variant/12 bg-[#121215]/50 px-5 py-8 text-center text-sm text-on-surface-variant/80">
                No comments yet.
              </div>
            ) : (
              fullComments.map((comment) => <CommentCard key={comment.comment_id} comment={comment} />)
            )
          ) : (
            <>
              {olderComments.map((comment) => (
                <CommentCard key={comment.comment_id} comment={comment} />
              ))}

              <GapControls
                canLoadFromTop={Boolean(olderCursor)}
                canLoadFromBottom={Boolean(newerCursor)}
                isLoadingTop={isLoadingTopGap}
                isLoadingBottom={isLoadingBottomGap}
                onLoadFromTop={() => void loadNewerGap()}
                onLoadFromBottom={() => void loadOlderGap()}
              />

              {newerComments.map((comment) => (
                <CommentCard key={comment.comment_id} comment={comment} />
              ))}
            </>
          )}
        </div>
      )}

      <CommentComposer value={draft} onChange={setDraft} onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
