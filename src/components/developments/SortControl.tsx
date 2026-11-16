"use client";

export const SORT_OPTIONS = ["score", "newest"] as const;
export type DevelopmentSort = (typeof SORT_OPTIONS)[number];

const LABELS: Record<DevelopmentSort, string> = { score: "Score", newest: "Newest" };

interface SortControlProps {
  active: DevelopmentSort;
  dark: boolean;
  onChange: (sort: DevelopmentSort) => void;
}

export default function SortControl({ active, dark, onChange }: SortControlProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>Sort</span>
      {SORT_OPTIONS.map((key) => (
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
