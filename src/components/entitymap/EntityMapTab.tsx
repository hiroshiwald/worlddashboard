"use client";

import type { MapFocus } from "@/hooks/useDashboardTable";
import { useEntityMap, type EntityMapState } from "@/hooks/useEntityMap";
import EntityLevel from "./EntityLevel";
import MapSvg from "./MapSvg";
import SidePanel from "./SidePanel";
import type { MapData } from "./model";

export interface EntityMapTabProps {
  dark: boolean;
  focus: MapFocus;
}

function updatedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.round(minutes / 60)} h ago`;
}

export default function EntityMapTab({ dark, focus }: EntityMapTabProps) {
  const state = useEntityMap(focus);
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const { load } = state;
  if (load.status === "loading") return <p className={`p-4 text-sm ${muted}`} role="status">Loading the entity map...</p>;
  if (load.status === "error") {
    return (
      <div className="p-4 text-sm" role="alert" data-testid="map-error">
        <p>{load.notConfigured ? load.message : `The entity map could not be loaded. ${load.message}`}</p>
        {!load.notConfigured && <button type="button" className="mt-2 rounded border px-2 py-1" onClick={state.reload}>Try again</button>}
      </div>
    );
  }
  if (state.data === null || state.data.nodes.length === 0) {
    return <p className={`p-4 text-sm ${muted}`} data-testid="map-empty">Nothing is new or rising yet, so there is nothing to map.</p>;
  }
  const { graph } = load;
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="entity-map">
      <Toolbar dark={dark} data={state.data} state={state} updated={updatedAgo(graph.generatedAt)} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`rounded border ${dark ? "border-slate-700" : "border-gray-200"}`}>
          {state.entityId === null && <MapSvg dark={dark} data={state.data} generatedAt={graph.generatedAt} state={state} />}
          {state.entityId !== null && <EntityLevel dark={dark} data={state.data} id={state.entityId} state={state} />}
        </div>
        <SidePanel dark={dark} data={state.data} generatedAt={graph.generatedAt} total={graph.stats} state={state} />
      </div>
    </div>
  );
}

function Breadcrumb({ data, state }: { data: MapData; state: EntityMapState }) {
  const scoped = state.scope.map((id) => data.groups.find((g) => g.id === id)).filter((g) => g !== undefined);
  const entity = state.entityId === null ? null : data.byId.get(state.entityId);
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm" data-testid="breadcrumb">
      <button type="button" className="hover:underline" onClick={() => state.goScope([])}>Universe</button>
      {scoped.map((g) => (
        <span key={g!.id}>
          {" › "}
          <button type="button" className="hover:underline" onClick={() => state.goScope(state.scope)}>{g!.label}</button>
          <button type="button" className="ml-1" aria-label={`Remove ${g!.label}`} onClick={() => state.goScope(state.scope.filter((x) => x !== g!.id))}>×</button>
        </span>
      ))}
      {entity && <span>{" › "}<strong>{entity.name}</strong></span>}
    </nav>
  );
}

function Toolbar({ dark, data, state, updated }: { dark: boolean; data: MapData; state: EntityMapState; updated: string }) {
  const btn = `rounded border px-2 py-1 text-sm ${dark ? "border-slate-600 hover:bg-slate-800" : "border-gray-300 hover:bg-gray-50"}`;
  const on = dark ? "bg-slate-700" : "bg-gray-200";
  const atUniverse = state.entityId === null && state.scope.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Breadcrumb data={data} state={state} />
      <span className={`text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>{updated}</span>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {atUniverse && (
          <>
            <button type="button" className={btn} onClick={state.openAll}>Open all</button>
            <button type="button" className={btn} onClick={state.closeAll}>Close all</button>
            <div role="group" aria-label="Context entities" className="flex">
              <button type="button" aria-pressed={state.anchors} className={`${btn} ${state.anchors ? on : ""}`} onClick={() => state.setAnchors(true)}>With context</button>
              <button type="button" aria-pressed={!state.anchors} className={`${btn} ${state.anchors ? "" : on}`} onClick={() => state.setAnchors(false)}>Without context</button>
            </div>
          </>
        )}
        {state.entityId === null && <button type="button" className={btn} onClick={state.resetLayout}>Reset layout</button>}
        {!atUniverse && <button type="button" className={btn} onClick={state.up}>Up one level (Esc)</button>}
      </div>
    </div>
  );
}
