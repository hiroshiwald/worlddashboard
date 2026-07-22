"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SignalCardData, SignalAction } from "@/components/signals/types";
import { useBusyIds } from "./useBusyIds";

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

export interface BriefMover {
  name: string;
  observed24h: number;
  baselineDaily: number;
  lift: number;
}

export interface BriefWarmup {
  active: boolean;
  daysRemaining: number;
}

export interface BriefDevelopmentEvidence {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string | null;
  firstSeenAt: string;
}

export interface BriefDevelopmentScoreParts {
  novelty: number;
  corroboration: number;
  persistence: number;
  relationStrength: number;
  anchorContext: number;
  penalty: number;
}

export interface BriefDevelopment {
  subjectName: string;
  subjectType: string;
  anchorNames: string[];
  relationOrReason: string;
  whyShown: string;
  label: "observed" | "pattern";
  firstObservedAt: string;
  lastObservedAt: string;
  staleReporting: boolean;
  evidence: BriefDevelopmentEvidence[];
  score: number;
  scoreParts: BriefDevelopmentScoreParts;
}

export interface BriefData {
  generatedAt: string;
  signals: BriefSignal[];
  newEntities: BriefNewEntity[];
  topStories: BriefTopStory[];
  movers: BriefMover[];
  warmup: BriefWarmup;
  developments: BriefDevelopment[];
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
  const { busyIds, withBusy } = useBusyIds();
  const loadSeq = useRef(0);

  // Guards against an in-flight load's response landing after a newer one
  // was started (e.g. a second action's refetch resolving before the
  // first's) and overwriting fresher data with stale data.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const result = await fetchBrief();
      if (seq !== loadSeq.current) return;
      setData(result);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load brief");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  const act = useCallback(
    (id: number, action: SignalAction) =>
      withBusy(id, async () => {
        setError(null);
        try {
          await postSignalAction(id, action);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Action failed");
        }
      }),
    [load, withBusy],
  );

  return { data, loading, error, dbUnconfigured, busyIds, act };
}
