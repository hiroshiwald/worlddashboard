import type { Sql, SqlRow } from "./db";
import type { Settings } from "./settings";

export type SignalSeverity = "advisory" | "warning" | "critical";
export type SignalType = "surge" | "first_seen" | "novel_edge" | "cross_category" | "sentiment";

export interface CandidateSignal {
  dedupeKey: string;
  type: SignalType;
  severity: SignalSeverity;
  confidence: number;
  title: string;
  entityIds: number[];
  evidence: Record<string, unknown>;
}

const BASELINE_WINDOW_DAYS = 14;
const MIN_BASELINE_DAYS = 3;
const BOOTSTRAP_GUARD_HOURS = 72;
const MAX_EVIDENCE_ARTICLES = 5;
const MIN_FIRST_SEEN_SOURCES = 2;
const MIN_NOVEL_EDGE_ARTICLES = 2;
const MIN_CROSS_CATEGORY_COUNT = 3;
const MIN_SENTIMENT_MENTIONS = 5;
const SENTIMENT_THRESHOLD = -0.3;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function capArticleIds(ids: number[]): number[] {
  return ids.slice(0, MAX_EVIDENCE_ARTICLES);
}

// ---- pure scoring functions (synthetic-panel testable) ----

/** Skips (returns null) for entities with <3 days of baseline history — cold
 * start, not a real absence of surprise. Fires when z >= k. */
export function scoreSurge(
  observed24h: number,
  baselineDaily: number,
  baselineDays: number,
  k: number,
): { z: number; severity: SignalSeverity; confidence: number } | null {
  if (baselineDays < MIN_BASELINE_DAYS) return null;
  const z = (observed24h - baselineDaily) / Math.sqrt(baselineDaily + 1);
  if (z < k) return null;
  const severity: SignalSeverity = z >= 2 * k ? "critical" : z >= 1.5 * k ? "warning" : "advisory";
  const confidence = Math.min(1, z / (2 * k));
  return { z, severity, confidence };
}

export function scoreFirstSeenNovelty(sourceCount: number): { severity: SignalSeverity; confidence: number } | null {
  if (sourceCount < MIN_FIRST_SEEN_SOURCES) return null;
  const severity: SignalSeverity = sourceCount >= 4 ? "critical" : "warning";
  const confidence = Math.min(1, sourceCount / 4);
  return { severity, confidence };
}

export function scoreNovelEdge(articleCount: number): { severity: SignalSeverity; confidence: number } | null {
  if (articleCount < MIN_NOVEL_EDGE_ARTICLES) return null;
  const severity: SignalSeverity = articleCount >= 4 ? "critical" : "warning";
  const confidence = Math.min(1, articleCount / 4);
  return { severity, confidence };
}

export function scoreCrossCategory(categoryCount: number): { severity: SignalSeverity; confidence: number } | null {
  if (categoryCount < MIN_CROSS_CATEGORY_COUNT) return null;
  const severity: SignalSeverity = categoryCount >= 5 ? "critical" : categoryCount >= 4 ? "warning" : "advisory";
  const confidence = Math.min(1, categoryCount / 5);
  return { severity, confidence };
}

export function scoreSentimentDeterioration(
  mentions: number,
  avgSentiment: number,
): { severity: SignalSeverity; confidence: number } | null {
  if (mentions < MIN_SENTIMENT_MENTIONS || avgSentiment > SENTIMENT_THRESHOLD) return null;
  const severity: SignalSeverity = avgSentiment <= -0.6 && mentions >= 10 ? "critical" : "warning";
  const confidence = Math.min(1, (Math.abs(avgSentiment) * mentions) / 6);
  return { severity, confidence };
}

/** True when `candidateFirstSeenAt` falls within BOOTSTRAP_GUARD_HOURS of the
 * earliest first_seen_at in its table — the initial dictionary-import cohort
 * (every country seen on day one) that would otherwise flood the queue. */
export function isBootstrapCohort(candidateFirstSeenAt: Date, globalMinFirstSeenAt: Date): boolean {
  return candidateFirstSeenAt.getTime() - globalMinFirstSeenAt.getTime() < BOOTSTRAP_GUARD_HOURS * 3600 * 1000;
}

// ---- panel queries (batched, tracked entities + cluster-head articles only) ----

interface HourlyAggRow {
  entityId: number;
  observed24h: number;
  sentimentSum24h: number;
  baselineSum: number;
  baselineDays: number;
}

async function loadHourlyAgg(sql: Sql): Promise<HourlyAggRow[]> {
  const rows = await sql`
    SELECT emh.entity_id,
      COALESCE(SUM(emh.mentions) FILTER (WHERE emh.bucket >= now() - INTERVAL '24 hours'), 0) AS observed_24h,
      COALESCE(SUM(emh.sentiment_sum) FILTER (WHERE emh.bucket >= now() - INTERVAL '24 hours'), 0) AS sentiment_sum_24h,
      COALESCE(SUM(emh.mentions) FILTER (
        WHERE emh.bucket < now() - INTERVAL '24 hours' AND emh.bucket >= now() - INTERVAL '15 days'
      ), 0) AS baseline_sum,
      COUNT(DISTINCT date_trunc('day', emh.bucket)) FILTER (
        WHERE emh.bucket < now() - INTERVAL '24 hours' AND emh.bucket >= now() - INTERVAL '15 days'
      ) AS baseline_days
    FROM entity_mentions_hourly emh
    JOIN entities e ON e.id = emh.entity_id
    WHERE e.status = 'tracked' AND emh.bucket >= now() - INTERVAL '15 days'
    GROUP BY emh.entity_id
  `;
  return rows.map((row) => ({
    entityId: Number(row.entity_id),
    observed24h: Number(row.observed_24h),
    sentimentSum24h: Number(row.sentiment_sum_24h),
    baselineSum: Number(row.baseline_sum),
    baselineDays: Number(row.baseline_days),
  }));
}

interface ArticleRow {
  entityId: number;
  articleId: number;
  sourceCategory: string;
}

async function loadArticles24h(sql: Sql): Promise<ArticleRow[]> {
  const rows = await sql`
    SELECT ae.entity_id, a.id AS article_id, a.source_category
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE e.status = 'tracked' AND a.dup_group_id IS NULL
      AND COALESCE(a.published_at, a.first_seen_at) >= now() - INTERVAL '24 hours'
  `;
  return rows.map((row) => ({
    entityId: Number(row.entity_id),
    articleId: Number(row.article_id),
    sourceCategory: String(row.source_category),
  }));
}

function groupArticlesByEntity(rows: ArticleRow[]): Map<number, ArticleRow[]> {
  const map = new Map<number, ArticleRow[]>();
  for (const row of rows) {
    const group = map.get(row.entityId);
    if (group) group.push(row);
    else map.set(row.entityId, [row]);
  }
  return map;
}

// ---- surge + sentiment detectors (share the hourly-agg panel) ----

function buildSurgeSignal(
  entityId: number,
  name: string,
  agg: HourlyAggRow,
  articleIds: number[],
  settings: Settings,
): CandidateSignal | null {
  const baselineDaily = agg.baselineSum / BASELINE_WINDOW_DAYS;
  const scored = scoreSurge(agg.observed24h, baselineDaily, agg.baselineDays, settings.surprise_k);
  if (!scored) return null;
  return {
    dedupeKey: `surge:${entityId}`,
    type: "surge",
    severity: scored.severity,
    confidence: scored.confidence,
    title: `Surge: ${name} (+${agg.observed24h} mentions/24h, ${scored.z.toFixed(1)}σ)`,
    entityIds: [entityId],
    evidence: {
      observed24h: agg.observed24h,
      baselineDaily,
      z: scored.z,
      k: settings.surprise_k,
      articleIds: capArticleIds(articleIds),
    },
  };
}

function buildSentimentSignal(
  entityId: number,
  name: string,
  agg: HourlyAggRow,
  articleIds: number[],
): CandidateSignal | null {
  if (agg.observed24h === 0) return null;
  const avgSentiment = agg.sentimentSum24h / agg.observed24h;
  const scored = scoreSentimentDeterioration(agg.observed24h, avgSentiment);
  if (!scored) return null;
  return {
    dedupeKey: `sentiment:${entityId}`,
    type: "sentiment",
    severity: scored.severity,
    confidence: scored.confidence,
    title: `Negative coverage: ${name}`,
    entityIds: [entityId],
    evidence: { mentions: agg.observed24h, avgSentiment, articleIds: capArticleIds(articleIds) },
  };
}

function buildSurgeAndSentiment(
  aggRows: HourlyAggRow[],
  articleRows: ArticleRow[],
  settings: Settings,
  entityNames: Map<number, string>,
): { surge: CandidateSignal[]; sentiment: CandidateSignal[] } {
  const articlesByEntity = groupArticlesByEntity(articleRows);

  // Sentiment isn't populated in older rows — if the whole 24h window's
  // sentiment_sum is zero across every entity, skip the detector entirely
  // rather than firing false "neutral" deteriorations.
  const anySentimentSignal = aggRows.some((row) => row.sentimentSum24h !== 0);

  const surge: CandidateSignal[] = [];
  const sentiment: CandidateSignal[] = [];
  for (const agg of aggRows) {
    const name = entityNames.get(agg.entityId);
    if (!name) continue;
    const articleIds = (articlesByEntity.get(agg.entityId) ?? []).map((a) => a.articleId);

    const surgeSignal = buildSurgeSignal(agg.entityId, name, agg, articleIds, settings);
    if (surgeSignal) surge.push(surgeSignal);

    if (anySentimentSignal) {
      const sentimentSignal = buildSentimentSignal(agg.entityId, name, agg, articleIds);
      if (sentimentSignal) sentiment.push(sentimentSignal);
    }
  }
  return { surge, sentiment };
}

// ---- cross-category detector (shares the articles24h panel) ----

function detectCrossCategory(articleRows: ArticleRow[], entityNames: Map<number, string>): CandidateSignal[] {
  const signals: CandidateSignal[] = [];
  for (const [entityId, rows] of groupArticlesByEntity(articleRows)) {
    const name = entityNames.get(entityId);
    if (!name) continue;
    const categories = new Set(rows.map((r) => r.sourceCategory));
    const scored = scoreCrossCategory(categories.size);
    if (!scored) continue;
    signals.push({
      dedupeKey: `cross_category:${entityId}`,
      type: "cross_category",
      severity: scored.severity,
      confidence: scored.confidence,
      title: `Cross-category: ${name} (${categories.size} categories)`,
      entityIds: [entityId],
      evidence: { categoryCount: categories.size, articleIds: capArticleIds(rows.map((r) => r.articleId)) },
    });
  }
  return signals;
}

// ---- first-seen novelty detector ----

interface NewEntityRow {
  id: number;
  canonicalName: string;
  firstSeenAt: Date;
}

// Both branches must scope to tracked-tracked pairs: entity_edges rows are
// written for ANY resolved mention pair regardless of entity status (the
// registry resolves dismissed entities too), so an unscoped MIN here could
// be pulled from a stray dismissed-entity edge with an unrelated
// first_seen_at, skewing the bootstrap guard against the tracked-tracked
// population loadRecentNovelEdges actually detects on.
async function loadGlobalMinFirstSeen(sql: Sql, table: "entities" | "entity_edges"): Promise<Date | null> {
  const rows = table === "entities"
    ? await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM entities WHERE status = 'tracked'`
    : await sql`
        SELECT MIN(ee.first_seen_at) AS min_first_seen
        FROM entity_edges ee
        JOIN entities ea ON ea.id = ee.entity_a
        JOIN entities eb ON eb.id = ee.entity_b
        WHERE ea.status = 'tracked' AND eb.status = 'tracked'
      `;
  const value = rows[0]?.min_first_seen;
  return value == null ? null : toDate(value);
}

async function loadRecentNewEntities(sql: Sql): Promise<NewEntityRow[]> {
  const rows = await sql`
    SELECT id, canonical_name, first_seen_at
    FROM entities
    WHERE status = 'tracked' AND first_seen_at >= now() - INTERVAL '48 hours'
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    firstSeenAt: toDate(row.first_seen_at),
  }));
}

async function loadEntityArticles(sql: Sql, entityIds: number[]): Promise<SqlRow[]> {
  if (entityIds.length === 0) return [];
  return sql`
    SELECT ae.entity_id, a.id AS article_id, a.source_name
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE a.dup_group_id IS NULL AND ae.entity_id = ANY(${entityIds}::bigint[])
  `;
}

async function detectFirstSeenNovelty(sql: Sql): Promise<CandidateSignal[]> {
  const globalMin = await loadGlobalMinFirstSeen(sql, "entities");
  if (!globalMin) return [];

  const candidates = await loadRecentNewEntities(sql);
  const eligible = candidates.filter((c) => !isBootstrapCohort(c.firstSeenAt, globalMin));
  if (eligible.length === 0) return [];

  const articleRows = await loadEntityArticles(sql, eligible.map((c) => c.id));
  const byEntity = new Map<number, { articleId: number; sourceName: string }[]>();
  for (const row of articleRows) {
    const entityId = Number(row.entity_id);
    const entry = { articleId: Number(row.article_id), sourceName: String(row.source_name) };
    const group = byEntity.get(entityId);
    if (group) group.push(entry);
    else byEntity.set(entityId, [entry]);
  }

  const signals: CandidateSignal[] = [];
  for (const entity of eligible) {
    const rows = byEntity.get(entity.id) ?? [];
    const sourceCount = new Set(rows.map((r) => r.sourceName)).size;
    const scored = scoreFirstSeenNovelty(sourceCount);
    if (!scored) continue;
    signals.push({
      dedupeKey: `first_seen:${entity.id}`,
      type: "first_seen",
      severity: scored.severity,
      confidence: scored.confidence,
      title: `New: ${entity.canonicalName} (${sourceCount} sources)`,
      entityIds: [entity.id],
      evidence: { sourceCount, articleIds: capArticleIds(rows.map((r) => r.articleId)) },
    });
  }
  return signals;
}

// ---- novel edge detector ----

interface NovelEdgeRow {
  entityA: number;
  entityB: number;
  nameA: string;
  nameB: string;
  firstSeenAt: Date;
  articleCount: number;
}

async function loadRecentNovelEdges(sql: Sql): Promise<NovelEdgeRow[]> {
  const rows = await sql`
    SELECT ee.entity_a, ee.entity_b, ea.canonical_name AS name_a, eb.canonical_name AS name_b,
      ee.first_seen_at, ee.article_count
    FROM entity_edges ee
    JOIN entities ea ON ea.id = ee.entity_a
    JOIN entities eb ON eb.id = ee.entity_b
    WHERE ee.first_seen_at >= now() - INTERVAL '48 hours'
      AND ee.article_count >= 2
      AND ea.status = 'tracked' AND eb.status = 'tracked'
  `;
  return rows.map((row) => ({
    entityA: Number(row.entity_a),
    entityB: Number(row.entity_b),
    nameA: String(row.name_a),
    nameB: String(row.name_b),
    firstSeenAt: toDate(row.first_seen_at),
    articleCount: Number(row.article_count),
  }));
}

async function loadEdgeArticles(sql: Sql, edges: NovelEdgeRow[]): Promise<Map<string, number[]>> {
  if (edges.length === 0) return new Map();
  const rows = await sql`
    SELECT ae1.article_id, v.a AS entity_a, v.b AS entity_b
    FROM UNNEST(${edges.map((e) => e.entityA)}::bigint[], ${edges.map((e) => e.entityB)}::bigint[]) AS v(a, b)
    JOIN article_entities ae1 ON ae1.entity_id = v.a
    JOIN article_entities ae2 ON ae2.entity_id = v.b AND ae2.article_id = ae1.article_id
    JOIN articles art ON art.id = ae1.article_id AND art.dup_group_id IS NULL
  `;
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${Number(row.entity_a)}:${Number(row.entity_b)}`;
    const list = map.get(key);
    const articleId = Number(row.article_id);
    if (list) list.push(articleId);
    else map.set(key, [articleId]);
  }
  return map;
}

async function detectNovelEdges(sql: Sql): Promise<CandidateSignal[]> {
  const globalMin = await loadGlobalMinFirstSeen(sql, "entity_edges");
  if (!globalMin) return [];

  const edges = await loadRecentNovelEdges(sql);
  const eligible = edges.filter((e) => !isBootstrapCohort(e.firstSeenAt, globalMin));
  if (eligible.length === 0) return [];

  const articlesByPair = await loadEdgeArticles(sql, eligible);

  const signals: CandidateSignal[] = [];
  for (const edge of eligible) {
    const scored = scoreNovelEdge(edge.articleCount);
    if (!scored) continue;
    const articleIds = articlesByPair.get(`${edge.entityA}:${edge.entityB}`) ?? [];
    signals.push({
      dedupeKey: `novel_edge:${edge.entityA}:${edge.entityB}`,
      type: "novel_edge",
      severity: scored.severity,
      confidence: scored.confidence,
      title: `Emerging link: ${edge.nameA} + ${edge.nameB}`,
      entityIds: [edge.entityA, edge.entityB],
      evidence: { articleCount: edge.articleCount, articleIds: capArticleIds(articleIds) },
    });
  }
  return signals;
}

// ---- orchestrator ----

async function loadTrackedEntityNames(sql: Sql): Promise<Map<number, string>> {
  const rows = await sql`SELECT id, canonical_name FROM entities WHERE status = 'tracked'`;
  return new Map(rows.map((row) => [Number(row.id), String(row.canonical_name)]));
}

export async function runDetectors(sql: Sql, settings: Settings): Promise<CandidateSignal[]> {
  const [entityNames, aggRows, articleRows, firstSeen, novelEdge] = await Promise.all([
    loadTrackedEntityNames(sql),
    loadHourlyAgg(sql),
    loadArticles24h(sql),
    detectFirstSeenNovelty(sql),
    detectNovelEdges(sql),
  ]);

  const { surge, sentiment } = buildSurgeAndSentiment(aggRows, articleRows, settings, entityNames);
  const crossCategory = detectCrossCategory(articleRows, entityNames);

  return [...surge, ...firstSeen, ...novelEdge, ...crossCategory, ...sentiment];
}
