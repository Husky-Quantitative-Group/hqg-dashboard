import React, { useState } from "react";

export default function DarkStripedStrategiesTable() {
  const [entriesCount, setEntriesCount] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Sample data for strategies
  const strategies = [
    {
      id: 1,
      name: "Momentum Alpha Strategy",
      user: "John Martinez",
      status: "Active",
      date: "15 Mar, 2024",
      sharpe: "2.34",
      sortino: "3.12",
      psr: "0.89",
      tags: ["Momentum", "Equity"],
    },
    {
      id: 2,
      name: "Mean Reversion Bot",
      user: "Sarah Chen",
      status: "Paused",
      date: "12 Mar, 2024",
      sharpe: "1.78",
      sortino: "2.45",
      psr: "0.76",
      tags: ["Mean Reversion", "Bonds"],
    },
    {
      id: 3,
      name: "Pairs Trading Algorithm",
      user: "Mike Thompson",
      status: "Active",
      date: "08 Mar, 2024",
      sharpe: "3.21",
      sortino: "4.05",
      psr: "0.94",
      tags: ["Pairs Trading", "Market Neutral"],
    },
    {
      id: 4,
      name: "Volatility Harvester",
      user: "Emma Rodriguez",
      status: "Draft",
      date: "05 Mar, 2024",
      sharpe: "2.67",
      sortino: "3.33",
      psr: "0.87",
      tags: ["Volatility", "Options"],
    },
    {
      id: 5,
      name: "Trend Following System",
      user: "David Wilson",
      status: "Active",
      date: "28 Feb, 2024",
      sharpe: "1.95",
      sortino: "2.78",
      psr: "0.81",
      tags: ["Trend Following"],
    },
    {
      id: 6,
      name: "Statistical Arbitrage",
      user: "Lisa Anderson",
      status: "Active",
      date: "25 Feb, 2024",
      sharpe: "2.89",
      sortino: "3.67",
      psr: "0.92",
      tags: ["Arbitrage", "Statistical"],
    },
    {
      id: 7,
      name: "Crypto Momentum Bot",
      user: "Alex Garcia",
      status: "Paused",
      date: "20 Feb, 2024",
      sharpe: "1.45",
      sortino: "2.01",
      psr: "0.73",
      tags: ["Crypto", "Momentum"],
    },
    {
      id: 8,
      name: "Options Strategy Alpha",
      user: "Jennifer Davis",
      status: "Active",
      date: "18 Feb, 2024",
      sharpe: "2.12",
      sortino: "2.89",
      psr: "0.85",
      tags: ["Options", "Alpha"],
    },
    {
      id: 9,
      name: "Momentum Alpha Strategy",
      user: "John Martinez",
      status: "Archived",
      date: "15 Mar, 2024",
      sharpe: "2.34",
      sortino: "3.12",
      psr: "0.89",
      tags: ["Momentum", "Equity"],
    },
    {
      id: 10,
      name: "Momentum Alpha Strategy",
      user: "John Martinez",
      status: "Paper Live",
      date: "15 Mar, 2024",
      sharpe: "2.34",
      sortino: "3.12",
      psr: "0.89",
      tags: ["Momentum", "Equity"],
    },
    {
      id: 11,
      name: "Momentum Alpha Strategy",
      user: "John Martinez",
      status: "Active",
      date: "15 Mar, 2024",
      sharpe: "2.34",
      sortino: "3.12",
      psr: "0.89",
      tags: ["Momentum", "Equity"],
    },
  ];

  // Map status to bubble style and label
  const getStatusBubble = (status: string) => {
    switch (status) {
      case "Live":
      case "Active":
        return {
          label: "Live",
          bg: "bg-green-100",
          text: "text-green-700",
          dot: "bg-green-600",
        };
      case "Offline":
      case "Paused":
        return {
          label: "Offline",
          bg: "bg-gray-200",
          text: "text-gray-600",
          dot: "bg-gray-500",
        };
      case "Archived":
        return {
          label: "Archived",
          bg: "bg-yellow-100",
          text: "text-yellow-700",
          dot: "bg-yellow-500",
        };
      case "Paper Live":
        return {
          label: "Paper Live",
          bg: "bg-blue-100",
          text: "text-blue-700",
          dot: "bg-blue-500",
        };
      case "Template":
      case "Draft":
        return {
          label: "Template",
          bg: "bg-purple-100",
          text: "text-purple-700",
          dot: "bg-purple-500",
        };
      default:
        return {
          label: status,
          bg: "bg-gray-200",
          text: "text-gray-600",
          dot: "bg-gray-500",
        };
    }
  };

  // Filter strategies based on search term
  const filteredStrategies = strategies.filter(
    (strategy) =>
      strategy.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      strategy.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
      strategy.tags.some((tag) =>
        tag.toLowerCase().includes(searchTerm.toLowerCase())
      )
  );

  // Calculate pagination
  const totalPages = Math.ceil(filteredStrategies.length / entriesCount);
  const startIndex = (currentPage - 1) * entriesCount;
  const paginatedStrategies = filteredStrategies.slice(
    startIndex,
    startIndex + entriesCount
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleEntriesChange = (newCount: string) => {
    setEntriesCount(parseInt(newCount));
    setCurrentPage(1); // Reset to first page when changing entries count
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
                  User
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
                  Status
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
                  Date
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
                  Sharpe
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
                  Sortino
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
                  PSR
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
              {paginatedStrategies.map((strategy, index) => (
                <tr
                  key={strategy.id}
                  className={`border-b border-slate-800 hover:bg-slate-600/50 transition-colors ${
                    index % 2 === 0 ? "bg-slate-950/80" : "bg-slate-900/80"
                  }`}
                >
                  <td className="py-4 px-4">
                    <div className="text-white font-medium">
                      {strategy.name}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-gray-300">{strategy.user}</div>
                  </td>
                  <td className="py-4 px-4">
                    {(() => {
                      const bubble = getStatusBubble(strategy.status);
                      return (
                        <span
                          className={`inline-flex items-center px-4 py-1 rounded-full font-medium text-sm ${bubble.bg} ${bubble.text}`}
                          style={{ minWidth: 70, justifyContent: "center" }}
                        >
                          <span
                            className={`w-3 h-3 rounded-full mr-2 ${bubble.dot}`}
                          ></span>
                          {bubble.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-gray-300">{strategy.date}</div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-white font-medium">
                      {strategy.sharpe}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-white font-medium">
                      {strategy.sortino}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="text-white font-medium">{strategy.psr}</div>
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
              ))}
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
              disabled={currentPage === 1}
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
              disabled={currentPage === totalPages}
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
