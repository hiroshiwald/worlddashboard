"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BriefDevelopment, BriefWarmup } from "./useBriefTab";
import { parseWarmup } from "./useSignalsTab";

export interface DevelopmentDiagnostics {
  draftCount: number;
  eligibleCount: number;
  rejected: Record<string, number>;
}

interface FetchDevelopmentsResult {
  developments: BriefDevelopment[];
  diagnostics: DevelopmentDiagnostics | null;
  warmup: BriefWarmup | null;
}

// Distinguishes "no database configured yet" from a genuine fetch/shape
// failure — same convention as useBriefTab/useSignalsTab.
class DatabaseNotConfiguredError extends Error {}

function parseDiagnostics(raw: unknown): DevelopmentDiagnostics | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.draftCount !== "number" || typeof d.eligibleCount !== "number") return null;
  const rejected = typeof d.rejected === "object" && d.rejected !== null ? (d.rejected as Record<string, number>) : {};
  return { draftCount: d.draftCount, eligibleCount: d.eligibleCount, rejected };
}

async function fetchDevelopments(): Promise<FetchDevelopmentsResult> {
  const res = await fetch("/api/developments", { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load developments (${res.status})`);
  const data = await res.json();
  return {
    developments: Array.isArray(data.developments) ? data.developments : [],
    diagnostics: parseDiagnostics(data.diagnostics),
    warmup: parseWarmup(data.warmup),
  };
}

// Fetches /api/developments once on mount — no polling, no actions. Owns
// the loading/error/dbUnconfigured triad exactly like useBriefTab, and the
// warm-up parsing useSignalsTab already established (reused, not
// reimplemented — the API returns the identical {active, daysRemaining}
// shape).
export function useDevelopmentsTab() {
  const [developments, setDevelopments] = useState<BriefDevelopment[]>([]);
  const [diagnostics, setDiagnostics] = useState<DevelopmentDiagnostics | null>(null);
  const [warmup, setWarmup] = useState<BriefWarmup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const result = await fetchDevelopments();
      if (seq !== loadSeq.current) return;
      setDevelopments(result.developments);
      setDiagnostics(result.diagnostics);
      setWarmup(result.warmup);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load developments");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load();
  }, [load]);

  return { developments, diagnostics, warmup, loading, error, dbUnconfigured };
}
