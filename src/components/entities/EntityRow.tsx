"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { EntityPatch, EntityRowData } from "./types";
import { growthChipText, sparklinePoints } from "./growth-format";

interface EntityRowProps {
  row: EntityRowData;
  idx: number;
  dark: boolean;
  busy: boolean;
  selected: boolean;
  onPatch: (id: number, patch: EntityPatch) => void;
  onSelect: (id: number) => void;
  onOpen: (row: EntityRowData) => void;
  onRowClick: (idx: number) => void;
  onRowKeyDown: (e: KeyboardEvent<HTMLTableRowElement>, idx: number) => void;
  rowAltA: string;
  rowAltB: string;
  rowBorder: string;
}

// Inline controls must not also trigger the row (which opens the map).
const stopRow = (e: MouseEvent) => e.stopPropagation();

function WikiIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

// Name opens the evidence panel (spine 2). "Context" is a label only
// (BUILD-GUIDE 6.7 rule 2): nothing is hidden for it.
function NameCell({ row, dark, busy, onSelect }: { row: EntityRowData; dark: boolean; busy: boolean; onSelect: (id: number) => void }) {
  const nameCls = `text-sm font-medium text-left hover:underline disabled:no-underline disabled:cursor-default ${dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600"}`;
  const isContext = row.role === "famous" || row.role === "anchor";
  const tagCls = dark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500";
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={(e) => { stopRow(e); onSelect(row.id); }} disabled={busy} className={nameCls} title="View evidence">
        {row.canonicalName}
      </button>
      {isContext && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tagCls}`} title="Widely known: shown as context, never a card subject">Context</span>}
      {busy && <span className={`text-[10px] italic whitespace-nowrap ${dark ? "text-slate-500" : "text-gray-400"}`}>saving…</span>}
      {row.wikiTitle && (
        <a
          href={`https://en.wikipedia.org/wiki/${encodeURIComponent(row.wikiTitle.replace(/ /g, "_"))}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopRow}
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

// Operator correction of the fame verdict, kept from the previous tab. The
// Developments engine reads it: Established never headlines a card.
function FameControl({ row, busy, onPatch, dark }: { row: EntityRowData; busy: boolean; onPatch: EntityRowProps["onPatch"]; dark: boolean }) {
  const btn = (active: boolean) =>
    `text-[10px] px-1.5 py-0.5 rounded font-medium disabled:opacity-40 ${
      active ? "bg-blue-600 text-white" : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;
  const patch = (e: MouseEvent, value: EntityPatch) => { stopRow(e); onPatch(row.id, value); };
  return (
    <div className="flex items-center gap-1 mt-1">
      <button onClick={(e) => patch(e, { fame: "famous", fameLocked: true })} disabled={busy} className={btn(row.fame === "famous")}
        title={`Marks ${row.canonicalName} as Established and locks it. It appears only as context, never as a card subject. Reversible.`}>
        Established
      </button>
      <button onClick={(e) => patch(e, { fame: "not_famous", fameLocked: true })} disabled={busy} className={btn(row.fame === "not_famous")}
        title={`Marks ${row.canonicalName} as Emerging and locks it. It can headline Developments cards. Reversible.`}>
        Emerging
      </button>
      {row.fameLocked && (
        <button onClick={(e) => patch(e, { fameLocked: false })} disabled={busy} className="text-[10px]"
          title={`Unlocks ${row.canonicalName}. The automatic check may change its status. Reversible.`}>
          🔒 Unlock
        </button>
      )}
    </div>
  );
}

function StatusCell({ row, busy, onPatch }: { row: EntityRowData; busy: boolean; onPatch: EntityRowProps["onPatch"] }) {
  const next = row.status === "tracked" ? "dismissed" : "tracked";
  const label = row.status === "tracked" ? "Dismiss" : "Track";
  const title = row.status === "tracked"
    ? `Dismisses ${row.canonicalName} — stops collecting new mentions. Reversible.`
    : `Tracks ${row.canonicalName} again. Reversible.`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{row.status}</span>
      <button
        onClick={(e) => { stopRow(e); onPatch(row.id, { status: next }); }}
        disabled={busy}
        title={title}
        className="text-[11px] px-2 py-1 rounded-lg font-medium bg-slate-700/20 hover:bg-slate-700/40 disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  );
}

function growthChipClass(state: NonNullable<EntityRowData["growth"]>["state"], dark: boolean): string {
  const classes = {
    New: dark ? "bg-blue-950 text-blue-300" : "bg-blue-50 text-blue-700",
    Rising: dark ? "bg-emerald-950 text-emerald-300" : "bg-emerald-50 text-emerald-700",
    Falling: dark ? "bg-amber-950 text-amber-300" : "bg-amber-50 text-amber-700",
    Steady: dark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500",
    WarmingUp: dark ? "bg-slate-800 text-slate-500 italic" : "bg-gray-100 text-gray-400 italic",
  };
  return classes[state];
}

function GrowthCell({ row, dark }: { row: EntityRowData; dark: boolean }) {
  const growth = row.growth;
  if (!growth) return <span>—</span>;
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] px-2 py-1 rounded-lg font-medium whitespace-nowrap ${growthChipClass(growth.state, dark)}`}>
        {growthChipText(growth)}
      </span>
      <svg width={56} height={16} viewBox="0 0 56 16" aria-label="Mentions per day, last 14 days" role="img" className="overflow-visible">
        <polyline points={sparklinePoints(growth.daily, 56, 16)} fill="none" stroke="currentColor" strokeWidth={1.5} className={dark ? "text-slate-400" : "text-gray-500"} />
      </svg>
    </div>
  );
}

function SourceCell({ row, dark }: { row: EntityRowData; dark: boolean }) {
  const sources = row.sources;
  if (!sources) return <span>—</span>;
  const weak = sources.count <= 1;
  const chipCls = weak
    ? dark ? "bg-amber-950 text-amber-300" : "bg-amber-50 text-amber-700"
    : dark ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-600";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[11px] px-2 py-0.5 rounded-lg font-medium whitespace-nowrap self-start ${chipCls}`}>{sources.label}</span>
      {sources.top.length > 0 && <span className="text-[11px] opacity-60">{sources.top.join(", ")}</span>}
    </div>
  );
}

function ConnectionCell({ row }: { row: EntityRowData }) {
  const nearest = row.nearestTracked ?? [];
  if (nearest.length === 0) return <span>—</span>;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {nearest.map((n) => <span key={n.id}>{n.name} · {n.hops} {n.hops === 1 ? "hop" : "hops"}</span>)}
    </div>
  );
}

export default function EntityRow({ row, idx, dark, busy, selected, onPatch, onSelect, onOpen, onRowClick, onRowKeyDown, rowAltA, rowAltB, rowBorder }: EntityRowProps) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const selectedCls = selected ? "outline outline-1 outline-blue-500" : "";
  return (
    <tr
      tabIndex={selected ? 0 : -1}
      data-entity-id={row.id}
      aria-selected={selected}
      onClick={() => { onRowClick(idx); onOpen(row); }}
      onKeyDown={(e) => onRowKeyDown(e, idx)}
      className={`${idx % 2 === 0 ? rowAltA : rowAltB} ${rowBorder} ${selectedCls} ${busy ? "opacity-50" : ""} transition-opacity cursor-pointer`}
    >
      <td className="px-4 py-2.5"><NameCell row={row} dark={dark} busy={busy} onSelect={onSelect} /></td>
      <td className="px-4 py-2.5">
        <StatusCell row={row} busy={busy} onPatch={onPatch} />
        <FameControl row={row} busy={busy} onPatch={onPatch} dark={dark} />
      </td>
      <td className="px-4 py-2.5"><GrowthCell row={row} dark={dark} /></td>
      <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${muted}`}>{row.mentions7d}</td>
      <td className={`px-4 py-2.5 ${muted}`}><SourceCell row={row} dark={dark} /></td>
      <td className={`px-4 py-2.5 ${muted}`}><ConnectionCell row={row} /></td>
      <td className={`px-4 py-2.5 text-xs ${muted}`} title="Topics are not stored yet">—</td>
    </tr>
  );
}
