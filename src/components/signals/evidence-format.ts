// Pure formatter: labeled detector numbers for a signal's evidence JSONB,
// keyed by signal type. Used by ManagedSignalCard's evidence expander to
// show the math behind a claim (DESIGN.md spine #2), not just its articles.

interface EvidenceField {
  key: string;
  label: string;
}

const FIELDS_BY_TYPE: Record<string, EvidenceField[]> = {
  surge: [
    { key: "observed24h", label: "observed 24h" },
    { key: "baselineDaily", label: "baseline/day" },
    { key: "z", label: "z-score" },
    { key: "k", label: "k" },
  ],
  sentiment: [
    { key: "avg24h", label: "avg sentiment 24h" },
    { key: "baselineAvg", label: "baseline sentiment" },
    { key: "delta", label: "delta" },
    { key: "mentions24h", label: "mentions 24h" },
  ],
  cross_category: [
    { key: "categoryCount24h", label: "categories 24h" },
    { key: "baselineAvgCategories", label: "baseline categories" },
    { key: "excess", label: "excess" },
  ],
  first_seen: [{ key: "sourceCount", label: "sources" }],
  novel_edge: [{ key: "articleCount", label: "articles" }],
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Missing or non-numeric keys are skipped outright — never rendered as
 * "undefined" or "NaN". An unrecognized type yields no lines. */
export function formatEvidenceNumbers(type: string, evidence: Record<string, unknown>): string[] {
  const fields = FIELDS_BY_TYPE[type];
  if (!fields) return [];
  const lines: string[] = [];
  for (const field of fields) {
    const value = evidence[field.key];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    lines.push(`${field.label} ${formatNumber(value)}`);
  }
  return lines;
}
