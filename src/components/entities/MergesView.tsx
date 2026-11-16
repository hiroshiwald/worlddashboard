"use client";

import type { MergeSuggestionsState } from "@/hooks/useMergeSuggestions";
import type { MergeGroupData } from "./types";

const REASON_LABELS: Record<MergeGroupData["reason"], string> = {
  alias: "shared name or alias",
  wiki: "same Wikipedia page",
  "alias+wiki": "shared alias and Wikipedia page",
};

function Group({ group, dark }: { group: MergeGroupData; dark: boolean }) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  return (
    <li className={`rounded-xl p-4 ${dark ? "bg-slate-900 border border-slate-800" : "bg-white shadow-sm"}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-medium">{group.canonical.name}</span>
        <span className={`text-xs ${muted}`}>{REASON_LABELS[group.reason]}</span>
      </div>
      <ul className={`mt-2 text-xs space-y-0.5 ${muted}`}>
        {group.members.map((m) => (
          <li key={m.id}>{m.name} · {m.type.replace(/_/g, " ")} · {m.status} · {m.mentions14d} mentions (14d)</li>
        ))}
      </ul>
    </li>
  );
}

export default function MergesView({ state, dark }: { state: MergeSuggestionsState; dark: boolean }) {
  const muted = `text-sm ${dark ? "text-slate-400" : "text-gray-500"}`;
  if (state.loading) return <p className={muted}>Loading suggested merges...</p>;
  if (state.error) return <p role="alert" className="text-sm text-red-500">{state.error}</p>;
  return (
    <>
      <p className={`${muted} mb-3`}>Merging needs your approval. It is not turned on yet.</p>
      {state.groups.length === 0 ? (
        <p className={muted}>No duplicate names found.</p>
      ) : (
        <ul className="space-y-3">
          {state.groups.map((g) => <Group key={g.canonical.id} group={g} dark={dark} />)}
        </ul>
      )}
    </>
  );
}
