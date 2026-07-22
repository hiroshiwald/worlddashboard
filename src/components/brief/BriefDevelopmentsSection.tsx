"use client";

import { useState } from "react";
import { BriefDevelopment, BriefDevelopmentEvidence, BriefDevelopmentScoreParts, BriefWarmup } from "@/hooks/useBriefTab";
import { timeAgo, formatDate } from "@/lib/date-utils";

function formatScoreParts(parts: BriefDevelopmentScoreParts): string {
  return [
    `novelty ${parts.novelty.toFixed(2)}`,
    `corroboration ${parts.corroboration.toFixed(2)}`,
    `persistence ${parts.persistence.toFixed(2)}`,
    `relation ${parts.relationStrength.toFixed(2)}`,
    `anchor ${parts.anchorContext.toFixed(2)}`,
    `penalty ${parts.penalty.toFixed(2)}`,
  ].join(" · ");
}

function EvidenceExpander({ evidence, dark }: { evidence: BriefDevelopmentEvidence[]; dark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (evidence.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
      >
        {expanded ? "Hide sources" : `${evidence.length} sources`}
      </button>
      {expanded && (
        <ul className={`mt-1.5 rounded-lg border px-3 py-2 space-y-1.5 ${dark ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
          {evidence.map((a) => (
            <li key={a.link} className="text-[11px]">
              <a
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`hover:underline ${dark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"}`}
              >
                {a.title}
              </a>
              <div className={dark ? "text-slate-500" : "text-gray-400"}>
                {a.sourceName}
                {a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ""} · observed {timeAgo(a.firstSeenAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Anchor chips stay visually secondary (muted, unbolded) to the subject
// headline; label/staleReporting render alongside as small tags per spec.
function AnchorAndLabelTags({
  card, dark, onEntityClick,
}: {
  card: BriefDevelopment; dark: boolean; onEntityClick: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center mb-1.5">
      {card.anchorNames.map((name) => (
        <button
          key={name}
          onClick={() => onEntityClick(name)}
          className={`text-[10px] px-2 py-0.5 rounded-full hover:underline ${dark ? "bg-slate-800/60 text-slate-400" : "bg-gray-50 text-gray-500"}`}
        >
          {name}
        </button>
      ))}
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
        {card.label}
      </span>
      {card.staleReporting && (
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${dark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"}`}>
          older reporting, newly observed
        </span>
      )}
    </div>
  );
}

function DevelopmentCard({
  card, dark, onEntityClick,
}: {
  card: BriefDevelopment; dark: boolean; onEntityClick: (name: string) => void;
}) {
  const cardBg = dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm";

  return (
    <li className={`border rounded-xl px-4 py-3 ${cardBg}`}>
      <div className="flex items-start gap-2.5 mb-1.5">
        <button
          onClick={() => onEntityClick(card.subjectName)}
          className={`text-sm font-bold text-left flex-1 min-w-0 truncate hover:underline ${dark ? "text-slate-100" : "text-gray-900"}`}
        >
          {card.subjectName}
        </button>
        <span
          className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}
        >
          {card.subjectType.replace(/_/g, " ")}
        </span>
        <span
          title={formatScoreParts(card.scoreParts)}
          className={`text-[10px] flex-shrink-0 ${dark ? "text-slate-600" : "text-gray-300"}`}
        >
          {card.score.toFixed(1)}
        </span>
      </div>

      <AnchorAndLabelTags card={card} dark={dark} onEntityClick={onEntityClick} />

      <p className={`text-xs mb-1 ${dark ? "text-slate-300" : "text-gray-600"}`}>{card.relationOrReason}</p>
      <p className={`text-xs mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>{card.whyShown}</p>

      <p className={`text-[10px] ${dark ? "text-slate-500" : "text-gray-400"}`}>
        first observed {timeAgo(card.firstObservedAt)} &middot; updated {timeAgo(card.lastObservedAt)}
      </p>

      <EvidenceExpander evidence={card.evidence} dark={dark} />
    </li>
  );
}

interface BriefDevelopmentsSectionProps {
  developments: BriefDevelopment[];
  warmup: BriefWarmup;
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// Unlike BriefMoversSection, the header always renders here: the spec calls
// for "section header plus" the warm-up line, and an honest zero-card state
// that must not hide the section (DESIGN.md spine #4).
export default function BriefDevelopmentsSection({ developments, warmup, dark, onEntityClick }: BriefDevelopmentsSectionProps) {
  return (
    <div className="mb-6">
      <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        Developments
      </h3>
      {warmup.active ? (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>
          Signal engine warming up — {Math.ceil(warmup.daysRemaining)} days of baseline remaining.
        </p>
      ) : developments.length === 0 ? (
        <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>
          No qualifying developments in the last 14 days.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {developments.map((card) => (
            <DevelopmentCard key={`${card.subjectName}-${card.firstObservedAt}`} card={card} dark={dark} onEntityClick={onEntityClick} />
          ))}
        </ul>
      )}
    </div>
  );
}
