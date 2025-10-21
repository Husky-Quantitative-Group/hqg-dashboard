import React from "react";
import type { Strategy } from "../api";

type StrategyTableProps = {
  strategies: Strategy[];
  isLoading?: boolean;
};

export default function StrategyTable({
  strategies,
  isLoading = false,
}: StrategyTableProps) {
  return (
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
          ) : strategies.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="py-6 px-4 text-center text-gray-400 text-sm"
              >
                No strategies found.
              </td>
            </tr>
          ) : (
            strategies.map((strategy, index) => (
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
  );
}
