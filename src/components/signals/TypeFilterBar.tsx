"use client";

export const TYPE_FILTERS = ["all", "surge", "sentiment", "cross_category", "first_seen", "novel_edge"] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

function label(type: TypeFilter): string {
  return type === "all" ? "All" : type.replace(/_/g, " ");
}

interface TypeFilterBarProps {
  active: TypeFilter;
  dark: boolean;
  onChange: (filter: TypeFilter) => void;
}

export default function TypeFilterBar({ active, dark, onChange }: TypeFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {TYPE_FILTERS.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium capitalize transition-colors ${
            active === key
              ? "bg-blue-600 text-white"
              : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {label(key)}
        </button>
      ))}
    </div>
  );
}
