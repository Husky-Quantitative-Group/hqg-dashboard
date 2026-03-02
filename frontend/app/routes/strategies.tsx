import React, { useEffect, useMemo, useState } from "react";
import StrategyTable from "../components/strategy-table";
import { fetchStrategies, type Strategy } from "../api/strategies";
import { useNavigate } from "react-router-dom";

export default function Strategies() {
  const navigate = useNavigate();

  const [entriesCount, setEntriesCount] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortMode, setSortMode] = useState("created_desc");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadStrategies = async () => {
      setIsLoading(true);
      try {
        const data = await fetchStrategies();
        setStrategies(data);
      } catch (error) {
        console.error("Failed to load strategies", error);
      } finally {
        setIsLoading(false);
      }
    };

    void loadStrategies();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, entriesCount, sortMode]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const formatSearchDate = (value?: string) => {
    if (!value) return [];
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return [];
    const isoDate = date.toISOString().slice(0, 10);
    const shortDate = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const longDate = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return [isoDate, shortDate.toLowerCase(), longDate.toLowerCase()];
  };

  const filteredStrategies = useMemo(() => {
    if (!normalizedSearch) {
      return strategies;
    }

    return strategies.filter((strategy) => {
      const owner = (strategy.owner_display ?? strategy.owner ?? "").toLowerCase();
      const project = strategy.project_id?.toLowerCase() ?? "";
      const tags = strategy.tags ?? [];
      const createdTokens = formatSearchDate(strategy.created_at);
      return (
        strategy.name.toLowerCase().includes(normalizedSearch) ||
        owner.includes(normalizedSearch) ||
        tags.some((tag) => tag.toLowerCase().includes(normalizedSearch)) ||
        createdTokens.some((token) => token.includes(normalizedSearch))
      );
    });
  }, [normalizedSearch, strategies]);

  const sortedStrategies = useMemo(() => {
    const sorted = [...filteredStrategies];
    sorted.sort((a, b) => {
      const aId = Number(a.id);
      const bId = Number(b.id);
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";

      switch (sortMode) {
        case "created_asc":
          return aCreated - bCreated;
        case "updated_desc":
          return bUpdated - aUpdated;
        case "updated_asc":
          return aUpdated - bUpdated;
        case "name_asc":
          return aName.localeCompare(bName);
        case "name_desc":
          return bName.localeCompare(aName);
        case "id_desc":
          if (Number.isNaN(aId) || Number.isNaN(bId)) {
            return String(b.id).localeCompare(String(a.id));
          }
          return bId - aId;
        case "id_asc":
          if (Number.isNaN(aId) || Number.isNaN(bId)) {
            return String(a.id).localeCompare(String(b.id));
          }
          return aId - bId;
        case "created_desc":
        default:
          return bCreated - aCreated;
      }
    });
    return sorted;
  }, [filteredStrategies, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedStrategies.length / entriesCount));
  const startIndex = (currentPage - 1) * entriesCount;
  const paginatedStrategies = sortedStrategies.slice(
    startIndex,
    startIndex + entriesCount
  );

  const handlePageChange = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    setCurrentPage(nextPage);
  };

  const handleEntriesChange = (newCount: string) => {
    const parsed = parseInt(newCount, 10);
    setEntriesCount(Number.isNaN(parsed) ? 10 : parsed);
  };

  return (
    <div className="ml-10 mr-5 my-5 shadow-lg z-50">
      <div className="w-full h-full rounded-lg flex flex-col">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-4xl font-bold text-white tracking-tight">
              Strategies
            </h2>
            <button 
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900"
              onClick={() => navigate("/create-strategy")}
            >
              Create Strategy
            </button>
          </div>

          <p className="text-gray-400 text-sm mt-1">
            Browse, search, and manage your trading strategies below.
          </p>
        </div>

        <div className="flex justify-end items-center mb-6 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4"
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
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-700 text-white placeholder-gray-400 rounded-lg py-2 pl-10 pr-4 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-slate-600 transition-colors"
              />
            </div>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              className="bg-slate-700 text-white border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="created_desc">Created (newest)</option>
              <option value="created_asc">Created (oldest)</option>
              <option value="updated_desc">Updated (newest)</option>
              <option value="updated_asc">Updated (oldest)</option>
              <option value="name_asc">Name (A → Z)</option>
              <option value="name_desc">Name (Z → A)</option>
              <option value="id_asc">ID (ascending)</option>
              <option value="id_desc">ID (descending)</option>
            </select>
          </div>
        </div>

        <StrategyTable strategies={paginatedStrategies} isLoading={isLoading} />

        <div className="flex justify-between items-center mt-6 flex-shrink-0">
          <div className="flex items-center gap-2 text-gray-400">
            <span>Show</span>
            <select
              value={entriesCount}
              onChange={(e) => handleEntriesChange(e.target.value)}
              className="bg-slate-700 text-white border border-slate-600 rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>entries</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`px-3 py-1 rounded transition-colors ${
                  currentPage === page
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-gray-300 hover:bg-slate-600"
                }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 rounded bg-slate-700 text-gray-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
