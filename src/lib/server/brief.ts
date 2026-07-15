import type { Sql, SqlRow } from "./db";
import type { Settings } from "./settings";
import { loadSignals, SignalJson } from "./signal-store";
import { computeWarmupState, computeEffectiveBaselineDays, WarmupState } from "./detectors";

const TOP_STORIES_LIMIT = 15;
const TOP_STORIES_WINDOW_HOURS = 48;
const NEW_ENTITIES_LIMIT = 5;
const NEW_ENTITIES_WINDOW_HOURS = 48;
const BOOTSTRAP_GUARD_HOURS = 72;
const MOVERS_LIMIT = 5;
const MIN_MOVER_OBSERVED_24H = 3;
const MOVER_BASELINE_FLOOR = 0.5;

export interface TopStoryJson {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  clusterSize: number;
  sourceCount: number;
}

export interface NewEntityJson {
  id: number;
  canonicalName: string;
  type: string;
  firstSeenAt: string;
  sourceCount: number;
}

export interface MoverJson {
  name: string;
  observed24h: number;
  baselineDaily: number;
  lift: number;
}

export interface Brief {
  generatedAt: string;
  signals: SignalJson[];
  newEntities: NewEntityJson[];
  topStories: TopStoryJson[];
  movers: MoverJson[];
  warmup: WarmupState;
}

/** Recency-decayed cluster size, hand-checkable in isolation: bigger
 * clusters rank higher, but decay by e^(-age/24h) so a big story from days
 * ago doesn't crowd out something small and fresh. */
export function computeStoryScore(clusterSize: number, ageHours: number): number {
  return Math.log(1 + clusterSize) * Math.exp(-ageHours / 24);
}

interface RawStory {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  publishedAt: Date;
  clusterSize: number;
  sourceCount: number;
}

// Mirrors the query's own COALESCE(published_at, first_seen_at) — a dateless
// feed item stores published_at = NULL, and without this fallback `new
// Date(null)` silently becomes the Unix epoch, sinking the story's rank and
// reporting a bogus 1970 publish date.
function parseStoryRow(row: SqlRow): RawStory {
  const effectiveAt = row.published_at ?? row.first_seen_at;
  return {
    id: Number(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    publishedAt: effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt as string),
    clusterSize: Number(row.cluster_size),
    sourceCount: Number(row.source_count),
  };
}

/** Cluster heads from the last 48h with member count and distinct source
 * count computed in one query; ranking (computeStoryScore) and the cap are
 * applied in JS so the formula stays a plain, independently testable
 * function rather than embedded SQL. */
async function loadTopStories(sql: Sql): Promise<TopStoryJson[]> {
  const rows = await sql`
    SELECT h.id, h.title, h.link, h.source_name, h.published_at, h.first_seen_at,
      (COUNT(m.id) + 1) AS cluster_size,
      cardinality(ARRAY(
        SELECT DISTINCT unnest(array_append(array_agg(m.source_name) FILTER (WHERE m.id IS NOT NULL), h.source_name))
      )) AS source_count
    FROM articles h
    LEFT JOIN articles m ON m.dup_group_id = h.id
    WHERE h.dup_group_id IS NULL
      AND COALESCE(h.published_at, h.first_seen_at) >= now() - make_interval(hours => ${TOP_STORIES_WINDOW_HOURS}::int)
    GROUP BY h.id
  `;

  const now = Date.now();
  const scored = rows.map(parseStoryRow).map((story) => {
    const ageHours = (now - story.publishedAt.getTime()) / 3600000;
    return { story, score: computeStoryScore(story.clusterSize, ageHours) };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, TOP_STORIES_LIMIT).map(({ story }) => ({
    id: story.id,
    title: story.title,
    link: story.link,
    sourceName: story.sourceName,
    publishedAt: story.publishedAt.toISOString(),
    clusterSize: story.clusterSize,
    sourceCount: story.sourceCount,
  }));
}

/** Tracked entities first seen within the last 48h, excluding the initial
 * dictionary-import cohort (same 72h bootstrap guard as the first-seen
 * novelty detector). */
async function loadNewEntities(sql: Sql): Promise<NewEntityJson[]> {
  const rows = await sql`
    SELECT e.id, e.canonical_name, e.type, e.first_seen_at, COUNT(DISTINCT a.source_name) AS source_count
    FROM entities e
    JOIN article_entities ae ON ae.entity_id = e.id
    JOIN articles a ON a.id = ae.article_id AND a.dup_group_id IS NULL
    WHERE e.status = 'tracked'
      AND e.first_seen_at >= now() - make_interval(hours => ${NEW_ENTITIES_WINDOW_HOURS}::int)
      AND e.first_seen_at >= (SELECT MIN(first_seen_at) FROM entities WHERE status = 'tracked')
        + make_interval(hours => ${BOOTSTRAP_GUARD_HOURS}::int)
    GROUP BY e.id
    ORDER BY e.first_seen_at DESC
    LIMIT ${NEW_ENTITIES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : new Date(row.first_seen_at as string).toISOString(),
    sourceCount: Number(row.source_count),
  }));
}

// The platform's operating epoch (earliest article ARRIVAL ever recorded) —
// duplicated from detectors.ts's private getSystemEpoch rather than
// exported from there, keeping this module decoupled from detector
// internals. Anchors the same warm-up gate detectors.ts uses.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value as string);
}

function computeDaysSinceEpoch(now: Date, epoch: Date): number {
  return Math.floor((now.getTime() - epoch.getTime()) / (24 * 3600 * 1000));
}

interface MoverAggRow {
  entityId: number;
  canonicalName: string;
  observed24h: number;
  baselineSum: number;
}

async function loadMoverAgg(sql: Sql): Promise<MoverAggRow[]> {
  const rows = await sql`
    SELECT e.id AS entity_id, e.canonical_name,
      COALESCE(SUM(emh.mentions) FILTER (WHERE emh.bucket >= now() - INTERVAL '24 hours'), 0) AS observed_24h,
      COALESCE(SUM(emh.mentions) FILTER (
        WHERE emh.bucket < now() - INTERVAL '24 hours' AND emh.bucket >= now() - INTERVAL '15 days'
      ), 0) AS baseline_sum
    FROM entities e
    JOIN entity_mentions_hourly emh ON emh.entity_id = e.id
    WHERE e.status = 'tracked' AND emh.bucket >= now() - INTERVAL '15 days'
    GROUP BY e.id
  `;
  return rows.map((row) => ({
    entityId: Number(row.entity_id),
    canonicalName: String(row.canonical_name),
    observed24h: Number(row.observed_24h),
    baselineSum: Number(row.baseline_sum),
  }));
}

/** lift = observed24h / max(baselineDaily, 0.5) — the floor keeps a
 * near-silent baseline (e.g. 0.1/day) from producing an absurd lift for a
 * handful of mentions. Hand-checkable in isolation. */
export function computeLift(observed24h: number, baselineDaily: number): number {
  return observed24h / Math.max(baselineDaily, MOVER_BASELINE_FLOOR);
}

function buildMovers(aggRows: MoverAggRow[], effectiveBaselineDays: number): MoverJson[] {
  const movers = aggRows
    .filter((r) => r.observed24h >= MIN_MOVER_OBSERVED_24H)
    .map((r) => {
      const baselineDaily = r.baselineSum / effectiveBaselineDays;
      return { name: r.canonicalName, observed24h: r.observed24h, baselineDaily, lift: computeLift(r.observed24h, baselineDaily) };
    });
  movers.sort((a, b) => b.lift - a.lift);
  return movers.slice(0, MOVERS_LIMIT);
}

async function loadMovers(sql: Sql, epoch: Date, now: Date): Promise<MoverJson[]> {
  const effectiveBaselineDays = computeEffectiveBaselineDays(computeDaysSinceEpoch(now, epoch));
  const aggRows = await loadMoverAgg(sql);
  return buildMovers(aggRows, effectiveBaselineDays);
}

export async function getBrief(sql: Sql, settings: Settings): Promise<Brief> {
  const now = new Date();
  const [signals, newEntities, topStories, epoch] = await Promise.all([
    loadSignals(sql, ["new", "seen", "promoted"], settings.brief_max_blocks),
    loadNewEntities(sql),
    loadTopStories(sql),
    getSystemEpoch(sql),
  ]);

  const warmup = computeWarmupState(epoch, settings.warmup_days, now);
  // computeWarmupState only returns active:false when epoch is non-null.
  const movers = warmup.active ? [] : await loadMovers(sql, epoch as Date, now);

  return { generatedAt: now.toISOString(), signals, newEntities, topStories, movers, warmup };
}
