import type { Sql, SqlRow } from "./db";
import { extractCandidates, extractDictionaryOnlyCandidates, addCandidate, normalizeName, Candidate, TypeHint } from "./extract-v2";
import { scoreSentiment } from "../entity-extractor";
import { isLlmConfigured, extractEntitiesBatch, getLlmMonthStats } from "./llm-extract";
import { getSettings } from "./settings";

const LOOKBACK_HOURS = 6;
const MAX_CANDIDATE_SOURCES = 10;
const MAX_SAMPLE_TITLES = 3;
const MAX_CONTEXTS = 3;
const MAX_CO_ENTITIES = 5;
const LLM_BATCH_SIZE = 25;
// Batches dispatched to the LLM per wave — bounds concurrent Anthropic
// calls under the 60s Vercel function ceiling without going fully serial.
const LLM_WAVE_SIZE = 3;
// Wall-clock budget for the whole LLM extraction phase of one ingest run.
// Once exceeded, no further Anthropic calls are made this run — remaining
// articles fall back to the (fast) heuristic stack instead of risking the
// function running past its 60s ceiling on a catch-up backlog.
const LLM_TIME_BUDGET_MS = 20_000;

export interface EntityIngestStats {
  articlesProcessed: number;
  mentionsWritten: number;
  newEntities: number;
  candidatesTouched: number;
  llm: { used: boolean; articles: number; monthCostUsd: number };
}

// ---- shared row/date parsing ----

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

// ---- cluster-head selection ----

interface HeadArticle {
  id: number;
  title: string;
  summary: string;
  effectiveAt: Date;
  arrivalAt: Date;
  sourceName: string;
}

function parseHeadRow(row: SqlRow): HeadArticle {
  return {
    id: Number(row.id),
    title: String(row.title),
    summary: row.summary != null ? String(row.summary) : "",
    effectiveAt: toDate(row.published_at ?? row.first_seen_at),
    arrivalAt: toDate(row.first_seen_at),
    sourceName: String(row.source_name),
  };
}

/** Cluster heads from the lookback window not yet marked processed — the
 * idempotency check that lets re-runs and catch-up runs self-heal without
 * reprocessing already-resolved articles. Uses an explicit
 * entities_processed_at marker (set at the end of a successful run) rather
 * than NOT EXISTS(article_entities): an article whose extracted names are
 * all unresolved candidates never gets an article_entities row, so under a
 * NOT EXISTS gate it would be re-selected — and its entity_candidates
 * sightings re-accumulated — every run for its whole lookback window. */
async function selectUnprocessedHeads(sql: Sql): Promise<HeadArticle[]> {
  const rows = await sql`
    SELECT a.id, a.title, a.summary, a.published_at, a.first_seen_at, a.source_name
    FROM articles a
    WHERE a.dup_group_id IS NULL
      AND a.first_seen_at >= now() - make_interval(hours => ${LOOKBACK_HOURS}::int)
      AND a.entities_processed_at IS NULL
  `;
  return rows.map(parseHeadRow);
}

async function markArticlesProcessed(sql: Sql, articleIds: number[]): Promise<void> {
  if (articleIds.length === 0) return;
  await sql`
    UPDATE articles SET entities_processed_at = now() WHERE id = ANY(${articleIds}::bigint[])
  `;
}

// ---- entity registry (resolution step 1: DB, all statuses incl. dismissed) ----

interface EntityRecord {
  id: number;
  canonicalName: string;
  type: TypeHint;
}

function buildRegistryIndex(rows: SqlRow[]): Map<string, EntityRecord> {
  const index = new Map<string, EntityRecord>();
  for (const row of rows) {
    const record: EntityRecord = {
      id: Number(row.id),
      canonicalName: String(row.canonical_name),
      type: String(row.type) as TypeHint,
    };
    const names = [record.canonicalName, ...toStringArray(row.aliases)];
    for (const name of names) {
      const key = normalizeName(name);
      if (key && !index.has(key)) index.set(key, record);
    }
  }
  return index;
}

async function loadEntityRegistry(sql: Sql): Promise<Map<string, EntityRecord>> {
  const rows = await sql`SELECT id, canonical_name, type, aliases FROM entities ORDER BY id ASC`;
  return buildRegistryIndex(rows);
}

// ---- candidate resolution (registry -> dictionary -> entity_candidates) ----

interface ResolvedMention {
  articleId: number;
  entityId: number;
  effectiveAt: Date;
  arrivalAt: Date;
  sourceName: string;
  sentiment: number;
}

interface PendingMention {
  articleId: number;
  effectiveAt: Date;
  arrivalAt: Date;
  sourceName: string;
  sentiment: number;
}

interface PendingNewEntity {
  canonicalName: string;
  type: TypeHint;
  mentions: PendingMention[];
}

interface CandidateSighting {
  norm: string;
  display: string;
  typeHint: TypeHint;
  effectiveAt: Date;
  sourceName: string;
  title: string;
  /** From the LLM layer's role/context phrase, when present. */
  roleContext?: string;
  /** Canonical names of tracked entities resolved in the SAME article as
   * this sighting — filled in by processArticle once every candidate in
   * the article has been classified. */
  coEntities: string[];
}

type Classification =
  | { kind: "resolved"; mention: ResolvedMention; canonicalName: string }
  | { kind: "new-entity"; canonicalName: string; type: TypeHint; mention: PendingMention }
  | { kind: "candidate"; sighting: CandidateSighting };

function classifyCandidate(
  candidate: Candidate,
  article: HeadArticle,
  sentiment: number,
  registry: Map<string, EntityRecord>,
): Classification {
  const known = registry.get(candidate.norm);
  const mention: PendingMention = {
    articleId: article.id,
    effectiveAt: article.effectiveAt,
    arrivalAt: article.arrivalAt,
    sourceName: article.sourceName,
    sentiment,
  };

  if (known) {
    return { kind: "resolved", mention: { ...mention, entityId: known.id }, canonicalName: known.canonicalName };
  }
  if (candidate.layer === "dictionary") {
    return { kind: "new-entity", canonicalName: candidate.display, type: candidate.typeHint, mention };
  }
  return {
    kind: "candidate",
    sighting: {
      norm: candidate.norm,
      display: candidate.display,
      typeHint: candidate.typeHint,
      effectiveAt: article.effectiveAt,
      sourceName: article.sourceName,
      title: article.title,
      roleContext: candidate.roleContext,
      coEntities: [],
    },
  };
}

// Canonical names of every entity this article resolved to (pre-existing
// registry hits and freshly-created dictionary entities alike) — the
// co_entities value for every unresolved candidate sighting in the same
// article.
function collectResolvedNames(classifications: Classification[]): string[] {
  const names = new Set<string>();
  for (const c of classifications) {
    if (c.kind === "resolved" || c.kind === "new-entity") names.add(c.canonicalName);
  }
  return Array.from(names);
}

interface ClassifiedBatch {
  resolved: ResolvedMention[];
  newEntities: Map<string, PendingNewEntity>;
  candidateSightings: CandidateSighting[];
  processedArticleIds: number[];
}

function addNewEntityMention(
  newEntities: Map<string, PendingNewEntity>,
  canonicalName: string,
  type: TypeHint,
  mention: PendingMention,
): void {
  const existing = newEntities.get(canonicalName);
  if (existing) existing.mentions.push(mention);
  else newEntities.set(canonicalName, { canonicalName, type, mentions: [mention] });
}

// Shared failure log for a single per-article extraction/classification
// step — every per-article try/catch below (classification, heuristic
// extraction, LLM merge) routes through this one call site so the message
// and log level stay in sync.
function logArticleFailure(articleId: number, err: unknown): void {
  console.error(`processNewArticles: failed to process article ${articleId}, skipping (will retry next run)`, err);
}

// Classification runs inside its own try/catch: one pathological article
// must not abort the whole batch. A failing article is logged and left out
// of processedArticleIds, so it's simply not marked processed and retries
// on the next run. Candidate extraction (heuristic or LLM) happens upstream
// in extractAllCandidates, under the same per-article resilience contract.
function processArticle(
  article: HeadArticle,
  candidates: Candidate[],
  registry: Map<string, EntityRecord>,
  batch: Omit<ClassifiedBatch, "processedArticleIds">,
): boolean {
  try {
    const sentiment = scoreSentiment(`${article.title} ${article.summary}`);
    const classifications = candidates.map((c) => classifyCandidate(c, article, sentiment, registry));
    const resolvedNames = collectResolvedNames(classifications);

    for (const result of classifications) {
      if (result.kind === "resolved") batch.resolved.push(result.mention);
      else if (result.kind === "new-entity") {
        addNewEntityMention(batch.newEntities, result.canonicalName, result.type, result.mention);
      } else batch.candidateSightings.push({ ...result.sighting, coEntities: resolvedNames });
    }
    return true;
  } catch (err) {
    logArticleFailure(article.id, err);
    return false;
  }
}

// candidatesByArticle maps article id -> candidates, or null when
// extraction itself failed for that article (already logged upstream) —
// such an article is silently skipped here, matching processArticle's own
// not-marked-processed/retry-next-run contract.
function classifyAll(
  heads: HeadArticle[],
  candidatesByArticle: Map<number, Candidate[] | null>,
  registry: Map<string, EntityRecord>,
): ClassifiedBatch {
  const batch = {
    resolved: [] as ResolvedMention[],
    newEntities: new Map<string, PendingNewEntity>(),
    candidateSightings: [] as CandidateSighting[],
  };
  const processedArticleIds: number[] = [];
  for (const article of heads) {
    const candidates = candidatesByArticle.get(article.id);
    if (!candidates) continue;
    if (processArticle(article, candidates, registry, batch)) processedArticleIds.push(article.id);
  }
  return { ...batch, processedArticleIds };
}

// ---- candidate extraction: heuristic stack, or LLM + dictionary union ----

export function chunkArticles<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function mergeLlmWithDictionary(llmCandidates: Candidate[], title: string, summary: string): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of llmCandidates) addCandidate(map, c.display, c.typeHint, c.layer, c.roleContext);
  for (const c of extractDictionaryOnlyCandidates(title, summary)) addCandidate(map, c.display, c.typeHint, c.layer, c.roleContext);
  return Array.from(map.values());
}

function heuristicCandidatesForArticle(article: HeadArticle): Candidate[] | null {
  try {
    return extractCandidates(article.title, article.summary);
  } catch (err) {
    logArticleFailure(article.id, err);
    return null;
  }
}

function extractAllHeuristic(heads: HeadArticle[]): Map<number, Candidate[] | null> {
  const result = new Map<number, Candidate[] | null>();
  for (const article of heads) result.set(article.id, heuristicCandidatesForArticle(article));
  return result;
}

interface CandidateExtractionResult {
  candidatesByArticle: Map<number, Candidate[] | null>;
  llmArticleCount: number;
}

// For an article whose batch returned an LLM result: LLM candidates UNION
// the dictionary layer only (the dictionary stays the canonical anchor;
// compromise/acronym/person-regex/product-pattern are skipped). For an
// article with no LLM result (failed/unparseable batch, or the wall-clock
// deadline ran out before its batch was dispatched): the full heuristic
// stack.
function resolveArticleCandidates(
  article: HeadArticle,
  llmCandidates: Candidate[] | undefined,
): { candidates: Candidate[] | null; usedLlm: boolean } {
  if (!llmCandidates) return { candidates: heuristicCandidatesForArticle(article), usedLlm: false };
  try {
    return { candidates: mergeLlmWithDictionary(llmCandidates, article.title, article.summary), usedLlm: true };
  } catch (err) {
    logArticleFailure(article.id, err);
    return { candidates: null, usedLlm: false };
  }
}

// Heuristic-extracts every article in every batch from fromIndex onward —
// used once the wall-clock deadline has passed, so none of these batches
// ever call the LLM. Returns the count of articles it fell back for.
function fallbackRemainingBatches(
  batches: HeadArticle[][],
  fromIndex: number,
  candidatesByArticle: Map<number, Candidate[] | null>,
): number {
  let count = 0;
  for (const batch of batches.slice(fromIndex)) {
    for (const article of batch) {
      candidatesByArticle.set(article.id, heuristicCandidatesForArticle(article));
      count += 1;
    }
  }
  return count;
}

// Resolves one wave's settled batch results into candidatesByArticle.
// Returns how many articles in this wave actually used the LLM.
function applyWaveResults(
  wave: HeadArticle[][],
  waveResults: (Map<number, Candidate[]> | null)[],
  candidatesByArticle: Map<number, Candidate[] | null>,
): number {
  let llmUsed = 0;
  for (let batchIndex = 0; batchIndex < wave.length; batchIndex++) {
    const batch = wave[batchIndex];
    const llmResult = waveResults[batchIndex];
    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      const { candidates, usedLlm } = resolveArticleCandidates(article, llmResult?.get(i));
      candidatesByArticle.set(article.id, candidates);
      if (usedLlm) llmUsed += 1;
    }
  }
  return llmUsed;
}

// Runs LLM batches in waves of up to LLM_WAVE_SIZE concurrent Anthropic
// calls, checking the wall-clock deadline before each wave. Once the
// deadline has passed, no further API calls are made this run — every
// remaining article falls back to heuristics, so a catch-up backlog
// degrades gracefully instead of running /api/ingest past its 60s ceiling.
// deadline defaults to now + LLM_TIME_BUDGET_MS, computed once per call;
// the parameter exists so tests can pin it without real timers.
async function extractAllWithLlm(
  heads: HeadArticle[],
  sql: Sql,
  budgetUsd: number,
  deadline: number = Date.now() + LLM_TIME_BUDGET_MS,
): Promise<CandidateExtractionResult> {
  const candidatesByArticle = new Map<number, Candidate[] | null>();
  const batches = chunkArticles(heads, LLM_BATCH_SIZE);
  let llmArticleCount = 0;
  let fallbackCount = 0;

  for (let i = 0; i < batches.length; i += LLM_WAVE_SIZE) {
    if (Date.now() >= deadline) {
      fallbackCount += fallbackRemainingBatches(batches, i, candidatesByArticle);
      break;
    }

    const wave = batches.slice(i, i + LLM_WAVE_SIZE);
    const waveResults = await Promise.all(
      wave.map((batch) =>
        extractEntitiesBatch(sql, budgetUsd, batch.map((article, j) => ({ index: j, title: article.title, summary: article.summary }))),
      ),
    );
    llmArticleCount += applyWaveResults(wave, waveResults, candidatesByArticle);
  }

  if (fallbackCount > 0) {
    console.warn(`processNewArticles: LLM wall-clock deadline exceeded, ${fallbackCount} article(s) fell back to heuristic extraction`);
  }
  return { candidatesByArticle, llmArticleCount };
}

// isLlmConfigured() gates whether this run touches llm_usage/settings at
// all — a deploy with no ANTHROPIC_API_KEY issues zero LLM-related queries.
// llmDeadline threads through to extractAllWithLlm's wall-clock cutoff;
// left undefined in production so it defaults to now + LLM_TIME_BUDGET_MS.
async function extractAllCandidates(heads: HeadArticle[], sql: Sql, llmDeadline?: number): Promise<CandidateExtractionResult> {
  if (!isLlmConfigured()) {
    return { candidatesByArticle: extractAllHeuristic(heads), llmArticleCount: 0 };
  }
  const settings = await getSettings(sql);
  return extractAllWithLlm(heads, sql, settings.llm_monthly_budget_usd, llmDeadline);
}

// The LLM month-cost read is purely informational for the ingest response —
// it must never turn an otherwise-successful, already-committed run into a
// reported failure.
async function safeLlmMonthCost(sql: Sql): Promise<number> {
  if (!isLlmConfigured()) return 0;
  try {
    return (await getLlmMonthStats(sql)).costUsd;
  } catch (err) {
    console.warn("processNewArticles: failed to read LLM month stats for the ingest response", err);
    return 0;
  }
}

// ---- new dictionary-first-hit entities: batch insert, then resolve ids ----

interface InsertedEntity {
  id: number;
  canonicalName: string;
}

async function upsertNewEntities(
  sql: Sql,
  newEntities: Map<string, PendingNewEntity>,
): Promise<InsertedEntity[]> {
  if (newEntities.size === 0) return [];
  const rows = Array.from(newEntities.values()).map((e) => {
    // entities.first_seen_at/last_seen_at are watch-time (arrival), not
    // news-time (publish date) — a feed pre-load's backdated published_at
    // must never smear these earlier than the system actually observed them.
    const times = e.mentions.map((m) => m.arrivalAt.getTime());
    return {
      canonicalName: e.canonicalName,
      type: e.type,
      firstSeenAt: new Date(Math.min(...times)).toISOString(),
      lastSeenAt: new Date(Math.max(...times)).toISOString(),
    };
  });

  const result = await sql`
    INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
    SELECT name, type, 'tracked', first_seen, last_seen FROM UNNEST(
      ${rows.map((r) => r.canonicalName)}::text[],
      ${rows.map((r) => r.type)}::text[],
      ${rows.map((r) => r.firstSeenAt)}::timestamptz[],
      ${rows.map((r) => r.lastSeenAt)}::timestamptz[]
    ) AS t(name, type, first_seen, last_seen)
    ON CONFLICT (canonical_name) DO UPDATE
      SET last_seen_at = GREATEST(entities.last_seen_at, EXCLUDED.last_seen_at)
    RETURNING id, canonical_name
  `;

  return result.map((row) => ({ id: Number(row.id), canonicalName: String(row.canonical_name) }));
}

function resolveNewEntityMentions(
  newEntities: Map<string, PendingNewEntity>,
  inserted: InsertedEntity[],
): ResolvedMention[] {
  const idByName = new Map(inserted.map((e) => [e.canonicalName, e.id]));
  const mentions: ResolvedMention[] = [];
  for (const entity of newEntities.values()) {
    const id = idByName.get(entity.canonicalName);
    if (id === undefined) {
      throw new Error(`resolveNewEntityMentions: no id returned for entity "${entity.canonicalName}"`);
    }
    for (const m of entity.mentions) mentions.push({ ...m, entityId: id });
  }
  return mentions;
}

// ---- mention dedup ----

// A single article can produce two resolved mentions of the same entity when
// two different surface forms in its text both normalize to aliases of that
// entity (e.g. "US" and "United States" both present, both registered on the
// same entity). Applied once, upstream of article_entities/hourly/edges, so
// none of those double-count a mention that's really one article's worth.
export function dedupeMentions(mentions: ResolvedMention[]): ResolvedMention[] {
  const seen = new Set<string>();
  const deduped: ResolvedMention[] = [];
  for (const m of mentions) {
    const key = `${m.articleId}:${m.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  return deduped;
}

// ---- entity last_seen_at bump ----

// entities.last_seen_at is only ever set by upsertNewEntities (on first
// mention). A mention that resolves against an EXISTING registry entity
// never touches it again, so a tracked entity's last_seen_at freezes at
// creation time even while it keeps being mentioned. Bump it here for every
// resolved mention (a harmless no-op re-set for just-created entities, since
// upsertNewEntities already set it to the same value). Uses arrivalAt (when
// the system observed the article), not effectiveAt (when it was
// published) — last_seen_at tracks watch time, not news time.
function maxSeenByEntity(mentions: ResolvedMention[]): Map<number, Date> {
  const maxSeen = new Map<number, Date>();
  for (const m of mentions) {
    const current = maxSeen.get(m.entityId);
    if (!current || m.arrivalAt > current) maxSeen.set(m.entityId, m.arrivalAt);
  }
  return maxSeen;
}

async function bumpEntityLastSeen(sql: Sql, mentions: ResolvedMention[]): Promise<void> {
  const maxSeen = maxSeenByEntity(mentions);
  if (maxSeen.size === 0) return;
  const ids = Array.from(maxSeen.keys());
  const maxes = ids.map((id) => maxSeen.get(id)!.toISOString());
  await sql`
    UPDATE entities SET last_seen_at = GREATEST(COALESCE(entities.last_seen_at, '-infinity'), v.max_seen)
    FROM UNNEST(${ids}::bigint[], ${maxes}::timestamptz[]) AS v(id, max_seen)
    WHERE entities.id = v.id
  `;
}

// ---- article_entities ----

async function insertArticleEntities(sql: Sql, mentions: ResolvedMention[]): Promise<void> {
  if (mentions.length === 0) return;
  await sql`
    INSERT INTO article_entities (article_id, entity_id)
    SELECT * FROM UNNEST(
      ${mentions.map((m) => m.articleId)}::bigint[],
      ${mentions.map((m) => m.entityId)}::bigint[]
    )
    ON CONFLICT DO NOTHING
  `;
}

// ---- entity_mentions_hourly rollup ----

export interface HourlyRollupRow {
  entityId: number;
  bucket: string;
  mentions: number;
  sourceCount: number;
  sentimentSum: number;
}

function hourBucket(date: Date): string {
  const truncated = new Date(date);
  truncated.setUTCMinutes(0, 0, 0);
  return truncated.toISOString();
}

// Buckets on effectiveAt (news time: publish date), NOT arrivalAt (watch
// time) — publish-date spread is the correct shape for trend charts, even
// though first/last_seen on entities/edges must use arrival time instead
// (see groupMentionsByArticle/rollupEntityEdges below and upsertNewEntities
// above).
export function rollupHourlyMentions(mentions: ResolvedMention[]): HourlyRollupRow[] {
  const groups = new Map<string, { entityId: number; bucket: string; mentions: number; sources: Set<string>; sentimentSum: number }>();
  for (const m of mentions) {
    const bucket = hourBucket(m.effectiveAt);
    const key = `${m.entityId}:${bucket}`;
    const group = groups.get(key);
    if (group) {
      group.mentions += 1;
      group.sources.add(m.sourceName);
      group.sentimentSum += m.sentiment;
    } else {
      groups.set(key, { entityId: m.entityId, bucket, mentions: 1, sources: new Set([m.sourceName]), sentimentSum: m.sentiment });
    }
  }
  return Array.from(groups.values()).map((g) => ({
    entityId: g.entityId,
    bucket: g.bucket,
    mentions: g.mentions,
    sourceCount: g.sources.size,
    sentimentSum: g.sentimentSum,
  }));
}

// source_count is a same-batch approximation (distinct sources seen in this
// run only) reconciled upward via GREATEST; exact per-source counts require
// joining article_entities while the underlying articles are still retained.
async function upsertHourlyMentions(sql: Sql, rows: HourlyRollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    INSERT INTO entity_mentions_hourly (entity_id, bucket, mentions, source_count, sentiment_sum)
    SELECT * FROM UNNEST(
      ${rows.map((r) => r.entityId)}::bigint[],
      ${rows.map((r) => r.bucket)}::timestamptz[],
      ${rows.map((r) => r.mentions)}::int[],
      ${rows.map((r) => r.sourceCount)}::int[],
      ${rows.map((r) => r.sentimentSum)}::real[]
    )
    ON CONFLICT (entity_id, bucket) DO UPDATE SET
      mentions = entity_mentions_hourly.mentions + EXCLUDED.mentions,
      source_count = GREATEST(entity_mentions_hourly.source_count, EXCLUDED.source_count),
      sentiment_sum = entity_mentions_hourly.sentiment_sum + EXCLUDED.sentiment_sum
  `;
}

// ---- entity_edges rollup ----

export interface EdgeRollupRow {
  entityA: number;
  entityB: number;
  firstSeenAt: string;
  lastSeenAt: string;
  articleCount: number;
}

// entity_edges.first_seen_at/last_seen_at are watch-time (arrivalAt), the
// deliberate opposite of rollupHourlyMentions' effectiveAt buckets above.
function groupMentionsByArticle(mentions: ResolvedMention[]): Map<number, { entityIds: Set<number>; arrivalAt: Date }> {
  const byArticle = new Map<number, { entityIds: Set<number>; arrivalAt: Date }>();
  for (const m of mentions) {
    const group = byArticle.get(m.articleId);
    if (group) group.entityIds.add(m.entityId);
    else byArticle.set(m.articleId, { entityIds: new Set([m.entityId]), arrivalAt: m.arrivalAt });
  }
  return byArticle;
}

export function rollupEntityEdges(mentions: ResolvedMention[]): EdgeRollupRow[] {
  const byArticle = groupMentionsByArticle(mentions);
  const groups = new Map<string, { entityA: number; entityB: number; articleCount: number; firstSeenAt: Date; lastSeenAt: Date }>();

  for (const { entityIds, arrivalAt } of byArticle.values()) {
    const ids = Array.from(entityIds).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}:${ids[j]}`;
        const group = groups.get(key);
        if (group) {
          group.articleCount += 1;
          if (arrivalAt < group.firstSeenAt) group.firstSeenAt = arrivalAt;
          if (arrivalAt > group.lastSeenAt) group.lastSeenAt = arrivalAt;
        } else {
          groups.set(key, { entityA: ids[i], entityB: ids[j], articleCount: 1, firstSeenAt: arrivalAt, lastSeenAt: arrivalAt });
        }
      }
    }
  }

  return Array.from(groups.values()).map((g) => ({
    entityA: g.entityA,
    entityB: g.entityB,
    firstSeenAt: g.firstSeenAt.toISOString(),
    lastSeenAt: g.lastSeenAt.toISOString(),
    articleCount: g.articleCount,
  }));
}

async function upsertEntityEdges(sql: Sql, rows: EdgeRollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    INSERT INTO entity_edges (entity_a, entity_b, first_seen_at, last_seen_at, article_count)
    SELECT * FROM UNNEST(
      ${rows.map((r) => r.entityA)}::bigint[],
      ${rows.map((r) => r.entityB)}::bigint[],
      ${rows.map((r) => r.firstSeenAt)}::timestamptz[],
      ${rows.map((r) => r.lastSeenAt)}::timestamptz[],
      ${rows.map((r) => r.articleCount)}::int[]
    )
    ON CONFLICT (entity_a, entity_b) DO UPDATE SET
      first_seen_at = LEAST(entity_edges.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(entity_edges.last_seen_at, EXCLUDED.last_seen_at),
      article_count = entity_edges.article_count + EXCLUDED.article_count
  `;
}

// ---- entity_candidates rollup (unresolved norms) ----

interface CandidateRow {
  nameNorm: string;
  displayName: string;
  typeHint: TypeHint;
  firstSeenAt: Date;
  lastSeenAt: Date;
  mentionCount: number;
  sourceNames: string[];
  dayCount: number;
  sampleTitles: string[];
  contexts: string[];
  coEntities: string[];
}

function parseCandidateRow(row: SqlRow): CandidateRow {
  return {
    nameNorm: String(row.name_norm),
    displayName: String(row.display_name),
    typeHint: String(row.type_hint) as TypeHint,
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    mentionCount: Number(row.mention_count),
    sourceNames: toStringArray(row.source_names),
    dayCount: Number(row.day_count),
    sampleTitles: toStringArray(row.sample_titles),
    contexts: toStringArray(row.contexts),
    coEntities: toStringArray(row.co_entities),
  };
}

async function loadExistingCandidates(sql: Sql, norms: string[]): Promise<Map<string, CandidateRow>> {
  const rows = await sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
           mention_count, source_names, day_count, sample_titles, contexts, co_entities
    FROM entity_candidates
    WHERE name_norm = ANY(${norms}::text[])
  `;
  return new Map(rows.map((r) => [String(r.name_norm), parseCandidateRow(r)]));
}

function groupSightingsByNorm(sightings: CandidateSighting[]): Map<string, CandidateSighting[]> {
  const groups = new Map<string, CandidateSighting[]>();
  for (const s of sightings) {
    const group = groups.get(s.norm);
    if (group) group.push(s);
    else groups.set(s.norm, [s]);
  }
  return groups;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Only increments once per newly-crossed UTC calendar day, chronologically —
// repeated same-day sightings (including reprocessing within the lookback
// window before an article resolves) never inflate it.
function computeDayCount(sortedSightings: CandidateSighting[], existing: CandidateRow | undefined): number {
  let dayCount = existing?.dayCount ?? 0;
  let lastDay = existing ? utcDay(existing.lastSeenAt) : null;
  for (const sighting of sortedSightings) {
    const day = utcDay(sighting.effectiveAt);
    if (lastDay === null || day > lastDay) {
      dayCount += 1;
      lastDay = day;
    }
  }
  return dayCount;
}

function pickDisplay(existing: CandidateRow | undefined, sorted: CandidateSighting[]): { display: string; typeHint: TypeHint } {
  if (existing) return { display: existing.displayName, typeHint: existing.typeHint };
  let best = sorted[0];
  for (const s of sorted) if (s.display.length > best.display.length) best = s;
  return { display: best.display, typeHint: best.typeHint };
}

export function rollupCandidate(
  norm: string,
  sightings: CandidateSighting[],
  existing: CandidateRow | undefined,
): CandidateRow {
  const sorted = [...sightings].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  const batchFirstSeen = sorted[0].effectiveAt;
  const batchLastSeen = sorted[sorted.length - 1].effectiveAt;
  const picked = pickDisplay(existing, sorted);

  return {
    nameNorm: norm,
    displayName: picked.display,
    typeHint: picked.typeHint,
    firstSeenAt: existing?.firstSeenAt ?? batchFirstSeen,
    lastSeenAt: existing && existing.lastSeenAt > batchLastSeen ? existing.lastSeenAt : batchLastSeen,
    mentionCount: (existing?.mentionCount ?? 0) + sorted.length,
    sourceNames: Array.from(new Set([...(existing?.sourceNames ?? []), ...sorted.map((s) => s.sourceName)])).slice(0, MAX_CANDIDATE_SOURCES),
    dayCount: computeDayCount(sorted, existing),
    sampleTitles: Array.from(new Set([...(existing?.sampleTitles ?? []), ...sorted.map((s) => s.title)])).slice(0, MAX_SAMPLE_TITLES),
    contexts: Array.from(new Set([
      ...(existing?.contexts ?? []),
      ...sorted.map((s) => s.roleContext).filter((r): r is string => Boolean(r)),
    ])).slice(0, MAX_CONTEXTS),
    coEntities: Array.from(new Set([...(existing?.coEntities ?? []), ...sorted.flatMap((s) => s.coEntities)])).slice(0, MAX_CO_ENTITIES),
  };
}

// Array-typed columns (source_names, sample_titles) are jagged per row, so a
// plain UNNEST (which flattens nested arrays) can't build them — jsonb_to_recordset
// decodes one JSON array of row objects into typed columns instead.
async function upsertCandidates(sql: Sql, rows: CandidateRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    name_norm: r.nameNorm,
    display_name: r.displayName,
    type_hint: r.typeHint,
    first_seen_at: r.firstSeenAt.toISOString(),
    last_seen_at: r.lastSeenAt.toISOString(),
    mention_count: r.mentionCount,
    source_names: r.sourceNames,
    day_count: r.dayCount,
    sample_titles: r.sampleTitles,
    contexts: r.contexts,
    co_entities: r.coEntities,
  }));

  await sql`
    INSERT INTO entity_candidates (
      name_norm, display_name, type_hint, first_seen_at, last_seen_at,
      mention_count, source_names, day_count, sample_titles, contexts, co_entities
    )
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
           mention_count, source_names, day_count, sample_titles, contexts, co_entities
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS t(
      name_norm text, display_name text, type_hint text,
      first_seen_at timestamptz, last_seen_at timestamptz,
      mention_count int, source_names text[], day_count int, sample_titles text[],
      contexts text[], co_entities text[]
    )
    ON CONFLICT (name_norm) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      type_hint = EXCLUDED.type_hint,
      last_seen_at = EXCLUDED.last_seen_at,
      mention_count = EXCLUDED.mention_count,
      source_names = EXCLUDED.source_names,
      day_count = EXCLUDED.day_count,
      sample_titles = EXCLUDED.sample_titles,
      contexts = EXCLUDED.contexts,
      co_entities = EXCLUDED.co_entities
  `;
}

async function persistCandidates(sql: Sql, sightings: CandidateSighting[]): Promise<number> {
  const grouped = groupSightingsByNorm(sightings);
  if (grouped.size === 0) return 0;
  const existing = await loadExistingCandidates(sql, Array.from(grouped.keys()));
  const rows = Array.from(grouped.entries()).map(([norm, group]) => rollupCandidate(norm, group, existing.get(norm)));
  await upsertCandidates(sql, rows);
  return rows.length;
}

// ---- orchestrator ----

export async function processNewArticles(sql: Sql, llmDeadline?: number): Promise<EntityIngestStats> {
  const heads = await selectUnprocessedHeads(sql);
  if (heads.length === 0) {
    return {
      articlesProcessed: 0,
      mentionsWritten: 0,
      newEntities: 0,
      candidatesTouched: 0,
      llm: { used: false, articles: 0, monthCostUsd: 0 },
    };
  }

  const registry = await loadEntityRegistry(sql);
  const { candidatesByArticle, llmArticleCount } = await extractAllCandidates(heads, sql, llmDeadline);
  const classified = classifyAll(heads, candidatesByArticle, registry);

  const insertedEntities = await upsertNewEntities(sql, classified.newEntities);
  const newEntityMentions = resolveNewEntityMentions(classified.newEntities, insertedEntities);
  const allMentions = dedupeMentions([...classified.resolved, ...newEntityMentions]);

  await bumpEntityLastSeen(sql, allMentions);
  await insertArticleEntities(sql, allMentions);
  await upsertHourlyMentions(sql, rollupHourlyMentions(allMentions));
  await upsertEntityEdges(sql, rollupEntityEdges(allMentions));
  const candidatesTouched = await persistCandidates(sql, classified.candidateSightings);

  // Marking processed is deliberately the LAST WRITE of a run: a crash
  // between the aggregate writes above and this UPDATE leaves this batch's
  // articles unmarked, so they retry next run — additive rollups (mentions,
  // edges, candidate counts) would double-count for that one batch. Rare
  // and bounded (at most one extra batch), chosen over silently losing
  // articles whose entities never got recorded at all. safeLlmMonthCost
  // below is a read-only stats lookup for the response, not a write.
  await markArticlesProcessed(sql, classified.processedArticleIds);

  const monthCostUsd = await safeLlmMonthCost(sql);

  return {
    articlesProcessed: classified.processedArticleIds.length,
    mentionsWritten: allMentions.length,
    newEntities: insertedEntities.length,
    candidatesTouched,
    llm: { used: llmArticleCount > 0, articles: llmArticleCount, monthCostUsd },
  };
}
