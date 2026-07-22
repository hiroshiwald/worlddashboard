"use client";

import { BriefMover, BriefWarmup } from "@/hooks/useBriefTab";

interface BriefMoversSectionProps {
  movers: BriefMover[];
  warmup: BriefWarmup;
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// BriefDevelopmentsSection (rendered first in BriefTab) owns the single
// warm-up line — this section stays silent during warm-up instead of
// duplicating it.
export default function BriefMoversSection({ movers, warmup, dark, onEntityClick }: BriefMoversSectionProps) {
  if (warmup.active) return null;
  if (movers.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        Unusually active
      </h3>
      <div className="flex flex-wrap gap-2">
        {movers.map((mover) => (
          <button
            key={mover.name}
            onClick={() => onEntityClick(mover.name)}
            className={`text-xs px-3 py-1.5 rounded-full border ${dark ? "bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
          >
            <span className="font-semibold">{mover.name}</span>
            <span className={dark ? "text-slate-500" : "text-gray-400"}> ×{mover.lift.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
