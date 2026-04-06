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
import { getThemeClasses } from "@/lib/theme";
import { formatDate } from "@/lib/date-utils";
import IntelTab from "./IntelTab";
import HeaderBar from "./HeaderBar";
import FeedItemImage from "./FeedItemImage";

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

const DiscoveryTab = dynamic(() => import("./DiscoveryTab"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400">Loading discovery view...</p>
    </div>
  ),
});

type ColumnKey = keyof FeedItem;

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
  const [activeTab, setActiveTab] = useState<"feeds" | "intel" | "network" | "map" | "signals" | "discovery">("feeds");

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

  const t = getThemeClasses(dark);

  const handleEntityClick = (name: string) => {
    setEntityFilter(name);
    setActiveTab("feeds");
  };

  return (
    <div className={`h-screen flex flex-col ${t.bg} transition-colors duration-200 ${dark ? "dark-scrollbar" : ""}`}>
      {/* ─── Header Bar ─── */}
      <HeaderBar
        dark={dark}
        toggleTheme={toggleTheme}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        categories={categories}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        feedsSucceeded={feedsSucceeded}
        feedsAttempted={feedsAttempted}
        totalItems={totalItems}
        filteredItemCount={filteredItems.length}
        fetchedAt={fetchedAt}
        loading={loading}
        refresh={refresh}
        setEntityFilter={setEntityFilter}
        t={t}
      />

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
        <MapTab items={filteredItems} dark={dark} onEntityClick={handleEntityClick} />
      )}

      {/* ─── NETWORK Tab ─── */}
      {activeTab === "network" && items.length > 0 && (
        <NetworkTab items={items} dark={dark} onEntityClick={handleEntityClick} />
      )}

      {/* ─── INTEL Tab ─── */}
      {activeTab === "intel" && items.length > 0 && (
        <IntelTab items={items} dark={dark} onEntityClick={handleEntityClick} />
      )}

      {/* ─── SIGNALS Tab ─── */}
      {activeTab === "signals" && items.length > 0 && (
        <SignalsTab items={items} dark={dark} onEntityClick={handleEntityClick} />
      )}

      {/* ─── DISCOVERY Tab ─── */}
      {activeTab === "discovery" && items.length > 0 && (
        <DiscoveryTab items={items} dark={dark} onEntityClick={handleEntityClick} />
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
                            <FeedItemImage
                              imageUrl={item.imageUrl}
                              link={item.link}
                              sourceName={item.sourceName}
                              dark={dark}
                              size="desktop"
                              imgPlaceholder={t.imgPlaceholder}
                            />
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
                    <FeedItemImage
                      imageUrl={item.imageUrl}
                      link={item.link}
                      sourceName={item.sourceName}
                      dark={dark}
                      size="mobile"
                      imgPlaceholder={t.imgPlaceholder}
                    />
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
