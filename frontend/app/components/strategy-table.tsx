import { Link } from "react-router-dom";
import type { Strategy } from "../api/strategies";

type StrategyTableProps = {
  strategies: Strategy[];
  isLoading?: boolean;
  totalCount?: number;
  currentPage?: number;
  entriesPerPage?: number;
  onPageChange?: (page: number) => void;
  onEntriesPerPageChange?: (count: number) => void;
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  filterMenuOpen?: boolean;
  onFilterMenuToggle?: (open: boolean) => void;
  sortMode?: string;
  onSortChange?: (mode: string) => void;
};

export default function StrategyTable({
  strategies,
  isLoading = false,
  totalCount = 0,
  currentPage = 1,
  entriesPerPage = 10,
  onPageChange,
  onEntriesPerPageChange,
  searchTerm = "",
  onSearchChange,
  filterMenuOpen = false,
  onFilterMenuToggle,
  sortMode = "created_desc",
  onSortChange,
}: StrategyTableProps) {
  // Pagination calculations
  const totalPages = Math.ceil(totalCount / entriesPerPage);
  const startIdx = (currentPage - 1) * entriesPerPage;
  const endIdx = Math.min(startIdx + entriesPerPage, totalCount);
  const paginatedStrategies = strategies.slice(startIdx, endIdx);

  const handlePrevPage = () => {
    if (currentPage > 1 && onPageChange) onPageChange(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages && onPageChange) onPageChange(currentPage + 1);
  };

  const handleEntriesPerPageChange = (value: number) => {
    if (onEntriesPerPageChange) {
      onEntriesPerPageChange(value);
    }
  };
  // Color palettes for avatars and tags
  const avatarColors = [
    "from-blue-500 to-blue-600",
    "from-purple-500 to-purple-600",
    "from-pink-500 to-pink-600",
    "from-red-500 to-red-600",
    "from-yellow-500 to-yellow-600",
    "from-green-500 to-green-600",
    "from-teal-500 to-teal-600",
    "from-cyan-500 to-cyan-600",
    "from-indigo-500 to-indigo-600",
  ];

  const tagColors = [
    { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
    { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
    { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/20" },
    { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
    { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
    { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20" },
    { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20" },
    { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
  ];

  // Hash function to consistently map strings to color indices
  const getColorIndex = (str: string, colorCount: number): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % colorCount;
  };

  const getAvatarColor = (ownerName: string): string => {
    const index = getColorIndex(ownerName, avatarColors.length);
    return avatarColors[index];
  };

  const getAvatarText = (name: string): string => {
    // Show first and third letter, or first and second if name is only 2 chars
    if (name.length === 0) return "";
    if (name.length === 1) return name.charAt(0).toUpperCase();
    if (name.length === 2) return (name.charAt(0) + name.charAt(1)).toUpperCase();
    return (name.charAt(0) + name.charAt(2)).toUpperCase();
  };

  const getTagColor = (tagName: string): { bg: string; text: string; border: string } => {
    const index = getColorIndex(tagName, tagColors.length);
    return tagColors[index];
  };

  const formatDate = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const formatNumber = (value: number | undefined, fractionDigits = 2) => {
    if (value === undefined || value === null) return "—";
    return value.toFixed(fractionDigits);
  };

  const formatPercent = (value: number | undefined) => {
    if (value === undefined || value === null) return "—";
    const percent = (value * 100).toFixed(1);
    if (value < 0) return `${percent}%`;
    return `+${percent}%`;
  };

  const truncateName = (name: string, maxLength: number = 50): string => {
    if (name.length > maxLength) {
      return name.substring(0, maxLength) + "...";
    }
    return name;
  };

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container/50 overflow-hidden shadow-xl">
      {/* Header Section */}
      <div className="flex justify-between items-center bg-[#181818]/60 border-b border-white/5 pr-3 pl-5 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-on-surface tracking-widest uppercase">
            Strategy List
          </h3>
          <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary-fixed-dim text-[10px] font-bold border border-secondary/20">
            Showing {totalCount === 0 ? 0 : startIdx + 1}-{endIdx} of {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-container-highest/50 border border-outline-variant/30 rounded-lg px-3 py-1">
            <svg
              className="text-on-surface-variant text-lg mr-2 w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              className="bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-xs text-on-surface placeholder-on-surface-variant/90 w-48 py-1"
              placeholder="Search strategies..."
              value={searchTerm}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          </div>

          {/* Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => onFilterMenuToggle?.(!filterMenuOpen)}
              className="px-3 py-2 rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest transition-colors flex items-center gap-2 text-xs"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="uppercase tracking-wider font-semibold">Filter</span>
            </button>

            {filterMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-outline-variant/30 bg-surface-container-highest/95 shadow-xl z-40 backdrop-blur-sm">
                <div className="p-3 space-y-2">
                  {[
                    { value: "owned_strategy", label: "Owned Strategy" },
                    { value: "created_desc", label: "Created (newest)" },
                    { value: "created_asc", label: "Created (oldest)" },
                    { value: "updated_desc", label: "Updated (newest)" },
                    { value: "updated_asc", label: "Updated (oldest)" },
                    { value: "name_asc", label: "Name (A → Z)" },
                    { value: "name_desc", label: "Name (Z → A)" },
                    { value: "id_asc", label: "ID (ascending)" },
                    { value: "id_desc", label: "ID (descending)" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        onSortChange?.(option.value);
                        onFilterMenuToggle?.(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        sortMode === option.value
                          ? "bg-secondary/20 text-secondary-fixed-dim"
                          : "text-on-surface-variant hover:bg-white/5"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse table-fixed">
          <thead>
            <tr className="border-b border-white/5 bg-[#0d0d0d]/40">
              <th className="pl-6 pr-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest" style={{ width: "28%" }}>
                Name
              </th>
              <th className="px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest" style={{ width: "12%" }}>
                Owner
              </th>
              <th className="px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest" style={{ width: "15%" }}>
                Created / Updated
              </th>
              <th className="py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest" style={{ width: "10%" }}>
                Tags
              </th>
              <th className="px-1 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-center" style={{ width: "8%" }}>
                Sharpe
              </th>
              <th className="px-1 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-center" style={{ width: "8%" }}>
                Sortino
              </th>
              <th className="px-1 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-center" style={{ width: "8%" }}>
                Max DD
              </th>
              <th className="pl-1 pr-2 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-center" style={{ width: "8%" }}>
                CAGR
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-3 px-4 text-center text-on-surface-variant text-sm">
                  Loading strategies...
                </td>
              </tr>
            ) : paginatedStrategies.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-3 px-4 text-center text-on-surface-variant text-sm">
                  No strategies found.
                </td>
              </tr>
            ) : (
              paginatedStrategies.map((strategy, index) => {
                const ownerLabel = strategy.owner_display ?? strategy.owner ?? "—";
                return (
                  <tr
                    key={strategy.id}
                    className={`hover:bg-white/[0.13] transition-colors group ${
                      index % 2 === 0 ? "bg-white/[0.03]" : "bg-white/[0]"
                    }`}
                  >
                    <td className="pl-6 pr-3 py-3" style={{ width: "28%" }}>
                      <div className="flex flex-col gap-0.5">
                        <Link
                          to={`/strategies/${strategy.id}`}
                          className="text-sm font-semibold text-on-surface hover:text-secondary transition-colors truncate"
                          title={strategy.name}
                        >
                          {truncateName(strategy.name)}
                        </Link>
                        <span className="text-[10px] text-on-surface-variant font-mono">
                          v{((strategy.current_version ?? 0) as number).toFixed(1)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3" style={{ width: "12%" }}>
                      <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded-full overflow-hidden border border-white/10 bg-gradient-to-br ${getAvatarColor(ownerLabel)} flex items-center justify-center text-[0.5rem] font-bold text-white`}>
                          {getAvatarText(ownerLabel)}
                        </div>
                        <span className="text-xs text-on-surface">{ownerLabel}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3" style={{ width: "15%" }}>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-on-surface uppercase tracking-tight">
                          {formatDate(strategy.created_at)}
                        </span>
                        <span className="text-xs font-bold text-secondary uppercase tracking-tight">
                          {formatDate(strategy.updated_at)}
                        </span>
                      </div>
                    </td>
                    <td className="px-1 py-3" style={{ width: "10%" }}>
                      <div className="flex gap-1.5 flex-wrap">
                        {(() => {
                          const tags = strategy.tags ?? [];
                          return (
                            <>
                              {tags.slice(0, 2).map((tag, idx) => {
                                const tagColor = getTagColor(tag);
                                return (
                                  <span
                                    key={idx}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${tagColor.bg} ${tagColor.text} border ${tagColor.border} uppercase flex-shrink-0`}
                                  >
                                    {tag}
                                  </span>
                                );
                              })}
                              {tags.length > 2 && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20 uppercase flex-shrink-0">
                                  +{tags.length - 2}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-1 py-3 text-center font-mono text-xs text-on-surface" style={{ width: "8%" }}>
                      {formatNumber(strategy.metrics?.sharpe_ratio, 2)}
                    </td>
                    <td className="px-1 py-3 text-center font-mono text-xs text-on-surface" style={{ width: "8%" }}>
                      {formatNumber(strategy.metrics?.sortino, 2)}
                    </td>
                    <td className="px-1 py-3 text-center font-mono text-xs" style={{ width: "8%" }}>
                      <span className={strategy.metrics?.max_drawdown !== undefined && strategy.metrics?.max_drawdown !== null ? "text-error-dim" : "text-on-surface"}>
                        {formatPercent(strategy.metrics?.max_drawdown)}
                      </span>
                    </td>
                    <td className="pl-1 pr-2 py-3 text-center font-mono text-xs" style={{ width: "8%" }}>
                      <span className={strategy.metrics?.annualized_return !== undefined ? "text-emerald-400 font-bold" : "text-on-surface"}>
                        {formatPercent(strategy.metrics?.annualized_return)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Section */}
      <div className="px-6 py-3 border-t border-white/5 flex justify-between items-center bg-[#0a0a0a]/20 gap-4">
        {/* Left: Entries per page selector */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-widest font-bold">
            Show
          </span>
          <select
            value={entriesPerPage}
            onChange={(e) => handleEntriesPerPageChange(Number(e.target.value))}
            className="px-2 py-1 bg-surface-container-highest/50 border border-outline-variant/30 rounded text-[10px] text-on-surface cursor-pointer hover:bg-surface-container-highest transition-colors"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-widest font-bold">
            entries
          </span>
        </div>

        {/* Right: Pagination info and controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="px-2 py-1 rounded border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-bold uppercase"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-on-surface-variant/70 font-bold whitespace-nowrap">
              Page {currentPage} of {Math.max(1, totalPages)}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages}
              className="px-2 py-1 rounded border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[10px] font-bold uppercase"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
