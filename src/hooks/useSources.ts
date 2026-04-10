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

interface UseFeedReturn {
  items: FeedItem[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  feedsAttempted: number;
  feedsSucceeded: number;
  totalItems: number;
  feedDiagnostics: FeedDiagnostic[];
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

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
    refresh: fetchFeed,
  };
}
