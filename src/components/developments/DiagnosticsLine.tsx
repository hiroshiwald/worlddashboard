"use client";

import { DevelopmentDiagnostics } from "@/hooks/useDevelopmentsTab";

const REASON_LABELS: Record<string, string> = {
  anchor_subject: "anchor subject",
  famous_subject: "famous subject",
  no_evidence: "no evidence",
  single_source: "single source",
  no_anchor: "no anchor",
};

function reasonLabel(key: string): string {
  return REASON_LABELS[key] ?? key.replace(/_/g, " ");
}

// Highest-impact reason first — the count that most explains an empty or
// thin result set belongs at the front of the sentence.
function formatRejected(rejected: Record<string, number>): string {
  const parts = Object.entries(rejected)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${count} ${reasonLabel(key)}`);
  return parts.length > 0 ? `rejected: ${parts.join(", ")}` : "";
}

interface DiagnosticsLineProps {
  diagnostics: DevelopmentDiagnostics;
  cardCount: number;
  dark: boolean;
}

// The honest-empty-state mechanism (DESIGN.md spine #4): explains what the
// engine rejected and why, so an empty or thin result reads as "the system
// checked and found little" rather than "the system is broken."
export default function DiagnosticsLine({ diagnostics, cardCount, dark }: DiagnosticsLineProps) {
  const parts = [
    `${diagnostics.draftCount} drafts considered`,
    `${diagnostics.eligibleCount} eligible`,
    formatRejected(diagnostics.rejected),
  ].filter(Boolean);
  const showing = diagnostics.eligibleCount > cardCount
    ? ` · showing ${cardCount} of ${diagnostics.eligibleCount} eligible`
    : "";

  return (
    <p className={`text-[11px] mb-3 ${dark ? "text-slate-500" : "text-gray-400"}`}>
      {parts.join(" · ")}
      {showing}
    </p>
  );
}
