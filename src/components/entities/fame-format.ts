// Pure formatter: the Wikipedia evidence line behind a fame verdict
// (EntityPanel's Fame block). sitelinks and pageviews are independent
// nullable columns — a wiki match can carry one without the other — so each
// renders only when present; null when both are absent, never "null"/
// "undefined" text (DESIGN.md spine #2/#4).
export function formatWikiEvidence(sitelinks: number | null, pageviewsMonthly: number | null): string | null {
  const parts: string[] = [];
  if (sitelinks != null) parts.push(`${sitelinks} sitelinks`);
  if (pageviewsMonthly != null) parts.push(`~${pageviewsMonthly} monthly pageviews`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
