"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ThemeClasses } from "@/lib/theme";
import { EntityPatch, EntityRowData, EntitySort, PageSizeOption, PAGE_SIZE_OPTIONS } from "./types";
import EntityRow from "./EntityRow";
import PaginationFooter from "./PaginationFooter";
import { nextRowIndex } from "./growth-format";

// Each sortable header maps to ONE fixed API direction — no toggle. Name
// sorts ascending; the rest sort descending (biggest first).
const SORT_DIRECTION: Record<EntitySort, "ascending" | "descending"> = {
  name: "ascending",
  growth: "descending",
  mentions: "descending",
  diversity: "descending",
};

function SortableTh({ label, sortKey, activeSort, onSortChange, t }: {
  label: string; sortKey: EntitySort; activeSort: EntitySort; onSortChange: (s: EntitySort) => void; t: ThemeClasses;
}) {
  const isActive = activeSort === sortKey;
  const direction = SORT_DIRECTION[sortKey];
  const activeCls = isActive ? "text-blue-500" : t.theadText;
  return (
    <th aria-sort={isActive ? direction : "none"} className="px-4 py-3 text-left whitespace-nowrap">
      <button
        onClick={() => onSortChange(sortKey)}
        title={`Sort by ${label.toLowerCase()}`}
        className={`text-xs font-semibold uppercase tracking-wider select-none ${activeCls}`}
      >
        {label}{isActive && <span className="ml-1">{direction === "ascending" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function PlainTh({ label, t }: { label: string; t: ThemeClasses }) {
  return <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${t.theadText}`}>{label}</th>;
}

function TableHeader({ t, sort, onSortChange }: { t: ThemeClasses; sort: EntitySort; onSortChange: (s: EntitySort) => void }) {
  const sortable = (label: string, key: EntitySort) => (
    <SortableTh label={label} sortKey={key} activeSort={sort} onSortChange={onSortChange} t={t} />
  );
  return (
    <thead className="sticky top-0 z-10">
      <tr className={t.theadBg}>
        {sortable("Entity", "name")}
        <PlainTh label="Status" t={t} />
        {sortable("Growth", "growth")}
        {sortable("Mentions", "mentions")}
        {sortable("Source", "diversity")}
        <PlainTh label="Connection to what you track" t={t} />
        <PlainTh label="Topics" t={t} />
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
  onOpenMap: (id: number) => void;
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
  entities, dark, t, busyIds, onPatch, onEntitySelect, onOpenMap, offset, total, hasPrev, hasNext, goPrev, goNext,
  pageSize, onPageSizeChange, sort, onSortChange,
}: EntitiesTableProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const activeIdx = Math.min(selectedIdx, entities.length - 1);

  // Arrows move selection and focus; Enter opens the map, but only when the
  // row itself has focus (Enter on an inline button must not).
  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, idx: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      onOpenMap(entities[idx].id);
      return;
    }
    const next = nextRowIndex(idx, e.key, entities.length);
    if (next === null) return;
    e.preventDefault();
    setSelectedIdx(next);
    tbodyRef.current?.querySelectorAll<HTMLElement>("tr")[next]?.focus();
  };

  return (
    <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <TableHeader t={t} sort={sort} onSortChange={onSortChange} />
          <tbody ref={tbodyRef}>
            {entities.map((row, idx) => (
              <EntityRow
                key={row.id}
                row={row}
                idx={idx}
                dark={dark}
                busy={busyIds.has(row.id)}
                onPatch={onPatch}
                selected={idx === activeIdx}
                onSelect={onEntitySelect}
                onOpen={(r) => onOpenMap(r.id)}
                onRowClick={setSelectedIdx}
                onRowKeyDown={onRowKeyDown}
                rowAltA={t.rowAltA}
                rowAltB={t.rowAltB}
                rowBorder={t.rowBorder}
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
