import type { Sql, SqlRow } from "./db";
import { extractCandidates, extractDictionaryOnlyCandidates, addCandidate, normalizeName, Candidate, TypeHint } from "./extract-v2";
import { scoreSentiment } from "../entity-extractor";
import {
  isLlmConfigured,
  submitBatch,
  pollBatch,
  fetchBatchResults,
  recordBatchUsage,
  getLlmMonthStats,
  currentUtcMonth,
  MAX_BATCH_SIZE,
  ExtractedRelation,
  RelationType,
  BatchResults,
} from "./llm-extract";
import { getSettings } from "./settings";

const LOOKBACK_HOURS = 6;
const MAX_CANDIDATE_SOURCES = 10;
const MAX_SAMPLE_TITLES = 3;
const MAX_CONTEXTS = 3;
const MAX_CO_ENTITIES = 5;
// A pending batch younger than this is polled and left pending; older than
// this, it's abandoned (heuristic-processed instead) — the Batches API's
// documented "most batches finish within an hour, hard max 24h" makes 6h a
// generous wait before giving up on one tick's worth of articles.
const PENDING_BATCH_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Up to this many DISTINCT error samples per run — mirrors fame-sweep.ts's
// MAX_EXCEPTION_SAMPLES convention (a few bounded samples, not a flood).
const MAX_ERROR_SAMPLES = 2;

export interface EntityIngestStats {
  articlesProcessed: number;
  mentionsWritten: number;
  newEntities: number;
  candidatesTouched: number;
  llm: {
    used: boolean;
    articles: number;
    monthCostUsd: number;
    batch: { submittedArticles: number; retrievedArticles: number; pendingAgeMinutes: number | null };
    /** Low-cardinality reason -> count for every non-success path this
     * tick (submit/poll/results HTTP statuses, per-chunk errored/canceled/
     * expired, abandoned_timeout, budget gate, malformed lines). Reason
     * keys only, never free text — see llm-extract.ts's submit/poll/
     * fetchBatchResults. */
    failureReasons: Record<string, number>;
    /** Up to MAX_ERROR_SAMPLES distinct sanitized samples of the response
     * body behind a submit/poll/results-fetch HTTP failure (see
     * llm-extract.ts's sampleErrorBody) — present only when at least one
     * such failure happened this run. Omitted (not empty-array) when there
     * are none, matching fame-sweep.ts's exceptionSamples convention. */
    errorSamples?: string[];
  };
  /** Famous-prominence LLM candidates inserted straight into entities
   * (status 'tracked') instead of the review queue — see classifyCandidate.
   * A subset of newEntities above, broken out for visibility. */
  entities: { autoAccepted: number };
  relations: { written: number };
}

// ---- shared row/date parsing ----

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function toNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : [];
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
// excludeIds keeps a still-pending batch's own articles out of this tick's
// selection (they're already spoken for) — see resolvePendingBatchStage.
async function selectUnprocessedHeads(sql: Sql, excludeIds: number[] = []): Promise<HeadArticle[]> {
  const rows = await sql`
    SELECT a.id, a.title, a.summary, a.published_at, a.first_seen_at, a.source_name
    FROM articles a
    WHERE a.dup_group_id IS NULL
      AND a.first_seen_at >= now() - make_interval(hours => ${LOOKBACK_HOURS}::int)
      AND a.entities_processed_at IS NULL
      AND NOT (a.id = ANY(${excludeIds}::bigint[]))
  `;
  return rows.map(parseHeadRow);
}

async function loadHeadsByIds(sql: Sql, ids: number[]): Promise<Map<number, HeadArticle>> {
  if (ids.length === 0) return new Map();
  // entities_processed_at IS NULL is the exactly-once guard: an id whose
  // article was somehow already processed (or deleted) by the time a batch
  // resolves is silently absent here, so applyBatchResults below just skips it.
  const rows = await sql`
    SELECT a.id, a.title, a.summary, a.published_at, a.first_seen_at, a.source_name
    FROM articles a
    WHERE a.id = ANY(${ids}::bigint[]) AND a.entities_processed_at IS NULL
  `;
  return new Map(rows.map(parseHeadRow).map((head) => [head.id, head] as const));
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
  /** True when this entity was created via the famous-prominence LLM
   * auto-accept path rather than a dictionary first-hit. */
  autoAccepted: boolean;
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
  | { kind: "new-entity"; canonicalName: string; type: TypeHint; mention: PendingMention; autoAccepted: boolean }
  | { kind: "candidate"; sighting: CandidateSighting };

// A candidate with no registry hit is auto-tracked (skips entity_candidates
// entirely) when either: the dictionary layer matched it (a known static
// entity, unchanged pre-existing behavior), or the LLM judged it 'famous' —
// a name every news reader already knows needs no human review. 'known' and
// 'obscure' LLM candidates, and every candidate with no prominence at all
// (the heuristic layers), fall through to the normal candidate queue.
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
    return { kind: "new-entity", canonicalName: candidate.display, type: candidate.typeHint, mention, autoAccepted: false };
  }
  if (candidate.layer === "llm" && candidate.prominence === "famous") {
    return { kind: "new-entity", canonicalName: candidate.display, type: candidate.typeHint, mention, autoAccepted: true };
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
  autoAccepted: boolean,
): void {
  const existing = newEntities.get(canonicalName);
  if (existing) existing.mentions.push(mention);
  else newEntities.set(canonicalName, { canonicalName, type, mentions: [mention], autoAccepted });
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
        addNewEntityMention(batch.newEntities, result.canonicalName, result.type, result.mention, result.autoAccepted);
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
  for (const c of llmCandidates) addCandidate(map, c.display, c.typeHint, c.layer, c.roleContext, c.prominence);
  for (const c of extractDictionaryOnlyCandidates(title, summary)) addCandidate(map, c.display, c.typeHint, c.layer, c.roleContext, c.prominence);
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

// ---- Batches API: pending-batch table (migrations/008_llm_batches.sql) ----
// Invariant: at most one llm_batches row exists at any time. Each tick,
// process-entities first resolves any pending row (poll -> apply/abandon),
// then — only if none remains pending — selects fresh heads and submits a
// new batch. Extraction-derived data (mentions, candidates, relations) can
// therefore land one tick later than ingest arrival; articles.first_seen_at
// (watch-time) is written at ingest and untouched here (DESIGN.md "honest
// time").

interface PendingBatch {
  batchId: string;
  submittedAt: Date;
  articleIds: number[];
}

async function loadPendingBatch(sql: Sql): Promise<PendingBatch | null> {
  const rows = await sql`SELECT batch_id, submitted_at, article_ids FROM llm_batches LIMIT 1`;
  if (rows.length === 0) return null;
  return { batchId: String(rows[0].batch_id), submittedAt: toDate(rows[0].submitted_at), articleIds: toNumberArray(rows[0].article_ids) };
}

async function insertPendingBatch(sql: Sql, batchId: string, articleIds: number[], submittedAt: Date): Promise<void> {
  await sql`INSERT INTO llm_batches (batch_id, submitted_at, article_ids) VALUES (${batchId}, ${submittedAt.toISOString()}, ${articleIds}::bigint[])`;
}

async function deletePendingBatch(sql: Sql, batchId: string): Promise<void> {
  await sql`DELETE FROM llm_batches WHERE batch_id = ${batchId}`;
}

interface PendingBatchOutcome {
  headById: Map<number, HeadArticle>;
  candidatesByArticle: Map<number, Candidate[] | null>;
  relationsByArticle: Map<number, ExtractedRelation[]>;
  llmUsed: number;
  /** Ids to keep out of this tick's fresh head selection — populated
   * whenever a pending row existed, whichever branch handled it. */
  excludeIds: number[];
  /** True only when the batch is still in flight (in_progress, or a poll
   * failure that leaves its status unknown) — step 2 (select+submit) is
   * skipped entirely in that case, preserving the at-most-one-pending
   * invariant. */
  stillPending: boolean;
  batch: { submittedArticles: number; retrievedArticles: number; pendingAgeMinutes: number | null };
}

function emptyPendingOutcome(): PendingBatchOutcome {
  return {
    headById: new Map(),
    candidatesByArticle: new Map(),
    relationsByArticle: new Map(),
    llmUsed: 0,
    excludeIds: [],
    stillPending: false,
    batch: { submittedArticles: 0, retrievedArticles: 0, pendingAgeMinutes: null },
  };
}

// Applies each chunk's outcome (succeeded/errored/canceled/expired/
// malformed) onto the pending batch's own articles, by chunk position — the
// SAME chunking (over the stored article id order) used at submit time, so
// custom_id alignment holds even when an id is missing from headById (the
// exactly-once guard: already processed, or gone — silently skipped).
function applyBatchResults(
  idsPerChunk: number[][],
  headById: Map<number, HeadArticle>,
  results: BatchResults,
  candidatesByArticle: Map<number, Candidate[] | null>,
  relationsByArticle: Map<number, ExtractedRelation[]>,
  tally: (reason: string) => void,
): number {
  let llmUsed = 0;
  for (let chunkIndex = 0; chunkIndex < idsPerChunk.length; chunkIndex++) {
    const failure = results.chunkFailures.get(chunkIndex);
    const chunkResult = results.byChunk.get(chunkIndex);
    idsPerChunk[chunkIndex].forEach((id, j) => {
      const head = headById.get(id);
      if (!head) return; // exactly-once guard
      if (failure) {
        tally(`chunk_${failure}`);
        candidatesByArticle.set(id, heuristicCandidatesForArticle(head));
        return;
      }
      const llmCandidates = chunkResult?.candidates.get(j);
      if (!llmCandidates) {
        tally("article_missing_from_batch_result");
        candidatesByArticle.set(id, heuristicCandidatesForArticle(head));
        return;
      }
      try {
        candidatesByArticle.set(id, mergeLlmWithDictionary(llmCandidates, head.title, head.summary));
        llmUsed += 1;
        const relations = chunkResult?.relations.get(j);
        if (relations && relations.length > 0) relationsByArticle.set(id, relations);
      } catch (err) {
        logArticleFailure(id, err);
        candidatesByArticle.set(id, null);
      }
    });
  }
  return llmUsed;
}

// Whole-batch heuristic fallback: no-key, abandoned-timeout, or a
// results-fetch failure — every one of the pending batch's own articles
// gets the full heuristic stack instead.
async function resolveWithHeuristicFallback(sql: Sql, pending: PendingBatch): Promise<PendingBatchOutcome> {
  const headById = await loadHeadsByIds(sql, pending.articleIds);
  const candidatesByArticle = new Map<number, Candidate[] | null>();
  for (const head of headById.values()) candidatesByArticle.set(head.id, heuristicCandidatesForArticle(head));
  await deletePendingBatch(sql, pending.batchId);
  return {
    headById,
    candidatesByArticle,
    relationsByArticle: new Map(),
    llmUsed: 0,
    excludeIds: pending.articleIds,
    stillPending: false,
    batch: { submittedArticles: 0, retrievedArticles: 0, pendingAgeMinutes: null },
  };
}

async function resolveEndedBatch(sql: Sql, pending: PendingBatch, resultsUrl: string, tally: (reason: string, sample?: string) => void): Promise<PendingBatchOutcome> {
  const results = await fetchBatchResults(resultsUrl);
  if ("reason" in results) {
    tally(results.reason, results.sample);
    return resolveWithHeuristicFallback(sql, pending);
  }

  const headById = await loadHeadsByIds(sql, pending.articleIds);
  const candidatesByArticle = new Map<number, Candidate[] | null>();
  const relationsByArticle = new Map<number, ExtractedRelation[]>();
  const idsPerChunk = chunkArticles(pending.articleIds, MAX_BATCH_SIZE);
  const llmUsed = applyBatchResults(idsPerChunk, headById, results, candidatesByArticle, relationsByArticle, tally);

  await recordBatchUsage(sql, currentUtcMonth(new Date()), results.inputTokens, results.outputTokens);
  await deletePendingBatch(sql, pending.batchId);

  return {
    headById,
    candidatesByArticle,
    relationsByArticle,
    llmUsed,
    excludeIds: pending.articleIds,
    stillPending: false,
    batch: { submittedArticles: 0, retrievedArticles: headById.size, pendingAgeMinutes: null },
  };
}

// Step 1: resolve any pending batch row. isLlmConfigured() false with a
// pending row present can't poll without a key, so it heuristic-processes
// immediately — the one edge case where the key check happens AFTER (not
// instead of) the pending-row read.
async function resolvePendingBatchStage(sql: Sql, tally: (reason: string, sample?: string) => void): Promise<PendingBatchOutcome> {
  const pending = await loadPendingBatch(sql);
  if (!pending) return emptyPendingOutcome();

  if (!isLlmConfigured()) {
    tally("no_api_key_pending");
    return resolveWithHeuristicFallback(sql, pending);
  }

  const ageMs = Date.now() - pending.submittedAt.getTime();
  if (ageMs >= PENDING_BATCH_MAX_AGE_MS) {
    tally("abandoned_timeout");
    return resolveWithHeuristicFallback(sql, pending);
  }

  const pollResult = await pollBatch(pending.batchId);
  const pendingAgeMinutes = Math.floor(ageMs / 60_000);
  if (pollResult.status === "in_progress") {
    return { ...emptyPendingOutcome(), excludeIds: pending.articleIds, stillPending: true, batch: { submittedArticles: 0, retrievedArticles: 0, pendingAgeMinutes } };
  }
  if (pollResult.status === "failed") {
    tally(pollResult.reason, pollResult.sample);
    return { ...emptyPendingOutcome(), excludeIds: pending.articleIds, stillPending: true, batch: { submittedArticles: 0, retrievedArticles: 0, pendingAgeMinutes } };
  }
  return resolveEndedBatch(sql, pending, pollResult.resultsUrl, tally);
}

// Step 2: only reached when no batch remains pending. Selects fresh
// unprocessed heads and submits them as one new batch (budget-gated at
// submit time); a submit failure heuristic-processes them this tick instead,
// exactly like the old live-call failure path.
async function submitNewBatchStage(
  sql: Sql,
  excludeIds: number[],
  tally: (reason: string, sample?: string) => void,
): Promise<{ headById: Map<number, HeadArticle>; candidatesByArticle: Map<number, Candidate[] | null>; submittedArticles: number }> {
  const newHeads = await selectUnprocessedHeads(sql, excludeIds);
  const headById = new Map(newHeads.map((h) => [h.id, h] as const));
  if (newHeads.length === 0) return { headById, candidatesByArticle: new Map(), submittedArticles: 0 };
  if (!isLlmConfigured()) return { headById, candidatesByArticle: extractAllHeuristic(newHeads), submittedArticles: 0 };

  const settings = await getSettings(sql);
  const chunks = chunkArticles(newHeads, MAX_BATCH_SIZE).map((chunk) => chunk.map((a, j) => ({ index: j, title: a.title, summary: a.summary })));
  const submitResult = await submitBatch(sql, settings.llm_monthly_budget_usd, chunks);
  if (!submitResult.ok) {
    tally(submitResult.reason, submitResult.sample);
    return { headById, candidatesByArticle: extractAllHeuristic(newHeads), submittedArticles: 0 };
  }

  await insertPendingBatch(sql, submitResult.batchId, newHeads.map((h) => h.id), new Date());
  return { headById, candidatesByArticle: new Map(), submittedArticles: newHeads.length };
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

// ---- entity_relations rollup ----

// registry (norm -> id, incl. every alias, all statuses — same resolution
// rule mentions themselves use) overlaid with this run's freshly-inserted
// entities (dictionary first-hits and famous-prominence auto-accepts alike),
// so a relation whose endpoint was JUST auto-tracked this run still resolves.
function buildRelationResolutionIndex(
  registry: Map<string, EntityRecord>,
  insertedEntities: InsertedEntity[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (const [norm, record] of registry) index.set(norm, record.id);
  for (const entity of insertedEntities) {
    const norm = normalizeName(entity.canonicalName);
    if (norm) index.set(norm, entity.id);
  }
  return index;
}

interface RelationOccurrence {
  sourceId: number;
  targetId: number;
  relation: RelationType;
  articleId: number;
  arrivalAt: Date;
}

// Relations only ever come from articles that used the LLM (heuristics
// extract no relations at all) and only from articles that survived
// classification this run (processedArticleIds) — an article dropped for a
// poison-pill extraction failure drops its relations too, matching mentions.
// A relation whose source/target don't BOTH resolve this run, or that
// degenerates to a self-relation via alias overlap, is dropped: the DB CHECK
// (source_id <> target_id) would otherwise fail the whole batched upsert.
function resolveRelationsForRun(
  processedArticleIds: number[],
  relationsByArticle: Map<number, ExtractedRelation[]>,
  headsById: Map<number, HeadArticle>,
  resolutionIndex: Map<string, number>,
): RelationOccurrence[] {
  const occurrences: RelationOccurrence[] = [];
  for (const articleId of processedArticleIds) {
    const relations = relationsByArticle.get(articleId);
    const article = headsById.get(articleId);
    if (!relations || !article) continue;

    for (const r of relations) {
      const sourceId = resolutionIndex.get(normalizeName(r.source));
      const targetId = resolutionIndex.get(normalizeName(r.target));
      if (sourceId === undefined || targetId === undefined || sourceId === targetId) continue;
      occurrences.push({ sourceId, targetId, relation: r.relation, articleId, arrivalAt: article.arrivalAt });
    }
  }
  return occurrences;
}

export interface RelationRollupRow {
  sourceId: number;
  targetId: number;
  relation: RelationType;
  firstSeenAt: string;
  lastSeenAt: string;
  articleCount: number;
  evidenceArticleId: number;
}

// evidence_article_id tracks whichever occurrence has the latest arrival
// (ARRIVAL time, like every first/last_seen semantic here) within this run's
// batch — upsertRelations then unconditionally overwrites the stored
// evidence with it, since a later run's articles always arrive after any
// previously stored evidence in normal operation.
export function rollupRelations(occurrences: RelationOccurrence[]): RelationRollupRow[] {
  const groups = new Map<
    string,
    { sourceId: number; targetId: number; relation: RelationType; count: number; firstSeenAt: Date; lastSeenAt: Date; evidenceArticleId: number }
  >();

  for (const occ of occurrences) {
    const key = `${occ.sourceId}:${occ.targetId}:${occ.relation}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        sourceId: occ.sourceId, targetId: occ.targetId, relation: occ.relation,
        count: 1, firstSeenAt: occ.arrivalAt, lastSeenAt: occ.arrivalAt, evidenceArticleId: occ.articleId,
      });
      continue;
    }
    group.count += 1;
    if (occ.arrivalAt < group.firstSeenAt) group.firstSeenAt = occ.arrivalAt;
    if (occ.arrivalAt >= group.lastSeenAt) {
      group.lastSeenAt = occ.arrivalAt;
      group.evidenceArticleId = occ.articleId;
    }
  }

  return Array.from(groups.values()).map((g) => ({
    sourceId: g.sourceId,
    targetId: g.targetId,
    relation: g.relation,
    firstSeenAt: g.firstSeenAt.toISOString(),
    lastSeenAt: g.lastSeenAt.toISOString(),
    articleCount: g.count,
    evidenceArticleId: g.evidenceArticleId,
  }));
}

async function upsertRelations(sql: Sql, rows: RelationRollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    INSERT INTO entity_relations (source_id, target_id, relation, first_seen_at, last_seen_at, article_count, evidence_article_id)
    SELECT * FROM UNNEST(
      ${rows.map((r) => r.sourceId)}::bigint[],
      ${rows.map((r) => r.targetId)}::bigint[],
      ${rows.map((r) => r.relation)}::text[],
      ${rows.map((r) => r.firstSeenAt)}::timestamptz[],
      ${rows.map((r) => r.lastSeenAt)}::timestamptz[],
      ${rows.map((r) => r.articleCount)}::int[],
      ${rows.map((r) => r.evidenceArticleId)}::bigint[]
    )
    ON CONFLICT (source_id, target_id, relation) DO UPDATE SET
      article_count = entity_relations.article_count + EXCLUDED.article_count,
      last_seen_at = GREATEST(entity_relations.last_seen_at, EXCLUDED.last_seen_at),
      evidence_article_id = EXCLUDED.evidence_article_id
  `;
}

// Relations only resolve against entities known by the END of this run
// (pre-existing registry + this run's fresh inserts, famous auto-accepts
// included) — see buildRelationResolutionIndex/resolveRelationsForRun.
async function persistRelations(
  sql: Sql,
  registry: Map<string, EntityRecord>,
  insertedEntities: InsertedEntity[],
  heads: HeadArticle[],
  processedArticleIds: number[],
  relationsByArticle: Map<number, ExtractedRelation[]>,
): Promise<number> {
  const resolutionIndex = buildRelationResolutionIndex(registry, insertedEntities);
  const headsById = new Map(heads.map((h) => [h.id, h]));
  const rows = rollupRelations(resolveRelationsForRun(processedArticleIds, relationsByArticle, headsById, resolutionIndex));
  await upsertRelations(sql, rows);
  return rows.length;
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

function emptyEntityIngestStats(
  batch: EntityIngestStats["llm"]["batch"],
  failureReasons: Record<string, number>,
  errorSamples: string[],
): EntityIngestStats {
  return {
    articlesProcessed: 0,
    mentionsWritten: 0,
    newEntities: 0,
    candidatesTouched: 0,
    llm: {
      used: false, articles: 0, monthCostUsd: 0, batch, failureReasons,
      ...(errorSamples.length > 0 ? { errorSamples } : {}),
    },
    entities: { autoAccepted: 0 },
    relations: { written: 0 },
  };
}

export async function processNewArticles(sql: Sql): Promise<EntityIngestStats> {
  const failureReasons: Record<string, number> = {};
  const errorSamples = new Set<string>();
  const tally = (reason: string, sample?: string) => {
    failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    // Distinct samples only, and only while under the cap — repeated
    // identical failures shouldn't flood the ingest response.
    if (sample && errorSamples.size < MAX_ERROR_SAMPLES) errorSamples.add(sample);
  };

  const pending = await resolvePendingBatchStage(sql, tally);
  const submitted = pending.stillPending
    ? { headById: new Map<number, HeadArticle>(), candidatesByArticle: new Map<number, Candidate[] | null>(), submittedArticles: 0 }
    : await submitNewBatchStage(sql, pending.excludeIds, tally);

  const headById = new Map([...pending.headById, ...submitted.headById]);
  const candidatesByArticle = new Map([...pending.candidatesByArticle, ...submitted.candidatesByArticle]);
  const batch = { ...pending.batch, submittedArticles: submitted.submittedArticles };

  const heads = Array.from(candidatesByArticle.keys()).map((id) => headById.get(id)!);
  if (heads.length === 0) return emptyEntityIngestStats(batch, failureReasons, Array.from(errorSamples));

  const registry = await loadEntityRegistry(sql);
  const classified = classifyAll(heads, candidatesByArticle, registry);

  const insertedEntities = await upsertNewEntities(sql, classified.newEntities);
  const newEntityMentions = resolveNewEntityMentions(classified.newEntities, insertedEntities);
  const allMentions = dedupeMentions([...classified.resolved, ...newEntityMentions]);

  await bumpEntityLastSeen(sql, allMentions);
  await insertArticleEntities(sql, allMentions);
  await upsertHourlyMentions(sql, rollupHourlyMentions(allMentions));
  await upsertEntityEdges(sql, rollupEntityEdges(allMentions));
  const candidatesTouched = await persistCandidates(sql, classified.candidateSightings);
  const relationsWritten = await persistRelations(sql, registry, insertedEntities, heads, classified.processedArticleIds, pending.relationsByArticle);
  // Marking processed is deliberately the LAST WRITE of a run: a crash
  // between the aggregate writes above and this UPDATE leaves this batch's
  // articles unmarked, so they retry next run — additive rollups (mentions,
  // edges, candidate counts) would double-count for that one batch. Rare
  // and bounded (at most one extra batch), chosen over silently losing
  // articles whose entities never got recorded at all. safeLlmMonthCost
  // below is a read-only stats lookup for the response, not a write.
  await markArticlesProcessed(sql, classified.processedArticleIds);

  const monthCostUsd = await safeLlmMonthCost(sql);
  const autoAcceptedCount = Array.from(classified.newEntities.values()).filter((e) => e.autoAccepted).length;

  return {
    articlesProcessed: classified.processedArticleIds.length,
    mentionsWritten: allMentions.length,
    newEntities: insertedEntities.length,
    candidatesTouched,
    llm: {
      used: pending.llmUsed > 0, articles: pending.llmUsed, monthCostUsd, batch, failureReasons,
      ...(errorSamples.size > 0 ? { errorSamples: Array.from(errorSamples) } : {}),
    },
    entities: { autoAccepted: autoAcceptedCount },
    relations: { written: relationsWritten },
  };
}
