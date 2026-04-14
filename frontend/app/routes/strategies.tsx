import React, { useEffect, useMemo, useState } from "react";
import StrategyTable from "../components/strategy-table";
import { fetchStrategies, type Strategy } from "../api/strategies";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserConext";

export default function Strategies() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [entriesCount, setEntriesCount] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortMode, setSortMode] = useState("created_desc");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

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
    const currentNetid = user?.netid?.toLowerCase() ?? "";
    sorted.sort((a, b) => {
      const aId = Number(a.id);
      const bId = Number(b.id);
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";
      const aOwned = currentNetid && a.owner?.toLowerCase() === currentNetid ? 1 : 0;
      const bOwned = currentNetid && b.owner?.toLowerCase() === currentNetid ? 1 : 0;

      switch (sortMode) {
        case "owned_strategy":
          if (aOwned !== bOwned) return bOwned - aOwned;
          return bCreated - aCreated;
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
  }, [filteredStrategies, sortMode, user?.netid]);

  const handlePageChange = (page: number) => {
    const maxPage = Math.max(1, Math.ceil(sortedStrategies.length / entriesCount));
    const nextPage = Math.min(Math.max(page, 1), maxPage);
    setCurrentPage(nextPage);
  };

  const handleEntriesChange = (newCount: number) => {
    setEntriesCount(newCount);
  };

  return (
    <div className="px-6 pb-20 max-w-full mx-auto space-y-4 pt-4">
      {/* Compact Header Section */}
      <section className="space-y-2 mb-6">
        <div className="flex justify-between items-center">
          <h2 className="font-extrabold font-headline tracking-tight text-on-surface text-4xl">
            Strategies
          </h2>
          {/* Create Strategy Button */}
          <button
            onClick={() => navigate("/create-strategy")}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-semibold text-xs uppercase tracking-wider hover:opacity-90 transition-all duration-200 shadow-lg hover:shadow-primary/30 whitespace-nowrap"
          >
            Create Strategy
          </button>
        </div>
        <p className="text-on-surface-variant text-sm font-medium">
          Browse, search, and manage strategies.
        </p>
      </section>

      {/* Table Section */}
      <section className="grid grid-cols-1 gap-8">
        <StrategyTable
          strategies={sortedStrategies}
          isLoading={isLoading}
          totalCount={sortedStrategies.length}
          currentPage={currentPage}
          entriesPerPage={entriesCount}
          onPageChange={handlePageChange}
          onEntriesPerPageChange={handleEntriesChange}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filterMenuOpen={filterMenuOpen}
          onFilterMenuToggle={setFilterMenuOpen}
          sortMode={sortMode}
          onSortChange={setSortMode}
        />
      </section>
    </div>
  );
}
