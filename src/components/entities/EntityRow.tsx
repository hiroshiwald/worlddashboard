"use client";

import { timeAgo } from "@/lib/date-utils";
import { EntityPatch, EntityRowData, ENTITY_TYPES } from "./types";

interface RowCellProps {
  row: EntityRowData;
  busy: boolean;
  onPatch: (id: number, patch: EntityPatch) => void;
}

function NameCell({ row, dark }: { row: EntityRowData; dark: boolean }) {
  const nameCls = `text-sm font-medium ${dark ? "text-slate-100" : "text-gray-900"}`;
  if (!row.wikiTitle) return <span className={nameCls}>{row.canonicalName}</span>;
  const href = `https://en.wikipedia.org/wiki/${encodeURIComponent(row.wikiTitle.replace(/ /g, "_"))}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${nameCls} hover:underline ${dark ? "hover:text-blue-300" : "hover:text-blue-600"}`}
      title="Evidence: the Wikipedia article behind this fame verdict"
    >
      {row.canonicalName}
    </a>
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
  rowAltA: string;
  rowAltB: string;
  rowBorder: string;
  selectBg: string;
}

export default function EntityRow({ row, idx, dark, busy, onPatch, rowAltA, rowAltB, rowBorder, selectBg }: EntityRowProps) {
  return (
    <tr className={`${idx % 2 === 0 ? rowAltA : rowAltB} ${rowBorder}`}>
      <td className="px-4 py-2.5"><NameCell row={row} dark={dark} /></td>
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
