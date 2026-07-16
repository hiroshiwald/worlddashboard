"use client";

import { useEffect, useState, useCallback } from "react";

interface Candidate {
  nameNorm: string;
  displayName: string;
  typeHint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  mentionCount: number;
  sourceNames: string[];
  sourceCount: number;
  dayCount: number;
  sampleTitles: string[];
  contexts: string[];
  coEntities: string[];
}

const TYPE_OPTIONS = [
  "person", "company", "organization", "government_body", "armed_group",
  "political_party", "country", "region", "city", "product", "technology",
  "financial_asset", "disease", "infrastructure", "other",
];

// Distinguishes "no database configured yet" (a normal, expected state for
// this app) from a genuine fetch/shape failure, so the UI can show a
// friendly empty state instead of an error banner.
class DatabaseNotConfiguredError extends Error {}

async function fetchCandidates(): Promise<Candidate[]> {
  const res = await fetch("/api/candidates", { cache: "no-store" });
  if (res.status === 503) throw new DatabaseNotConfiguredError();
  if (!res.ok) throw new Error(`Failed to load candidates (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.candidates)) throw new Error("Malformed candidates response");
  return data.candidates;
}

async function postAction(nameNorm: string, action: string, extra: Record<string, string> = {}): Promise<void> {
  const res = await fetch("/api/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nameNorm, action, ...extra }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Action failed (${res.status})`);
  }
}

function SourceChips({ names, dark }: { names: string[]; dark: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span
          key={name}
          className={`text-[11px] px-2 py-0.5 rounded-full ${dark ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-600"}`}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

interface CandidateCardProps {
  candidate: Candidate;
  dark: boolean;
  busy: boolean;
  onAccept: (nameNorm: string, type: string) => void;
  onMerge: (nameNorm: string, mergeInto: string) => void;
  onDismiss: (nameNorm: string) => void;
}

function CandidateCard({ candidate, dark, busy, onAccept, onMerge, onDismiss }: CandidateCardProps) {
  const [type, setType] = useState(TYPE_OPTIONS.includes(candidate.typeHint) ? candidate.typeHint : "other");
  const [mergeTarget, setMergeTarget] = useState("");
  const cardBg = dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm";
  const inputBg = dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-gray-50 border-gray-200 text-gray-900";

  return (
    <div className={`border rounded-xl p-4 ${cardBg}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-gray-900"}`}>{candidate.displayName}</h3>
        <span className={`text-[11px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-gray-400"}`}>{candidate.typeHint}</span>
      </div>
      {candidate.contexts.length > 0 && (
        <p className={`text-xs italic mb-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>{candidate.contexts.join(" · ")}</p>
      )}
      <p className={`text-xs mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        {candidate.mentionCount} mentions &middot; {candidate.sourceCount} sources &middot; {candidate.dayCount} days
      </p>
      {candidate.coEntities.length > 0 && (
        <p className={`text-xs mb-2 ${dark ? "text-slate-500" : "text-gray-400"}`}>appears with: {candidate.coEntities.join(", ")}</p>
      )}
      <SourceChips names={candidate.sourceNames} dark={dark} />
      <ul className={`text-xs mt-2 mb-3 space-y-0.5 ${dark ? "text-slate-500" : "text-gray-500"}`}>
        {candidate.sampleTitles.map((title) => (
          <li key={title} className="truncate">&ldquo;{title}&rdquo;</li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={busy}
          className={`text-xs px-2 py-1.5 border rounded-lg ${inputBg}`}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
          ))}
        </select>
        <button
          onClick={() => onAccept(candidate.nameNorm, type)}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
        >
          Accept
        </button>

        <input
          type="text"
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
          placeholder="Merge into exact entity name"
          disabled={busy}
          className={`text-xs px-2 py-1.5 border rounded-lg flex-1 min-w-[10rem] ${inputBg}`}
        />
        <button
          onClick={() => onMerge(candidate.nameNorm, mergeTarget)}
          disabled={busy || mergeTarget.trim().length === 0}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
        >
          Merge
        </button>

        <button
          onClick={() => onDismiss(candidate.nameNorm)}
          disabled={busy}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

interface ReviewTabProps {
  dark: boolean;
  onCandidatesChanged: (count: number) => void;
}

export default function ReviewTab({ dark, onCandidatesChanged }: ReviewTabProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbUnconfigured, setDbUnconfigured] = useState(false);
  const [busyNorm, setBusyNorm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDbUnconfigured(false);
    try {
      const list = await fetchCandidates();
      setCandidates(list);
      onCandidatesChanged(list.length);
    } catch (e) {
      // Reset the header badge on any failure — a stale positive count
      // shouldn't linger once the list itself couldn't be confirmed.
      onCandidatesChanged(0);
      if (e instanceof DatabaseNotConfiguredError) setDbUnconfigured(true);
      else setError(e instanceof Error ? e.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [onCandidatesChanged]);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports errors via state.
    load();
  }, [load]);

  const runAction = async (nameNorm: string, action: string, extra?: Record<string, string>) => {
    setBusyNorm(nameNorm);
    setError(null);
    try {
      await postAction(nameNorm, action, extra);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyNorm(null);
    }
  };

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {dbUnconfigured && (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>
          Entity review requires a configured database.
        </p>
      )}

      {!dbUnconfigured && error && (
        <div className={`mb-4 border text-sm px-4 py-3 rounded-xl ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          {error}
        </div>
      )}

      {!dbUnconfigured && loading && candidates.length === 0 && !error && (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>Loading candidates...</p>
      )}

      {!dbUnconfigured && !loading && candidates.length === 0 && !error && (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>No entities awaiting review.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.nameNorm}
            candidate={candidate}
            dark={dark}
            busy={busyNorm === candidate.nameNorm}
            onAccept={(nameNorm, type) => runAction(nameNorm, "accept", { type })}
            onMerge={(nameNorm, mergeInto) => runAction(nameNorm, "merge", { mergeInto })}
            onDismiss={(nameNorm) => runAction(nameNorm, "dismiss")}
          />
        ))}
      </div>
    </div>
  );
}
