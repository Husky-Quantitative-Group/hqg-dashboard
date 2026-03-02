import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Strategy } from "../api/strategies";

type StrategyTableProps = {
  strategies: Strategy[];
  isLoading?: boolean;
};

export default function StrategyTable({
  strategies,
  isLoading = false,
}: StrategyTableProps) {
  const sortedStrategies = useMemo(
    () =>
      [...strategies].sort((a, b) => {
        const aId = Number(a.id);
        const bId = Number(b.id);
        if (Number.isNaN(aId) || Number.isNaN(bId)) {
          return String(a.id).localeCompare(String(b.id));
        }
        return aId - bId;
      }),
    [strategies]
  );

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
            sortedStrategies.map((strategy, index) => {
              const ownerLabel = strategy.owner_display ?? strategy.owner ?? "—";
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
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <Link to={`/strategies/${strategy.id}`} className="text-white font-medium hover:underline">
                      {strategy.name}
                    </Link>
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
                  {formatNumber(strategy.metrics?.sharpe)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatNumber(strategy.metrics?.sortino)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatPercent(strategy.metrics?.max_drawdown)}
                </td>
                <td className="py-4 px-4 text-gray-200 font-mono text-sm">
                  {formatPercent(strategy.metrics?.cagr)}
                </td>
              </tr>
            )})
          )}
        </tbody>
      </table>
    </div>
  );
}
