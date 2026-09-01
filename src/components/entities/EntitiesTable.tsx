"use client";

import { ThemeClasses } from "@/lib/theme";
import { EntityPatch, EntityRowData, EntitySort, PageSizeOption, PAGE_SIZE_OPTIONS } from "./types";
import EntityRow from "./EntityRow";
import PaginationFooter from "./PaginationFooter";

// The one-line helper text the task asks for lives on the Fame column
// header, right where the Established/Emerging buttons it explains live.
const FAME_HELP = "Established: a widely known name — appears as context, never as a card subject. Emerging: eligible to headline cards.";

// Each sortable header maps to ONE fixed API direction (entity-admin.ts's
// EntitySort) — no toggle/direction cycling. name sorts ascending; the rest
// sort descending (most-recent/most-active first).
const SORT_DIRECTION: Record<EntitySort, "ascending" | "descending"> = {
  name: "ascending",
  first_seen: "descending",
  last_seen: "descending",
  activity: "descending",
};

const PLAIN_COLUMNS = ["Role", "Type", "Status", "Fame"];

function SortableTh({ label, sortKey, activeSort, onSortChange, t }: {
  label: string; sortKey: EntitySort; activeSort: EntitySort; onSortChange: (s: EntitySort) => void; t: ThemeClasses;
}) {
  const isActive = activeSort === sortKey;
  const direction = SORT_DIRECTION[sortKey];
  const activeCls = isActive ? "text-blue-500" : t.theadText;
  return (
    <th
      onClick={() => onSortChange(sortKey)}
      aria-sort={isActive ? direction : "none"}
      title={`Sort by ${label.toLowerCase()}`}
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none ${activeCls}`}
    >
      {label}{isActive && <span className="ml-1">{direction === "ascending" ? "↑" : "↓"}</span>}
    </th>
  );
}

function TableHeader({ t, sort, onSortChange }: { t: ThemeClasses; sort: EntitySort; onSortChange: (s: EntitySort) => void }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className={t.theadBg}>
        <SortableTh label="Name" sortKey="name" activeSort={sort} onSortChange={onSortChange} t={t} />
        {PLAIN_COLUMNS.map((col) => (
          <th
            key={col}
            title={col === "Fame" ? FAME_HELP : undefined}
            className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${t.theadText}`}
          >
            {col}
          </th>
        ))}
        <SortableTh label="Activity (7d)" sortKey="activity" activeSort={sort} onSortChange={onSortChange} t={t} />
        <SortableTh label="Last seen" sortKey="last_seen" activeSort={sort} onSortChange={onSortChange} t={t} />
        <SortableTh label="First seen" sortKey="first_seen" activeSort={sort} onSortChange={onSortChange} t={t} />
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
  pageSize: PageSizeOption;
  onPageSizeChange: (size: PageSizeOption) => void;
  sort: EntitySort;
  onSortChange: (s: EntitySort) => void;
}

export default function EntitiesTable({
  entities, dark, t, busyIds, onPatch, onEntitySelect, offset, total, hasPrev, hasNext, goPrev, goNext,
  pageSize, onPageSizeChange, sort, onSortChange,
}: EntitiesTableProps) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <TableHeader t={t} sort={sort} onSortChange={onSortChange} />
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
        pageSize={pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => onPageSizeChange(size as PageSizeOption)}
      />
    </div>
  );
}
