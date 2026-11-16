"use client";

// The smallest reusable equivalent of entities/SegmentedControl.tsx's visual
// pattern. That component is entity-coupled (a hardcoded "tracked"/"queue"
// EntitiesView union and a queueCount prop baked into its second label), so
// rather than fork a near-copy for two differently-named segments, this is
// the same pill styling made generic and data-driven.
interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentBarProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  dark: boolean;
  onChange: (value: T) => void;
}

export default function SegmentBar<T extends string>({ value, options, dark, onChange }: SegmentBarProps<T>) {
  const base = "px-4 py-2 text-sm font-medium rounded-lg transition-colors";
  const active = dark ? "bg-slate-700 text-slate-100" : "bg-white text-gray-900 shadow-sm";
  const inactive = dark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700";
  return (
    <div className={`inline-flex gap-1 p-1 rounded-xl mb-4 ${dark ? "bg-slate-900 border border-slate-800" : "bg-gray-100"}`}>
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)} className={`${base} ${value === opt.value ? active : inactive}`}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
