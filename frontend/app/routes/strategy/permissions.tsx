import { useEffect, useState } from "react";
import { useStrategyWorkspace } from "./layout";
import {
  fetchStrategyPermissions,
  patchStrategyPermissions,
  searchUsers,
  type UserSearchResult,
} from "../../api/strategies";
import { useUser } from "../../context/UserConext";

export default function StrategyPermissions() {
  const { strategy } = useStrategyWorkspace();
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

  if (!canManagePermissions) {
    return (
      <section className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-6 py-2.5">
          <span className="material-symbols-outlined text-on-surface-variant/60">lock</span>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-on-surface">Permissions</h3>
          </div>
        </div>
        <div className="px-6 py-6 text-xs text-on-surface-variant">
          Only the owner or an admin can manage permissions.
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(148,163,184,.3)] bg-[rgba(10,14,23,0.75)] shadow-[inset_1px_1px_0_0_rgba(148,163,184,0.05)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-[rgba(148,163,184,0.1)] bg-[rgba(28,36,54,0.5)] px-6 py-2.5">
        <span className="material-symbols-outlined text-on-surface-variant/60">lock</span>
        <div>
          <h3 className="text-sm font-bold tracking-tight text-on-surface">Permissions</h3>
          <p className="text-xs text-on-surface-variant">Set read/write permissions for this strategy</p>
        </div>
      </div>
      <div className="px-6 py-6">

        {permissionsError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200 mb-4">
            {permissionsError}
          </div>
        )}

        <div className="grid gap-6 text-base font-medium text-slate-200 md:grid-cols-2">
          {/* Read Permissions */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Read Access</h4>
            <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>Public</span>
              <input
                type="checkbox"
                checked={publicRead}
                disabled={permissionsLoading}
                onChange={async (event) => {
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
                      await patchStrategyPermissions(strategy.id, {
                        read: { public: false },
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
              <span>FUND</span>
              <input
                type="checkbox"
                checked={fundRead}
                disabled={permissionsLoading}
                onChange={async (event) => {
                  const nextValue = event.target.checked;
                  setFundRead(nextValue);
                  try {
                    if (nextValue) {
                      await patchStrategyPermissions(strategy.id, {
                        read: { fund: true },
                      });
                    } else {
                      await patchStrategyPermissions(strategy.id, {
                        read: { fund: false },
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
              <div className="space-y-2 mt-3">
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
                            try {
                              await patchStrategyPermissions(strategy.id, {
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
                    className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  {readResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-slate-950/95 shadow-lg">
                      {readResults.map((item) => (
                        <button
                          type="button"
                          key={item.netid}
                          onClick={async () => {
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

          {/* Write Permissions */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Write Access</h4>
            <label className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>Public</span>
              <input
                type="checkbox"
                checked={publicWrite}
                disabled={permissionsLoading}
                onChange={async (event) => {
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
                      await patchStrategyPermissions(strategy.id, {
                        write: { public: false },
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
              <span>FUND</span>
              <input
                type="checkbox"
                checked={fundWrite}
                disabled={permissionsLoading}
                onChange={async (event) => {
                  const nextValue = event.target.checked;
                  setFundWrite(nextValue);
                  try {
                    if (nextValue) {
                      await patchStrategyPermissions(strategy.id, {
                        write: { fund: true },
                      });
                    } else {
                      await patchStrategyPermissions(strategy.id, {
                        write: { fund: false },
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
              <div className="space-y-2 mt-3">
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
                            try {
                              await patchStrategyPermissions(strategy.id, {
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
                    className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  {writeResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-slate-950/95 shadow-lg">
                      {writeResults.map((item) => (
                        <button
                          type="button"
                          key={item.netid}
                          onClick={async () => {
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
    </section>
  );
}
