"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardSource } from "@/lib/types";

interface UseSourcesReturn {
  sources: DashboardSource[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  refresh: () => void;
}

export function useSources(): UseSourcesReturn {
  const [sources, setSources] = useState<DashboardSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSources(data.sources);
      setFetchedAt(data.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return { sources, loading, error, fetchedAt, refresh: fetchSources };
}
