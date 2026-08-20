"use client";

import { useState } from "react";
import { CandidateRowData, ENTITY_TYPES } from "./types";
import SampleTitleLink from "./SampleTitleLink";

function SelectCell({ selected, busy, onToggle }: { selected: boolean; busy: boolean; onToggle: () => void }) {
  return <input type="checkbox" checked={selected} disabled={busy} onChange={onToggle} className="w-4 h-4" />;
}

function NameTypeCell({
  candidate, rowType, busy, onTypeChange, selectBg, dark,
}: { candidate: CandidateRowData; rowType: string; busy: boolean; onTypeChange: (type: string) => void; selectBg: string; dark: boolean }) {
  return (
    <div className="min-w-[10rem]">
      <div className={`text-sm font-medium ${dark ? "text-slate-100" : "text-gray-900"}`}>{candidate.displayName}</div>
      <select
        value={rowType}
        disabled={busy}
        onChange={(e) => onTypeChange(e.target.value)}
        className={`mt-1 text-xs px-2 py-1 border rounded-lg disabled:opacity-40 ${selectBg}`}
      >
        {ENTITY_TYPES.map((opt) => <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>)}
      </select>
    </div>
  );
}

function CountsCell({ candidate, dark }: { candidate: CandidateRowData; dark: boolean }) {
  return (
    <span className={`text-xs whitespace-nowrap ${dark ? "text-slate-400" : "text-gray-500"}`}>
      {candidate.mentionCount} mentions &middot; {candidate.sourceCount} sources &middot; {candidate.dayCount} days
    </span>
  );
}

function ContextsCell({ contexts, dark }: { contexts: string[]; dark: boolean }) {
  if (contexts.length === 0) return null;
  return <p className={`text-xs italic max-w-[14rem] ${dark ? "text-slate-400" : "text-gray-500"}`}>{contexts.join(" · ")}</p>;
}

function CoEntitiesCell({ coEntities, dark }: { coEntities: string[]; dark: boolean }) {
  if (coEntities.length === 0) return null;
  return <p className={`text-xs max-w-[12rem] ${dark ? "text-slate-500" : "text-gray-400"}`}>{coEntities.join(", ")}</p>;
}

function TitlesCell({ titles, dark }: { titles: string[]; dark: boolean }) {
  return (
    <ul className="text-xs space-y-0.5 max-w-[14rem]">
      {titles.map((title) => <li key={title}><SampleTitleLink title={title} dark={dark} /></li>)}
    </ul>
  );
}

function ActionsCell({
  candidate, rowType, busy, dark, onAccept, onMerge, onDismiss,
}: { candidate: CandidateRowData; rowType: string; busy: boolean; dark: boolean; onAccept: () => void; onMerge: (mergeInto: string) => void; onDismiss: () => void }) {
  const [mergeTarget, setMergeTarget] = useState("");
  const inputBg = dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-200 text-gray-900";
  return (
    <div className="flex flex-col gap-1.5 min-w-[11rem]">
      <button onClick={onAccept} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
        Accept as {rowType.replace(/_/g, " ")}
      </button>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
          placeholder="Merge into exact name"
          disabled={busy}
          className={`text-xs px-2 py-1.5 border rounded-lg flex-1 min-w-0 ${inputBg}`}
        />
        <button
          onClick={() => onMerge(mergeTarget)}
          disabled={busy || mergeTarget.trim().length === 0}
          className="text-xs px-2 py-1.5 rounded-lg font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 shrink-0"
        >
          Merge
        </button>
      </div>
      <button
        onClick={onDismiss}
        disabled={busy}
        className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
      >
        Dismiss
      </button>
    </div>
  );
}

interface CandidateRowProps {
  candidate: CandidateRowData;
  idx: number;
  dark: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  rowType: string;
  onTypeChange: (type: string) => void;
  busy: boolean;
  onAccept: (type: string) => void;
  onMerge: (mergeInto: string) => void;
  onDismiss: () => void;
  rowAltA: string;
  rowAltB: string;
  rowBorder: string;
  selectBg: string;
}

export default function CandidateRow({
  candidate, idx, dark, selected, onToggleSelect, rowType, onTypeChange, busy,
  onAccept, onMerge, onDismiss, rowAltA, rowAltB, rowBorder, selectBg,
}: CandidateRowProps) {
  return (
    <tr className={`${idx % 2 === 0 ? rowAltA : rowAltB} ${rowBorder} align-top ${busy ? "opacity-50" : ""} transition-opacity`}>
      <td className="px-3 py-2.5"><SelectCell selected={selected} busy={busy} onToggle={onToggleSelect} /></td>
      <td className="px-3 py-2.5">
        <NameTypeCell candidate={candidate} rowType={rowType} busy={busy} onTypeChange={onTypeChange} selectBg={selectBg} dark={dark} />
        {busy && <span className={`text-[10px] italic ${dark ? "text-slate-500" : "text-gray-400"}`}>saving…</span>}
      </td>
      <td className="px-3 py-2.5"><CountsCell candidate={candidate} dark={dark} /></td>
      <td className="px-3 py-2.5"><ContextsCell contexts={candidate.contexts} dark={dark} /></td>
      <td className="px-3 py-2.5"><CoEntitiesCell coEntities={candidate.coEntities} dark={dark} /></td>
      <td className="px-3 py-2.5"><TitlesCell titles={candidate.sampleTitles} dark={dark} /></td>
      <td className="px-3 py-2.5">
        <ActionsCell
          candidate={candidate} rowType={rowType} busy={busy} dark={dark}
          onAccept={() => onAccept(rowType)} onMerge={onMerge} onDismiss={onDismiss}
        />
      </td>
    </tr>
  );
}
