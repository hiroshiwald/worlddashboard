"use client";

import { EntityStats, StatusFilter, FameFilter, FameCheckedFilter } from "./types";

interface StatsStripProps {
  stats: EntityStats;
  dark: boolean;
  status: StatusFilter;
  fame: FameFilter;
  fameChecked: FameCheckedFilter;
  fameLocked: boolean;
  setStatus: (s: StatusFilter) => void;
  setFame: (f: FameFilter) => void;
  setFameChecked: (f: FameCheckedFilter) => void;
  setFameLocked: (v: boolean) => void;
}

interface Tile {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}

// Every tile shares one "fame layer" (fame/fameChecked/fameLocked) that is
// mutually exclusive by construction: activating any tile always clears the
// other two dimensions of that layer, so at most one tile is ever active —
// same contract the four original clickable tiles already had, now
// extended to all seven (TABS-REDESIGN-PLAN.md §6 Phase 3b item 3).
// Parked/Never-checked/Locked additionally force status="tracked" because
// their counts (loadEntityStats) are themselves defined only over tracked
// entities — clicking them must show exactly what the tile's own number
// means, not a mix that includes dismissed rows.
function buildTiles(
  stats: EntityStats, status: StatusFilter, fame: FameFilter, fameChecked: FameCheckedFilter, fameLocked: boolean,
  setStatus: (s: StatusFilter) => void, setFame: (f: FameFilter) => void,
  setFameChecked: (f: FameCheckedFilter) => void, setFameLocked: (v: boolean) => void,
): Tile[] {
  const clearFameLayer = () => { setFame("all"); setFameChecked("all"); setFameLocked(false); };
  const trackedActive = status === "tracked" && fame === "all" && fameChecked === "all" && !fameLocked;
  const fameTile = (label: string, value: number, target: FameFilter): Tile => {
    const active = fame === target;
    const onClick = () => {
      clearFameLayer();
      if (!active) setFame(target);
    };
    return { label, value, active, onClick };
  };
  return [
    {
      label: "Tracked", value: stats.totalTracked, active: trackedActive,
      onClick: () => { setStatus(trackedActive ? "all" : "tracked"); clearFameLayer(); },
    },
    fameTile("Established", stats.famousCount, "famous"),
    fameTile("Emerging", stats.notFamousCount, "not_famous"),
    fameTile("Unchecked", stats.unknownCount, "unknown"),
    {
      label: "Parked", value: stats.parkedCount, active: fame === "unknown" && fameChecked === "checked",
      onClick: () => {
        if (fame === "unknown" && fameChecked === "checked") { clearFameLayer(); return; }
        setStatus("tracked"); setFame("unknown"); setFameChecked("checked"); setFameLocked(false);
      },
    },
    {
      label: "Never checked", value: stats.neverCheckedCount, active: fameChecked === "never",
      onClick: () => {
        if (fameChecked === "never") { setFameChecked("all"); return; }
        setStatus("tracked"); setFame("all"); setFameChecked("never"); setFameLocked(false);
      },
    },
    {
      label: "Locked", value: stats.lockedCount, active: fameLocked,
      onClick: () => {
        if (fameLocked) { setFameLocked(false); return; }
        setStatus("tracked"); setFame("all"); setFameChecked("all"); setFameLocked(true);
      },
    },
  ];
}

export default function StatsStrip({ stats, dark, status, fame, fameChecked, fameLocked, setStatus, setFame, setFameChecked, setFameLocked }: StatsStripProps) {
  const tiles = buildTiles(stats, status, fame, fameChecked, fameLocked, setStatus, setFame, setFameChecked, setFameLocked);

  const idleCls = dark ? "bg-slate-900 border-slate-800 hover:border-slate-700" : "bg-white border-gray-100 shadow-sm hover:border-gray-200";
  const activeCls = dark ? "bg-blue-950 border-blue-600" : "bg-blue-50 border-blue-300";
  const valueCls = dark ? "text-slate-100" : "text-gray-900";
  const labelCls = dark ? "text-slate-500" : "text-gray-400";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
      {tiles.map((tile) => (
        <button
          key={tile.label}
          type="button"
          onClick={tile.onClick}
          aria-pressed={tile.active}
          title={`Filter the table to ${tile.label}.${tile.active ? " Click again to clear." : ""}`}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${tile.active ? activeCls : idleCls}`}
        >
          <div className={`text-lg font-semibold ${valueCls}`}>{tile.value}</div>
          <div className={`text-[11px] uppercase tracking-wide ${labelCls}`}>{tile.label}</div>
        </button>
      ))}
    </div>
  );
}
