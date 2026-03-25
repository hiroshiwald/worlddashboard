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
  { key: "published", label: "DTG", width: "w-32" },
  { key: "imageUrl", label: "", width: "w-14" },
  { key: "sourceName", label: "Source", width: "min-w-[140px]" },
  { key: "sourceCategory", label: "Category", width: "min-w-[120px]" },
  { key: "title", label: "Headline", width: "min-w-[320px]" },
  { key: "summary", label: "Summary", width: "min-w-[260px]" },
  { key: "sourceTier", label: "Tier", width: "w-28" },
];

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "NOW";
  if (secs < 5) return "NOW";
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

  if (diffHrs < 1) return timeAgo(isoString) + " AGO";
  if (diffHrs < 24) return `${Math.floor(diffHrs)}H AGO`;

  return d
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .toUpperCase();
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
    if (sort.key !== key) return "";
    return sort.direction === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* ─── Header Bar ─── */}
      <div className="sticky top-0 z-30 bg-slate-900 border-b border-slate-700">
        <div className="max-w-[1920px] mx-auto px-4 py-2 flex items-center justify-between gap-4">
          {/* Left: branding + status */}
          <div className="flex items-center gap-4 shrink-0">
            <h1 className="text-xs font-bold tracking-[0.25em] text-slate-100 uppercase">
              WORLD DASHBOARD
            </h1>
            {feedsSucceeded > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {feedsSucceeded}/{feedsAttempted} FEEDS
              </span>
            )}
            {totalItems > 0 && (
              <span className="text-xs text-slate-400">
                {filteredItems.length !== totalItems
                  ? `${filteredItems.length}/${totalItems}`
                  : totalItems}{" "}
                ITEMS
              </span>
            )}
          </div>

          {/* Center: search */}
          <div className="flex-1 max-w-lg mx-4">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                /
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH HEADLINES, SOURCES..."
                className="w-full pl-7 pr-8 py-1.5 text-xs bg-slate-800 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-400 uppercase"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 text-xs"
                >
                  CLR
                </button>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-3 shrink-0">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 text-slate-200 focus:outline-none focus:border-slate-400 cursor-pointer uppercase"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "ALL CATEGORIES" : cat.toUpperCase()}
                </option>
              ))}
            </select>

            {fetchedAt && (
              <span className="text-xs text-slate-500 hidden sm:inline">
                {timeAgo(fetchedAt)}
              </span>
            )}

            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-200 bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors disabled:opacity-40 uppercase tracking-wide"
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
              REFRESH
            </button>
          </div>
        </div>

        {/* Urgency legend */}
        <div className="max-w-[1920px] mx-auto px-4 pb-1.5 flex items-center gap-5 text-[10px] text-slate-500 uppercase tracking-wide">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-red-500" />
            CRITICAL
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-amber-500" />
            WARNING
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-yellow-500" />
            ADVISORY
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-sky-500" />
            MONITORING
          </span>
        </div>
      </div>

      {/* ─── Error Banner ─── */}
      {error && (
        <div className="max-w-[1920px] mx-auto px-4 py-3">
          <div className="bg-red-950 border border-red-700 text-red-300 text-xs px-4 py-2 uppercase">
            ERROR: {error}
          </div>
        </div>
      )}

      {/* ─── Loading State ─── */}
      {loading && items.length === 0 && (
        <div className="max-w-[1920px] mx-auto px-4 py-20 text-center">
          <svg
            className="w-6 h-6 mx-auto mb-3 animate-spin text-slate-500"
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
          <p className="text-slate-400 text-xs uppercase tracking-wide">
            FETCHING LIVE FEEDS FROM {feedsAttempted || "140+"} SOURCES...
          </p>
          <p className="text-slate-600 text-xs mt-1">
            STAND BY — 10-15 SECONDS
          </p>
        </div>
      )}

      {/* ─── Table ─── */}
      {items.length > 0 && (
        <div className="max-w-[1920px] mx-auto px-2 py-2">
          <div className="border border-slate-700 bg-slate-900 overflow-auto max-h-[calc(100vh-110px)]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-800 border-b border-slate-600">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`${col.width} px-3 py-2 text-left text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap`}
                    >
                      {col.label}
                      {getSortArrow(col.key)}
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
                            ? "bg-slate-900"
                            : "bg-slate-900/60"
                          : ""
                      } hover:bg-slate-800 transition-colors border-b border-slate-800`}
                    >
                      {/* DTG (Date-Time Group) */}
                      <td className="px-3 py-1.5 text-xs text-slate-300 whitespace-nowrap">
                        {formatDate(item.published)}
                      </td>

                      {/* Thumbnail */}
                      <td className="px-1 py-1">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="w-10 h-7 object-cover bg-slate-800"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div className="w-10 h-7 bg-slate-800" />
                        )}
                      </td>

                      {/* Source */}
                      <td className="px-3 py-1.5 text-xs font-semibold text-slate-100 whitespace-nowrap">
                        {item.sourceName}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-1.5 text-xs">
                        <span className={getUrgencyBadgeClasses(level)}>
                          {item.sourceCategory.toUpperCase()}
                        </span>
                      </td>

                      {/* Headline */}
                      <td className="px-3 py-1.5 max-w-[420px]">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-white hover:text-amber-300 hover:underline leading-snug line-clamp-2"
                          title={item.title}
                        >
                          {item.title}
                        </a>
                      </td>

                      {/* Summary */}
                      <td
                        className="px-3 py-1.5 text-xs text-slate-400 max-w-[300px]"
                        title={item.summary}
                      >
                        <span className="line-clamp-2">{item.summary}</span>
                      </td>

                      {/* Tier */}
                      <td className="px-3 py-1.5 text-xs text-slate-400 whitespace-nowrap uppercase">
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
          <p className="text-slate-500 text-xs uppercase">
            NO FEED ITEMS — PAST 7 DAYS
          </p>
          <button
            onClick={refresh}
            className="mt-3 text-slate-400 text-xs hover:text-slate-200 hover:underline uppercase"
          >
            RETRY
          </button>
        </div>
      )}

      {/* ─── Search empty state ─── */}
      {!loading && items.length > 0 && sortedItems.length === 0 && (
        <div className="max-w-[1920px] mx-auto px-4 py-12 text-center">
          <p className="text-slate-500 text-xs uppercase">
            NO RESULTS FOR &ldquo;{searchQuery}&rdquo;
            {categoryFilter !== "all"
              ? ` IN ${categoryFilter.toUpperCase()}`
              : ""}
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setCategoryFilter("all");
            }}
            className="mt-2 text-slate-400 text-xs hover:text-slate-200 hover:underline uppercase"
          >
            CLEAR FILTERS
          </button>
        </div>
      )}
    </div>
  );
}
