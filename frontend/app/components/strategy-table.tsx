import React, { useEffect, useMemo, useState } from "react";
import { fetchStrategies, type Strategy } from "../api";

export default function DarkStripedStrategiesTable() {
  const [entriesCount, setEntriesCount] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
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
  }, [searchTerm, entriesCount]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredStrategies = useMemo(() => {
    if (!normalizedSearch) {
      return strategies;
    }

    return strategies.filter((strategy) => {
      const owner = strategy.owner?.toLowerCase() ?? "";
      return (
        strategy.name.toLowerCase().includes(normalizedSearch) ||
        strategy.project.toLowerCase().includes(normalizedSearch) ||
        strategy.repository.toLowerCase().includes(normalizedSearch) ||
        strategy.branch.toLowerCase().includes(normalizedSearch) ||
        owner.includes(normalizedSearch) ||
        strategy.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch))
      );
    });
  }, [normalizedSearch, strategies]);

  const totalPages = Math.max(1, Math.ceil(filteredStrategies.length / entriesCount));
  const startIndex = (currentPage - 1) * entriesCount;
  const paginatedStrategies = filteredStrategies.slice(
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
        {/* Section Header */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-4xl font-bold text-white tracking-tight">
              Strategies
            </h2>
            <button className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900">
              Publish Strategy
            </button>
          </div>

          <p className="text-gray-400 text-sm mt-1">
            Browse, search, and manage your trading strategies below.
          </p>
        </div>
        {/* Header Controls */}
        <div className="flex justify-end items-center mb-6 flex-shrink-0">
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
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full rounded-xl overflow-hidden bg-slate-900">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="border-b border-slate-600">
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Name
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Project
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Repository
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Branch
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Owner
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Updated
                  <svg
                    className="inline ml-1 w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </th>
                <th className="text-left py-4 px-4 text-gray-400 font-medium text-sm">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 px-4 text-center text-gray-400 text-sm"
                  >
                    Loading strategies...
                  </td>
                </tr>
              ) : paginatedStrategies.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 px-4 text-center text-gray-400 text-sm"
                  >
                    No strategies found.
                  </td>
                </tr>
              ) : (
                paginatedStrategies.map((strategy, index) => (
                  <tr
                    key={strategy.strategyId}
                    className={`border-b border-slate-800 hover:bg-slate-600/50 transition-colors ${
                      index % 2 === 0 ? "bg-slate-950/80" : "bg-slate-900/80"
                    }`}
                  >
                    <td className="py-4 px-4 align-middle">
                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <a
                          href={strategy.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-white font-medium hover:underline"
                        >
                          {strategy.name}
                        </a>
                        <div className="mt-2 flex w-full justify-start">
                          <a
                            href={strategy.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center text-gray-400 hover:text-white"
                            aria-label={`Open ${strategy.name} on GitHub`}
                            title="View on GitHub"
                          >
                            <svg
                              className="w-5 h-5"
                              role="img"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                            >
                              <path
                                fill="currentColor"
                                d="M12 .297a12 12 0 00-3.797 23.406c.6.111.82-.261.82-.58v-2.234c-3.338.726-4.042-1.416-4.042-1.416-.546-1.387-1.332-1.758-1.332-1.758-1.089-.745.082-.73.082-.73 1.205.085 1.84 1.238 1.84 1.238 1.07 1.834 2.809 1.304 3.495.997.108-.775.42-1.305.763-1.605-2.665-.304-5.466-1.333-5.466-5.932 0-1.31.468-2.381 1.236-3.221-.124-.303-.536-1.523.118-3.176 0 0 1.008-.322 3.3 1.23a11.458 11.458 0 013.003-.403c1.02.005 2.047.138 3.003.403 2.291-1.552 3.297-1.23 3.297-1.23.656 1.653.244 2.873.12 3.176.77.84 1.235 1.91 1.235 3.22 0 4.61-2.804 5.625-5.476 5.922.43.372.823 1.103.823 2.222v3.293c0 .322.218.697.825.579A12 12 0 0012 .297"
                              />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-gray-300">{strategy.project}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-gray-300">{strategy.repository}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-gray-300">{strategy.branch}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-white font-medium">
                        {strategy.owner ?? "—"}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-gray-300">
                        {new Date(strategy.updatedAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap gap-1">
                        {strategy.tags.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-900/50 text-blue-300 rounded border border-blue-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Controls */}
        <div className="flex justify-between items-center mt-6 flex-shrink-0">
          {/* Show entries */}
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

          {/* Pagination */}
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
