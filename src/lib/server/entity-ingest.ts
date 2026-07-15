import type { Sql, SqlRow } from "./db";
import { extractCandidates, normalizeName, Candidate, TypeHint } from "./extract-v2";
import { scoreSentiment } from "../entity-extractor";

const LOOKBACK_HOURS = 6;
const MAX_CANDIDATE_SOURCES = 10;
const MAX_SAMPLE_TITLES = 3;

export interface EntityIngestStats {
  articlesProcessed: number;
  mentionsWritten: number;
  newEntities: number;
  candidatesTouched: number;
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
}

type Classification =
  | { kind: "resolved"; mention: ResolvedMention }
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
    return { kind: "resolved", mention: { ...mention, entityId: known.id } };
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
    },
  };
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

// Extraction (compromise NLP, regex layers) and classification run per
// article inside their own try/catch: one pathological title must not abort
// the whole batch. A failing article is logged and left out of
// processedArticleIds, so it's simply not marked processed and retries
// on the next run.
function processArticle(
  article: HeadArticle,
  registry: Map<string, EntityRecord>,
  batch: Omit<ClassifiedBatch, "processedArticleIds">,
): boolean {
  try {
    const candidates = extractCandidates(article.title, article.summary);
    const sentiment = scoreSentiment(`${article.title} ${article.summary}`);
    for (const candidate of candidates) {
      const result = classifyCandidate(candidate, article, sentiment, registry);
      if (result.kind === "resolved") batch.resolved.push(result.mention);
      else if (result.kind === "new-entity") {
        addNewEntityMention(batch.newEntities, result.canonicalName, result.type, result.mention);
      } else batch.candidateSightings.push(result.sighting);
    }
    return true;
  } catch (err) {
    console.error(`processNewArticles: failed to process article ${article.id}, skipping (will retry next run)`, err);
    return false;
  }
}

function classifyAll(heads: HeadArticle[], registry: Map<string, EntityRecord>): ClassifiedBatch {
  const batch = {
    resolved: [] as ResolvedMention[],
    newEntities: new Map<string, PendingNewEntity>(),
    candidateSightings: [] as CandidateSighting[],
  };
  const processedArticleIds: number[] = [];
  for (const article of heads) {
    if (processArticle(article, registry, batch)) processedArticleIds.push(article.id);
  }
  return { ...batch, processedArticleIds };
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
  };
}

async function loadExistingCandidates(sql: Sql, norms: string[]): Promise<Map<string, CandidateRow>> {
  const rows = await sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
           mention_count, source_names, day_count, sample_titles
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
  }));

  await sql`
    INSERT INTO entity_candidates (
      name_norm, display_name, type_hint, first_seen_at, last_seen_at,
      mention_count, source_names, day_count, sample_titles
    )
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
           mention_count, source_names, day_count, sample_titles
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS t(
      name_norm text, display_name text, type_hint text,
      first_seen_at timestamptz, last_seen_at timestamptz,
      mention_count int, source_names text[], day_count int, sample_titles text[]
    )
    ON CONFLICT (name_norm) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      type_hint = EXCLUDED.type_hint,
      last_seen_at = EXCLUDED.last_seen_at,
      mention_count = EXCLUDED.mention_count,
      source_names = EXCLUDED.source_names,
      day_count = EXCLUDED.day_count,
      sample_titles = EXCLUDED.sample_titles
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

export async function processNewArticles(sql: Sql): Promise<EntityIngestStats> {
  const heads = await selectUnprocessedHeads(sql);
  if (heads.length === 0) {
    return { articlesProcessed: 0, mentionsWritten: 0, newEntities: 0, candidatesTouched: 0 };
  }

  const registry = await loadEntityRegistry(sql);
  const classified = classifyAll(heads, registry);

  const insertedEntities = await upsertNewEntities(sql, classified.newEntities);
  const newEntityMentions = resolveNewEntityMentions(classified.newEntities, insertedEntities);
  const allMentions = dedupeMentions([...classified.resolved, ...newEntityMentions]);

  await bumpEntityLastSeen(sql, allMentions);
  await insertArticleEntities(sql, allMentions);
  await upsertHourlyMentions(sql, rollupHourlyMentions(allMentions));
  await upsertEntityEdges(sql, rollupEntityEdges(allMentions));
  const candidatesTouched = await persistCandidates(sql, classified.candidateSightings);

  // Marking processed is deliberately the LAST statement of a run: a crash
  // between the aggregate writes above and this UPDATE leaves this batch's
  // articles unmarked, so they retry next run — additive rollups (mentions,
  // edges, candidate counts) would double-count for that one batch. Rare
  // and bounded (at most one extra batch), chosen over silently losing
  // articles whose entities never got recorded at all.
  await markArticlesProcessed(sql, classified.processedArticleIds);

  return {
    articlesProcessed: classified.processedArticleIds.length,
    mentionsWritten: allMentions.length,
    newEntities: insertedEntities.length,
    candidatesTouched,
  };
}
