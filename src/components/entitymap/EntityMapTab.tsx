"use client";

import { useMemo } from "react";
import type { MapFocus } from "@/hooks/useDashboardTable";
import { useEmerging, type EmergingState } from "@/hooks/useEmerging";
import { useEntityMap, type EntityMapState } from "@/hooks/useEntityMap";
import EntityLevel from "./EntityLevel";
import UniverseGraph from "./UniverseGraph";
import SidePanel from "./SidePanel";
import { buildUniverse } from "./forcegraph";
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
  const emerging = useEmerging();
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
  if (state.data === null) return null;
  const { graph } = load;
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="entity-map">
      <Toolbar dark={dark} data={state.data} state={state} updated={updatedAgo(graph.generatedAt)} />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`rounded border ${dark ? "border-slate-700" : "border-gray-200"}`}>
          {state.entityId === null && <Universe dark={dark} data={state.data} emerging={emerging} state={state} />}
          {state.entityId !== null && <EntityLevel dark={dark} data={state.data} id={state.entityId} state={state} />}
        </div>
        <SidePanel dark={dark} data={state.data} emerging={emerging} generatedAt={graph.generatedAt} state={state} />
      </div>
    </div>
  );
}

function Toolbar({ dark, data, state, updated }: { dark: boolean; data: MapData; state: EntityMapState; updated: string }) {
  const btn = `rounded border px-2 py-1 text-sm ${dark ? "border-slate-600 hover:bg-slate-800" : "border-gray-300 hover:bg-gray-50"}`;
  const entity = state.entityId === null ? null : data.byId.get(state.entityId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm" data-testid="breadcrumb">
        <button type="button" className="hover:underline" onClick={state.up}>Universe</button>
        {entity && <span>{" › "}<strong>{entity.name}</strong></span>}
      </nav>
      <span className={`text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>{updated}</span>
      {state.entityId !== null && <button type="button" className={`ml-auto ${btn}`} onClick={state.up}>Up one level (Esc)</button>}
    </div>
  );
}

function Universe({ dark, data, emerging, state }: { dark: boolean; data: MapData; emerging: EmergingState; state: EntityMapState }) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const universe = useMemo(() => buildUniverse(data.nodes, data.edges, emerging.visible), [data, emerging.visible]);
  const { load } = emerging;
  return (
    <div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs ${muted}`}>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-500" />New name</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />Known entity, sized by mentions in 14 days</span>
        {load.status === "loading" && <span role="status">Loading new names...</span>}
        {load.status === "error" && (
          <span role="alert" data-testid="universe-error">New names could not be loaded. {load.message}{" "}
            <button type="button" className="underline" onClick={emerging.reload}>Try again</button></span>
        )}
        {load.status === "ready" && emerging.visible.length === 0 && <span data-testid="universe-empty">No new names in the last {load.data.days} days.</span>}
      </div>
      {universe.nodes.length === 0 && <p className={`p-4 text-sm ${muted}`}>No entities to show yet.</p>}
      {universe.nodes.length > 0 && <UniverseGraph dark={dark} universe={universe} selected={state.selected} onSelect={state.select} />}
    </div>
  );
}
