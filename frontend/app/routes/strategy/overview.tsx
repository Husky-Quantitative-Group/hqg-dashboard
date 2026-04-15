import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStrategyWorkspace } from "./layout";
import {
  deleteStrategyPermissions,
  fetchStrategyPermissions,
  patchStrategyPermissions,
  searchUsers,
  type UserSearchResult,
} from "../../api/strategies";
import { useUser } from "../../context/UserConext";

const CodeRenderer = ({ inline, className, children, ...props }: any) => {
  if (inline) {
    return (
      <code className="rounded bg-slate-900/60 px-1 py-0.5 text-[0.85em] text-fuchsia-200" {...props}>
        {children}
      </code>
    );
  }
  return (
    <pre className="rounded-xl bg-slate-900/80 p-4 text-slate-200">
      <code className={className}>{children}</code>
    </pre>
  );
};

const markdownComponents: Components = {
  code: CodeRenderer,
  h1: ({ children }) => <h1 className="text-2xl font-semibold text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-white">{children}</h3>,
  p: ({ children }) => <p className="text-slate-300">{children}</p>,
  ul: ({ children }) => <ul className="ml-5 list-disc text-slate-300">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal text-slate-300">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
};

export default function StrategyOverview() {
  const { strategy, handleRun, isRunning, files } = useStrategyWorkspace();
  const navigate = useNavigate();
  const { user, hasRole } = useUser();

  const isOwner =
    Boolean(user?.netid) &&
    Boolean(strategy.owner) &&
    strategy.owner!.toLowerCase() === user!.netid.toLowerCase();
  const ownerNetid = strategy.owner?.toLowerCase() ?? "";
  const canManagePermissions = isOwner || hasRole("ADMIN") || !user;

  const [publicRead, setPublicRead] = useState(false);
  const [publicWrite, setPublicWrite] = useState(false);
  const [fundRead, setFundRead] = useState(false);
  const [fundWrite, setFundWrite] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [readUsers, setReadUsers] = useState<UserSearchResult[]>([]);
  const [writeUsers, setWriteUsers] = useState<UserSearchResult[]>([]);
  const [readQuery, setReadQuery] = useState("");
  const [writeQuery, setWriteQuery] = useState("");
  const [readResults, setReadResults] = useState<UserSearchResult[]>([]);
  const [writeResults, setWriteResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const rankUserSearch = (query: string, item: UserSearchResult) => {
    const q = query.toLowerCase();
    const netid = item.netid.toLowerCase();
    const fullName = (item.full_name ?? "").toLowerCase();
    const email = (item.uconn_email ?? "").toLowerCase();
    if (netid.startsWith(q)) return 0;
    if (fullName.startsWith(q)) return 1;
    if (email.startsWith(q)) return 2;
    if (netid.includes(q)) return 3;
    if (fullName.includes(q)) return 4;
    if (email.includes(q)) return 5;
    return 6;
  };

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    []
  );

  const surface = "border border-slate-800 bg-slate-950/40";
  const labelColor = "text-slate-400";
  const mutedColor = "text-slate-400";
  const badgeClass = "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  const quickButtonClass =
    "w-full rounded-xl border border-slate-600/60 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-900";
  const previewSurface = "border border-slate-800/60 bg-slate-950/60 text-slate-200";

  useEffect(() => {
    if (!canManagePermissions) return;
    let isActive = true;
    setPermissionsLoading(true);
    setPermissionsError(null);
    const loadPermissions = async () => {
      try {
        const data = await fetchStrategyPermissions(strategy.id);
        if (!isActive) return;
        setPublicRead(data.read.public);
        setPublicWrite(data.write.public);
        setFundRead(data.read.fund === true);
        setFundWrite(data.write.fund === true);
        setReadUsers(
          (data.read.users ?? []).filter((item) => item.netid.toLowerCase() !== ownerNetid)
        );
        setWriteUsers(
          (data.write.users ?? []).filter((item) => item.netid.toLowerCase() !== ownerNetid)
        );
      } catch (error) {
        if (!isActive) return;
        console.error("Failed to load permissions", error);
        setPermissionsError("Failed to load permissions.");
        setPublicRead(false);
        setPublicWrite(false);
      } finally {
        if (!isActive) return;
        setPermissionsLoading(false);
      }
    };

    void loadPermissions();
    return () => {
      isActive = false;
    };
  }, [canManagePermissions, strategy.id, ownerNetid]);

  useEffect(() => {
    if (!canManagePermissions || publicRead) return;
    if (readQuery.trim().length < 2) {
      setReadResults([]);
      return;
    }
    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      const query = readQuery.trim();
      searchUsers(query)
        .then((items) => {
          if (!active) return;
          const readUserIds = new Set(readUsers.map((item) => item.netid));
          const filtered = items.filter(
            (item) =>
              item.netid.toLowerCase() !== ownerNetid &&
              !readUserIds.has(item.netid)
          );
          filtered.sort((a, b) => {
            const rankDiff = rankUserSearch(query, a) - rankUserSearch(query, b);
            if (rankDiff !== 0) return rankDiff;
            return a.netid.localeCompare(b.netid);
          });
          setReadResults(filtered);
        })
        .catch((error) => {
          if (!active) return;
          console.error("Failed to search users", error);
          setReadResults([]);
        })
        .finally(() => {
          if (!active) return;
          setSearchLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canManagePermissions, publicRead, readQuery, readUsers, ownerNetid]);

  useEffect(() => {
    if (!canManagePermissions || publicWrite) return;
    if (writeQuery.trim().length < 2) {
      setWriteResults([]);
      return;
    }
    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      const query = writeQuery.trim();
      searchUsers(query)
        .then((items) => {
          if (!active) return;
          const writeUserIds = new Set(writeUsers.map((item) => item.netid));
          const filtered = items.filter(
            (item) =>
              item.netid.toLowerCase() !== ownerNetid &&
              !writeUserIds.has(item.netid)
          );
          filtered.sort((a, b) => {
            const rankDiff = rankUserSearch(query, a) - rankUserSearch(query, b);
            if (rankDiff !== 0) return rankDiff;
            return a.netid.localeCompare(b.netid);
          });
          setWriteResults(filtered);
        })
        .catch((error) => {
          if (!active) return;
          console.error("Failed to search users", error);
          setWriteResults([]);
        })
        .finally(() => {
          if (!active) return;
          setSearchLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canManagePermissions, publicWrite, writeQuery, writeUsers, ownerNetid]);

  return (
    <div className="space-y-6">
      <section className="grid gap-5">
        <div className={`rounded-2xl ${surface} p-6`}>
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Overview</p>
              <h2 className="text-2xl font-semibold tracking-tight">{strategy.name}</h2>
            </div>
            <div className={`text-xs ${mutedColor}`}>Strategy ID · STR {strategy.id}</div>
          </header>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className={labelColor}>Owner</dt>
                <dd className="text-base font-medium">{strategy.owner}</dd>
              </div>
              <div>
                <dt className={labelColor}>Project</dt>
                <dd className="text-base font-medium">
                  {strategy.project_id ? (
                    <>
                      PRJ {strategy.project_id} · {strategy.project_name}
                    </>
                  ) : (
                    <span className="text-slate-500">Not assigned</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className={labelColor}>Created</dt>
                <dd>{strategy.created_at ? formatter.format(new Date(strategy.created_at)) : "-"}</dd>
              </div>
              <div>
                <dt className={labelColor}>Updated</dt>
                <dd>{strategy.updated_at ? formatter.format(new Date(strategy.updated_at)) : "-"}</dd>
              </div>
              <div>
                <dt className={labelColor}>Description</dt>
                <dd className="text-base font-medium text-slate-200">
                  {strategy.description?.trim() ? strategy.description : <span className="text-slate-500">No description</span>}
                </dd>
              </div>
              <div>
                <dt className={labelColor}>Tags</dt>
                <dd className="flex flex-wrap gap-2">
                  {strategy.tags?.length ? (
                    strategy.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-base font-medium text-slate-500">No tags</span>
                  )}
                </dd>
              </div>
            </dl>

            <div>
              {canManagePermissions && (
                <div className="space-y-3">
                  <div>
                    <dt className={labelColor}>Permissions</dt>
                    <dd className="text-xs text-slate-400">Set public access for this strategy</dd>
                  </div>

                  {!isOwner && user && !hasRole("ADMIN") && (
                    <div className="text-xs text-slate-500">
                      Only the owner or an admin can change permissions.
                    </div>
                  )}

                  {permissionsError && (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                      {permissionsError}
                    </div>
                  )}

                  <div className="grid gap-3 text-base font-medium text-slate-200 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                        <span>Read access · Public</span>
                        <input
                          type="checkbox"
                          checked={publicRead}
                          disabled={permissionsLoading || !canManagePermissions}
                          onChange={async (event) => {
                            if (!canManagePermissions) return;
                            const nextValue = event.target.checked;
                            setPublicRead(nextValue);
                            try {
                              if (nextValue) {
                                await patchStrategyPermissions(strategy.id, {
                                  read: { public: true },
                                });
                                setReadQuery("");
                                setReadResults([]);
                              } else {
                                await deleteStrategyPermissions(strategy.id, {
                                  read: { public: true },
                                });
                              }
                            } catch (error) {
                              console.error("Failed to update public read permission", error);
                              setPublicRead(!nextValue);
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                        <span>Read access · FUND</span>
                        <input
                          type="checkbox"
                          checked={fundRead}
                          disabled={permissionsLoading || !canManagePermissions}
                          onChange={async (event) => {
                            if (!canManagePermissions) return;
                            const nextValue = event.target.checked;
                            setFundRead(nextValue);
                            try {
                              if (nextValue) {
                                await patchStrategyPermissions(strategy.id, {
                                  read: { fund: true },
                                });
                              } else {
                                await deleteStrategyPermissions(strategy.id, {
                                  read: { fund: true },
                                });
                              }
                            } catch (error) {
                              console.error("Failed to update FUND read permission", error);
                              setFundRead(!nextValue);
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-400 focus:ring-emerald-400"
                        />
                      </label>
                      {!publicRead && (
                        <div className="space-y-2">
                          {readUsers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {readUsers.map((userItem) => (
                                <span
                                  key={userItem.netid}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs"
                                >
                                  {userItem.full_name || userItem.netid}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!canManagePermissions) return;
                                      try {
                                        await deleteStrategyPermissions(strategy.id, {
                                          read: { removeUsers: [userItem.netid] },
                                        });
                                        setReadUsers((prev) =>
                                          prev.filter((entry) => entry.netid !== userItem.netid)
                                        );
                                      } catch (error) {
                                        console.error("Failed to remove read user", error);
                                      }
                                    }}
                                    className="text-slate-400 transition hover:text-white"
                                    aria-label={`Remove ${userItem.netid} from read permissions`}
                                  >
                                    &times;
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">No users added.</div>
                          )}
                          <div className="relative">
                            <input
                              type="text"
                              value={readQuery}
                              onChange={(event) => setReadQuery(event.target.value)}
                              placeholder="Search users to add..."
                              disabled={!canManagePermissions}
                              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                            />
                            {readResults.length > 0 && (
                              <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-slate-950/95 shadow-lg">
                                {readResults.map((item) => (
                                  <button
                                    type="button"
                                    key={item.netid}
                                    onClick={async () => {
                                      if (!canManagePermissions) return;
                                      try {
                                        await patchStrategyPermissions(strategy.id, {
                                          read: { addUsers: [item.netid] },
                                        });
                                        setReadUsers((prev) => [...prev, item]);
                                        setReadQuery("");
                                        setReadResults([]);
                                      } catch (error) {
                                        console.error("Failed to add read user", error);
                                      }
                                    }}
                                    className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-white/5"
                                  >
                                    <span className="font-medium">
                                      {item.full_name || item.netid}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {item.netid}
                                      {item.uconn_email ? ` · ${item.uconn_email}` : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {searchLoading && (
                              <div className="mt-1 text-[11px] text-slate-500">Searching...</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                        <span>Write access · Public</span>
                        <input
                          type="checkbox"
                          checked={publicWrite}
                          disabled={permissionsLoading || !canManagePermissions}
                          onChange={async (event) => {
                            if (!canManagePermissions) return;
                            const nextValue = event.target.checked;
                            setPublicWrite(nextValue);
                            try {
                              if (nextValue) {
                                await patchStrategyPermissions(strategy.id, {
                                  write: { public: true },
                                });
                                setWriteQuery("");
                                setWriteResults([]);
                              } else {
                                await deleteStrategyPermissions(strategy.id, {
                                  write: { public: true },
                                });
                              }
                            } catch (error) {
                              console.error("Failed to update public write permission", error);
                              setPublicWrite(!nextValue);
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                        <span>Write access · FUND</span>
                        <input
                          type="checkbox"
                          checked={fundWrite}
                          disabled={permissionsLoading || !canManagePermissions}
                          onChange={async (event) => {
                            if (!canManagePermissions) return;
                            const nextValue = event.target.checked;
                            setFundWrite(nextValue);
                            try {
                              if (nextValue) {
                                await patchStrategyPermissions(strategy.id, {
                                  write: { fund: true },
                                });
                              } else {
                                await deleteStrategyPermissions(strategy.id, {
                                  write: { fund: true },
                                });
                              }
                            } catch (error) {
                              console.error("Failed to update FUND write permission", error);
                              setFundWrite(!nextValue);
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-400 focus:ring-emerald-400"
                        />
                      </label>
                      {!publicWrite && (
                        <div className="space-y-2">
                          {writeUsers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {writeUsers.map((userItem) => (
                                <span
                                  key={userItem.netid}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs"
                                >
                                  {userItem.full_name || userItem.netid}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!canManagePermissions) return;
                                      try {
                                        await deleteStrategyPermissions(strategy.id, {
                                          write: { removeUsers: [userItem.netid] },
                                        });
                                        setWriteUsers((prev) =>
                                          prev.filter((entry) => entry.netid !== userItem.netid)
                                        );
                                      } catch (error) {
                                        console.error("Failed to remove write user", error);
                                      }
                                    }}
                                    className="text-slate-400 transition hover:text-white"
                                    aria-label={`Remove ${userItem.netid} from write permissions`}
                                  >
                                    &times;
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">No users added.</div>
                          )}
                          <div className="relative">
                            <input
                              type="text"
                              value={writeQuery}
                              onChange={(event) => setWriteQuery(event.target.value)}
                              placeholder="Search users to add..."
                              disabled={!canManagePermissions}
                              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                            />
                            {writeResults.length > 0 && (
                              <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-slate-950/95 shadow-lg">
                                {writeResults.map((item) => (
                                  <button
                                    type="button"
                                    key={item.netid}
                                    onClick={async () => {
                                      if (!canManagePermissions) return;
                                      try {
                                        await patchStrategyPermissions(strategy.id, {
                                          write: { addUsers: [item.netid] },
                                        });
                                        setWriteUsers((prev) => [...prev, item]);
                                        setWriteQuery("");
                                        setWriteResults([]);
                                      } catch (error) {
                                        console.error("Failed to add write user", error);
                                      }
                                    }}
                                    className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-white/5"
                                  >
                                    <span className="font-medium">
                                      {item.full_name || item.netid}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {item.netid}
                                      {item.uconn_email ? ` · ${item.uconn_email}` : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {searchLoading && (
                              <div className="mt-1 text-[11px] text-slate-500">Searching...</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5">
        <article className={`rounded-2xl ${surface} p-6`}>
          <header className="flex items-center justify-between">
            <h3 className="text-base font-semibold">README.md</h3>
            <span className={`text-xs ${mutedColor}`}>Preview</span>
          </header>
          <div className={`mt-4 max-h-96 overflow-y-auto rounded-xl ${previewSurface} p-4`}>
            <div className="space-y-4 text-sm leading-relaxed text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {files.find((file) => file.path.toLowerCase() === "readme.md")?.content}
              </ReactMarkdown>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
