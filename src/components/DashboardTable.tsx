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
      <p className="text-sm text-gray-400">Loading map...</p>
    </div>
  ),
});

const NetworkTab = dynamic(() => import("./NetworkTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading network...</p>
    </div>
  ),
});

const SignalsTab = dynamic(() => import("./SignalsTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Analyzing signals...</p>
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

  if (diffHrs < 1) return timeAgo(isoString) + " ago";
  if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;

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

function fallbackSourceImage(link: string): string {
  try {
    const domain = new URL(link).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return "";
  }
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
  const [dark, setDark] = useState(false);
  const [activeTab, setActiveTab] = useState<"feeds" | "intel" | "network" | "map" | "signals">("feeds");

  useEffect(() => {
    const saved = localStorage.getItem("wd-theme");
    if (saved === "dark") setDark(true);
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

  // Theme classes — refreshed design
  const t = {
    bg: dark ? "bg-slate-950" : "bg-gray-50",
    headerBg: dark ? "bg-slate-900/95 backdrop-blur border-b border-slate-800" : "bg-white/95 backdrop-blur shadow-sm",
    headerText: dark ? "text-slate-100" : "text-gray-900",
    feedBadge: dark ? "text-emerald-400" : "text-emerald-600",
    itemCount: dark ? "text-slate-400" : "text-gray-500",
    searchBg: dark
      ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
      : "bg-gray-100 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20",
    selectBg: dark
      ? "bg-slate-800 border-slate-700 text-slate-200 focus:border-blue-500"
      : "bg-gray-100 border-gray-200 text-gray-700 focus:border-blue-500",
    btnBg: dark
      ? "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
      : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700 shadow-sm",
    legendText: dark ? "text-slate-500" : "text-gray-400",
    tableBorder: dark ? "bg-slate-900 border-slate-800" : "bg-white",
    theadBg: dark ? "bg-slate-800/60 border-b border-slate-700" : "bg-gray-50/80 border-b border-gray-200",
    theadText: dark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-gray-50/50",
    rowHover: dark ? "hover:bg-slate-800/80" : "hover:bg-blue-50/40",
    rowBorder: dark ? "border-b border-slate-800/60" : "border-b border-gray-100",
    dtgText: dark ? "text-slate-400" : "text-gray-500",
    sourceText: dark ? "text-slate-100" : "text-gray-800",
    headlineText: dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600",
    summaryText: dark ? "text-slate-400" : "text-gray-500",
    tierText: dark ? "text-slate-500" : "text-gray-400",
    imgPlaceholder: dark ? "bg-slate-800 rounded-lg" : "bg-gray-100 rounded-lg",
    loadingText: dark ? "text-slate-400" : "text-gray-500",
    loadingSub: dark ? "text-slate-600" : "text-gray-400",
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    cardBorder: dark ? "border-slate-800" : "border-gray-100",
    tabActive: dark ? "text-blue-400 border-b-2 border-blue-400" : "text-blue-600 border-b-2 border-blue-600",
    tabInactive: dark ? "text-slate-500 hover:text-slate-300 border-b-2 border-transparent" : "text-gray-400 hover:text-gray-600 border-b-2 border-transparent",
  };

  const tabs = [
    { key: "feeds" as const, label: "Feeds" },
    { key: "intel" as const, label: "Intel" },
    { key: "network" as const, label: "Network" },
    { key: "map" as const, label: "Map" },
    { key: "signals" as const, label: "Signals" },
  ];

  return (
    <div className={`h-screen flex flex-col ${t.bg} transition-colors duration-200 ${dark ? "dark-scrollbar" : ""}`}>
      {/* ─── Header Bar ─── */}
      <div className={`shrink-0 z-30 ${t.headerBg}`}>
        {/* Row 1: brand + controls */}
        <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3 md:gap-6">
          {/* Left: branding */}
          <div className="flex items-center gap-3 md:gap-5 shrink-0">
            <h1 className={`text-sm md:text-base font-bold tracking-wide ${t.headerText}`}>
              World Dashboard
            </h1>
            {feedsSucceeded > 0 && (
              <span className={`flex items-center gap-1.5 text-xs ${t.feedBadge}`}>
                <span className={`w-2 h-2 rounded-full ${dark ? "bg-emerald-400" : "bg-emerald-500"} animate-pulse`} />
                {feedsSucceeded}/{feedsAttempted}
              </span>
            )}
            {totalItems > 0 && (
              <span className={`hidden md:inline text-xs ${t.itemCount}`}>
                {filteredItems.length !== totalItems
                  ? `${filteredItems.length}/${totalItems}`
                  : totalItems}{" "}
                items
              </span>
            )}
          </div>

          {/* Center: search */}
          <div className="hidden sm:block flex-1 max-w-lg mx-2 md:mx-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search feeds..."
                className={`w-full pl-10 pr-8 py-2 text-sm border rounded-lg focus:outline-none transition-colors ${t.searchBg}`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 ${dark ? "text-slate-500 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              onClick={toggleTheme}
              className={`p-2 border rounded-lg transition-colors ${t.btnBg}`}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={`hidden md:block px-3 py-2 text-sm border rounded-lg focus:outline-none cursor-pointer ${t.selectBg}`}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "All Categories" : cat}
                </option>
              ))}
            </select>

            {fetchedAt && (
              <span className={`hidden lg:inline text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
                {timeAgo(fetchedAt)}
              </span>
            )}

            <button
              onClick={refresh}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors disabled:opacity-40 ${t.btnBg}`}
            >
              <svg
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
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
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Row 2 mobile: search bar */}
        <div className="sm:hidden max-w-[1920px] mx-auto px-4 pb-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search feeds..."
              className={`w-full pl-10 pr-8 py-2 text-sm border rounded-lg focus:outline-none transition-colors ${t.searchBg}`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${dark ? "text-slate-500 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Row 3: tabs + legend */}
        <div className={`max-w-[1920px] mx-auto px-4 md:px-6 flex items-center gap-4 md:gap-8 ${t.legendText}`}>
          <div className="flex items-center gap-1 mr-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  if (tab.key === "intel") setEntityFilter(null);
                }}
                className={`px-3 md:px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key ? t.tabActive : t.tabInactive
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Mobile: category filter inline with tabs */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className={`md:hidden px-2 py-1 text-xs border rounded-lg focus:outline-none cursor-pointer ${t.selectBg}`}
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === "all" ? "All" : cat}
              </option>
            ))}
          </select>

          {(activeTab === "feeds" || activeTab === "map" || activeTab === "signals") && (
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                Critical
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Warning
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                Advisory
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                Monitoring
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Scrollable Content Area ─── */}
      <div className={`flex-1 overflow-auto min-h-0 ${dark ? "dark-scrollbar" : ""}`}>

      {/* ─── Entity Filter Banner ─── */}
      {entityFilter && activeTab === "feeds" && (
        <div className={`${dark ? "bg-blue-950/50 border-b border-blue-900" : "bg-blue-50 border-b border-blue-100"}`}>
          <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between">
            <span className={`text-sm ${dark ? "text-blue-200" : "text-blue-800"}`}>
              Showing results for <strong>&ldquo;{entityFilter}&rdquo;</strong>
              <span className={`ml-2 ${dark ? "text-blue-400" : "text-blue-500"}`}>
                ({filteredItems.length} {filteredItems.length === 1 ? "item" : "items"})
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEntityFilter(null)}
                className={`text-sm font-medium px-3 py-1 rounded-lg transition-colors ${
                  dark
                    ? "text-blue-200 hover:bg-blue-900 hover:text-white"
                    : "text-blue-700 hover:bg-blue-100 hover:text-blue-900"
                }`}
              >
                Show All
              </button>
              <button
                onClick={() => setEntityFilter(null)}
                className={`p-1 rounded-lg transition-colors ${
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
        <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-3">
          <div className={`${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"} border text-sm px-4 py-3 rounded-xl`}>
            Error: {error}
          </div>
        </div>
      )}

      {/* ─── Loading State ─── */}
      {loading && items.length === 0 && (
        <div className="max-w-[1920px] mx-auto px-6 py-20 text-center">
          <svg
            className={`w-8 h-8 mx-auto mb-4 animate-spin ${dark ? "text-slate-500" : "text-gray-400"}`}
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
          <p className={`text-sm ${t.loadingText}`}>
            Fetching live feeds from {feedsAttempted || "140+"} sources...
          </p>
          <p className={`text-xs mt-1.5 ${t.loadingSub}`}>
            Stand by — 10-15 seconds
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
          {/* Desktop table */}
          <div className="hidden md:block max-w-[1920px] mx-auto px-4 md:px-6 py-4">
            <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className={t.theadBg}>
                    <th
                      onClick={() => handleSort("published")}
                      className={`w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      DTG{getSortArrow("published")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceName")}
                      className={`min-w-[130px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      Source{getSortArrow("sourceName")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceCategory")}
                      className={`min-w-[120px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      Category{getSortArrow("sourceCategory")}
                    </th>
                    <th
                      onClick={() => handleSort("title")}
                      className={`min-w-[400px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      Headline{getSortArrow("title")}
                    </th>
                    <th
                      onClick={() => handleSort("summary")}
                      className={`min-w-[240px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      Summary{getSortArrow("summary")}
                    </th>
                    <th
                      onClick={() => handleSort("sourceTier")}
                      className={`w-28 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`}
                    >
                      Tier{getSortArrow("sourceTier")}
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
                        <td className={`px-4 py-3 text-xs whitespace-nowrap ${t.dtgText}`}>
                          {formatDate(item.published)}
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${t.sourceText}`}>
                          {item.sourceName}
                        </td>
                        <td className="px-4 py-3">
                          <span className={getUrgencyBadgeClasses(level, dark)}>
                            {item.sourceCategory.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[500px]">
                          <div className="flex items-start gap-3">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className={`w-[74px] h-[50px] object-cover shrink-0 mt-0.5 rounded-lg ${t.imgPlaceholder}`}
                                loading="lazy"
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  const sourceFallback = fallbackSourceImage(item.link);
                                  if (sourceFallback && img.src !== sourceFallback) {
                                    img.src = sourceFallback;
                                    return;
                                  }
                                  img.style.display = "none";
                                }}
                              />
                            ) : (
                              <div className={`w-[74px] h-[50px] shrink-0 mt-0.5 flex items-center justify-center text-lg font-semibold ${dark ? "text-slate-500" : "text-gray-400"} ${t.imgPlaceholder}`}>
                                {item.sourceName.charAt(0)}
                              </div>
                            )}
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-sm font-medium hover:underline leading-snug line-clamp-2 ${t.headlineText}`}
                              title={item.title}
                            >
                              {item.title}
                            </a>
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-sm max-w-[300px] ${t.summaryText}`}
                          title={item.summary}
                        >
                          <span className="line-clamp-2">{item.summary}</span>
                        </td>
                        <td className={`px-4 py-3 text-xs whitespace-nowrap uppercase ${t.tierText}`}>
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
          <div className="md:hidden max-w-[1920px] mx-auto px-4 py-3 space-y-2">
            {sortedItems.map((item, idx) => {
              const level = getUrgencyLevel(item.sourceCategory);
              const rowColor = getRowClasses(level, dark);

              return (
                <div
                  key={item.id + idx}
                  className={`${rowColor} ${
                    level === "neutral" ? t.cardBg : ""
                  } border ${t.cardBorder} rounded-xl px-4 py-3`}
                >
                  {/* Top line: source + time */}
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-semibold ${t.sourceText}`}>
                      {item.sourceName}
                    </span>
                    <span className={`text-xs ${t.dtgText}`}>
                      {formatDate(item.published)}
                    </span>
                  </div>

                  {/* Headline with image */}
                  <div className="flex items-start gap-3 mb-2">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className={`w-16 h-[46px] object-cover shrink-0 rounded-lg ${t.imgPlaceholder}`}
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          const sourceFallback = fallbackSourceImage(item.link);
                          if (sourceFallback && img.src !== sourceFallback) {
                            img.src = sourceFallback;
                            return;
                          }
                          img.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className={`w-16 h-[46px] shrink-0 flex items-center justify-center text-base font-semibold ${dark ? "text-slate-500" : "text-gray-400"} ${t.imgPlaceholder}`}>
                        {item.sourceName.charAt(0)}
                      </div>
                    )}
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm font-medium hover:underline leading-snug ${t.headlineText}`}
                    >
                      {item.title}
                    </a>
                  </div>

                  {/* Summary */}
                  {item.summary && (
                    <p className={`text-xs leading-relaxed line-clamp-2 mb-2 ${t.summaryText}`}>
                      {item.summary}
                    </p>
                  )}

                  {/* Bottom: category + tier */}
                  <div className="flex items-center justify-between">
                    <span className={getUrgencyBadgeClasses(level, dark)}>
                      {item.sourceCategory.toUpperCase()}
                    </span>
                    <span className={`text-xs ${t.tierText}`}>
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
        <div className="max-w-[1920px] mx-auto px-6 py-20 text-center">
          <p className={`text-sm ${t.loadingText}`}>
            No feed items — past 7 days
          </p>
          <button
            onClick={refresh}
            className={`mt-3 text-sm font-medium hover:underline ${dark ? "text-blue-400" : "text-blue-600"}`}
          >
            Retry
          </button>
        </div>
      )}

      {/* ─── Search empty state ─── */}
      {!loading && items.length > 0 && sortedItems.length === 0 && activeTab === "feeds" && (
        <div className="max-w-[1920px] mx-auto px-6 py-12 text-center">
          <p className={`text-sm ${t.loadingText}`}>
            No results{searchQuery ? ` for \u201C${searchQuery}\u201D` : ""}
            {entityFilter ? ` for \u201C${entityFilter}\u201D` : ""}
            {categoryFilter !== "all"
              ? ` in ${categoryFilter}`
              : ""}
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setEntityFilter(null);
              setCategoryFilter("all");
            }}
            className={`mt-2 text-sm font-medium hover:underline ${dark ? "text-blue-400" : "text-blue-600"}`}
          >
            Clear Filters
          </button>
        </div>
      )}

      </div>{/* end scrollable content area */}
    </div>
  );
}
