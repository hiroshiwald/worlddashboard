"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedItem, FeedDiagnostic } from "@/lib/types";

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
      setItems(data.items);
      setFetchedAt(data.fetchedAt);
      setFeedsAttempted(data.feedsAttempted);
      setFeedsSucceeded(data.feedsSucceeded);
      setTotalItems(data.count);
      setFeedDiagnostics(data.feedDiagnostics || []);
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
