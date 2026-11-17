"use client";

import type { MapFocus } from "@/hooks/useDashboardTable";
import { useEmerging } from "@/hooks/useEmerging";
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
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`rounded border ${dark ? "border-slate-700" : "border-gray-200"}`}>
          {state.entityId === null && <MapSvg dark={dark} emerging={emerging} state={state} />}
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
