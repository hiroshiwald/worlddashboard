"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MapFocus } from "@/hooks/useDashboardTable";
import { useEmerging, type EmergingState } from "@/hooks/useEmerging";
import { useEntityMap, type EntityMapState } from "@/hooks/useEntityMap";
import SidePanel from "./SidePanel";
import { buildGraph } from "./graph-metrics";
import type { MapData } from "./model";

// sigma needs WebGL, so the view loads in the browser only.
const UniverseGraph = dynamic(() => import("./UniverseGraph"), { ssr: false });

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
  return <Loaded dark={dark} data={state.data} emerging={emerging} generatedAt={load.graph.generatedAt} state={state} />;
}

interface LoadedProps {
  dark: boolean;
  data: MapData;
  emerging: EmergingState;
  generatedAt: string;
  state: EntityMapState;
}

function Loaded({ dark, data, emerging, generatedAt, state }: LoadedProps) {
  const [hideHubs, setHideHubs] = useState(true);
  const graph = useMemo(
    () => buildGraph(data.nodes, data.edges, { hideHubs }, new Date(generatedAt)),
    [data, hideHubs, generatedAt],
  );
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="entity-map">
      <Toolbar hideHubs={hideHubs} onToggle={setHideHubs} updated={updatedAgo(generatedAt)} dark={dark} />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`rounded border ${dark ? "border-slate-700" : "border-gray-200"}`}>
          <Status dark={dark} emerging={emerging} empty={graph.order === 0} />
          {graph.order > 0 && <UniverseGraph dark={dark} graph={graph} selected={state.selected} onSelect={state.select} />}
        </div>
        <SidePanel dark={dark} data={data} emerging={emerging} generatedAt={generatedAt} graph={graph} state={state} />
      </div>
    </div>
  );
}

interface ToolbarProps {
  dark: boolean;
  hideHubs: boolean;
  onToggle: (hide: boolean) => void;
  updated: string;
}

function Toolbar({ dark, hideHubs, onToggle, updated }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={!hideHubs} onChange={(e) => onToggle(!e.target.checked)} data-testid="show-hubs" />
        Show hubs (countries, regions, cities, most-linked)
      </label>
      <span className={`text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>{updated}</span>
    </div>
  );
}

function Status({ dark, emerging, empty }: { dark: boolean; emerging: EmergingState; empty: boolean }) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const { load } = emerging;
  return (
    <div className={`px-3 py-2 text-xs ${muted}`}>
      {load.status === "loading" && <span role="status">Loading new names...</span>}
      {load.status === "error" && (
        <span role="alert" data-testid="universe-error">New names could not be loaded. {load.message}{" "}
          <button type="button" className="underline" onClick={emerging.reload}>Try again</button></span>
      )}
      {load.status === "ready" && emerging.visible.length === 0 && <span data-testid="universe-empty">No new names in the last {load.data.days} days.</span>}
      {empty && <p className="p-1 text-sm">No entities to show yet.</p>}
    </div>
  );
}
