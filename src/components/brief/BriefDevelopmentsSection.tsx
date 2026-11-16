"use client";

import { BriefDevelopment, BriefWarmup } from "@/hooks/useBriefTab";
import DevelopmentCard from "@/components/developments/DevelopmentCard";

interface BriefDevelopmentsSectionProps {
  developments: BriefDevelopment[];
  warmup: BriefWarmup;
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// Unlike BriefMoversSection, the header always renders here: the spec calls
// for "section header plus" the warm-up line, and an honest zero-card state
// that must not hide the section (DESIGN.md spine #4). The card itself is
// DevelopmentCard, shared with the Developments tab (Phase 2b) — this file
// now owns only the section-level header/warmup/empty states and the grid.
export default function BriefDevelopmentsSection({ developments, warmup, dark, onEntityClick }: BriefDevelopmentsSectionProps) {
  const warmupDays = Math.ceil(warmup.daysRemaining);
  return (
    <div className="mb-6">
      <div className="mb-2">
        <h3 className={`text-xs font-bold uppercase tracking-wide ${dark ? "text-slate-400" : "text-gray-500"}`}>
          Developments{developments.length > 0 ? ` · ${developments.length}` : ""}
        </h3>
        {developments.length > 0 && (
          <p className={`text-[11px] mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>Ranked by score</p>
        )}
      </div>
      {warmup.active ? (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
          Signal engine warming up — {warmupDays} {warmupDays === 1 ? "day" : "days"} of baseline remaining.
        </p>
      ) : developments.length === 0 ? (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>
          No qualifying developments in the last 14 days.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {developments.map((card) => (
            <DevelopmentCard key={`${card.subjectName}-${card.firstObservedAt}`} card={card} dark={dark} onEntityClick={onEntityClick} />
          ))}
        </ul>
      )}
    </div>
  );
}
