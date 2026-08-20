"use client";

import { EntityStats } from "./types";

interface Tile {
  label: string;
  value: number;
}

function tiles(stats: EntityStats): Tile[] {
  return [
    { label: "Tracked", value: stats.totalTracked },
    { label: "Famous", value: stats.famousCount },
    { label: "Not famous", value: stats.notFamousCount },
    { label: "Unknown", value: stats.unknownCount },
    { label: "Parked", value: stats.parkedCount },
    { label: "Never checked", value: stats.neverCheckedCount },
    { label: "Locked", value: stats.lockedCount },
  ];
}

export default function StatsStrip({ stats, dark }: { stats: EntityStats; dark: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
      {tiles(stats).map((tile) => (
        <div
          key={tile.label}
          className={`rounded-xl border px-3 py-2.5 ${dark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100 shadow-sm"}`}
        >
          <div className={`text-lg font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>{tile.value}</div>
          <div className={`text-[11px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
