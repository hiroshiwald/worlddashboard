"use client";

import { ThemeClasses } from "@/lib/theme";
import { EntityPatch, EntityRowData } from "./types";
import EntityRow from "./EntityRow";

const COLUMNS = ["Name", "Type", "Status", "Fame", "Checked", "First seen"];

function TableHeader({ t }: { t: ThemeClasses }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className={t.theadBg}>
        {COLUMNS.map((col) => (
          <th key={col} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${t.theadText}`}>
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function PaginationFooter({
  offset, count, total, hasPrev, hasNext, goPrev, goNext, dark,
}: {
  offset: number; count: number; total: number;
  hasPrev: boolean; hasNext: boolean; goPrev: () => void; goNext: () => void; dark: boolean;
}) {
  const btnCls = `text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${
    dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
  }`;
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
        {total === 0 ? "0 entities" : `${offset + 1}–${offset + count} of ${total}`}
      </span>
      <div className="flex gap-2">
        <button onClick={goPrev} disabled={!hasPrev} className={btnCls}>Prev</button>
        <button onClick={goNext} disabled={!hasNext} className={btnCls}>Next</button>
      </div>
    </div>
  );
}

interface EntitiesTableProps {
  entities: EntityRowData[];
  dark: boolean;
  t: ThemeClasses;
  busyIds: Set<number>;
  onPatch: (id: number, patch: EntityPatch) => void;
  offset: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

export default function EntitiesTable({
  entities, dark, t, busyIds, onPatch, offset, total, hasPrev, hasNext, goPrev, goNext,
}: EntitiesTableProps) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <TableHeader t={t} />
          <tbody>
            {entities.map((row, idx) => (
              <EntityRow
                key={row.id}
                row={row}
                idx={idx}
                dark={dark}
                busy={busyIds.has(row.id)}
                onPatch={onPatch}
                rowAltA={t.rowAltA}
                rowAltB={t.rowAltB}
                rowBorder={t.rowBorder}
                selectBg={t.selectBg}
              />
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter
        offset={offset} count={entities.length} total={total}
        hasPrev={hasPrev} hasNext={hasNext} goPrev={goPrev} goNext={goNext} dark={dark}
      />
    </div>
  );
}
