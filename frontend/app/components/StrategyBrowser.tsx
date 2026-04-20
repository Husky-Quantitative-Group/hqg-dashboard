import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchStrategies, type Strategy } from "../api/strategies";
import { useUser } from "../context/UserConext";
import StrategyTable from "./strategy-table";

type StrategyBrowserProps = {
  title: string;
  description: string;
  scope: "all" | "mine";
  showCreateButton?: boolean;
};

export default function StrategyBrowser({
  title,
  description,
  scope,
  showCreateButton = true,
}: StrategyBrowserProps) {
  const navigate = useNavigate();
  const { user } = useUser();

  const [entriesCount, setEntriesCount] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortMode, setSortMode] = useState("updated_desc");
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
  }, [searchTerm, entriesCount, sortMode, scope, user?.netid]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const currentNetid = user?.netid?.toLowerCase() ?? "";

  const formatSearchDate = (value?: string) => {
    if (!value) return [];
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return [];
    const isoDate = date.toISOString().slice(0, 10);
    const shortDate = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const longDate = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return [isoDate, shortDate.toLowerCase(), longDate.toLowerCase()];
  };

  const scopedStrategies = useMemo(() => {
    if (scope !== "mine") return strategies;
    if (!currentNetid) return [];
    return strategies.filter((strategy) => strategy.owner?.toLowerCase() === currentNetid);
  }, [currentNetid, scope, strategies]);

  const filteredStrategies = useMemo(() => {
    if (!normalizedSearch) {
      return scopedStrategies;
    }

    return scopedStrategies.filter((strategy) => {
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
  }, [normalizedSearch, scopedStrategies]);

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
  }, [currentNetid, filteredStrategies, sortMode]);

  const handlePageChange = (page: number) => {
    const maxPage = Math.max(1, Math.ceil(sortedStrategies.length / entriesCount));
    const nextPage = Math.min(Math.max(page, 1), maxPage);
    setCurrentPage(nextPage);
  };

  return (
    <div className="mx-auto max-w-full space-y-4 px-6 pb-20 pt-4">
      <section className="mb-6 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface">{title}</h2>
          {showCreateButton ? (
            <button
              onClick={() => navigate("/create-strategy")}
              className="whitespace-nowrap rounded-lg border border-secondary-fixed bg-secondary-fixed px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-on-secondary-fixed  transition-all duration-200 hover:-translate-y-0.5 hover:brightness-120"
            >
              Create Strategy
            </button>
          ) : null}
        </div>
        <p className="text-sm font-medium text-on-surface-variant">{description}</p>
      </section>

      <section className="grid grid-cols-1 gap-8">
        <StrategyTable
          strategies={sortedStrategies}
          isLoading={isLoading}
          totalCount={sortedStrategies.length}
          currentPage={currentPage}
          entriesPerPage={entriesCount}
          onPageChange={handlePageChange}
          onEntriesPerPageChange={setEntriesCount}
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
