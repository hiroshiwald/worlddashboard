"use client";

import { useState, useMemo } from "react";
import { FeedItem, SortConfig } from "@/lib/types";
import { useFeed } from "@/hooks/useSources";
import {
  getUrgencyLevel,
  getRowClasses,
  getUrgencyBadgeClasses,
} from "@/lib/urgency";

type ColumnKey = keyof FeedItem;

interface Column {
  key: ColumnKey;
  label: string;
  width: string;
}

const COLUMNS: Column[] = [
  { key: "published", label: "Published", width: "w-40" },
  { key: "sourceName", label: "Source", width: "min-w-[150px]" },
  { key: "sourceCategory", label: "Category", width: "min-w-[140px]" },
  { key: "title", label: "Headline", width: "min-w-[320px]" },
  { key: "summary", label: "Summary", width: "min-w-[280px]" },
  { key: "sourceTier", label: "Tier", width: "w-36" },
];

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "just now";
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);

  if (diffHrs < 1) return timeAgo(isoString);
  if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardTable() {
  const {
    items,
    loading,
    error,
    fetchedAt,
    feedsAttempted,
    feedsSucceeded,
    totalItems,
    refresh,
  } = useFeed();

  const [sort, setSort] = useState<SortConfig>({
    key: "published",
    direction: "desc",
  });
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const handleSort = (key: ColumnKey) => {
    setSort((prev) => ({
      key,
      direction:
        prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.sourceCategory));
    return ["all", ...Array.from(cats).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (categoryFilter === "all") return items;
    return items.filter((i) => i.sourceCategory === categoryFilter);
  }, [items, categoryFilter]);

  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const aVal = a[sort.key];
      const bVal = b[sort.key];
      let cmp: number;
      if (sort.key === "published") {
        cmp =
          new Date(aVal as string).getTime() -
          new Date(bVal as string).getTime();
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sort]);

  const getSortArrow = (key: ColumnKey): string => {
    if (sort.key !== key) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Toolbar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1900px] mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          {/* Left side */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">
              World Dashboard
            </h1>
            <span className="text-xs text-gray-400">LIVE FEED</span>
            {totalItems > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700 rounded-full">
                {filteredItems.length}
                {categoryFilter !== "all"
                  ? ` / ${totalItems}`
                  : ""}{" "}
                items
              </span>
            )}
            {feedsSucceeded > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
                {feedsSucceeded}/{feedsAttempted} feeds online
              </span>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "All Categories" : cat}
                </option>
              ))}
            </select>

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
        <div className="max-w-[1900px] mx-auto px-4 pb-2 flex items-center gap-4 text-[10px] font-medium text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-400" />
            Conflict / Cyber / Military
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-400" />
            Disaster / Health
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />
            Gov Advisory
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
            Economic / Supply Chain
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-[1900px] mx-auto px-4 py-3">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-2">
            Error: {error}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="max-w-[1900px] mx-auto px-4 py-16 text-center">
          <svg
            className="w-10 h-10 mx-auto mb-4 animate-spin text-indigo-500"
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
          <p className="text-gray-500 text-sm">
            Fetching live feeds from {feedsAttempted || "40+"} sources...
          </p>
          <p className="text-gray-400 text-xs mt-1">
            This may take 10-15 seconds on first load
          </p>
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div className="max-w-[1900px] mx-auto px-4 py-4">
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
                {sortedItems.map((item, idx) => {
                  const level = getUrgencyLevel(item.sourceCategory);
                  const rowColor = getRowClasses(level);

                  return (
                    <tr
                      key={item.id + idx}
                      className={`${rowColor} ${
                        level === "neutral"
                          ? idx % 2 === 0
                            ? "bg-white"
                            : "bg-gray-50/50"
                          : ""
                      } hover:brightness-[0.97] transition-all border-b border-gray-100`}
                    >
                      {/* Published */}
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap font-mono">
                        {formatDate(item.published)}
                      </td>

                      {/* Source */}
                      <td className="px-3 py-2 font-medium text-gray-700 text-xs whitespace-nowrap">
                        {item.sourceName}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${getUrgencyBadgeClasses(
                            level
                          )}`}
                        >
                          {item.sourceCategory}
                        </span>
                      </td>

                      {/* Title / Headline */}
                      <td className="px-3 py-2 max-w-[400px]">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-900 hover:text-indigo-700 hover:underline font-medium text-sm leading-snug line-clamp-2"
                          title={item.title}
                        >
                          {item.title}
                        </a>
                      </td>

                      {/* Summary */}
                      <td
                        className="px-3 py-2 text-gray-500 text-xs max-w-[320px]"
                        title={item.summary}
                      >
                        <span className="line-clamp-2">{item.summary}</span>
                      </td>

                      {/* Tier */}
                      <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                        {item.sourceTier}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state after loading */}
      {!loading && items.length === 0 && !error && (
        <div className="max-w-[1900px] mx-auto px-4 py-16 text-center">
          <p className="text-gray-500 text-sm">
            No feed items found from the past 7 days.
          </p>
          <button
            onClick={refresh}
            className="mt-3 text-indigo-600 text-sm hover:underline"
          >
            Try refreshing
          </button>
        </div>
      )}
    </div>
  );
}
