"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedItem, FeedDiagnostic } from "@/lib/types";

interface ValidatedResponse {
  items: FeedItem[];
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  count: number;
  feedDiagnostics: FeedDiagnostic[];
}

function validateApiResponse(data: unknown): ValidatedResponse {
  const obj = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;

  if (!Array.isArray(obj.items)) {
    console.warn("[useSources] data.items is not an array, defaulting to []");
  }
  if (typeof obj.feedsAttempted !== "number") {
    console.warn(
      "[useSources] data.feedsAttempted is not a number, defaulting to 0",
    );
  }
  if (typeof obj.feedsSucceeded !== "number") {
    console.warn(
      "[useSources] data.feedsSucceeded is not a number, defaulting to 0",
    );
  }
  if (typeof obj.count !== "number") {
    console.warn(
      "[useSources] data.count is not a number, defaulting to 0",
    );
  }
  if (obj.feedDiagnostics !== undefined && !Array.isArray(obj.feedDiagnostics)) {
    console.warn(
      "[useSources] data.feedDiagnostics is not an array, defaulting to []",
    );
  }

  return {
    items: Array.isArray(obj.items) ? (obj.items as FeedItem[]) : [],
    fetchedAt: typeof obj.fetchedAt === "string" ? obj.fetchedAt : null,
    feedsAttempted:
      typeof obj.feedsAttempted === "number" ? obj.feedsAttempted : 0,
    feedsSucceeded:
      typeof obj.feedsSucceeded === "number" ? obj.feedsSucceeded : 0,
    count: typeof obj.count === "number" ? obj.count : 0,
    feedDiagnostics: Array.isArray(obj.feedDiagnostics)
      ? (obj.feedDiagnostics as FeedDiagnostic[])
      : [],
  };
}

interface ValidatedDbResponse {
  items: FeedItem[];
  lastIngestAt: string | null;
  count: number;
}

function validateDbResponse(data: unknown): ValidatedDbResponse | null {
  const obj = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(obj.items)) return null;
  if (typeof obj.lastIngestAt !== "string" && obj.lastIngestAt !== null) {
    return null;
  }

  return {
    items: obj.items as FeedItem[],
    lastIngestAt: typeof obj.lastIngestAt === "string" ? obj.lastIngestAt : null,
    count: typeof obj.count === "number" ? obj.count : obj.items.length,
  };
}

interface UseFeedReturn {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  totalItems: number;
  feedDiagnostics: FeedDiagnostic[];
  mode: "db" | "live";
  lastIngestAt: string | null;
  refresh: () => void;
}

export function useFeed(): UseFeedReturn {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [feedsAttempted, setFeedsAttempted] = useState(0);
  const [feedsSucceeded, setFeedsSucceeded] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [feedDiagnostics, setFeedDiagnostics] = useState<FeedDiagnostic[]>([]);
  const [mode, setMode] = useState<"db" | "live">("live");
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);

  // Tries the DB-backed read path first. Returns false (and warns) on a
  // 503 (no data yet), any other non-2xx, a malformed body, or a network
  // error — the caller then falls back to the live fetch path.
  const fetchFromDb = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/articles", { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[useSources] /api/articles returned ${res.status}, falling back to live fetch`);
        return false;
      }
      const data = await res.json();
      const validated = validateDbResponse(data);
      if (!validated) {
        console.warn("[useSources] /api/articles response has unexpected shape, falling back to live fetch");
        return false;
      }
      setItems(validated.items);
      setFetchedAt(new Date().toISOString());
      setFeedsAttempted(0);
      setFeedsSucceeded(0);
      setTotalItems(validated.count);
      setFeedDiagnostics([]);
      setMode("db");
      setLastIngestAt(validated.lastIngestAt);
      return true;
    } catch (err) {
      console.warn("[useSources] /api/articles fetch failed, falling back to live fetch", err);
      return false;
    }
  }, []);

  const fetchFromLive = useCallback(async () => {
    const res = await fetch("/api/sources", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const validated = validateApiResponse(data);
    setItems(validated.items);
    setFetchedAt(validated.fetchedAt);
    setFeedsAttempted(validated.feedsAttempted);
    setFeedsSucceeded(validated.feedsSucceeded);
    setTotalItems(validated.count);
    setFeedDiagnostics(validated.feedDiagnostics);
    setMode("live");
    setLastIngestAt(null);
  }, []);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const usedDb = await fetchFromDb();
      if (!usedDb) await fetchFromLive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch feed");
    } finally {
      setLoading(false);
    }
  }, [fetchFromDb, fetchFromLive]);

  useEffect(() => {
    // Fire-and-forget: useEffect cannot return a promise. Errors handled inside fetchFeed.
    fetchFeed();
  }, [fetchFeed]);

  return {
    items,
    loading,
    error,
    fetchedAt,
    feedsAttempted,
    feedsSucceeded,
    totalItems,
    feedDiagnostics,
    mode,
    lastIngestAt,
    refresh: fetchFeed,
  };
}
