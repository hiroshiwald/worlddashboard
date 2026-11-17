"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmergingResponse } from "@/lib/emerging-types";
import { parseEmerging } from "@/components/entitymap/universe";

export type EmergingLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EmergingResponse };

async function fetchEmerging(): Promise<EmergingResponse> {
  const res = await fetch("/api/emerging", { cache: "no-store" });
  if (res.status === 503) throw new Error("The database is not configured yet.");
  if (!res.ok) throw new Error(`Failed to load new names (${res.status})`);
  return parseEmerging(await res.json());
}

export function useEmerging(): { load: EmergingLoad; reload: () => void } {
  const [load, setLoad] = useState<EmergingLoad>({ status: "loading" });
  const reload = useCallback(() => {
    setLoad({ status: "loading" });
    fetchEmerging().then(
      (data) => setLoad({ status: "ready", data }),
      (e: Error) => setLoad({ status: "error", message: e.message }),
    );
  }, []);
  useEffect(reload, [reload]);
  return { load, reload };
}
