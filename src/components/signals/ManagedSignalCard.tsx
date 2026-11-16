"use client";

import { useState } from "react";
import { severityColor, timeAgo } from "./utils";
import { formatEvidenceNumbers } from "./evidence-format";
import { SignalCardData, SignalAction } from "./types";

function expanderLabel(articleCount: number, expanded: boolean): string {
  if (expanded) return "Hide details";
  return articleCount > 0 ? `Show sources (${articleCount})` : "Show detector data";
}

// Detector numbers (from evidence-format.ts) come first when present — the
// math behind the claim, one click away (DESIGN.md spine #2) — followed by
// the resolved article list, if any. Renders for a type/state combo that has
// neither (e.g. a surge signal has no articleIds) only when there's nothing
// to show at all, in which case the whole expander is suppressed.
function EvidenceExpander({ signal, dark }: { signal: SignalCardData; dark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detectorLines = formatEvidenceNumbers(signal.type, signal.evidence);
  if (signal.articles.length === 0 && detectorLines.length === 0) return null;

  return (
    <div className="mb-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
      >
        {expanderLabel(signal.articles.length, expanded)}
      </button>
      {expanded && (
        <div className={`mt-1.5 rounded-lg border px-3 py-2 space-y-1 ${dark ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
          {detectorLines.length > 0 && (
            <div
              className={`text-[11px] pb-1 mb-1 ${signal.articles.length > 0 ? "border-b" : ""} ${dark ? "text-slate-400 border-slate-700" : "text-gray-500 border-gray-200"}`}
            >
              {detectorLines.join(" · ")}
            </div>
          )}
          {signal.articles.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 text-[11px]">
              <span className={`font-medium flex-shrink-0 ${dark ? "text-slate-400" : "text-gray-500"}`}>{a.sourceName}</span>
              <a
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`truncate hover:underline ${dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
              >
                {a.title}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// "Watch" (UI label only) — the POST action value stays "promoted"; nothing
// downstream ever consumed a distinct meaning for the word "promote", so
// relabeling costs nothing and repairs the dead-end language.
const ACTION_LABELS: Record<SignalAction, string> = {
  seen: "Seen",
  promoted: "Watch",
  dismissed: "Dismiss",
  reopen: "Reopen",
};

function actionStyle(action: SignalAction, dark: boolean): string {
  if (action === "dismissed") {
    return dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700";
  }
  if (action === "promoted") return "bg-emerald-600 hover:bg-emerald-500 text-white";
  return "bg-blue-600 hover:bg-blue-500 text-white"; // seen, reopen
}

function ActionButtons({
  signal, busy, dark, actions, onAction,
}: {
  signal: SignalCardData; busy: boolean; dark: boolean; actions: SignalAction[];
  onAction: (id: number, action: SignalAction) => void;
}) {
  const buttonCls = "text-[11px] px-2.5 py-1 rounded-lg font-medium disabled:opacity-40";
  return (
    <div className="flex gap-1.5">
      {actions.map((action) => (
        <button key={action} onClick={() => onAction(signal.id, action)} disabled={busy} className={`${buttonCls} ${actionStyle(action, dark)}`}>
          {ACTION_LABELS[action]}
        </button>
      ))}
    </div>
  );
}

function WatchingBadge({ dark }: { dark: boolean }) {
  return (
    <span
      className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border flex-shrink-0 ${dark ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}
    >
      watching
    </span>
  );
}

const STATE_LABELS: Record<string, string> = { seen: "seen", dismissed: "dismissed", promoted: "watching" };

function TimingLines({ signal, dark }: { signal: SignalCardData; dark: boolean }) {
  const cls = `text-[10px] ${dark ? "text-slate-500" : "text-gray-400"}`;
  return (
    <div className="mb-1.5">
      <p className={cls}>first detected {timeAgo(signal.firstDetectedAt)}</p>
      {signal.state !== "new" && signal.stateChangedAt && (
        <p className={cls}>
          {STATE_LABELS[signal.state] ?? signal.state} &middot; {timeAgo(signal.stateChangedAt)}
        </p>
      )}
    </div>
  );
}

const EXPIRING_TYPES = new Set(["surge", "first_seen", "cross_category", "sentiment"]);

// Honest lifecycle hints (DESIGN.md spine #4). The 7-quiet-day expiry is a
// hardcoded server product decision (ingest-writer.ts's SIGNAL_EXPIRY_DAYS),
// safe to state; the dismiss cooldown length is a server *setting* the API
// never exposes, so its duration is deliberately never hardcoded here.
function LifecycleHint({ signal, dark }: { signal: SignalCardData; dark: boolean }) {
  let text: string | null = null;
  if (signal.state === "new" && EXPIRING_TYPES.has(signal.type)) text = "expires after 7 quiet days";
  else if (signal.state === "dismissed") text = "suppressed from re-firing for a cooldown after dismissal";
  if (!text) return null;
  return <p className={`text-[10px] mb-2 ${dark ? "text-slate-600" : "text-gray-400"}`}>{text}</p>;
}

interface ManagedSignalCardProps {
  signal: SignalCardData;
  dark: boolean;
  busy: boolean;
  actions: SignalAction[];
  onAction: (id: number, action: SignalAction) => void;
  onEntityClick: (name: string) => void;
}

export default function ManagedSignalCard({ signal, dark, busy, actions, onAction, onEntityClick }: ManagedSignalCardProps) {
  const sc = severityColor(signal.severity, dark);
  const cardBg = dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm";

  return (
    <div className={`border border-l-4 rounded-xl ${sc.border} ${cardBg} px-4 py-3`}>
      <div className="flex items-start gap-2.5 mb-2">
        <span className={`text-xs font-bold uppercase tracking-wide ${sc.text} flex-1 min-w-0 truncate`}>{signal.title}</span>
        {signal.state === "promoted" && <WatchingBadge dark={dark} />}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
          {signal.type.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mb-2.5">
        <div className={`w-24 h-2 rounded-full overflow-hidden ${dark ? "bg-slate-700" : "bg-gray-200"}`}>
          <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${signal.confidence * 100}%` }} />
        </div>
        <span className={`text-[10px] ${dark ? "text-slate-400" : "text-gray-500"}`}>{Math.round(signal.confidence * 100)}%</span>
        <span className={`ml-auto text-[10px] ${dark ? "text-slate-500" : "text-gray-400"}`}>{timeAgo(signal.lastEvidenceAt)}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center mb-2.5">
        {signal.entityNames.map((name) => (
          <button
            key={name}
            onClick={() => onEntityClick(name)}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:underline ${sc.bg} ${sc.text}`}
          >
            {name}
          </button>
        ))}
      </div>

      <TimingLines signal={signal} dark={dark} />
      <LifecycleHint signal={signal} dark={dark} />
      <EvidenceExpander signal={signal} dark={dark} />
      <ActionButtons signal={signal} busy={busy} dark={dark} actions={actions} onAction={onAction} />
    </div>
  );
}
