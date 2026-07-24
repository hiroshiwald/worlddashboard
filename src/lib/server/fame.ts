import type { Sql } from "./db";
import { isDictionaryTerm } from "../entity-extractor";

const MIN_FAME_SOURCE_BREADTH = 12;
const FAME_VOLUME_PERCENTILE = 0.75;
// Same "at least 3/day" floor as developments.ts's MIN_ANCHOR_THRESHOLD, kept
// as its own constant: fame.ts must stay a leaf module (developments.ts and
// detectors.ts import it, not the other way around).
const MIN_FAME_VOLUME_THRESHOLD = 3;

// ---- Wikidata/Wikipedia fame verdict (pure) ----

export const FAME_PAGEVIEWS_THRESHOLD = 20_000;
export const FAME_SITELINKS_THRESHOLD = 25;
export const FAME_SITELINKS_CORROBORATION_PAGEVIEWS = 3_000;

/** The persisted verdict on entities.fame: 'unknown' covers both "never
 * checked" and "last check failed" (see fame-sweep.ts) — the caller never
 * gets to distinguish those two from the stored column alone, by design. */
export type StoredFame = "unknown" | "not_famous" | "famous";

export interface WikiFameInput {
  matched: boolean;
  sitelinks: number;
  medianMonthlyPageviews: number;
}

/** "Was the world already watching this entity?" — independent of local
 * ingest volume. No Wikidata match at all is not_famous. The sitelinks
 * prong deliberately requires pageview corroboration: Wikipedia grows
 * sitelinks within days of a breaking story, so sitelinks alone are not
 * spike-immune — an entity with 100 sitelinks but zero prior-year views is
 * the world newly watching, a satellite, not famous. A lookup FAILURE (as
 * opposed to a clean no-match) is never passed here at all — the caller
 * decides that case is 'unknown', not not_famous (see fame-sweep.ts). */
export function computeWikiFameVerdict(input: WikiFameInput): "famous" | "not_famous" {
  if (!input.matched) return "not_famous";
  if (input.medianMonthlyPageviews >= FAME_PAGEVIEWS_THRESHOLD) return "famous";
  if (input.sitelinks >= FAME_SITELINKS_THRESHOLD && input.medianMonthlyPageviews >= FAME_SITELINKS_CORROBORATION_PAGEVIEWS) {
    return "famous";
  }
  return "not_famous";
}

/** Facts needed to evaluate the fame test, assembled by the caller from
 * whatever it already has loaded. For a candidate (no tracked-entity
 * baseline, breadth, or stored verdict), pass baselineDaily=0,
 * sourceBreadth=0, storedFame='unknown' — isVolumeFamous/isBreadthFamous's
 * own guards degrade both prongs to false and 'unknown' is a no-op, leaving
 * only the dictionary prong live. */
export interface FameFacts {
  names: string[];
  baselineDaily: number;
  sourceBreadth: number;
  /** The persisted Wikidata/Wikipedia verdict. Only ever TIGHTENS the
   * heuristics below, never loosens them: storedFame='famous' makes
   * isFamous true even when every heuristic prong is false, but
   * storedFame='not_famous' never vetoes a heuristic prong that fires —
   * it can only add a fame verdict the heuristics missed, never remove one
   * they found. 'unknown' changes nothing, exactly as if this layer didn't
   * exist. */
  storedFame: StoredFame;
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

/** The shared fame test: famous when the stored Wikidata/Wikipedia verdict
 * says so, OR a seeded dictionary term, OR lifetime source breadth clears
 * MIN_FAME_SOURCE_BREADTH, OR baseline clears the population's own top
 * quartile. Deliberately broader than isAnchor — anchors provide context,
 * but famous entities must never be card subjects. storedFame='not_famous'
 * is deliberately absent from this OR chain: it must never veto a heuristic
 * prong that fires on its own (see FameFacts.storedFame). */
export function isFamous(facts: FameFacts, volumeThreshold: number): boolean {
  return (
    facts.storedFame === "famous" ||
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
