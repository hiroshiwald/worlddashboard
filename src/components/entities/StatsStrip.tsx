"use client";

import { EntityStats, StatusFilter, FameFilter } from "./types";

interface StatsStripProps {
  stats: EntityStats;
  dark: boolean;
  status: StatusFilter;
  fame: FameFilter;
  setStatus: (s: StatusFilter) => void;
  setFame: (f: FameFilter) => void;
}

interface ClickableTile {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}

interface StaticTile {
  label: string;
  value: number;
}

// Tracked toggles the tab's default "tracked only" view on/off; the other
// three toggle a fame bucket. Clicking an already-active tile clears it
// back to "all" — DESIGN.md spine 3 (zero configuration): this is
// navigation over the data the operator already sees, not a new setting.
function buildClickableTiles(
  stats: EntityStats, status: StatusFilter, fame: FameFilter,
  setStatus: (s: StatusFilter) => void, setFame: (f: FameFilter) => void,
): ClickableTile[] {
  const trackedActive = status === "tracked" && fame === "all";
  const fameTile = (label: string, value: number, target: FameFilter): ClickableTile => {
    const active = fame === target;
    return { label, value, active, onClick: () => setFame(active ? "all" : target) };
  };
  return [
    {
      label: "Tracked", value: stats.totalTracked, active: trackedActive,
      onClick: () => { setStatus(trackedActive ? "all" : "tracked"); setFame("all"); },
    },
    fameTile("Established", stats.famousCount, "famous"),
    fameTile("Emerging", stats.notFamousCount, "not_famous"),
    fameTile("Unchecked", stats.unknownCount, "unknown"),
  ];
}

export default function StatsStrip({ stats, dark, status, fame, setStatus, setFame }: StatsStripProps) {
  const clickable = buildClickableTiles(stats, status, fame, setStatus, setFame);
  // Parked/Never checked/Locked stay static: the API has no query param for
  // "checked but inconclusive" vs "never checked" vs fame_locked, and adding
  // one would be a server change — out of scope for this PR (scope guard:
  // client only; omit rather than invent server logic).
  const staticTiles: StaticTile[] = [
    { label: "Parked", value: stats.parkedCount },
    { label: "Never checked", value: stats.neverCheckedCount },
    { label: "Locked", value: stats.lockedCount },
  ];

  const idleCls = dark ? "bg-slate-900 border-slate-800 hover:border-slate-700" : "bg-white border-gray-100 shadow-sm hover:border-gray-200";
  const activeCls = dark ? "bg-blue-950 border-blue-600" : "bg-blue-50 border-blue-300";
  const valueCls = dark ? "text-slate-100" : "text-gray-900";
  const labelCls = dark ? "text-slate-500" : "text-gray-400";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
      {clickable.map((tile) => (
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
      {staticTiles.map((tile) => (
        <div key={tile.label} className={`rounded-xl border px-3 py-2.5 ${idleCls}`}>
          <div className={`text-lg font-semibold ${valueCls}`}>{tile.value}</div>
          <div className={`text-[11px] uppercase tracking-wide ${labelCls}`}>{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
