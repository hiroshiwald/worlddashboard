"use client";

import { useState, useMemo, useEffect } from "react";
import { FeedItem, SortConfig } from "@/lib/types";
import { useFeed } from "@/hooks/useSources";
import { getThemeClasses, ThemeClasses } from "@/lib/theme";

export type TabKey = "feeds" | "intel" | "network" | "map" | "signals" | "discovery";
export type ColumnKey = keyof FeedItem;

interface UseDashboardTableReturn {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  totalItems: number;
  refresh: () => void;
  sort: SortConfig;
  categoryFilter: string;
  searchQuery: string;
  entityFilter: string | null;
  dark: boolean;
  activeTab: TabKey;
  setSearchQuery: (q: string) => void;
  setCategoryFilter: (c: string) => void;
  setEntityFilter: (e: string | null) => void;
  setActiveTab: (tab: TabKey) => void;
  categories: string[];
  filteredItems: FeedItem[];
  sortedItems: FeedItem[];
  t: ThemeClasses;
  toggleTheme: () => void;
  handleSort: (key: ColumnKey) => void;
  getSortArrow: (key: ColumnKey) => string;
  handleEntityClick: (name: string) => void;
  clearFilters: () => void;
}

function matchesText(item: FeedItem, query: string): boolean {
  const q = query.toLowerCase();
  return (
    item.title.toLowerCase().includes(q) ||
    item.sourceName.toLowerCase().includes(q) ||
    item.summary.toLowerCase().includes(q) ||
    item.sourceCategory.toLowerCase().includes(q)
  );
}

function filterItems(
  items: FeedItem[], entityFilter: string | null,
  searchQuery: string, categoryFilter: string,
): FeedItem[] {
  let result = items;
  if (entityFilter) result = result.filter((i) => matchesText(i, entityFilter));
  if (searchQuery.trim()) result = result.filter((i) => matchesText(i, searchQuery));
  if (categoryFilter !== "all") result = result.filter((i) => i.sourceCategory === categoryFilter);
  return result;
}

function sortItems(items: FeedItem[], sort: SortConfig): FeedItem[] {
  const arr = [...items];
  arr.sort((a, b) => {
    const aVal = a[sort.key];
    const bVal = b[sort.key];
    let cmp: number;
    if (sort.key === "published") {
      cmp = new Date(aVal as string).getTime() - new Date(bVal as string).getTime();
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return arr;
}

// Exception to 50-line rule: 6 state variables + 1 effect + 2 memos +
// 5 handlers make further reduction below 50 counterproductive. Pure
// helpers (matchesText, filterItems, sortItems) are already extracted
// above; remaining code is React state/effect wiring that must stay
// co-located with the hook.
export function useDashboardTable(): UseDashboardTableReturn {
  const {
    items, loading, error, fetchedAt,
    feedsAttempted, feedsSucceeded, totalItems, refresh,
  } = useFeed();

  const [sort, setSort] = useState<SortConfig>({ key: "published", direction: "desc" });
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("feeds");

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
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.sourceCategory));
    return ["all", ...Array.from(cats).sort()];
  }, [items]);

  const filteredItems = useMemo(
    () => filterItems(items, entityFilter, searchQuery, categoryFilter),
    [items, searchQuery, entityFilter, categoryFilter],
  );

  const sortedItems = useMemo(
    () => sortItems(filteredItems, sort),
    [filteredItems, sort],
  );

  const getSortArrow = (key: ColumnKey): string => {
    if (sort.key !== key) return "";
    return sort.direction === "asc" ? " \u2191" : " \u2193";
  };

  const t = getThemeClasses(dark);

  const handleEntityClick = (name: string) => {
    setEntityFilter(name);
    setActiveTab("feeds");
  };

  const clearFilters = () => {
    setSearchQuery("");
    setEntityFilter(null);
    setCategoryFilter("all");
  };

  return {
    items, loading, error, fetchedAt,
    feedsAttempted, feedsSucceeded, totalItems, refresh,
    sort, categoryFilter, searchQuery, entityFilter, dark, activeTab,
    setSearchQuery, setCategoryFilter, setEntityFilter, setActiveTab,
    categories, filteredItems, sortedItems, t,
    toggleTheme, handleSort, getSortArrow, handleEntityClick, clearFilters,
  };
}
