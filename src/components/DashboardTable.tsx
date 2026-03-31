"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { FeedItem, SortConfig } from "@/lib/types";
import { useFeed } from "@/hooks/useSources";
import {
  getUrgencyLevel,
  getRowClasses,
  getUrgencyBadgeClasses,
} from "@/lib/urgency";
import IntelTab from "./IntelTab";

const MapTab = dynamic(() => import("./MapTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs uppercase tracking-wide text-slate-500">LOADING MAP...</p>
    </div>
  ),
});

const NetworkTab = dynamic(() => import("./NetworkTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs uppercase tracking-wide text-slate-500">LOADING NETWORK...</p>
    </div>
  ),
});

const SignalsTab = dynamic(() => import("./SignalsTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs uppercase tracking-wide text-slate-500">ANALYZING SIGNALS...</p>
    </div>
  ),
});

type ColumnKey = keyof FeedItem;

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
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [dark, setDark] = useState(true);
  const [activeTab, setActiveTab] = useState<"feeds" | "intel" | "network" | "map" | "signals">("feeds");

  useEffect(() => {
    const saved = localStorage.getItem("wd-theme");
    if (saved === "light") setDark(false);
  }, []);

  const toggleTheme = () => {
    setDark((prev) => {
      localStorage.setItem("wd-theme", prev ? "light" : "dark");
      return !prev;
    });
  };

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

    // Apply entity filter (from INTEL tab click)
    if (entityFilter) {
      const ef = entityFilter.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(ef) ||
          i.sourceName.toLowerCase().includes(ef) ||
          i.summary.toLowerCase().includes(ef) ||
          i.sourceCategory.toLowerCase().includes(ef)
      );
    }

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
  }, [items, searchQuery, entityFilter, categoryFilter]);

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

  // Theme classes
  const t = {
    bg: dark ? "bg-slate-950" : "bg-stone-50",
    headerBg: dark ? "bg-slate-900 border-b border-slate-700" : "bg-white border-b border-stone-200 shadow-sm",
    headerText: dark ? "text-stone-100" : "text-stone-800",
    feedBadge: dark ? "text-emerald-400" : "text-emerald-600",
    itemCount: dark ? "text-slate-400" : "text-stone-500",
    searchBg: dark ? "bg-slate-800 border-slate-600 text-slate-100 placeholder-slate-500 focus:border-slate-400" : "bg-stone-100 border-stone-300 text-stone-900 placeholder-stone-400 focus:border-blue-400",
    selectBg: dark ? "bg-slate-800 border-slate-600 text-slate-200 focus:border-slate-400" : "bg-stone-100 border-stone-300 text-stone-700 focus:border-blue-400",
    btnBg: dark ? "bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-200" : "bg-stone-100 hover:bg-stone-200 border-stone-300 text-stone-700",
    legendText: dark ? "text-slate-500" : "text-stone-500",
    tableBorder: dark ? "border-slate-700 bg-slate-900" : "border-stone-200 bg-white",
    theadBg: dark ? "bg-slate-800 border-b border-slate-600" : "bg-stone-100 border-b border-stone-200",
    theadText: dark ? "text-slate-300 hover:text-white" : "text-stone-600 hover:text-stone-900",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-stone-50",
    rowHover: dark ? "hover:bg-slate-800" : "hover:bg-blue-50/50",
    rowBorder: dark ? "border-b border-slate-800" : "border-b border-stone-100",
    dtgText: dark ? "text-slate-300" : "text-stone-500",
    sourceText: dark ? "text-slate-100" : "text-stone-800",
    headlineText: dark ? "text-white hover:text-amber-300" : "text-stone-900 hover:text-blue-600",
    summaryText: dark ? "text-slate-400" : "text-stone-500",
    tierText: dark ? "text-slate-400" : "text-stone-400",
    imgPlaceholder: dark ? "bg-slate-800" : "bg-stone-100",
    loadingText: dark ? "text-slate-400" : "text-stone-500",
    loadingSub: dark ? "text-slate-600" : "text-stone-400",
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-stone-200",
    cardBorder: dark ? "border-slate-800" : "border-stone-200",
    tabActive: dark ? "text-white bg-slate-700" : "text-white bg-blue-600",
    tabInactive: dark ? "text-slate-500 hover:text-slate-300" : "text-stone-500 hover:text-stone-800",
  };

  return (
    <div className={`h-screen flex flex-col ${t.bg} transition-colors duration-200`}>
      {/* ─── Header Bar ─── */}
      <div className={`shrink-0 z-30 ${t.headerBg}`}>
        {/* Row 1: brand + controls */}
        <div className="max-w-[1920px] mx-auto px-3 md:px-4 py-2.5 flex items-center justify-between gap-2 md:gap-4">
          {/* Left: branding */}
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <h1 className={`text-xs md:text-sm font-bold tracking-[0.12em] md:tracking-[0.15em] ${t.headerText} uppercase`}>
              WORLD DASHBOARD
            </h1>
            {feedsSucceeded > 0 && (
              <span className={`flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs ${t.feedBadge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dark ? "bg-emerald-400" : "bg-emerald-500"} animate-pulse`} />
                {feedsSucceeded}/{feedsAttempted}
              </span>
            )}
            {totalItems > 0 && (
              <span className={`hidden md:inline text-xs ${t.itemCount}`}>
                {filteredItems.length !== totalItems
                  ? `${filteredItems.length}/${totalItems}`
                  : totalItems}{" "}
                ITEMS
              </span>
            )}
          </div>

          {/* Center: search — hidden on very small, shown sm+ */}
          <div className="hidden sm:block flex-1 max-w-lg mx-2 md:mx-4">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                /
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH..."
                className={`w-full pl-7 pr-8 py-1.5 text-xs border rounded focus:outline-none uppercase ${t.searchBg}`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs ${dark ? "text-slate-500 hover:text-slate-200" : "text-stone-400 hover:text-stone-700"}`}
                >
                  CLR
                </button>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <button
              onClick={toggleTheme}
              className={`p-1.5 md:p-2 border rounded transition-colors ${t.btnBg}`}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? (
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`hidden md:block px-2 py-1.5 text-xs border rounded focus:outline-none cursor-pointer uppercase ${t.selectBg}`}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "ALL CATEGORIES" : cat.toUpperCase()}
                </option>
              ))}
            </select>

            {fetchedAt && (
              <span className={`hidden lg:inline text-xs ${dark ? "text-slate-500" : "text-stone-400"}`}>
                {timeAgo(fetchedAt)}
              </span>
            )}

            <button
              onClick={refresh}
              disabled={loading}
              className={`inline-flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 text-[10px] md:text-xs font-semibold border rounded transition-colors disabled:opacity-40 uppercase tracking-wide ${t.btnBg}`}
            >
              <svg
                className={`w-3 h-3 md:w-3.5 md:h-3.5 ${loading ? "animate-spin" : ""}`}
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
              <span className="hidden sm:inline">REFRESH</span>
            </button>
          </div>
        </div>

        {/* Row 2 mobile: search bar (shown on small screens only) */}
        <div className="sm:hidden max-w-[1920px] mx-auto px-3 pb-1.5">
          <div className="relative">
            <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs ${dark ? "text-slate-500" : "text-stone-400"}`}>
              /
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH..."
              className={`w-full pl-7 pr-8 py-1.5 text-xs border rounded focus:outline-none uppercase ${t.searchBg}`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs ${dark ? "text-slate-500 hover:text-slate-200" : "text-stone-400 hover:text-stone-700"}`}
              >
                CLR
              </button>
            )}
          </div>
        </div>

        {/* Row 3: tabs + legend */}
        <div className={`max-w-[1920px] mx-auto px-3 md:px-4 pb-1.5 flex items-center gap-3 md:gap-6 text-[10px] uppercase tracking-wide ${t.legendText}`}>
          <div className="flex items-center gap-0.5 mr-1 md:mr-2">
            <button
              onClick={() => setActiveTab("feeds")}
              className={`px-2.5 md:px-3 py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                activeTab === "feeds"
                  ? t.tabActive
                  : t.tabInactive
              }`}
            >
              FEEDS
            </button>
            <button
              onClick={() => {
                setActiveTab("intel");
                setEntityFilter(null);
              }}
              className={`px-2.5 md:px-3 py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                activeTab === "intel"
                  ? t.tabActive
                  : t.tabInactive
              }`}
            >
              INTEL
            </button>
            <button
              onClick={() => setActiveTab("network")}
              className={`px-2.5 md:px-3 py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                activeTab === "network"
                  ? t.tabActive
                  : t.tabInactive
              }`}
            >
              NETWORK
            </button>
            <button
              onClick={() => setActiveTab("map")}
              className={`px-2.5 md:px-3 py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                activeTab === "map"
                  ? t.tabActive
                  : t.tabInactive
              }`}
            >
              MAP
            </button>
            <button
              onClick={() => setActiveTab("signals")}
              className={`px-2.5 md:px-3 py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                activeTab === "signals"
                  ? t.tabActive
                  : t.tabInactive
              }`}
            >
              SIGNALS
            </button>
          </div>

          {/* Mobile: category filter inline with tabs */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={`md:hidden px-1.5 py-0.5 text-[10px] border rounded focus:outline-none cursor-pointer uppercase ${t.selectBg}`}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "all" ? "ALL" : cat.toUpperCase()}
              </option>
            ))}
          </select>

          {(activeTab === "feeds" || activeTab === "map" || activeTab === "signals") && (
            <div className="hidden sm:flex items-center gap-3 md:gap-5">
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
          )}
        </div>
      </div>

      {/* ─── Scrollable Content Area ─── */}
      <div className="flex-1 overflow-auto min-h-0">

      {/* ─── Entity Filter Banner ─── */}
      {entityFilter && activeTab === "feeds" && (
        <div className={`${dark ? "bg-blue-950/70 border-b border-blue-800" : "bg-blue-50 border-b border-blue-200"}`}>
          <div className="max-w-[1920px] mx-auto px-3 md:px-4 py-2 flex items-center justify-between">
            <span className={`text-xs ${dark ? "text-blue-200" : "text-blue-800"}`}>
              Showing results for <strong>&ldquo;{entityFilter}&rdquo;</strong>
              <span className={`ml-2 ${dark ? "text-blue-400" : "text-blue-500"}`}>
                ({filteredItems.length} {filteredItems.length === 1 ? "item" : "items"})
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEntityFilter(null);
                }}
                className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                  dark
                    ? "text-blue-200 hover:bg-blue-900 hover:text-white"
                    : "text-blue-700 hover:bg-blue-100 hover:text-blue-900"
                }`}
              >
                SHOW ALL
              </button>
              <button
                onClick={() => setEntityFilter(null)}
                className={`p-0.5 rounded transition-colors ${
                  dark ? "text-blue-400 hover:text-white" : "text-blue-500 hover:text-blue-900"
                }`}
                title="Clear filter"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Error Banner ─── */}
      {error && (
        <div className="max-w-[1920px] mx-auto px-3 py-3">
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
          <p className={`text-xs uppercase tracking-wide ${t.loadingText}`}>
            FETCHING LIVE FEEDS FROM {feedsAttempted || "140+"} SOURCES...
          </p>
          <p className={`text-xs mt-1 ${t.loadingSub}`}>
            STAND BY — 10-15 SECONDS
          </p>
        </div>
      )}

      {/* ─── MAP Tab ─── */}
      {activeTab === "map" && items.length > 0 && (
        <MapTab
          items={filteredItems}
          dark={dark}
          onEntityClick={(name) => {
            setEntityFilter(name);
            setActiveTab("feeds");
          }}
        />
      )}

      {/* ─── NETWORK Tab ─── */}
      {activeTab === "network" && items.length > 0 && (
        <NetworkTab
          items={items}
          dark={dark}
          onEntityClick={(name) => {
            setEntityFilter(name);
            setActiveTab("feeds");
          }}
        />
      )}

      {/* ─── INTEL Tab ─── */}
      {activeTab === "intel" && items.length > 0 && (
        <IntelTab
          items={items}
          dark={dark}
          onEntityClick={(name) => {
            setEntityFilter(name);
            setActiveTab("feeds");
          }}
        />
      )}

      {/* ─── SIGNALS Tab ─── */}
      {activeTab === "signals" && items.length > 0 && (
        <SignalsTab
          items={items}
          dark={dark}
          onEntityClick={(name) => {
            setEntityFilter(name);
            setActiveTab("feeds");
          }}
        />
      )}

      {/* ─── FEEDS: Desktop Table ─── */}
      {activeTab === "feeds" && items.length > 0 && (
        <>
          {/* Desktop table — hidden on mobile */}
          <div className="hidden md:block max-w-[1920px] mx-auto px-2 py-2">
            <div className={`border overflow-auto ${t.tableBorder}`}>
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className={t.theadBg}>
                    <th
                      onClick={() => handleSort("published")}
                      className={`w-28 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      DTG{getSortArrow("published")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceName")}
                      className={`min-w-[130px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      SOURCE{getSortArrow("sourceName")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceCategory")}
                      className={`min-w-[110px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      CATEGORY{getSortArrow("sourceCategory")}
                    </th>
                    <th
                      onClick={() => handleSort("title")}
                      className={`min-w-[400px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      HEADLINE{getSortArrow("title")}
                    </th>
                    <th
                      onClick={() => handleSort("summary")}
                      className={`min-w-[240px] px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      SUMMARY{getSortArrow("summary")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceTier")}
                      className={`w-28 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      TIER{getSortArrow("sourceTier")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, idx) => {
                    const level = getUrgencyLevel(item.sourceCategory);
                    const rowColor = getRowClasses(level, dark);

                    return (
                      <tr
                        key={item.id + idx}
                        className={`${rowColor} ${
                          level === "neutral"
                            ? idx % 2 === 0
                              ? t.rowAltA
                              : t.rowAltB
                            : ""
                        } ${t.rowHover} transition-colors ${t.rowBorder}`}
                      >
                        <td className={`px-3 py-2 text-xs whitespace-nowrap ${t.dtgText}`}>
                          {formatDate(item.published)}
                        </td>
                        <td className={`px-3 py-2 text-xs font-semibold whitespace-nowrap ${t.sourceText}`}>
                          {item.sourceName}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className={getUrgencyBadgeClasses(level, dark)}>
                            {item.sourceCategory.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 max-w-[500px]">
                          <div className="flex items-start gap-2.5">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className={`w-[74px] h-[50px] object-cover shrink-0 mt-0.5 ${t.imgPlaceholder}`}
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            ) : (
                              <div className={`w-[74px] h-[50px] shrink-0 mt-0.5 flex items-center justify-center text-lg font-bold text-white/60 ${t.imgPlaceholder}`}>
                                {item.sourceName.charAt(0)}
                              </div>
                            )}
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-xs font-semibold hover:underline leading-snug line-clamp-2 ${t.headlineText}`}
                              title={item.title}
                            >
                              {item.title}
                            </a>
                          </div>
                        </td>
                        <td
                          className={`px-3 py-2 text-xs max-w-[300px] ${t.summaryText}`}
                          title={item.summary}
                        >
                          <span className="line-clamp-2">{item.summary}</span>
                        </td>
                        <td className={`px-3 py-2 text-xs whitespace-nowrap uppercase ${t.tierText}`}>
                          {item.sourceTier}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── FEEDS: Mobile Cards ─── */}
          <div className="md:hidden max-w-[1920px] mx-auto px-2 py-2 space-y-1.5">
            {sortedItems.map((item, idx) => {
              const level = getUrgencyLevel(item.sourceCategory);
              const rowColor = getRowClasses(level, dark);

              return (
                <div
                  key={item.id + idx}
                  className={`${rowColor} ${
                    level === "neutral" ? t.cardBg : ""
                  } border ${t.cardBorder} px-3 py-2.5`}
                >
                  {/* Top line: source + time */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-bold uppercase ${t.sourceText}`}>
                      {item.sourceName}
                    </span>
                    <span className={`text-[10px] ${t.dtgText}`}>
                      {formatDate(item.published)}
                    </span>
                  </div>

                  {/* Headline with image */}
                  <div className="flex items-start gap-2.5 mb-1.5">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className={`w-16 h-[46px] object-cover shrink-0 ${t.imgPlaceholder}`}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className={`w-16 h-[46px] shrink-0 flex items-center justify-center text-base font-bold text-white/60 ${t.imgPlaceholder}`}>
                        {item.sourceName.charAt(0)}
                      </div>
                    )}
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-xs font-semibold hover:underline leading-snug ${t.headlineText}`}
                    >
                      {item.title}
                    </a>
                  </div>

                  {/* Summary */}
                  {item.summary && (
                    <p className={`text-[10px] leading-snug line-clamp-2 mb-1.5 ${t.summaryText}`}>
                      {item.summary}
                    </p>
                  )}

                  {/* Bottom: category + tier */}
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] ${getUrgencyBadgeClasses(level, dark)}`}>
                      {item.sourceCategory.toUpperCase()}
                    </span>
                    <span className={`text-[10px] uppercase ${t.tierText}`}>
                      {item.sourceTier}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ─── Empty State ─── */}
      {!loading && items.length === 0 && !error && (
        <div className="max-w-[1920px] mx-auto px-4 py-20 text-center">
          <p className={`text-xs uppercase ${t.loadingText}`}>
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
      {!loading && items.length > 0 && sortedItems.length === 0 && activeTab === "feeds" && (
        <div className="max-w-[1920px] mx-auto px-4 py-12 text-center">
          <p className={`text-xs uppercase ${t.loadingText}`}>
            NO RESULTS{searchQuery ? ` FOR \u201C${searchQuery}\u201D` : ""}
            {entityFilter ? ` FOR \u201C${entityFilter}\u201D` : ""}
            {categoryFilter !== "all"
              ? ` IN ${categoryFilter.toUpperCase()}`
              : ""}
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setEntityFilter(null);
              setCategoryFilter("all");
            }}
            className={`mt-2 text-xs hover:underline uppercase ${dark ? "text-slate-400 hover:text-slate-200" : "text-stone-500 hover:text-stone-800"}`}
          >
            CLEAR FILTERS
          </button>
        </div>
      )}

      </div>{/* end scrollable content area */}
    </div>
  );
}
