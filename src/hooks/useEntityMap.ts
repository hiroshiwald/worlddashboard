"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapFocus } from "@/hooks/useDashboardTable";
import type { GraphResponse } from "@/lib/server/graph";
import {
  buildMapData, filterGraph, parseGraph, traceConnection,
  type MapData, type Sel, type TraceResult,
} from "@/components/entitymap/model";

export interface Offset { dx: number; dy: number }

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

function focusEntityId(focus: MapFocus): string[] {
  return focus !== null && focus.kind === "entity" ? [focus.id] : [];
}

export function useEntityMap(focus: MapFocus) {
  const [load, setLoad] = useState<GraphLoad>({ status: "loading" });
  const [open, setOpen] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [off, setOff] = useState<Record<string, Offset>>({});
  const [anchors, setAnchors] = useState(true);
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

  const forced = focusEntityId(focus).join(",");
  const data: MapData | null = useMemo(() => {
    if (load.status !== "ready") return null;
    const { nodes, edges } = filterGraph(load.graph.nodes, load.graph.edges, forced === "" ? [] : [forced]);
    return buildMapData(nodes, edges, load.graph.clusters);
  }, [load, forced]);

  useEffect(() => {
    if (data === null || focus === null) return;
    if (focus.kind === "entity" && data.byId.has(focus.id)) setEntityId(focus.id);
    if (focus.kind === "topic" && data.groups.some((g) => g.id === focus.id)) setScope([focus.id]);
    setSel(null);
  }, [data, focus]);

  const trace: TraceResult = useMemo(
    () => (data === null ? { kind: "none" } : traceConnection(data, from, to)),
    [data, from, to],
  );
  const pathIds = useMemo(() => (trace.kind === "path" ? trace.path : []), [trace]);

  const up = useCallback(() => {
    if (entityId !== null) setEntityId(null);
    else if (scope.length > 0) setScope([]);
    else setSel(null);
  }, [entityId, scope]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") up();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up]);

  const openGroup = useCallback((id: string) => setOpen((o) => (o.includes(id) ? o : [...o, id])), []);
  const closeGroup = useCallback((id: string) => setOpen((o) => o.filter((x) => x !== id)), []);
  const openAll = useCallback(() => {
    if (data !== null) setOpen(data.groups.map((g) => g.id));
  }, [data]);
  const goEntity = useCallback((id: string) => { setEntityId(id); setSel(null); }, []);
  const goScope = useCallback((ids: string[]) => { setEntityId(null); setScope(ids); setSel(null); }, []);
  const moveBy = useCallback((key: string, o: Offset) => setOff((p) => ({ ...p, [key]: o })), []);

  return {
    load, reload, data, open, scope, entityId, sel, off, anchors, from, to, trace, pathIds,
    setSel, setAnchors, setFrom, setTo, openGroup, closeGroup, openAll, goEntity, goScope, up, moveBy,
    closeAll: () => setOpen([]),
    resetLayout: () => setOff({}),
  };
}

export type EntityMapState = ReturnType<typeof useEntityMap>;
