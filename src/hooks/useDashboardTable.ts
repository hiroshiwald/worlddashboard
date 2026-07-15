"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { FeedItem, SortConfig } from "@/lib/types";
import { useFeed } from "@/hooks/useSources";
import { getThemeClasses, ThemeClasses } from "@/lib/theme";

export type TabKey = "feeds" | "intel" | "network" | "map" | "signals" | "discovery" | "review";
export type ColumnKey = keyof FeedItem;

interface UseDashboardTableReturn {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  totalItems: number;
  mode: "db" | "live";
  lastIngestAt: string | null;
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
  candidateCount: number;
  handleCandidatesChanged: (count: number) => void;
  panelEntityId: number | null;
  setPanelEntityId: (id: number | null) => void;
}

// Never throws: a non-ok response, a malformed body, or a network error all
// resolve to a 0 count (and warn) rather than leaving the badge unset.
async function fetchCandidateCount(): Promise<number> {
  try {
    const res = await fetch("/api/candidates", { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[useDashboardTable] /api/candidates returned ${res.status}, defaulting count to 0`);
      return 0;
    }
    const data = await res.json();
    return Array.isArray(data.candidates) ? data.candidates.length : 0;
  } catch (err) {
    console.warn("[useDashboardTable] /api/candidates fetch failed, defaulting count to 0", err);
    return 0;
  }
}

// Resolves a clicked name to a tracked entity id. Returns null (and warns)
// on a 404, any other non-2xx, a malformed body, or a network error — the
// caller then falls back to the existing text-filter behavior.
async function resolveEntityIdByName(name: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/entities?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[useDashboardTable] /api/entities returned ${res.status}, falling back to text filter`);
      return null;
    }
    const data = await res.json();
    if (typeof data.id !== "number") {
      console.warn("[useDashboardTable] /api/entities response has unexpected shape, falling back to text filter");
      return null;
    }
    return data.id;
  } catch (err) {
    console.warn("[useDashboardTable] /api/entities fetch failed, falling back to text filter", err);
    return null;
  }
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

// Exception to 50-line rule: 8 state variables + 2 effects + 3 memos +
// 5 handlers make further reduction below 50 counterproductive. Pure
// helpers (matchesText, filterItems, sortItems, fetchCandidateCount,
// resolveEntityIdByName) are already extracted above; remaining code is
// React state/effect wiring that must stay co-located with the hook.
export function useDashboardTable(): UseDashboardTableReturn {
  const {
    items, loading, error, fetchedAt,
    feedsAttempted, feedsSucceeded, totalItems, mode, lastIngestAt, refresh,
  } = useFeed();

  const [sort, setSort] = useState<SortConfig>({ key: "published", direction: "desc" });
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("feeds");
  const [candidateCount, setCandidateCount] = useState(0);
  const [panelEntityId, setPanelEntityId] = useState<number | null>(null);
  const entityClickSeq = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem("wd-theme");
    if (saved === "dark") setDark(true);
  }, []);

  useEffect(() => {
    // Fire-and-forget: fetchCandidateCount has its own try/catch and always
    // resolves (never rejects), so there's nothing further to catch here.
    fetchCandidateCount().then(setCandidateCount);
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

  // Guards against out-of-order resolution: if the user clicks a second
  // entity before the first click's fetch resolves, only the LATEST click's
  // result is allowed to update state.
  const handleEntityClick = async (name: string) => {
    const seq = ++entityClickSeq.current;
    const entityId = await resolveEntityIdByName(name);
    if (seq !== entityClickSeq.current) return;
    if (entityId !== null) {
      setPanelEntityId(entityId);
      return;
    }
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
    feedsAttempted, feedsSucceeded, totalItems, mode, lastIngestAt, refresh,
    sort, categoryFilter, searchQuery, entityFilter, dark, activeTab,
    setSearchQuery, setCategoryFilter, setEntityFilter, setActiveTab,
    categories, filteredItems, sortedItems, t,
    toggleTheme, handleSort, getSortArrow, handleEntityClick, clearFilters,
    candidateCount, handleCandidatesChanged: setCandidateCount,
    panelEntityId, setPanelEntityId,
  };
}
