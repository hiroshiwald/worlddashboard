"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmergingItem, EmergingResponse } from "@/lib/emerging-types";
import { nameRequest, parseEmerging, type NameAction } from "@/components/entitymap/universe";
import { sendJson } from "@/hooks/useNewsfeed";
import { useSnapshot } from "@/components/SnapshotContext";

export type EmergingLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EmergingResponse };

export type Resolution = "tracked" | "ignored";

async function fetchEmerging(days: number): Promise<EmergingResponse> {
  const res = await fetch(`/api/emerging?days=${days}`, { cache: "no-store" });
  if (res.status === 503) throw new Error("The database is not configured yet.");
  if (!res.ok) throw new Error(`Failed to load new names (${res.status})`);
  return parseEmerging(await res.json());
}

interface EmergingSnapshot { data: EmergingResponse; resolved: Record<string, Resolution> }

/** Pure. True when two responses list the same names; keeping the old object
 * then avoids a graph rebuild on the Entity map. */
export function sameEmerging(a: EmergingResponse, b: EmergingResponse): boolean {
  return a.days === b.days && JSON.stringify(a.items) === JSON.stringify(b.items);
}

/** days: the look-back window, 1..30 (the API rejects anything else). */
export function useEmerging(days = 7) {
  // One slot: the last window shown, with the reader's own Track/Ignore marks.
  const [saved, save] = useSnapshot<EmergingSnapshot>("emerging");
  const start = saved !== undefined && saved.data.days === days ? saved : undefined;
  const [load, setLoad] = useState<EmergingLoad>(() => (start === undefined ? { status: "loading" } : { status: "ready", data: start.data }));
  const [resolved, setResolved] = useState<Record<string, Resolution>>(() => (start === undefined ? {} : start.resolved));
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const shown = useRef(load);
  shown.current = load;

  // A copy for this window stays on screen while the reload runs; see useEntityMap.
  const reload = useCallback(() => {
    setLoad((prev) => (prev.status === "ready" && prev.data.days === days ? prev : { status: "loading" }));
    fetchEmerging(days).then(
      (data) => {
        const prev = shown.current;
        if (prev.status === "ready" && sameEmerging(prev.data, data)) return;
        setResolved({});
        setLoad({ status: "ready", data });
      },
      (e: Error) => {
        const prev = shown.current;
        if (prev.status === "ready" && prev.data.days === days) {
          console.warn("emerging: background reload failed, showing saved data", e);
          return;
        }
        setLoad({ status: "error", message: e.message });
      },
    );
  }, [days]);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (load.status === "ready") save({ data: load.data, resolved });
  }, [load, resolved, save]);

  const resolve = useCallback(async (item: EmergingItem, action: NameAction) => {
    const { method, url, body } = nameRequest(item, action);
    setBusy(item.key);
    setActionError(null);
    try {
      await sendJson(method, url, body);
      setResolved((prev) => ({ ...prev, [item.key]: action === "track" ? "tracked" : "ignored" }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }, []);

  // Names still open: everything loaded minus what was just tracked or ignored.
  const visible = useMemo(
    () => (load.status === "ready" ? load.data.items.filter((i) => resolved[i.key] === undefined) : []),
    [load, resolved],
  );
  return { load, reload, visible, resolved, busy, actionError, resolve };
}

export type EmergingState = ReturnType<typeof useEmerging>;
