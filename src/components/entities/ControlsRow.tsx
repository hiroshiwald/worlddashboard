"use client";

import { ThemeClasses } from "@/lib/theme";
import { StatusFilter, FameFilter, STATUS_FILTERS, FAME_FILTERS, FAME_VERDICT_LABELS } from "./types";

const STATUS_LABELS: Record<StatusFilter, string> = { tracked: "Tracked", dismissed: "Dismissed", all: "All statuses" };
const FAME_LABELS: Record<FameFilter, string> = { all: "All fame", ...FAME_VERDICT_LABELS };

interface ControlsRowProps {
  q: string;
  setQ: (q: string) => void;
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  fame: FameFilter;
  setFame: (f: FameFilter) => void;
  t: ThemeClasses;
}

export default function ControlsRow({ q, setQ, status, setStatus, fame, setFame, t }: ControlsRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search entities..."
        className={`px-3 py-2 text-sm border rounded-lg focus:outline-none flex-1 min-w-[12rem] max-w-sm ${t.searchBg}`}
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as StatusFilter)}
        className={`px-3 py-2 text-sm border rounded-lg focus:outline-none cursor-pointer ${t.selectBg}`}
      >
        {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
      <select
        value={fame}
        onChange={(e) => setFame(e.target.value as FameFilter)}
        title="Established: a widely known name — appears as context, never as a card subject. Emerging: eligible to headline cards."
        className={`px-3 py-2 text-sm border rounded-lg focus:outline-none cursor-pointer ${t.selectBg}`}
      >
        {FAME_FILTERS.map((f) => <option key={f} value={f}>{FAME_LABELS[f]}</option>)}
      </select>
    </div>
  );
}
