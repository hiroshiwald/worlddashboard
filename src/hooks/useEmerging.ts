"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmergingItem, EmergingResponse } from "@/lib/emerging-types";
import { nameRequest, parseEmerging, type NameAction } from "@/components/entitymap/universe";
import { sendJson } from "@/hooks/useNewsfeed";

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

/** days: the look-back window, 1..30 (the API rejects anything else). */
export function useEmerging(days = 7) {
  const [load, setLoad] = useState<EmergingLoad>({ status: "loading" });
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoad({ status: "loading" });
    setResolved({});
    fetchEmerging(days).then(
      (data) => setLoad({ status: "ready", data }),
      (e: Error) => setLoad({ status: "error", message: e.message }),
    );
  }, [days]);
  useEffect(reload, [reload]);

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
