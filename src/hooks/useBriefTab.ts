"use client";

import { useState, useEffect, useCallback } from "react";
import { SignalCardData, SignalAction } from "@/components/signals/types";

export type { SignalAction } from "@/components/signals/types";
export type BriefSignal = SignalCardData;

export interface BriefNewEntity {
  id: number;
  canonicalName: string;
  type: string;
  firstSeenAt: string;
  sourceCount: number;
}

export interface BriefTopStory {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  clusterSize: number;
  sourceCount: number;
}

export interface BriefData {
  generatedAt: string;
  signals: BriefSignal[];
  newEntities: BriefNewEntity[];
  topStories: BriefTopStory[];
}

// Distinguishes "no database configured yet" from a genuine fetch/shape
// failure, so the UI can show a friendly empty state instead of an error
// banner — same convention as ReviewTab's DatabaseNotConfiguredError.
class DatabaseNotConfiguredError extends Error {}

async function fetchBrief(): Promise<BriefData> {
  const res = await fetch("/api/brief", { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load brief (${res.status})`);
  return res.json();
}

async function postSignalAction(id: number, action: SignalAction): Promise<void> {
  const res = await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Action failed (${res.status})`);
  }
}

export function useBriefTab() {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      setData(await fetchBrief());
    } catch (e) {
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load brief");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const act = useCallback(
    async (id: number, action: SignalAction) => {
      setBusyId(id);
      setError(null);
      try {
        await postSignalAction(id, action);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return { data, loading, error, dbUnconfigured, busyId, act };
}
