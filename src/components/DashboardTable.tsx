"use client";

import { useState, useMemo } from "react";
import { DashboardSource, SortConfig, SortDirection } from "@/lib/types";
import { useSources } from "@/hooks/useSources";
import {
  getUrgencyLevel,
  getRowClasses,
  getUrgencyBadgeClasses,
  getUrgencyLabel,
} from "@/lib/urgency";

type ColumnKey = keyof DashboardSource;

interface Column {
  key: ColumnKey;
  label: string;
  width: string;
}

const COLUMNS: Column[] = [
  { key: "id", label: "#", width: "w-14" },
  { key: "name", label: "Name", width: "min-w-[220px]" },
  { key: "category", label: "Category", width: "min-w-[160px]" },
  { key: "type", label: "Type", width: "w-28" },
  { key: "tier", label: "Tier", width: "min-w-[140px]" },
  { key: "url", label: "URL", width: "min-w-[180px]" },
  { key: "notes", label: "Notes", width: "min-w-[260px]" },
  { key: "status", label: "Status", width: "w-24" },
];

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export default function DashboardTable() {
  const { sources, loading, error, fetchedAt, refresh } = useSources();
  const [sort, setSort] = useState<SortConfig>({
    key: "id",
    direction: "asc",
  });
  const [filter7Days, setFilter7Days] = useState(true);

  const handleSort = (key: ColumnKey) => {
    setSort((prev) => ({
      key,
      direction:
        prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedSources = useMemo(() => {
    const arr = [...sources];
    arr.sort((a, b) => {
      const aVal = a[sort.key];
      const bVal = b[sort.key];
      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [sources, sort]);

  const getSortArrow = (key: ColumnKey): string => {
    if (sort.key !== key) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  };

  const isStaticSource = (source: DashboardSource) =>
    source.status === "static" || source.tier === "Reference";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Toolbar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          {/* Left side */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">
              World Dashboard Sources
            </h1>
            {sources.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700 rounded-full">
                {sources.length} sources
              </span>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* 7-day filter toggle */}
            <button
              onClick={() => setFilter7Days(!filter7Days)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                filter7Days
                  ? "bg-indigo-50 text-indigo-700 border-indigo-300"
                  : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
              }`}
            >
              Last 7 Days
            </button>

            {/* Last fetched */}
            {fetchedAt && (
              <span className="text-xs text-gray-400">
                Updated {timeAgo(fetchedAt)}
              </span>
            )}

            {/* Refresh button */}
            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Urgency legend */}
        <div className="max-w-[1800px] mx-auto px-4 pb-2 flex items-center gap-3 text-[10px] font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-400" />
            Critical
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-400" />
            Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />
            Advisory
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
            Monitoring
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
            System
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-[1800px] mx-auto px-4 py-3">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-2">
            Error loading sources: {error}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && sources.length === 0 && (
        <div className="max-w-[1800px] mx-auto px-4 py-12 text-center text-gray-400">
          <svg
            className="w-8 h-8 mx-auto mb-3 animate-spin text-indigo-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Loading dashboard sources...
        </div>
      )}

      {/* Table */}
      {sources.length > 0 && (
        <div className="max-w-[1800px] mx-auto px-4 py-4">
          <div className="border border-gray-200 rounded-lg shadow-sm bg-white overflow-auto max-h-[calc(100vh-160px)]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b-2 border-gray-200">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`${col.width} px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 transition-colors whitespace-nowrap`}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <span
                          className={`text-[10px] ${
                            sort.key === col.key
                              ? "text-indigo-600"
                              : "text-gray-300"
                          }`}
                        >
                          {getSortArrow(col.key)}
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedSources.map((source, idx) => {
                  const level = getUrgencyLevel(source.category);
                  const rowColor = getRowClasses(level);
                  const isStatic = isStaticSource(source);
                  const dimmed = filter7Days && isStatic;

                  return (
                    <tr
                      key={source.id}
                      className={`${rowColor} ${
                        level === "neutral"
                          ? idx % 2 === 0
                            ? "bg-white"
                            : "bg-gray-50/50"
                          : ""
                      } hover:brightness-95 transition-all border-b border-gray-100 ${
                        dimmed ? "opacity-50" : ""
                      }`}
                    >
                      {/* # */}
                      <td className="px-3 py-2 text-gray-400 text-right font-mono text-xs tabular-nums">
                        {source.id}
                      </td>

                      {/* Name */}
                      <td
                        className="px-3 py-2 font-medium text-gray-900 truncate max-w-[280px]"
                        title={source.name}
                      >
                        {source.name}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${getUrgencyBadgeClasses(
                            level
                          )}`}
                        >
                          {getUrgencyLabel(level) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                          )}
                          {source.category}
                        </span>
                      </td>

                      {/* Type */}
                      <td className="px-3 py-2 text-gray-600">
                        {source.type}
                      </td>

                      {/* Tier */}
                      <td className="px-3 py-2 text-gray-600 text-xs">
                        {source.tier}
                      </td>

                      {/* URL */}
                      <td
                        className="px-3 py-2 max-w-[220px] truncate"
                        title={source.url}
                      >
                        {source.url.startsWith("http") ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-800 hover:underline text-xs"
                          >
                            {source.url.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        ) : (
                          <span className="text-gray-400 text-xs italic">
                            {source.url}
                          </span>
                        )}
                      </td>

                      {/* Notes */}
                      <td
                        className="px-3 py-2 text-gray-500 text-xs truncate max-w-[320px]"
                        title={source.notes}
                      >
                        {source.notes}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        <StatusPill status={source.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: DashboardSource["status"] }) {
  const config = {
    live: {
      dot: "bg-green-500",
      bg: "bg-green-50 text-green-700 ring-green-200",
      label: "Live",
    },
    static: {
      dot: "bg-gray-400",
      bg: "bg-gray-50 text-gray-500 ring-gray-200",
      label: "Static",
    },
    unknown: {
      dot: "bg-yellow-400",
      bg: "bg-yellow-50 text-yellow-700 ring-yellow-200",
      label: "—",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ${config.bg}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${
          status === "live" ? "animate-pulse" : ""
        }`}
      />
      {config.label}
    </span>
  );
}
