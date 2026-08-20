"use client";

import { ThemeClasses } from "@/lib/theme";
import { EntityPatch, EntityRowData } from "./types";
import EntityRow from "./EntityRow";
import PaginationFooter from "./PaginationFooter";

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

interface EntitiesTableProps {
  entities: EntityRowData[];
  dark: boolean;
  t: ThemeClasses;
  busyIds: Set<number>;
  onPatch: (id: number, patch: EntityPatch) => void;
  onEntitySelect: (id: number) => void;
  offset: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

export default function EntitiesTable({
  entities, dark, t, busyIds, onPatch, onEntitySelect, offset, total, hasPrev, hasNext, goPrev, goNext,
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
                onSelect={onEntitySelect}
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
        noun="entities"
      />
    </div>
  );
}
