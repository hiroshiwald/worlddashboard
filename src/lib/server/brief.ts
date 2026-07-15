import type { Sql, SqlRow } from "./db";
import type { Settings } from "./settings";
import { loadSignals, SignalJson } from "./signal-store";

const TOP_STORIES_LIMIT = 15;
const TOP_STORIES_WINDOW_HOURS = 48;
const NEW_ENTITIES_LIMIT = 5;
const NEW_ENTITIES_WINDOW_HOURS = 48;
const BOOTSTRAP_GUARD_HOURS = 72;

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

export interface Brief {
  generatedAt: string;
  signals: SignalJson[];
  newEntities: NewEntityJson[];
  topStories: TopStoryJson[];
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

function parseStoryRow(row: SqlRow): RawStory {
  return {
    id: Number(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    publishedAt: row.published_at instanceof Date ? row.published_at : new Date(row.published_at as string),
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

export async function getBrief(sql: Sql, settings: Settings): Promise<Brief> {
  const [signals, newEntities, topStories] = await Promise.all([
    loadSignals(sql, ["new", "seen", "promoted"], settings.brief_max_blocks),
    loadNewEntities(sql),
    loadTopStories(sql),
  ]);
  return { generatedAt: new Date().toISOString(), signals, newEntities, topStories };
}
