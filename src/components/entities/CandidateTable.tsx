"use client";

import { ThemeClasses } from "@/lib/theme";
import { CandidateRowData } from "./types";
import CandidateRow from "./CandidateRow";
import PaginationFooter from "./PaginationFooter";

const COLUMNS = ["", "Name / type", "Counts", "Contexts", "Co-entities", "Sample titles", "Actions"];

function TableHeader({ t, isAllPageSelected, onToggleSelectAll }: { t: ThemeClasses; isAllPageSelected: boolean; onToggleSelectAll: () => void }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className={t.theadBg}>
        <th className="px-3 py-3">
          <input type="checkbox" checked={isAllPageSelected} onChange={onToggleSelectAll} className="w-4 h-4" aria-label="Select all on page" />
        </th>
        {COLUMNS.slice(1).map((col) => (
          <th key={col} className={`px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${t.theadText}`}>
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

interface CandidateTableProps {
  candidates: CandidateRowData[];
  dark: boolean;
  t: ThemeClasses;
  selected: Set<string>;
  onToggleSelect: (nameNorm: string) => void;
  isAllPageSelected: boolean;
  onToggleSelectAll: () => void;
  getRowType: (nameNorm: string, typeHint: string) => string;
  onTypeChange: (nameNorm: string, type: string) => void;
  busyNorms: Set<string>;
  onAccept: (nameNorm: string, type: string) => void;
  onMerge: (nameNorm: string, mergeInto: string) => void;
  onDismiss: (nameNorm: string) => void;
  offset: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

export default function CandidateTable({
  candidates, dark, t, selected, onToggleSelect, isAllPageSelected, onToggleSelectAll,
  getRowType, onTypeChange, busyNorms, onAccept, onMerge, onDismiss,
  offset, total, hasPrev, hasNext, goPrev, goNext,
}: CandidateTableProps) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <TableHeader t={t} isAllPageSelected={isAllPageSelected} onToggleSelectAll={onToggleSelectAll} />
          <tbody>
            {candidates.map((candidate, idx) => (
              <CandidateRow
                key={candidate.nameNorm}
                candidate={candidate}
                idx={idx}
                dark={dark}
                selected={selected.has(candidate.nameNorm)}
                onToggleSelect={() => onToggleSelect(candidate.nameNorm)}
                rowType={getRowType(candidate.nameNorm, candidate.typeHint)}
                onTypeChange={(type) => onTypeChange(candidate.nameNorm, type)}
                busy={busyNorms.has(candidate.nameNorm)}
                onAccept={(type) => onAccept(candidate.nameNorm, type)}
                onMerge={(mergeInto) => onMerge(candidate.nameNorm, mergeInto)}
                onDismiss={() => onDismiss(candidate.nameNorm)}
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
        offset={offset} count={candidates.length} total={total}
        hasPrev={hasPrev} hasNext={hasNext} goPrev={goPrev} goNext={goNext} dark={dark}
        noun="in review queue"
      />
    </div>
  );
}
