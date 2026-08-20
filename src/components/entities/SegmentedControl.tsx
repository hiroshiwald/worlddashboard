"use client";

export type EntitiesView = "tracked" | "queue";

interface SegmentedControlProps {
  view: EntitiesView;
  onChange: (view: EntitiesView) => void;
  queueCount: number;
  dark: boolean;
}

export default function SegmentedControl({ view, onChange, queueCount, dark }: SegmentedControlProps) {
  const base = "px-4 py-2 text-sm font-medium rounded-lg transition-colors";
  const active = dark ? "bg-slate-700 text-slate-100" : "bg-white text-gray-900 shadow-sm";
  const inactive = dark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700";
  return (
    <div className={`inline-flex gap-1 p-1 rounded-xl mb-4 ${dark ? "bg-slate-900 border border-slate-800" : "bg-gray-100"}`}>
      <button onClick={() => onChange("tracked")} className={`${base} ${view === "tracked" ? active : inactive}`}>
        Tracked
      </button>
      <button onClick={() => onChange("queue")} className={`${base} ${view === "queue" ? active : inactive}`}>
        {queueCount > 0 ? `Review queue (${queueCount})` : "Review queue"}
      </button>
    </div>
  );
}
