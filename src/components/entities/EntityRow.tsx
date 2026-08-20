"use client";

import { timeAgo } from "@/lib/date-utils";
import { EntityPatch, EntityRowData, ENTITY_TYPES } from "./types";

interface RowCellProps {
  row: EntityRowData;
  busy: boolean;
  onPatch: (id: number, patch: EntityPatch) => void;
}

function WikiIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

// The name opens the evidence panel (Part B, spine 2: evidence one click
// away) — the Wikipedia link (fame verdict evidence) moves to its own small
// icon alongside it rather than sharing the name's click target.
function NameCell({ row, dark, busy, onSelect }: { row: EntityRowData; dark: boolean; busy: boolean; onSelect: (id: number) => void }) {
  const nameCls = `text-sm font-medium text-left hover:underline disabled:no-underline disabled:cursor-default ${dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600"}`;
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onSelect(row.id)} disabled={busy} className={nameCls} title="View evidence">
        {row.canonicalName}
      </button>
      {busy && <span className={`text-[10px] italic whitespace-nowrap ${dark ? "text-slate-500" : "text-gray-400"}`}>saving…</span>}
      {row.wikiTitle && (
        <a
          href={`https://en.wikipedia.org/wiki/${encodeURIComponent(row.wikiTitle.replace(/ /g, "_"))}`}
          target="_blank"
          rel="noopener noreferrer"
          className={dark ? "text-slate-500 hover:text-blue-300" : "text-gray-400 hover:text-blue-600"}
          title="Evidence: the Wikipedia article behind this fame verdict"
          aria-label="Open Wikipedia article"
        >
          <WikiIcon />
        </a>
      )}
    </div>
  );
}

function TypeCell({ row, busy, onPatch, selectBg }: RowCellProps & { selectBg: string }) {
  return (
    <select
      value={row.type}
      disabled={busy}
      onChange={(e) => onPatch(row.id, { type: e.target.value })}
      className={`text-xs px-2 py-1 border rounded-lg disabled:opacity-40 ${selectBg}`}
    >
      {ENTITY_TYPES.map((opt) => <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>)}
    </select>
  );
}

function StatusCell({ row, busy, onPatch }: RowCellProps) {
  const next = row.status === "tracked" ? "dismissed" : "tracked";
  const label = row.status === "tracked" ? "Dismiss" : "Track";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{row.status}</span>
      <button
        onClick={() => onPatch(row.id, { status: next })}
        disabled={busy}
        className="text-[11px] px-2 py-1 rounded-lg font-medium bg-slate-700/20 hover:bg-slate-700/40 disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  );
}

function FameCell({ row, busy, onPatch, dark }: RowCellProps & { dark: boolean }) {
  const btn = (active: boolean) =>
    `text-[11px] px-2 py-1 rounded-lg font-medium disabled:opacity-40 ${
      active ? "bg-blue-600 text-white" : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={() => onPatch(row.id, { fame: "famous", fameLocked: true })} disabled={busy} className={btn(row.fame === "famous")}>Famous</button>
      <button onClick={() => onPatch(row.id, { fame: "not_famous", fameLocked: true })} disabled={busy} className={btn(row.fame === "not_famous")}>Not famous</button>
      {row.fameLocked ? (
        <button onClick={() => onPatch(row.id, { fameLocked: false })} disabled={busy} className="text-[11px]" title="Human-locked — the sweep will not overwrite this">
          🔒 Unlock
        </button>
      ) : (
        <span className="text-[10px] opacity-50">unlocked</span>
      )}
    </div>
  );
}

interface EntityRowProps {
  row: EntityRowData;
  idx: number;
  dark: boolean;
  busy: boolean;
  onPatch: (id: number, patch: EntityPatch) => void;
  onSelect: (id: number) => void;
  rowAltA: string;
  rowAltB: string;
  rowBorder: string;
  selectBg: string;
}

export default function EntityRow({ row, idx, dark, busy, onPatch, onSelect, rowAltA, rowAltB, rowBorder, selectBg }: EntityRowProps) {
  return (
    <tr className={`${idx % 2 === 0 ? rowAltA : rowAltB} ${rowBorder} ${busy ? "opacity-50" : ""} transition-opacity`}>
      <td className="px-4 py-2.5"><NameCell row={row} dark={dark} busy={busy} onSelect={onSelect} /></td>
      <td className="px-4 py-2.5"><TypeCell row={row} busy={busy} onPatch={onPatch} selectBg={selectBg} /></td>
      <td className="px-4 py-2.5"><StatusCell row={row} busy={busy} onPatch={onPatch} /></td>
      <td className="px-4 py-2.5"><FameCell row={row} busy={busy} onPatch={onPatch} dark={dark} /></td>
      <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${dark ? "text-slate-400" : "text-gray-500"}`}>
        {row.fameCheckedAt ? `checked ${timeAgo(row.fameCheckedAt)}` : "never checked"}
      </td>
      <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${dark ? "text-slate-400" : "text-gray-500"}`}>
        {timeAgo(row.firstSeenAt)}
      </td>
    </tr>
  );
}
