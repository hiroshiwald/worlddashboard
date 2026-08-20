"use client";

// Shared by EntitiesTable and CandidateTable — identical Prev/Next footer,
// just a different noun in the count label.
interface PaginationFooterProps {
  offset: number;
  count: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  dark: boolean;
  noun?: string;
}

export default function PaginationFooter({
  offset, count, total, hasPrev, hasNext, goPrev, goNext, dark, noun = "entities",
}: PaginationFooterProps) {
  const btnCls = `text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${
    dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
  }`;
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
        {total === 0 ? `0 ${noun}` : `${offset + 1}–${offset + count} of ${total}`}
      </span>
      <div className="flex gap-2">
        <button onClick={goPrev} disabled={!hasPrev} className={btnCls}>Prev</button>
        <button onClick={goNext} disabled={!hasNext} className={btnCls}>Next</button>
      </div>
    </div>
  );
}
