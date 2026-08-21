"use client";

// Shared by EntitiesTable and CandidateTable — identical Prev/Next footer,
// just a different noun in the count label. The page-size control is
// opt-in (pageSizeOptions/onPageSizeChange/pageSize all required together)
// so CandidateTable's fixed client-side page keeps its unchanged shape.
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
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (size: number) => void;
}

export default function PaginationFooter({
  offset, count, total, hasPrev, hasNext, goPrev, goNext, dark, noun = "entities",
  pageSize, pageSizeOptions, onPageSizeChange,
}: PaginationFooterProps) {
  const btnCls = `text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${
    dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
  }`;
  const selectCls = `text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
    dark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-gray-50 border-gray-200 text-gray-700"
  }`;
  const showPageSize = pageSizeOptions !== undefined && onPageSizeChange !== undefined && pageSize !== undefined;

  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap">
      <span className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
        {total === 0 ? `0 ${noun}` : `${offset + 1}–${offset + count} of ${total}`}
      </span>
      <div className="flex items-center gap-3">
        {showPageSize && (
          <label className={`flex items-center gap-1.5 text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={selectCls}
              title="Rows per page. Resets to the first page on change."
            >
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <button onClick={goPrev} disabled={!hasPrev} className={btnCls}>Prev</button>
          <button onClick={goNext} disabled={!hasNext} className={btnCls}>Next</button>
        </div>
      </div>
    </div>
  );
}
