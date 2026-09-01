"use client";

export const SEVERITY_FILTERS = ["all", "critical", "warning", "advisory"] as const;
export type SeverityFilter = (typeof SEVERITY_FILTERS)[number];

const LABELS: Record<SeverityFilter, string> = {
  all: "All",
  critical: "Critical",
  warning: "Warning",
  advisory: "Advisory",
};

interface SeverityFilterBarProps {
  active: SeverityFilter;
  dark: boolean;
  onChange: (filter: SeverityFilter) => void;
}

export default function SeverityFilterBar({ active, dark, onChange }: SeverityFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {SEVERITY_FILTERS.map((key) => (
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
