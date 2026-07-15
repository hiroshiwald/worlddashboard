"use client";

import { StateFilter, STATE_FILTERS } from "@/hooks/useSignalsTab";

const LABELS: Record<StateFilter, string> = {
  all: "All",
  new: "New",
  seen: "Seen",
  dismissed: "Dismissed",
  promoted: "Promoted",
};

interface StateFilterBarProps {
  counts: Record<StateFilter, number>;
  active: StateFilter;
  dark: boolean;
  onChange: (filter: StateFilter) => void;
}

export default function StateFilterBar({ counts, active, dark, onChange }: StateFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {STATE_FILTERS.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
            active === key
              ? "bg-blue-600 text-white"
              : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {LABELS[key]} ({counts[key]})
        </button>
      ))}
    </div>
  );
}
