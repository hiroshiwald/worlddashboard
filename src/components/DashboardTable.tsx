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
  { key: "published", label: "Time", width: "w-28" },
  { key: "imageUrl", label: "", width: "w-14" },
  { key: "sourceName", label: "Source", width: "min-w-[120px]" },
  { key: "sourceCategory", label: "Category", width: "min-w-[110px]" },
  { key: "title", label: "Headline", width: "min-w-[300px]" },
  { key: "summary", label: "Summary", width: "min-w-[240px]" },
  { key: "sourceTier", label: "Tier", width: "w-24" },
];

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "now";
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);

  if (diffHrs < 1) return timeAgo(isoString) + " ago";
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
  const [searchQuery, setSearchQuery] = useState<string>("");

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
    let result = items;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.sourceName.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.sourceCategory.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (categoryFilter !== "all") {
      result = result.filter((i) => i.sourceCategory === categoryFilter);
    }

    return result;
  }, [items, searchQuery, categoryFilter]);

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
    <div className="min-h-screen bg-slate-100">
      {/* ─── Dark Header Bar ─── */}
      <div className="sticky top-0 z-30 bg-slate-900 shadow-lg">
        {/* Primary row */}
        <div className="max-w-[1920px] mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          {/* Left: branding */}
          <div className="flex items-center gap-3 shrink-0">
            <h1 className="text-sm font-semibold tracking-[0.2em] text-white uppercase">
              World Dashboard
            </h1>
            {feedsSucceeded > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {feedsSucceeded}/{feedsAttempted} feeds
              </span>
            )}
            {totalItems > 0 && (
              <span className="text-[10px] text-slate-400 font-mono">
                {filteredItems.length}
                {filteredItems.length !== totalItems
                  ? ` / ${totalItems}`
                  : ""}{" "}
                items
              </span>
            )}
          </div>

          {/* Center: search */}
          <div className="flex-1 max-w-md mx-4">
            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search headlines, sources, categories..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-slate-800 border border-slate-700 rounded-md text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-500 cursor-pointer"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "All Categories" : cat}
                </option>
              ))}
            </select>

            {fetchedAt && (
              <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                {timeAgo(fetchedAt)} ago
              </span>
            )}

            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors disabled:opacity-40"
            >
              <svg
                className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
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

        {/* Urgency legend strip */}
        <div className="max-w-[1920px] mx-auto px-4 pb-2 flex items-center gap-4 text-[9px] font-medium text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-red-500" />
            Critical
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-400" />
            Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-yellow-400" />
            Advisory
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-sky-400" />
            Monitoring
          </span>
        </div>
      </div>

      {/* ─── Error Banner ─── */}
      {error && (
        <div className="max-w-[1920px] mx-auto px-4 py-3">
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-md px-4 py-2">
            {error}
          </div>
        </div>
      )}

      {/* ─── Loading State ─── */}
      {loading && items.length === 0 && (
        <div className="max-w-[1920px] mx-auto px-4 py-20 text-center">
          <svg
            className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-400"
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
          <p className="text-slate-500 text-xs">
            Fetching live feeds from {feedsAttempted || "140+"} sources...
          </p>
          <p className="text-slate-400 text-[10px] mt-1">
            This may take 10–15 seconds on first load
          </p>
        </div>
      )}

      {/* ─── Table ─── */}
      {items.length > 0 && (
        <div className="max-w-[1920px] mx-auto px-3 py-3">
          <div className="border border-slate-200 rounded-lg shadow-sm bg-white overflow-auto max-h-[calc(100vh-120px)]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-800">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`${col.width} px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-200 transition-colors whitespace-nowrap`}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <span
                          className={`text-[9px] ${
                            sort.key === col.key
                              ? "text-white"
                              : "text-slate-600"
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
                            : "bg-slate-50/50"
                          : ""
                      } hover:brightness-[0.97] transition-all border-b border-slate-100`}
                    >
                      {/* Time */}
                      <td className="px-3 py-1.5 text-[11px] text-slate-400 whitespace-nowrap font-mono">
                        {formatDate(item.published)}
                      </td>

                      {/* Thumbnail */}
                      <td className="px-1 py-1">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="w-10 h-7 object-cover rounded-sm bg-slate-100"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div className="w-10 h-7 rounded-sm bg-slate-100" />
                        )}
                      </td>

                      {/* Source */}
                      <td className="px-3 py-1.5 font-medium text-slate-700 text-[11px] whitespace-nowrap">
                        {item.sourceName}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-1.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${getUrgencyBadgeClasses(
                            level
                          )}`}
                        >
                          {item.sourceCategory}
                        </span>
                      </td>

                      {/* Headline */}
                      <td className="px-3 py-1.5 max-w-[400px]">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-900 hover:text-blue-700 hover:underline font-medium text-[13px] leading-snug line-clamp-2"
                          title={item.title}
                        >
                          {item.title}
                        </a>
                      </td>

                      {/* Summary */}
                      <td
                        className="px-3 py-1.5 text-slate-400 text-[11px] max-w-[300px]"
                        title={item.summary}
                      >
                        <span className="line-clamp-2">{item.summary}</span>
                      </td>

                      {/* Tier */}
                      <td className="px-3 py-1.5 text-slate-400 text-[10px] whitespace-nowrap font-mono">
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

      {/* ─── Empty State ─── */}
      {!loading && items.length === 0 && !error && (
        <div className="max-w-[1920px] mx-auto px-4 py-20 text-center">
          <p className="text-slate-500 text-xs">
            No feed items found from the past 7 days.
          </p>
          <button
            onClick={refresh}
            className="mt-3 text-slate-400 text-xs hover:text-slate-600 hover:underline"
          >
            Try refreshing
          </button>
        </div>
      )}

      {/* ─── Search empty state ─── */}
      {!loading && items.length > 0 && sortedItems.length === 0 && (
        <div className="max-w-[1920px] mx-auto px-4 py-12 text-center">
          <p className="text-slate-400 text-xs">
            No results for &ldquo;{searchQuery}&rdquo;
            {categoryFilter !== "all" ? ` in ${categoryFilter}` : ""}
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setCategoryFilter("all");
            }}
            className="mt-2 text-slate-500 text-xs hover:text-slate-700 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
