"use client";

import { useDashboardTable } from "@/hooks/useDashboardTable";
import HeaderBar from "./HeaderBar";
import { EntityFilterBanner, FeedTable, FeedCardList, TabContent } from "./dashboard";

export default function DashboardTable() {
  const {
    items, loading, error, fetchedAt, feedsAttempted, feedsSucceeded, totalItems, refresh,
    categoryFilter, searchQuery, entityFilter, dark, activeTab,
    setSearchQuery, setCategoryFilter, setEntityFilter, setActiveTab,
    categories, filteredItems, sortedItems, t,
    toggleTheme, handleSort, getSortArrow, handleEntityClick, clearFilters,
  } = useDashboardTable();

  return (
    <div className={`h-screen flex flex-col ${t.bg} transition-colors duration-200 ${dark ? "dark-scrollbar" : ""}`}>
      <HeaderBar
        dark={dark} toggleTheme={toggleTheme} searchQuery={searchQuery}
        setSearchQuery={setSearchQuery} categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter} categories={categories}
        activeTab={activeTab} setActiveTab={setActiveTab}
        feedsSucceeded={feedsSucceeded} feedsAttempted={feedsAttempted}
        totalItems={totalItems} filteredItemCount={filteredItems.length}
        fetchedAt={fetchedAt} loading={loading} refresh={refresh}
        setEntityFilter={setEntityFilter} t={t}
      />

      <div className={`flex-1 overflow-auto min-h-0 ${dark ? "dark-scrollbar" : ""}`}>
        {entityFilter && activeTab === "feeds" && (
          <EntityFilterBanner entityFilter={entityFilter} dark={dark} filteredItemCount={filteredItems.length} onClear={() => setEntityFilter(null)} />
        )}

        {error && (
          <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-3">
            <div className={`${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"} border text-sm px-4 py-3 rounded-xl`}>
              Error: {error}
            </div>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="max-w-[1920px] mx-auto px-6 py-20 text-center">
            <svg className={`w-8 h-8 mx-auto mb-4 animate-spin ${dark ? "text-slate-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <p className={`text-sm ${t.loadingText}`}>Fetching live feeds from {feedsAttempted || "140+"} sources...</p>
            <p className={`text-xs mt-1.5 ${t.loadingSub}`}>Stand by — 10-15 seconds</p>
          </div>
        )}

        <TabContent activeTab={activeTab} items={items} filteredItems={filteredItems} dark={dark} onEntityClick={handleEntityClick} />

        {activeTab === "feeds" && items.length > 0 && (
          <>
            <FeedTable sortedItems={sortedItems} dark={dark} t={t} onSort={handleSort} getSortArrow={getSortArrow} />
            <FeedCardList sortedItems={sortedItems} dark={dark} t={t} />
          </>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="max-w-[1920px] mx-auto px-6 py-20 text-center">
            <p className={`text-sm ${t.loadingText}`}>No feed items — past 7 days</p>
            <button onClick={refresh} className={`mt-3 text-sm font-medium hover:underline ${dark ? "text-blue-400" : "text-blue-600"}`}>Retry</button>
          </div>
        )}

        {!loading && items.length > 0 && sortedItems.length === 0 && activeTab === "feeds" && (
          <div className="max-w-[1920px] mx-auto px-6 py-12 text-center">
            <p className={`text-sm ${t.loadingText}`}>
              No results{searchQuery ? ` for \u201C${searchQuery}\u201D` : ""}{entityFilter ? ` for \u201C${entityFilter}\u201D` : ""}{categoryFilter !== "all" ? ` in ${categoryFilter}` : ""}
            </p>
            <button onClick={clearFilters} className={`mt-2 text-sm font-medium hover:underline ${dark ? "text-blue-400" : "text-blue-600"}`}>Clear Filters</button>
          </div>
        )}
      </div>
    </div>
  );
}
