"use client";

import { useState, useEffect } from "react";
import type { MergeGroupData } from "@/components/entities/types";

const REASONS = new Set(["alias", "wiki", "alias+wiki"]);

function isGroup(value: unknown): value is MergeGroupData {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Partial<MergeGroupData>;
  return (
    typeof g.canonical?.name === "string" &&
    Array.isArray(g.members) &&
    typeof g.reason === "string" &&
    REASONS.has(g.reason)
  );
}

/** Validates the /api/entities/merges body at the module boundary. Throws on a wrong shape. */
export function parseMergeGroups(body: unknown): MergeGroupData[] {
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups) || !groups.every(isGroup)) {
    throw new Error("Unexpected merge suggestions response");
  }
  return groups;
}

export interface MergeSuggestionsState {
  groups: MergeGroupData[];
  loading: boolean;
  error: string | null;
  dbUnconfigured: boolean;
}

const IDLE: MergeSuggestionsState = { groups: [], loading: false, error: null, dbUnconfigured: false };

// Fetched only while `enabled` (the segment is open). Read-only: no merge endpoint exists.
export function useMergeSuggestions(enabled: boolean): MergeSuggestionsState {
  const [state, setState] = useState<MergeSuggestionsState>(IDLE);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      setState({ ...IDLE, loading: true });
      try {
        const res = await fetch("/api/entities/merges", { cache: "no-store" });
        if (res.status === 503) {
          if (!cancelled) setState({ ...IDLE, dbUnconfigured: true });
          return;
        }
        if (!res.ok) throw new Error(`Failed to load merge suggestions (${res.status})`);
        const groups = parseMergeGroups(await res.json());
        if (!cancelled) setState({ ...IDLE, groups });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Failed to load merge suggestions";
        if (!cancelled) setState({ ...IDLE, error });
      }
    }
    // Detached on purpose: load() catches everything and reports through state.
    load();
    return () => { cancelled = true; };
  }, [enabled]);

  return state;
}
