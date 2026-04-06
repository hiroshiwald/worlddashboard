"use client";

import { ThemeClasses } from "@/lib/theme";
import { timeAgo } from "@/lib/date-utils";

type TabKey = "feeds" | "intel" | "network" | "map" | "signals";

interface HeaderBarProps {
  dark: boolean;
  toggleTheme: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  categories: string[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  feedsSucceeded: number;
  feedsAttempted: number;
  totalItems: number;
  filteredItemCount: number;
  fetchedAt: string | null;
  loading: boolean;
  refresh: () => void;
  setEntityFilter: (e: string | null) => void;
  t: ThemeClasses;
}

const tabs: { key: TabKey; label: string }[] = [
  { key: "feeds", label: "Feeds" },
  { key: "intel", label: "Intel" },
  { key: "network", label: "Network" },
  { key: "map", label: "Map" },
  { key: "signals", label: "Signals" },
];

function SearchInput({
  searchQuery,
  setSearchQuery,
  dark,
  t,
  className,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  dark: boolean;
  t: ThemeClasses;
  className?: string;
}) {
  return (
    <div className={`relative ${className || ""}`}>
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
  );
}

export default function HeaderBar({
  dark,
  toggleTheme,
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  categories,
  activeTab,
  setActiveTab,
  feedsSucceeded,
  feedsAttempted,
  totalItems,
  filteredItemCount,
  fetchedAt,
  loading,
  refresh,
  setEntityFilter,
  t,
}: HeaderBarProps) {
  return (
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
              {filteredItemCount !== totalItems
                ? `${filteredItemCount}/${totalItems}`
                : totalItems}{" "}
              items
            </span>
          )}
        </div>

        {/* Center: search (desktop) */}
        <div className="hidden sm:block flex-1 max-w-lg mx-2 md:mx-4">
          <SearchInput searchQuery={searchQuery} setSearchQuery={setSearchQuery} dark={dark} t={t} />
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
        <SearchInput searchQuery={searchQuery} setSearchQuery={setSearchQuery} dark={dark} t={t} />
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
  );
}
