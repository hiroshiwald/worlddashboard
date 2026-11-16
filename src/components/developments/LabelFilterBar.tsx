"use client";

export const LABEL_FILTERS = ["all", "observed", "pattern"] as const;
export type LabelFilter = (typeof LABEL_FILTERS)[number];

const LABELS: Record<LabelFilter, string> = { all: "All", observed: "Observed", pattern: "Pattern" };

interface LabelFilterBarProps {
  active: LabelFilter;
  dark: boolean;
  onChange: (filter: LabelFilter) => void;
}

export default function LabelFilterBar({ active, dark, onChange }: LabelFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {LABEL_FILTERS.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
            active === key
              ? "bg-blue-600 text-white"
              : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
