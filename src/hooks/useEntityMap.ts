"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapFocus } from "@/hooks/useDashboardTable";
import type { GraphResponse } from "@/lib/server/graph";
import {
  buildMapData, liveGraph, parseGraph, traceConnection,
  type MapData, type TraceResult,
} from "@/components/entitymap/model";

export type GraphLoad =
  | { status: "loading" }
  | { status: "error"; message: string; notConfigured: boolean }
  | { status: "ready"; graph: GraphResponse };

async function fetchGraph(): Promise<GraphResponse> {
  const res = await fetch("/api/graph", { cache: "no-store" });
  if (res.status === 503) throw new Error("The database is not configured yet.");
  if (!res.ok) throw new Error(`Failed to load the entity graph (${res.status})`);
  return parseGraph(await res.json());
}

export interface EvidenceArticle { id: number; title: string; link: string; sourceName: string }
export type Evidence = { status: "loading" } | { status: "error" } | { status: "ready"; articles: EvidenceArticle[] };

/** Recent articles for one entity, from the existing entity detail endpoint. */
export function useEntityArticles(id: string | null): Evidence | null {
  const [state, setState] = useState<{ id: string; ev: Evidence } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    setState({ id, ev: { status: "loading" } });
    fetch(`/api/entities/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((body) => {
        if (!Array.isArray(body.articles)) throw new Error("bad shape");
        if (live) setState({ id, ev: { status: "ready", articles: body.articles.slice(0, 5) } });
      })
      .catch(() => {
        if (live) setState({ id, ev: { status: "error" } });
      });
    return () => {
      live = false;
    };
  }, [id]);
  if (id === null || state === null || state.id !== id) return null;
  return state.ev;
}

export function useEntityMap(focus: MapFocus) {
  const [load, setLoad] = useState<GraphLoad>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null); // clicked Universe node: entity id or EmergingItem key
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const reload = useCallback(() => {
    setLoad({ status: "loading" });
    fetchGraph().then(
      (graph) => setLoad({ status: "ready", graph }),
      (e: Error) => setLoad({ status: "error", message: e.message, notConfigured: /not configured/.test(e.message) }),
    );
  }, []);
  useEffect(reload, [reload]);

  const data: MapData | null = useMemo(() => {
    if (load.status !== "ready") return null;
    const { nodes, edges } = liveGraph(load.graph.nodes, load.graph.edges);
    return buildMapData(nodes, edges);
  }, [load]);

  useEffect(() => {
    if (data === null || focus === null) return;
    setSelected(focus.kind === "entity" && data.byId.has(focus.id) ? focus.id : null);
  }, [data, focus]);

  const trace: TraceResult = useMemo(
    () => (data === null ? { kind: "none" } : traceConnection(data, from, to)),
    [data, from, to],
  );

  const up = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") up();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up]);

  return { load, reload, data, selected, from, to, trace, select: setSelected, setFrom, setTo, up };
}

export type EntityMapState = ReturnType<typeof useEntityMap>;
