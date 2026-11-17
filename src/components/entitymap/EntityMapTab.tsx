"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MapFocus } from "@/hooks/useDashboardTable";
import { useEmerging, type EmergingState } from "@/hooks/useEmerging";
import { useReplay } from "@/hooks/useReplay";
import type { EmergingItem } from "@/lib/emerging-types";
import { useEntityMap, type EntityMapState } from "@/hooks/useEntityMap";
import SidePanel from "./SidePanel";
import { noveltyView, type NoveltyOptions } from "./novelty";
import { replayLabel } from "./replay";
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
  return <Loaded dark={dark} data={state.data} generatedAt={load.graph.generatedAt} state={state} />;
}

interface LoadedProps {
  dark: boolean;
  data: MapData;
  generatedAt: string;
  state: EntityMapState;
}

const DEFAULTS: NoveltyOptions = { days: 14, topN: 100, hideFamous: false, hops: 0, hideHubs: true };
const NO_ITEMS: EmergingItem[] = [];

function Loaded({ dark, data, generatedAt, state }: LoadedProps) {
  const [opts, setOpts] = useState<NoveltyOptions>(DEFAULTS);
  const emerging = useEmerging(opts.days);
  const now = useMemo(() => new Date(generatedAt), [generatedAt]);
  const items = emerging.load.status === "ready" ? emerging.visible : NO_ITEMS;
  const view = useMemo(() => noveltyView(data, items, opts, now), [data, items, opts, now]);
  const replay = useReplay(now.getTime(), opts.days);
  const { graph } = view;
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="entity-map">
      <Toolbar opts={opts} onChange={setOpts} followedCount={view.followedCount} replay={replay} updated={updatedAgo(generatedAt)} dark={dark} />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`rounded border ${dark ? "border-slate-700" : "border-gray-200"}`}>
          <Status dark={dark} emerging={emerging} empty={graph.order === 0} />
          {graph.order > 0 && (
            <UniverseGraph
              dark={dark} graph={graph} communities={view.communities} firstSeen={view.firstSeen}
              replayAt={replay.replayAt} selected={state.selected} onSelect={state.select}
            />
          )}
        </div>
        <SidePanel dark={dark} data={data} emerging={emerging} generatedAt={generatedAt} graph={graph} reasons={view.reasons} state={state} />
      </div>
    </div>
  );
}

interface ToolbarProps {
  dark: boolean;
  opts: NoveltyOptions;
  onChange: (opts: NoveltyOptions) => void;
  followedCount: number;
  replay: ReturnType<typeof useReplay>;
  updated: string;
}

const HOPS = { off: 0, "1": 1, "2": 2 } as const;

function Toolbar({ dark, opts, onChange, followedCount, replay, updated }: ToolbarProps) {
  const field = `rounded border px-1 py-0.5 ${dark ? "border-slate-600 bg-slate-900" : "border-gray-300 bg-white"}`;
  const on = opts.topN !== null;
  const running = replay.replayAt !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={on} onChange={(e) => onChange({ ...opts, topN: e.target.checked ? DEFAULTS.topN : null })} data-testid="novelty-on" />
        Novelty
        <input type="range" min={25} max={300} step={25} value={opts.topN ?? 100} disabled={!on} aria-label="Top names shown"
          onChange={(e) => onChange({ ...opts, topN: Number(e.target.value) })} data-testid="novelty-topn" />
        <span className="tabular-nums">{opts.topN ?? "all"}</span>
      </label>
      <label className="inline-flex items-center gap-1.5">Window
        <select className={field} value={opts.days} data-testid="window-days"
          onChange={(e) => onChange({ ...opts, days: Number(e.target.value) as NoveltyOptions["days"] })}>
          <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={opts.hideFamous} onChange={(e) => onChange({ ...opts, hideFamous: e.target.checked })} data-testid="hide-famous" />
        Hide famous
      </label>
      <label className="inline-flex items-center gap-1.5">Near my tracked
        <select className={field} value={String(followedCount === 0 ? "off" : opts.hops || "off")} disabled={followedCount === 0} data-testid="near-tracked"
          onChange={(e) => onChange({ ...opts, hops: HOPS[e.target.value as keyof typeof HOPS] })}>
          <option value="off">Off</option><option value="1">1 hop</option><option value="2">2 hops</option>
        </select>
      </label>
      {followedCount === 0 && <span className={`text-xs ${dark ? "text-slate-400" : "text-gray-500"}`} data-testid="near-tracked-hint">Track entities to use this filter</span>}
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={!opts.hideHubs} onChange={(e) => onChange({ ...opts, hideHubs: !e.target.checked })} data-testid="show-hubs" />
        Show hubs
      </label>
      <span className="inline-flex items-center gap-1.5">
        <button type="button" className="rounded border px-2 py-0.5" onClick={running ? replay.stop : replay.start} data-testid="replay">{running ? "Stop" : "Play"}</button>
        {running && <span className="tabular-nums" data-testid="replay-date">{replayLabel(replay.replayAt!)}</span>}
      </span>
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
