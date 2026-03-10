import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Strategy, UserSearchResult } from "../api/strategies";
import {
  deleteStrategyPermissions,
  fetchStrategyPermissions,
  patchStrategyPermissions,
} from "../api/strategies";
import { useUser } from "../context/UserConext";

type StrategyTableProps = {
  strategies: Strategy[];
  isLoading?: boolean;
};

export default function StrategyTable({
  strategies,
  isLoading = false,
}: StrategyTableProps) {
  const { user } = useUser();
  const [activeStrategy, setActiveStrategy] = useState<Strategy | null>(null);
  const [publicRead, setPublicRead] = useState(false);
  const [publicWrite, setPublicWrite] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [readUsers, setReadUsers] = useState<UserSearchResult[]>([]);
  const [writeUsers, setWriteUsers] = useState<UserSearchResult[]>([]);
  const [readUserInput, setReadUserInput] = useState("");
  const [writeUserInput, setWriteUserInput] = useState("");

  useEffect(() => {
    if (!activeStrategy) return;
    let isActive = true;
    setPermissionsLoading(true);
    setPermissionsError(null);
    setReadUsers([]);
    setWriteUsers([]);
    setReadUserInput("");
    setWriteUserInput("");
    fetchStrategyPermissions(activeStrategy.id)
      .then((data) => {
        if (!isActive) return;
        setPublicRead(data.read.public);
        setPublicWrite(data.write.public);
        setReadUsers(data.read.users ?? []);
        setWriteUsers(data.write.users ?? []);
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("Failed to load permissions", error);
        setPermissionsError("Failed to load permissions.");
        setPublicRead(false);
        setPublicWrite(false);
      })
      .finally(() => {
        if (!isActive) return;
        setPermissionsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [activeStrategy]);

  const addReadUser = async () => {
    if (!activeStrategy) return;
    const value = readUserInput.trim();
    if (!value || readUsers.some((user) => user.netid === value)) return;
    try {
      await patchStrategyPermissions(activeStrategy.id, {
        read: { addUsers: [value] },
      });
      setReadUsers((prev) => [...prev, { netid: value }]);
      setReadUserInput("");
    } catch (error) {
      console.error("Failed to add read permission", error);
    }
  };

  const addWriteUser = async () => {
    if (!activeStrategy) return;
    const value = writeUserInput.trim();
    if (!value || writeUsers.some((user) => user.netid === value)) return;
    try {
      await patchStrategyPermissions(activeStrategy.id, {
        write: { addUsers: [value] },
      });
      setWriteUsers((prev) => [...prev, { netid: value }]);
      setWriteUserInput("");
    } catch (error) {
      console.error("Failed to add write permission", error);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatNumber = (value: number | undefined, fractionDigits = 2) => {
    if (value === undefined || value === null) return "—";
    return value.toFixed(fractionDigits);
  };

  const formatPercent = (value: number | undefined) => {
    if (value === undefined || value === null) return "—";
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full rounded-xl overflow-hidden bg-slate-900">
        <thead className="sticky top-0 bg-slate-900 z-10">
          <tr className="border-b border-slate-600">
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">ID</th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Name
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Project
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Owner
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Created
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Last Updated
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
              Tags
            </th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">Sharpe</th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">Sortino</th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">Max DD</th>
            <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">CAGR</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={11} className="py-6 px-4 text-center text-gray-400 text-sm">
                Loading strategies...
              </td>
            </tr>
          ) : strategies.length === 0 ? (
            <tr>
              <td colSpan={11} className="py-6 px-4 text-center text-gray-400 text-sm">
                No strategies found.
              </td>
            </tr>
          ) : (
            strategies.map((strategy, index) => {
              const ownerLabel = strategy.owner_display ?? strategy.owner ?? "—";
              const isOwned =
                Boolean(user?.netid) &&
                Boolean(strategy.owner) &&
                strategy.owner!.toLowerCase() === user!.netid.toLowerCase();
              return (
                <tr
                  key={strategy.id}
                  className={`border-b border-slate-800 hover:bg-slate-600/50 transition-colors ${
                    index % 2 === 0 ? "bg-slate-950/80" : "bg-slate-900/80"
                  }`}
                >
                <td className="py-4 px-4 text-gray-300 font-mono text-xs">
                  STR-{strategy.id}
                </td>
                <td className="py-4 px-4 align-middle">
                  <div className="flex h-full items-center justify-center gap-2 text-center">
                    <Link to={`/strategies/${strategy.id}`} className="text-white font-medium hover:underline">
                      {strategy.name}
                    </Link>
                    {isOwned && (
                      <button
                        type="button"
                        onClick={() => setActiveStrategy(strategy)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-slate-700/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Manage permissions for ${strategy.name}`}
                      >
                        <img
                          src="/permissions-icon.png"
                          alt=""
                          className="h-4 w-4 opacity-90"
                        />
                      </button>
                    )}
                  </div>
                </td>
                <td className="py-4 px-4">
                  <div className="text-gray-300">{strategy.project_id}</div>
                </td>
                <td className="py-4 px-4">
                  <div className="text-white font-medium">
                    {ownerLabel}
                  </div>
                </td>
                <td className="py-4 px-4">
                  <div className="text-gray-300">{formatDate(strategy.created_at)}</div>
                </td>
                <td className="py-4 px-4">
                  <div className="text-gray-300">{formatDateTime(strategy.updated_at)}</div>
                </td>
                <td className="py-4 px-4">
                  <div className="flex flex-wrap gap-1">
                    {(strategy.tags ?? []).map((tag, tagIndex) => (
                      <span
                        key={tagIndex}
                        className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-900/50 text-blue-300 rounded border border-blue-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatNumber(strategy.metrics?.sharpe_ratio)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatNumber(strategy.metrics?.sortino)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatPercent(strategy.metrics?.max_drawdown)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatPercent(strategy.metrics?.annualized_return)}
                </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {activeStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setActiveStrategy(null)}
            aria-label="Close permissions modal"
          />
          <div className="relative w-[50vw] max-w-[90vw] rounded-2xl border border-slate-700/70 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Permissions</h3>
                <p className="text-sm text-slate-400">
                  Manage access for {activeStrategy.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveStrategy(null)}
                className="rounded-full p-1 text-slate-300 transition hover:bg-slate-700/60 hover:text-white"
                aria-label="Close"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm text-slate-300">
              {permissionsError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                  {permissionsError}
                </div>
              )}
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Read permissions</div>
                    <div className="text-xs text-slate-400">Who can view this strategy</div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={publicRead}
                      disabled={permissionsLoading}
                      onChange={async (event) => {
                        if (!activeStrategy) return;
                        const nextValue = event.target.checked;
                        setPublicRead(nextValue);
                        try {
                          if (nextValue) {
                            await patchStrategyPermissions(activeStrategy.id, {
                              read: { public: true },
                            });
                          } else {
                            await deleteStrategyPermissions(activeStrategy.id, {
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
                    Public
                  </label>
                </div>

                {publicRead ? (
                  <div className="mt-3 text-xs text-slate-400">Readable by anyone.</div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {readUsers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {readUsers.map((userItem) => (
                          <span
                            key={userItem.netid}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                          >
                            {userItem.full_name || userItem.netid}
                            <button
                              type="button"
                              onClick={async () => {
                                if (!activeStrategy) return;
                                try {
                                  await deleteStrategyPermissions(activeStrategy.id, {
                                    read: { removeUsers: [userItem.netid] },
                                  });
                                  setReadUsers((prev) =>
                                    prev.filter((entry) => entry.netid !== userItem.netid)
                                  );
                                } catch (error) {
                                  console.error("Failed to remove read permission", error);
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
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Add user (netid or email)"
                        value={readUserInput}
                        onChange={(event) => setReadUserInput(event.target.value)}
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={addReadUser}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-lg text-slate-100 transition hover:bg-slate-700"
                        aria-label="Add read permission"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-700/70 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Write permissions</div>
                    <div className="text-xs text-slate-400">Who can modify this strategy</div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={publicWrite}
                      disabled={permissionsLoading}
                      onChange={async (event) => {
                        if (!activeStrategy) return;
                        const nextValue = event.target.checked;
                        setPublicWrite(nextValue);
                        try {
                          if (nextValue) {
                            await patchStrategyPermissions(activeStrategy.id, {
                              write: { public: true },
                            });
                          } else {
                            await deleteStrategyPermissions(activeStrategy.id, {
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
                    Public
                  </label>
                </div>

                {publicWrite ? (
                  <div className="mt-3 text-xs text-slate-400">Writable by anyone.</div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {writeUsers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {writeUsers.map((userItem) => (
                          <span
                            key={userItem.netid}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                          >
                            {userItem.full_name || userItem.netid}
                            <button
                              type="button"
                              onClick={async () => {
                                if (!activeStrategy) return;
                                try {
                                  await deleteStrategyPermissions(activeStrategy.id, {
                                    write: { removeUsers: [userItem.netid] },
                                  });
                                  setWriteUsers((prev) =>
                                    prev.filter((entry) => entry.netid !== userItem.netid)
                                  );
                                } catch (error) {
                                  console.error("Failed to remove write permission", error);
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
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Add user (netid or email)"
                        value={writeUserInput}
                        onChange={(event) => setWriteUserInput(event.target.value)}
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={addWriteUser}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-lg text-slate-100 transition hover:bg-slate-700"
                        aria-label="Add write permission"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveStrategy(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
