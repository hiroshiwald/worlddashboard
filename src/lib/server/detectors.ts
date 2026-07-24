import type { Sql, SqlRow } from "./db";
import type { Settings } from "./settings";
import { computeFameVolumeThreshold, isFamous, loadLifetimeSourceBreadth } from "./fame";

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
const MIN_DAYS_SINCE_EPOCH = 4;
const BOOTSTRAP_GUARD_HOURS = 72;
const MAX_EVIDENCE_ARTICLES = 5;
const MIN_FIRST_SEEN_SOURCES = 2;
const CRITICAL_FIRST_SEEN_SOURCES = 8;
const MIN_NOVEL_EDGE_ARTICLES = 2;
const CRITICAL_NOVEL_EDGE_ARTICLES = 6;
const MIN_CATEGORY_COUNT_24H = 4;
const MIN_CATEGORY_EXCESS = 2;
const MIN_SENTIMENT_MENTIONS = 5;
const MIN_SENTIMENT_BASELINE_MENTIONS = 10;
const SENTIMENT_DELTA_THRESHOLD = -0.3;
const SENTIMENT_CRITICAL_DELTA = -0.5;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function capArticleIds(ids: number[]): number[] {
  return ids.slice(0, MAX_EVIDENCE_ARTICLES);
}

// ---- pure scoring functions (synthetic-panel testable) ----

/** Skips (returns null) for entities with <3 days of baseline history, or
 * when the system itself is under MIN_DAYS_SINCE_EPOCH days old — cold
 * start, not a real absence of surprise. Fires when z >= k. */
export function scoreSurge(
  observed24h: number,
  baselineDaily: number,
  baselineDays: number,
  k: number,
  daysSinceEpoch: number,
): { z: number; severity: SignalSeverity; confidence: number } | null {
  if (baselineDays < MIN_BASELINE_DAYS) return null;
  if (daysSinceEpoch < MIN_DAYS_SINCE_EPOCH) return null;
  const z = (observed24h - baselineDaily) / Math.sqrt(baselineDaily + 1);
  if (z < k) return null;
  const severity: SignalSeverity = z >= 2 * k ? "critical" : z >= 1.5 * k ? "warning" : "advisory";
  const confidence = Math.min(1, z / (2 * k));
  return { z, severity, confidence };
}

export function scoreFirstSeenNovelty(sourceCount: number): { severity: SignalSeverity; confidence: number } | null {
  if (sourceCount < MIN_FIRST_SEEN_SOURCES) return null;
  const severity: SignalSeverity = sourceCount >= CRITICAL_FIRST_SEEN_SOURCES ? "critical" : "warning";
  const confidence = Math.min(1, sourceCount / CRITICAL_FIRST_SEEN_SOURCES);
  return { severity, confidence };
}

export function scoreNovelEdge(articleCount: number): { severity: SignalSeverity; confidence: number } | null {
  if (articleCount < MIN_NOVEL_EDGE_ARTICLES) return null;
  const severity: SignalSeverity = articleCount >= CRITICAL_NOVEL_EDGE_ARTICLES ? "critical" : "warning";
  const confidence = Math.min(1, articleCount / CRITICAL_NOVEL_EDGE_ARTICLES);
  return { severity, confidence };
}

/** Fires on a spread from the entity's OWN baseline, not an absolute category
 * count — a prominent entity that always spans many categories must not
 * perpetually trip this. Skips (returns null) for entities with <3 active
 * baseline days (cold start / not enough history to know what's normal). */
export function scoreCategorySpread(
  categoryCount24h: number,
  baselineAvgCategories: number,
  baselineActiveDays: number,
): { excess: number; severity: SignalSeverity; confidence: number } | null {
  if (baselineActiveDays < MIN_BASELINE_DAYS) return null;
  if (categoryCount24h < MIN_CATEGORY_COUNT_24H) return null;
  const excess = categoryCount24h - baselineAvgCategories;
  if (excess < MIN_CATEGORY_EXCESS) return null;
  const severity: SignalSeverity = excess >= 4 ? "critical" : excess >= 3 ? "warning" : "advisory";
  const confidence = Math.min(1, excess / 4);
  return { excess, severity, confidence };
}

/** Fires on a DROP from the entity's own baseline sentiment, not an absolute
 * negative level — an entity whose coverage is always negative (e.g. an
 * active war zone) must not perpetually trip this; only a genuine
 * deterioration from its own norm does. Skips (returns null) for entities
 * with <3 baseline days or <10 baseline mentions (not enough history to
 * know what's normal). */
export function scoreSentimentDelta(
  mentions24h: number,
  avg24h: number,
  baselineAvg: number,
  baselineDays: number,
  baselineMentions: number,
): { delta: number; severity: SignalSeverity; confidence: number } | null {
  if (baselineDays < MIN_BASELINE_DAYS) return null;
  if (baselineMentions < MIN_SENTIMENT_BASELINE_MENTIONS) return null;
  if (mentions24h < MIN_SENTIMENT_MENTIONS) return null;
  const delta = avg24h - baselineAvg;
  if (delta > SENTIMENT_DELTA_THRESHOLD) return null;
  const severity: SignalSeverity = delta <= SENTIMENT_CRITICAL_DELTA && mentions24h >= 10 ? "critical" : "warning";
  const confidence = Math.min(1, Math.abs(delta) * 2);
  return { delta, severity, confidence };
}

/** True when `candidateFirstSeenAt` falls within BOOTSTRAP_GUARD_HOURS of the
 * earliest first_seen_at in its table — the initial dictionary-import cohort
 * (every country seen on day one) that would otherwise flood the queue. */
export function isBootstrapCohort(candidateFirstSeenAt: Date, globalMinFirstSeenAt: Date): boolean {
  return candidateFirstSeenAt.getTime() - globalMinFirstSeenAt.getTime() < BOOTSTRAP_GUARD_HOURS * 3600 * 1000;
}

export interface WarmupState {
  active: boolean;
  daysRemaining: number;
}

/** True (and history-dependent detectors stay silent) when the system has
 * no observed articles yet, or hasn't been running long enough to have
 * accumulated a real operating history — distinct from isBootstrapCohort,
 * which guards individual entities/edges once the system itself is past
 * warm-up. */
export function computeWarmupState(epoch: Date | null, warmupDays: number, now: Date): WarmupState {
  if (!epoch) return { active: true, daysRemaining: warmupDays };
  const elapsedDays = (now.getTime() - epoch.getTime()) / (24 * 3600 * 1000);
  return { active: elapsedDays < warmupDays, daysRemaining: Math.max(0, warmupDays - elapsedDays) };
}

function computeDaysSinceEpoch(now: Date, epoch: Date): number {
  return Math.floor((now.getTime() - epoch.getTime()) / (24 * 3600 * 1000));
}

/** The surge baseline denominator: real elapsed operating days (excluding
 * the most recent, still-accumulating day), clamped to at least 1 and to
 * the BASELINE_WINDOW_DAYS ceiling. Replaces the old fixed 14-day divisor,
 * which overstated the denominator (understating λ) for a system that
 * hadn't actually been running that long. */
export function computeEffectiveBaselineDays(daysSinceEpoch: number): number {
  return Math.min(Math.max(daysSinceEpoch - 1, 1), BASELINE_WINDOW_DAYS);
}

// ---- panel queries (batched, tracked entities + cluster-head articles only) ----

interface HourlyAggRow {
  entityId: number;
  observed24h: number;
  sentimentSum24h: number;
  baselineSum: number;
  baselineSentimentSum: number;
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
      COALESCE(SUM(emh.sentiment_sum) FILTER (
        WHERE emh.bucket < now() - INTERVAL '24 hours' AND emh.bucket >= now() - INTERVAL '15 days'
      ), 0) AS baseline_sentiment_sum,
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
    baselineSentimentSum: Number(row.baseline_sentiment_sum),
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

interface CategoryBaselineRow {
  entityId: number;
  baselineActiveDays: number;
  baselineAvgCategories: number;
}

/** Per entity, the average number of distinct source categories seen on an
 * ACTIVE day (a day with >=1 mention) over the trailing 14 days excluding
 * the last 24h — the "usually spans ~N categories" an entity's 24h count is
 * compared against. */
async function loadCategoryBaseline(sql: Sql): Promise<CategoryBaselineRow[]> {
  const rows = await sql`
    SELECT entity_id, COUNT(*) AS active_days, AVG(day_categories) AS avg_categories
    FROM (
      SELECT ae.entity_id AS entity_id,
        date_trunc('day', COALESCE(a.published_at, a.first_seen_at)) AS day,
        COUNT(DISTINCT a.source_category) AS day_categories
      FROM article_entities ae
      JOIN articles a ON a.id = ae.article_id
      JOIN entities e ON e.id = ae.entity_id
      WHERE e.status = 'tracked' AND a.dup_group_id IS NULL
        AND COALESCE(a.published_at, a.first_seen_at) < now() - INTERVAL '24 hours'
        AND COALESCE(a.published_at, a.first_seen_at) >= now() - INTERVAL '15 days'
      GROUP BY ae.entity_id, day
    ) daily
    GROUP BY entity_id
  `;
  return rows.map((row) => ({
    entityId: Number(row.entity_id),
    baselineActiveDays: Number(row.active_days),
    baselineAvgCategories: Number(row.avg_categories),
  }));
}

// ---- surge + sentiment detectors (share the hourly-agg panel) ----

function buildSurgeSignal(
  entityId: number,
  name: string,
  agg: HourlyAggRow,
  articleIds: number[],
  settings: Settings,
  effectiveBaselineDays: number,
  daysSinceEpoch: number,
): CandidateSignal | null {
  const baselineDaily = agg.baselineSum / effectiveBaselineDays;
  const scored = scoreSurge(agg.observed24h, baselineDaily, agg.baselineDays, settings.surprise_k, daysSinceEpoch);
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
  const avg24h = agg.sentimentSum24h / agg.observed24h;
  const baselineAvg = agg.baselineSum > 0 ? agg.baselineSentimentSum / agg.baselineSum : 0;
  const scored = scoreSentimentDelta(agg.observed24h, avg24h, baselineAvg, agg.baselineDays, agg.baselineSum);
  if (!scored) return null;
  return {
    dedupeKey: `sentiment:${entityId}`,
    type: "sentiment",
    severity: scored.severity,
    confidence: scored.confidence,
    title: `Tone shift: ${name}`,
    entityIds: [entityId],
    evidence: {
      avg24h,
      baselineAvg,
      delta: scored.delta,
      mentions24h: agg.observed24h,
      articleIds: capArticleIds(articleIds),
    },
  };
}

function buildSurgeAndSentiment(
  aggRows: HourlyAggRow[],
  articlesByEntity: Map<number, ArticleRow[]>,
  settings: Settings,
  entityNames: Map<number, string>,
  effectiveBaselineDays: number,
  daysSinceEpoch: number,
): { surge: CandidateSignal[]; sentiment: CandidateSignal[] } {
  // If every tracked entity's 24h sentiment_sum is exactly zero, that's not
  // a panel of genuinely neutral coverage — it's the shape of a sentiment
  // pipeline outage. Under the deviation-based scorer, an outage like that
  // would read as a sharp negative delta for every entity with a positive
  // baseline (delta = 0 - baselineAvg), firing a signal storm driven by a
  // data gap rather than any real tone shift, so the whole sentiment pass is
  // skipped for this run instead.
  const anySentimentSignal = aggRows.some((row) => row.sentimentSum24h !== 0);

  const surge: CandidateSignal[] = [];
  const sentiment: CandidateSignal[] = [];
  for (const agg of aggRows) {
    const name = entityNames.get(agg.entityId);
    if (!name) continue;
    const articleIds = (articlesByEntity.get(agg.entityId) ?? []).map((a) => a.articleId);

    const surgeSignal = buildSurgeSignal(agg.entityId, name, agg, articleIds, settings, effectiveBaselineDays, daysSinceEpoch);
    if (surgeSignal) surge.push(surgeSignal);

    if (anySentimentSignal) {
      const sentimentSignal = buildSentimentSignal(agg.entityId, name, agg, articleIds);
      if (sentimentSignal) sentiment.push(sentimentSignal);
    }
  }
  return { surge, sentiment };
}

// ---- cross-category detector (shares the articles24h panel) ----

function detectCrossCategory(
  articlesByEntity: Map<number, ArticleRow[]>,
  baselineRows: CategoryBaselineRow[],
  entityNames: Map<number, string>,
): CandidateSignal[] {
  const baselineByEntity = new Map(baselineRows.map((row) => [row.entityId, row]));
  const signals: CandidateSignal[] = [];
  for (const [entityId, rows] of articlesByEntity) {
    const name = entityNames.get(entityId);
    if (!name) continue;
    const baseline = baselineByEntity.get(entityId);
    if (!baseline) continue;

    const categoryCount24h = new Set(rows.map((r) => r.sourceCategory)).size;
    const scored = scoreCategorySpread(categoryCount24h, baseline.baselineAvgCategories, baseline.baselineActiveDays);
    if (!scored) continue;
    signals.push({
      dedupeKey: `cross_category:${entityId}`,
      type: "cross_category",
      severity: scored.severity,
      confidence: scored.confidence,
      title: `Category spread: ${name} (${categoryCount24h} categories, usually ~${baseline.baselineAvgCategories.toFixed(1)})`,
      entityIds: [entityId],
      evidence: {
        categoryCount24h,
        baselineAvgCategories: baseline.baselineAvgCategories,
        excess: scored.excess,
        articleIds: capArticleIds(rows.map((r) => r.articleId)),
      },
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
  aliasesA: string[];
  aliasesB: string[];
  firstSeenAt: Date;
  articleCount: number;
}

async function loadRecentNovelEdges(sql: Sql): Promise<NovelEdgeRow[]> {
  const rows = await sql`
    SELECT ee.entity_a, ee.entity_b, ea.canonical_name AS name_a, eb.canonical_name AS name_b,
      ea.aliases AS aliases_a, eb.aliases AS aliases_b,
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
    aliasesA: toStringArray(row.aliases_a),
    aliasesB: toStringArray(row.aliases_b),
    firstSeenAt: toDate(row.first_seen_at),
    articleCount: Number(row.article_count),
  }));
}

/** max(3, 75th percentile) of baselineDaily over the hourly-agg panel — the
 * same population/percentile math fame.ts's computeFameVolumeThreshold
 * always takes, just assembled from detectors.ts's own already-loaded
 * panel instead of developments.ts's separate baseline query. */
function computeNovelEdgeFameThreshold(aggRows: HourlyAggRow[], effectiveBaselineDays: number): number {
  return computeFameVolumeThreshold(aggRows.map((row) => row.baselineSum / effectiveBaselineDays));
}

/** Suppresses a novel_edge candidate when BOTH endpoints are famous (full
 * fame test) — a famous-famous pair is expected co-coverage between two
 * already-known subjects (e.g. Washington + White House), not a genuine
 * emerging link. One-famous and zero-famous edges still fire. Bounded to
 * just this (typically small) 48h edge list's endpoint entities — never
 * the whole tracked roster (see fame.ts's loadLifetimeSourceBreadth). */
async function suppressFamousEdges(
  sql: Sql,
  edges: NovelEdgeRow[],
  aggRows: HourlyAggRow[],
  effectiveBaselineDays: number,
): Promise<NovelEdgeRow[]> {
  if (edges.length === 0) return edges;

  const endpointIds = Array.from(new Set(edges.flatMap((e) => [e.entityA, e.entityB])));
  const breadthById = await loadLifetimeSourceBreadth(sql, endpointIds);
  const baselineById = new Map(aggRows.map((row) => [row.entityId, row.baselineSum / effectiveBaselineDays]));
  const volumeThreshold = computeNovelEdgeFameThreshold(aggRows, effectiveBaselineDays);

  function endpointIsFamous(id: number, name: string, aliases: string[]): boolean {
    return isFamous(
      { names: [name, ...aliases], baselineDaily: baselineById.get(id) ?? 0, sourceBreadth: breadthById.get(id) ?? 0 },
      volumeThreshold,
    );
  }

  return edges.filter((e) => {
    const bothFamous = endpointIsFamous(e.entityA, e.nameA, e.aliasesA) && endpointIsFamous(e.entityB, e.nameB, e.aliasesB);
    return !bothFamous;
  });
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

async function detectNovelEdges(
  sql: Sql,
  aggRows: HourlyAggRow[],
  effectiveBaselineDays: number,
): Promise<CandidateSignal[]> {
  const globalMin = await loadGlobalMinFirstSeen(sql, "entity_edges");
  if (!globalMin) return [];

  const edges = await loadRecentNovelEdges(sql);
  const eligible = edges.filter((e) => !isBootstrapCohort(e.firstSeenAt, globalMin));
  if (eligible.length === 0) return [];

  const surviving = await suppressFamousEdges(sql, eligible, aggRows, effectiveBaselineDays);
  if (surviving.length === 0) return [];

  const articlesByPair = await loadEdgeArticles(sql, surviving);

  const signals: CandidateSignal[] = [];
  for (const edge of surviving) {
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

/** The system's operating epoch — the earliest article ARRIVAL (not publish
 * date) ever recorded. Deliberately unscoped by dup_group_id: a duplicate
 * member's own first_seen_at still reflects a real observation, and the
 * epoch answers "when did the platform start observing anything," not
 * "when did it see a cluster head." Anchors the warm-up gate below. */
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  return value == null ? null : toDate(value);
}

async function loadTrackedEntityNames(sql: Sql): Promise<Map<number, string>> {
  const rows = await sql`SELECT id, canonical_name FROM entities WHERE status = 'tracked'`;
  return new Map(rows.map((row) => [Number(row.id), String(row.canonical_name)]));
}

// Every detector depends on the system having a real operating history: not
// just surge/first-seen/novel-edge, but also cross_category and sentiment,
// whose baselines need 14 days of an entity's own prior behavior to compare
// against. During the first warmup_days after launch, a feed pre-load smears
// publish-dated articles across the prior week, faking exactly that history —
// so ALL detectors stay silent until warm-up clears, not a subset.
export async function runDetectors(sql: Sql, settings: Settings): Promise<CandidateSignal[]> {
  const epoch = await getSystemEpoch(sql);
  const now = new Date();
  const warmup = computeWarmupState(epoch, settings.warmup_days, now);
  if (warmup.active) {
    console.warn(`runDetectors: warm-up active (${warmup.daysRemaining.toFixed(1)}d remaining) — skipping all detectors`);
    return [];
  }
  // computeWarmupState only returns active:false when epoch is non-null (it
  // returns active:true unconditionally for a null epoch) — so warmup.active
  // being false here guarantees epoch is set. Asserted explicitly rather than
  // silently defaulting, so a future change to that contract fails loudly
  // here instead of quietly feeding a fabricated daysSinceEpoch=0 downstream.
  if (!epoch) throw new Error("runDetectors: epoch is null but warm-up is inactive — invariant violation");

  // Hoisted ahead of the Promise.all below (a slight restructure): the
  // novel-edge pass now needs the hourly-agg panel (baselineDaily + the
  // fame volume threshold) to suppress famous-famous edges, so it can no
  // longer run fully independently of it.
  const daysSinceEpoch = computeDaysSinceEpoch(now, epoch);
  const effectiveBaselineDays = computeEffectiveBaselineDays(daysSinceEpoch);
  const aggRows = await loadHourlyAgg(sql);

  const [entityNames, articleRows, categoryBaseline, firstSeen, novelEdge] = await Promise.all([
    loadTrackedEntityNames(sql),
    loadArticles24h(sql),
    loadCategoryBaseline(sql),
    detectFirstSeenNovelty(sql),
    detectNovelEdges(sql, aggRows, effectiveBaselineDays),
  ]);

  const articlesByEntity = groupArticlesByEntity(articleRows);
  const { surge, sentiment } = buildSurgeAndSentiment(
    aggRows,
    articlesByEntity,
    settings,
    entityNames,
    effectiveBaselineDays,
    daysSinceEpoch,
  );
  const crossCategory = detectCrossCategory(articlesByEntity, categoryBaseline, entityNames);

  return [...surge, ...firstSeen, ...novelEdge, ...crossCategory, ...sentiment];
}
