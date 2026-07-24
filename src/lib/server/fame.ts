import type { Sql } from "./db";
import { isDictionaryTerm } from "../entity-extractor";

const MIN_FAME_SOURCE_BREADTH = 12;
const FAME_VOLUME_PERCENTILE = 0.75;
// Same "at least 3/day" floor as developments.ts's MIN_ANCHOR_THRESHOLD, kept
// as its own constant: fame.ts must stay a leaf module (developments.ts and
// detectors.ts import it, not the other way around).
const MIN_FAME_VOLUME_THRESHOLD = 3;

/** Facts needed to evaluate the three-pronged fame test, assembled by the
 * caller from whatever it already has loaded. For a candidate (no tracked-
 * entity baseline or breadth), pass baselineDaily=0 and sourceBreadth=0 —
 * isVolumeFamous/isBreadthFamous's own guards degrade both prongs to false,
 * leaving only the dictionary prong live. */
export interface FameFacts {
  names: string[];
  baselineDaily: number;
  sourceBreadth: number;
}

/** True when any given name form — canonical name + aliases for a tracked
 * entity, or [display_name, name_norm] for an unresolved candidate — is
 * itself a seeded COUNTRY/ORG/REGION dictionary term or alias. */
export function isDictionaryFamous(names: string[]): boolean {
  return names.some(isDictionaryTerm);
}

export function isBreadthFamous(sourceBreadth: number): boolean {
  return sourceBreadth >= MIN_FAME_SOURCE_BREADTH;
}

/** max(3, 75th percentile) of baselineDaily across the same population
 * computeAnchorThreshold uses (tracked entities with any mentions in the
 * trailing 15 days) — identical linear-interpolation percentile math,
 * duplicated rather than imported per this codebase's small-shared-math
 * convention (see e.g. getSystemEpoch's three independent copies). An empty
 * population returns Infinity rather than the floor: fame's volume prong
 * must reject everyone when there's no population to rank against, unlike
 * isAnchor's deliberate floor-of-3-regardless-of-population behavior. */
export function computeFameVolumeThreshold(baselineDailyValues: number[]): number {
  if (baselineDailyValues.length === 0) return Infinity;
  const sorted = [...baselineDailyValues].sort((a, b) => a - b);
  const rank = FAME_VOLUME_PERCENTILE * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const percentile = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.max(MIN_FAME_VOLUME_THRESHOLD, percentile);
}

/** A zero (or negative) baseline is "no established rate," never
 * volume-famous — regardless of how low the threshold computes. */
export function isVolumeFamous(baselineDaily: number, threshold: number): boolean {
  return baselineDaily > 0 && baselineDaily >= threshold;
}

/** The shared fame test: famous when a seeded dictionary term, OR lifetime
 * source breadth clears MIN_FAME_SOURCE_BREADTH, OR baseline clears the
 * population's own top quartile. Deliberately broader than isAnchor —
 * anchors provide context, but famous entities must never be card subjects. */
export function isFamous(facts: FameFacts, volumeThreshold: number): boolean {
  return (
    isDictionaryFamous(facts.names) ||
    isBreadthFamous(facts.sourceBreadth) ||
    isVolumeFamous(facts.baselineDaily, volumeThreshold)
  );
}

/** Lifetime distinct-source-name count per entity, across every
 * article_entities row ever recorded for it — no time window, no
 * dup_group_id filter (a duplicate member is still a distinct outlet that
 * covered the entity). Bounded in practice by ingest-writer.ts's retention
 * sweep, not a true forever-lifetime count. Only ever call this with a
 * small, bounded entity id set (relation endpoints in window, newly tracked
 * entities, resolved card subjects, novel-edge endpoints) — never the whole
 * tracked roster. */
export async function loadLifetimeSourceBreadth(sql: Sql, entityIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (entityIds.length === 0) return map;
  const rows = await sql`
    SELECT ae.entity_id, COUNT(DISTINCT a.source_name) AS source_breadth
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ANY(${entityIds}::bigint[])
    GROUP BY ae.entity_id
  `;
  for (const row of rows) {
    map.set(Number(row.entity_id), Number(row.source_breadth));
  }
  return map;
}
