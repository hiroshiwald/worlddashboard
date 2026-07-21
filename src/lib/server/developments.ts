import type { Sql, SqlRow } from "./db";
import { computeEffectiveBaselineDays, isBootstrapCohort } from "./detectors";
import { normalizeName } from "./extract-v2";

export interface EvidenceArticleJson {
  title: string;
  link: string;
  sourceName: string;
  publishedAt: string | null;
  firstSeenAt: string;
}

interface ScoreParts {
  novelty: number;
  corroboration: number;
  persistence: number;
  relationStrength: number;
  anchorContext: number;
  penalty: number;
}

export interface DevelopmentCardJson {
  subjectName: string;
  subjectType: string;
  anchorNames: string[];
  relationOrReason: string;
  whyShown: string;
  label: "observed" | "pattern";
  firstObservedAt: string;
  lastObservedAt: string;
  staleReporting: boolean;
  evidence: EvidenceArticleJson[];
  score: number;
  scoreParts: ScoreParts;
}

type SourceKind = "R" | "N" | "C" | "E";

interface TrackedEntityMeta {
  id: number;
  canonicalName: string;
  type: string;
  aliases: string[];
  baselineDaily: number;
}

interface EntityBaselineRow {
  id: number;
  canonicalName: string;
  type: string;
  aliases: string[];
  baselineMentions: number;
  totalMentions15d: number;
}

interface RawEvidenceArticle {
  articleId: number;
  title: string;
  link: string;
  sourceName: string;
  publishedAt: Date | null;
  firstSeenAt: Date;
}

interface RawTitleMatch {
  title: string;
  articleId: number;
  dupGroupId: number | null;
}

interface CardDraft {
  sourceKind: SourceKind;
  subjectName: string;
  subjectType: string;
  subjectBaselineDaily: number | null;
  anchorNames: string[];
  relationOrReason: string;
  label: "observed" | "pattern";
  firstObservedAt: Date;
  lastObservedAt: Date;
  fullEvidence: RawEvidenceArticle[];
  relation?: string;
  candidateDayCount?: number;
}

interface ScoredCard extends CardDraft {
  score: number;
  scoreParts: ScoreParts;
  whyShown: string;
  staleReporting: boolean;
}

const WINDOW_DAYS = 14;
const BOOTSTRAP_GUARD_HOURS = 72;
const ANCHOR_PERCENTILE = 0.9;
const MIN_ANCHOR_THRESHOLD = 3;
const MAX_EVIDENCE_ARTICLES = 5;
const MAX_ANCHOR_NAMES = 3;
const MIN_DISTINCT_SOURCES = 2;
const MIN_ANCHOR_COUNT = 1;
const MIN_CANDIDATE_DAY_COUNT = 2;
const MIN_CANDIDATE_SOURCE_NAMES = 2;
const MIN_EDGE_ARTICLE_COUNT = 2;
const CANDIDATE_MATCH_WINDOW_PAD_DAYS = 2;
const STALE_REPORTING_THRESHOLD_DAYS = 7;
const NOVELTY_DECAY_DAYS = 7;
const CARD_CAP = 8;

const STRONG_RELATIONS = new Set(["sanction", "supply", "acquisition", "investment", "regulation", "legal_action"]);
const WEAK_RELATIONS = new Set(["statement_about", "other"]);
const RELATION_STRENGTH_STRONG = 1.0;
const RELATION_STRENGTH_MODERATE = 0.8;
const RELATION_STRENGTH_WEAK = 0.5;
const RELATION_STRENGTH_N = 0.6;
const RELATION_STRENGTH_C = 0.5;
const RELATION_STRENGTH_E = 0.35;

const PENALTY_STALE = 0.5;
const PENALTY_DRIFT = 1.0;
const ANCHOR_CONTEXT_CAP = 3;
const ANCHOR_CONTEXT_WEIGHT = 0.5;

const SOURCE_PRECEDENCE: Record<SourceKind, number> = { R: 0, N: 1, C: 2, E: 3 };

const DAY_MS = 24 * 3600 * 1000;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

// ---- anchor classification ----

/** An entity is an anchor by type (country/region, regardless of volume) or
 * by volume (trailing baseline clears the population's own top decile).
 * Applied uniformly to every card's subject in `passesEligibility` — not
 * assumed safe to skip for any one source, since a candidate's type_hint
 * can legitimately be 'region' (see developments.ts plan for why). */
export function isAnchor(type: string, baselineDaily: number, anchorThreshold: number): boolean {
  if (type === "country" || type === "region") return true;
  return baselineDaily >= anchorThreshold;
}

/** max(3, 90th percentile) of baselineDaily across tracked entities with any
 * mentions in the trailing 15 days. Linear-interpolation percentile (sort
 * ascending, rank = p*(n-1), interpolate floor/ceil) — the standard
 * numpy/R type-7 definition. Guards the empty-population case (possible
 * right after warm-up clears on a small corpus), where `rank` is otherwise
 * undefined. */
export function computeAnchorThreshold(baselineDailyValues: number[]): number {
  if (baselineDailyValues.length === 0) return MIN_ANCHOR_THRESHOLD;
  const sorted = [...baselineDailyValues].sort((a, b) => a - b);
  const rank = ANCHOR_PERCENTILE * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const percentile = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.max(MIN_ANCHOR_THRESHOLD, percentile);
}

/** Ranks resolved anchor candidates by their own prominence (baselineDaily
 * desc, name asc as a deterministic tie-break) and caps at 3 — used by both
 * the N and C sources, which can resolve more than one anchor per card
 * (unlike R/E, which always have exactly one). */
export function rankAnchors(anchors: TrackedEntityMeta[]): TrackedEntityMeta[] {
  return [...anchors]
    .sort((a, b) => b.baselineDaily - a.baselineDaily || a.canonicalName.localeCompare(b.canonicalName))
    .slice(0, MAX_ANCHOR_NAMES);
}

// ---- pure scoring functions (synthetic-panel testable, no DB) ----

/** ageDays measured from firstObservedAt to now, computed by the caller —
 * mirrors computeStoryScore(clusterSize, ageHours)'s convention of taking a
 * pre-derived number rather than Date objects. */
export function computeNovelty(ageDays: number): number {
  return Math.exp(-ageDays / NOVELTY_DECAY_DAYS);
}

export function computeCorroboration(distinctSources: number): number {
  return Math.min(distinctSources, 5) / 5;
}

/** C uses its own day_count; R/N/E use countDistinctUtcDays over their
 * full (pre-cap-at-5) evidence set. */
export function computePersistence(distinctDays: number): number {
  return Math.min(distinctDays, 5) / 5;
}

export function computeRelationStrength(sourceKind: SourceKind, relation?: string): number {
  if (sourceKind === "R") {
    if (relation && STRONG_RELATIONS.has(relation)) return RELATION_STRENGTH_STRONG;
    if (relation && WEAK_RELATIONS.has(relation)) return RELATION_STRENGTH_WEAK;
    return RELATION_STRENGTH_MODERATE;
  }
  if (sourceKind === "N") return RELATION_STRENGTH_N;
  if (sourceKind === "C") return RELATION_STRENGTH_C;
  return RELATION_STRENGTH_E;
}

export function computeAnchorContext(anchorCount: number): number {
  return (Math.min(anchorCount, ANCHOR_CONTEXT_CAP) / ANCHOR_CONTEXT_CAP) * ANCHOR_CONTEXT_WEIGHT;
}

/** subjectBaselineDaily is null for candidate subjects (source C) — they
 * have no tracked-entity baseline at all, so the drift half of the penalty
 * never applies to them; staleReporting can still apply to any source. */
export function computePenalty(
  staleReporting: boolean,
  subjectBaselineDaily: number | null,
  anchorThreshold: number,
): number {
  let penalty = 0;
  if (staleReporting) penalty += PENALTY_STALE;
  if (subjectBaselineDaily !== null && subjectBaselineDaily >= anchorThreshold / 2) penalty += PENALTY_DRIFT;
  return penalty;
}

export function scoreDevelopment(parts: ScoreParts): number {
  return (
    3 * parts.relationStrength +
    2 * parts.novelty +
    parts.corroboration +
    parts.persistence +
    parts.anchorContext -
    parts.penalty
  );
}

export function countDistinctSources(evidence: { sourceName: string }[]): number {
  return new Set(evidence.map((e) => e.sourceName)).size;
}

export function countDistinctUtcDays(evidence: { firstSeenAt: Date }[]): number {
  return new Set(evidence.map((e) => e.firstSeenAt.toISOString().slice(0, 10))).size;
}

/** True when the newest evidence publish date lags firstObservedAt by more
 * than 7 days; false (never "stale") when no evidence article has a known
 * publish date at all — an unknown publish date must never read as fresh
 * OR as stale, so it's simply excluded from the comparison. */
export function computeStaleReporting(firstObservedAt: Date, evidence: { publishedAt: Date | null }[]): boolean {
  const published = evidence.map((e) => e.publishedAt).filter((d): d is Date => d !== null);
  if (published.length === 0) return false;
  const newest = Math.max(...published.map((d) => d.getTime()));
  const gapDays = (firstObservedAt.getTime() - newest) / DAY_MS;
  return gapDays > STALE_REPORTING_THRESHOLD_DAYS;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildLinkClause(sourceKind: SourceKind, relation: string | undefined, anchorName: string): string {
  if (sourceKind === "R" && relation) return `linked to ${anchorName} by a stated ${relation} relation`;
  if (sourceKind === "N") return `newly tracked alongside ${anchorName}`;
  if (sourceKind === "C") return `recurring alongside ${anchorName}`;
  return `recurring in coverage alongside ${anchorName}`;
}

interface WhyShownInput {
  ageDays: number;
  distinctSources: number;
  distinctDays: number;
  anchorName: string;
  sourceKind: SourceKind;
  relation?: string;
}

/** One plain sentence from the score parts, e.g. "First observed 4 days
 * ago, reported by 3 sources over 2 days, linked to Russia by a stated
 * sanction relation." */
export function buildWhyShown(input: WhyShownInput): string {
  const days = Math.round(input.ageDays);
  const timePhrase = `First observed ${pluralize(days, "day")} ago`;
  const corroborationPhrase = `reported by ${pluralize(input.distinctSources, "source")} over ${pluralize(input.distinctDays, "day")}`;
  const linkClause = buildLinkClause(input.sourceKind, input.relation, input.anchorName);
  return `${timePhrase}, ${corroborationPhrase}, ${linkClause}.`;
}

// ---- eligibility (uniform across all four sources) ----

interface EligibilityInput {
  subjectIsAnchor: boolean;
  distinctSourceCount: number;
  evidenceCount: number;
  anchorCount: number;
}

/** The hard filters, applied identically to every source's assembled card
 * before scoring. subjectIsAnchor is the uniform fix that closes the C-source
 * gap: a candidate's type_hint can be 'region' (compromise-tagged place
 * names not in REGION_DICT and not LLM-judged famous fall through to
 * entity_candidates), so it must be checked here rather than assumed
 * structurally impossible for that one source. */
export function passesEligibility(input: EligibilityInput): boolean {
  if (input.subjectIsAnchor) return false;
  if (input.evidenceCount < 1) return false;
  if (input.distinctSourceCount < MIN_DISTINCT_SOURCES) return false;
  if (input.anchorCount < MIN_ANCHOR_COUNT) return false;
  return true;
}

/** day_count/distinct-source-name gate for candidates (source C only). A
 * plain JS threshold check, not a SQL WHERE clause — kept consistent with
 * how every other numeric eligibility threshold in this codebase (scoreSurge,
 * scoreNovelEdge, etc.) is a testable function rather than baked into SQL. */
export function isCorroboratedCandidate(dayCount: number, distinctSourceNameCount: number): boolean {
  return dayCount >= MIN_CANDIDATE_DAY_COUNT && distinctSourceNameCount >= MIN_CANDIDATE_SOURCE_NAMES;
}

/** Groups candidate title matches by the sample title they satisfied; a
 * title whose matches resolve (via dup_group_id) to more than one distinct
 * cluster head is ambiguous and is discarded entirely. Returns the
 * surviving, deduped head article ids. Pure — the primary evidence-integrity
 * rule for source C. */
export function resolveAmbiguousTitles(matches: RawTitleMatch[]): number[] {
  const headsByTitle = new Map<string, Set<number>>();
  for (const match of matches) {
    const headId = match.dupGroupId ?? match.articleId;
    const heads = headsByTitle.get(match.title);
    if (heads) heads.add(headId);
    else headsByTitle.set(match.title, new Set([headId]));
  }
  const survivingHeadIds = new Set<number>();
  for (const heads of headsByTitle.values()) {
    if (heads.size === 1) for (const headId of heads) survivingHeadIds.add(headId);
  }
  return Array.from(survivingHeadIds);
}

// ---- evidence display + card assembly (pure) ----

export function selectDisplayEvidence(evidence: RawEvidenceArticle[], cap: number): RawEvidenceArticle[] {
  return [...evidence].sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime()).slice(0, cap);
}

function toEvidenceJson(article: RawEvidenceArticle): EvidenceArticleJson {
  return {
    title: article.title,
    link: article.link,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
    firstSeenAt: article.firstSeenAt.toISOString(),
  };
}

function isBetterCard(a: ScoredCard, b: ScoredCard): boolean {
  if (a.scoreParts.relationStrength !== b.scoreParts.relationStrength) {
    return a.scoreParts.relationStrength > b.scoreParts.relationStrength;
  }
  return SOURCE_PRECEDENCE[a.sourceKind] < SOURCE_PRECEDENCE[b.sourceKind];
}

/** Cross-source dedupe by normalized subject name — the same satellite can
 * legitimately surface from more than one source (e.g. both a stated
 * relation and a co-coverage edge to the same anchor). Keeps the highest
 * relationStrength, tie-broken by source precedence R>N>C>E. */
export function dedupeCards(cards: ScoredCard[]): ScoredCard[] {
  const bySubject = new Map<string, ScoredCard>();
  for (const card of cards) {
    const key = normalizeName(card.subjectName);
    const existing = bySubject.get(key);
    if (!existing || isBetterCard(card, existing)) bySubject.set(key, card);
  }
  return Array.from(bySubject.values());
}

export function sortAndCapCards(cards: ScoredCard[], cap: number): ScoredCard[] {
  const sorted = [...cards].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.firstObservedAt.getTime() - a.firstObservedAt.getTime();
  });
  return sorted.slice(0, cap);
}

// ---- shared panel: tracked-entity roster + baseline + epoch ----

// Deliberately duplicated (a third copy alongside brief.ts/detectors.ts's
// own private getSystemEpoch) rather than imported — keeps this module
// decoupled from the other two, the same convention brief.ts already uses.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  return value == null ? null : toDate(value);
}

function computeDaysSinceEpoch(now: Date, epoch: Date): number {
  return Math.floor((now.getTime() - epoch.getTime()) / DAY_MS);
}

function parseEntityBaselineRow(row: SqlRow): EntityBaselineRow {
  return {
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    aliases: toStringArray(row.aliases),
    baselineMentions: Number(row.baseline_mentions),
    totalMentions15d: Number(row.total_mentions_15d),
  };
}

// LEFT JOIN (not the inner join loadMoverAgg/loadHourlyAgg use) — this needs
// the FULL tracked roster, including zero-mention entities, for R/N/E
// endpoint lookups and C's name resolution. Aliased baseline_mentions/
// total_mentions_15d rather than loadMoverAgg's baseline_sum: that exact
// substring is what brief.test.ts's existing mock branches on, and reusing
// it here would silently misroute rows in any test exercising both queries.
async function loadEntityBaselinePanel(sql: Sql): Promise<EntityBaselineRow[]> {
  const rows = await sql`
    SELECT e.id, e.canonical_name, e.type, e.aliases,
      COALESCE(SUM(emh.mentions) FILTER (WHERE emh.bucket < now() - INTERVAL '24 hours'), 0) AS baseline_mentions,
      COALESCE(SUM(emh.mentions), 0) AS total_mentions_15d
    FROM entities e
    LEFT JOIN entity_mentions_hourly emh
      ON emh.entity_id = e.id AND emh.bucket >= now() - INTERVAL '15 days'
    WHERE e.status = 'tracked'
    GROUP BY e.id
  `;
  return rows.map(parseEntityBaselineRow);
}

function toTrackedEntityMeta(rows: EntityBaselineRow[], effectiveBaselineDays: number): TrackedEntityMeta[] {
  return rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonicalName,
    type: row.type,
    aliases: row.aliases,
    baselineDaily: row.baselineMentions / effectiveBaselineDays,
  }));
}

function buildEntityIndex(entities: TrackedEntityMeta[]): Map<number, TrackedEntityMeta> {
  return new Map(entities.map((e) => [e.id, e]));
}

// Mirrors entity-ingest.ts's buildRegistryIndex shape (canonical_name +
// every alias, normalized) without importing it — entity-ingest.ts doesn't
// export it and is forbidden to edit.
function buildNameIndex(entities: TrackedEntityMeta[]): Map<string, TrackedEntityMeta> {
  const index = new Map<string, TrackedEntityMeta>();
  for (const entity of entities) {
    for (const name of [entity.canonicalName, ...entity.aliases]) {
      const key = normalizeName(name);
      if (key && !index.has(key)) index.set(key, entity);
    }
  }
  return index;
}

function collectBaselinePopulation(rows: EntityBaselineRow[], effectiveBaselineDays: number): number[] {
  return rows.filter((row) => row.totalMentions15d > 0).map((row) => row.baselineMentions / effectiveBaselineDays);
}

function parseEvidenceArticleRow(row: SqlRow): RawEvidenceArticle {
  return {
    articleId: Number(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    publishedAt: row.published_at == null ? null : toDate(row.published_at),
    firstSeenAt: toDate(row.first_seen_at),
  };
}

// Cluster heads only. Also used for R's evidence_article_id resolution,
// where a "no row back" result correctly means "doesn't currently resolve
// to a head" (a stored evidence_article_id can be retroactively demoted to
// a member — article-identity.ts's dup_group_id repass — so this must
// tolerate a miss, not assume a hit).
async function loadArticlesByIds(sql: Sql, articleIds: number[]): Promise<Map<number, RawEvidenceArticle>> {
  if (articleIds.length === 0) return new Map();
  const rows = await sql`
    SELECT id, title, link, source_name, published_at, first_seen_at
    FROM articles
    WHERE id = ANY(${articleIds}::bigint[]) AND dup_group_id IS NULL
  `;
  const articles = rows.map(parseEvidenceArticleRow);
  return new Map(articles.map((a) => [a.articleId, a]));
}

interface EntityPair {
  a: number;
  b: number;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// Shared by R and E — both need "cluster-head articles mentioning exactly
// these two given entities." Mirrors detectors.ts's private loadEdgeArticles
// UNNEST-self-join shape but selects full article fields instead of just an
// id. Pairs are normalized to (min,max) before querying/keying since R's
// (source_id,target_id) is directed, unlike E's pre-ordered entity_a<entity_b.
async function loadPairEvidenceArticles(sql: Sql, pairs: EntityPair[]): Promise<Map<string, RawEvidenceArticle[]>> {
  const map = new Map<string, RawEvidenceArticle[]>();
  if (pairs.length === 0) return map;

  const firsts = pairs.map((p) => Math.min(p.a, p.b));
  const seconds = pairs.map((p) => Math.max(p.a, p.b));
  const rows = await sql`
    SELECT v.a AS entity_a, v.b AS entity_b,
      art.id, art.title, art.link, art.source_name, art.published_at, art.first_seen_at
    FROM UNNEST(${firsts}::bigint[], ${seconds}::bigint[]) AS v(a, b)
    JOIN article_entities ae1 ON ae1.entity_id = v.a
    JOIN article_entities ae2 ON ae2.entity_id = v.b AND ae2.article_id = ae1.article_id
    JOIN articles art ON art.id = ae1.article_id AND art.dup_group_id IS NULL
  `;
  for (const row of rows) {
    const key = pairKey(Number(row.entity_a), Number(row.entity_b));
    const article = parseEvidenceArticleRow(row);
    const list = map.get(key);
    if (list) list.push(article);
    else map.set(key, [article]);
  }
  return map;
}

// ---- source R: stated relation ----

interface RelationRow {
  sourceId: number;
  targetId: number;
  relation: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  evidenceArticleId: number | null;
}

function parseRelationRow(row: SqlRow): RelationRow {
  return {
    sourceId: Number(row.source_id),
    targetId: Number(row.target_id),
    relation: String(row.relation),
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    evidenceArticleId: row.evidence_article_id == null ? null : Number(row.evidence_article_id),
  };
}

async function loadRelationsInWindow(sql: Sql): Promise<RelationRow[]> {
  const rows = await sql`
    SELECT r.source_id, r.target_id, r.relation, r.first_seen_at, r.last_seen_at, r.evidence_article_id
    FROM entity_relations r
    JOIN entities es ON es.id = r.source_id AND es.status = 'tracked'
    JOIN entities et ON et.id = r.target_id AND et.status = 'tracked'
    WHERE r.first_seen_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
  `;
  return rows.map(parseRelationRow);
}

function mergeRelationEvidence(
  pairEvidence: RawEvidenceArticle[],
  resolvedEvidence: RawEvidenceArticle | undefined,
): RawEvidenceArticle[] {
  const byId = new Map(pairEvidence.map((a) => [a.articleId, a]));
  if (resolvedEvidence) byId.set(resolvedEvidence.articleId, resolvedEvidence);
  return Array.from(byId.values());
}

function buildRelationCardDrafts(
  relations: RelationRow[],
  entityIndex: Map<number, TrackedEntityMeta>,
  pairArticles: Map<string, RawEvidenceArticle[]>,
  resolvedEvidenceById: Map<number, RawEvidenceArticle>,
  anchorThreshold: number,
): CardDraft[] {
  const drafts: CardDraft[] = [];
  for (const relation of relations) {
    const source = entityIndex.get(relation.sourceId);
    const target = entityIndex.get(relation.targetId);
    if (!source || !target) continue;

    const sourceIsAnchor = isAnchor(source.type, source.baselineDaily, anchorThreshold);
    const targetIsAnchor = isAnchor(target.type, target.baselineDaily, anchorThreshold);
    if (sourceIsAnchor === targetIsAnchor) continue;

    const subject = sourceIsAnchor ? target : source;
    const anchorEntity = sourceIsAnchor ? source : target;
    const pairEvidence = pairArticles.get(pairKey(relation.sourceId, relation.targetId)) ?? [];
    const resolvedEvidence =
      relation.evidenceArticleId == null ? undefined : resolvedEvidenceById.get(relation.evidenceArticleId);

    drafts.push({
      sourceKind: "R",
      subjectName: subject.canonicalName,
      subjectType: subject.type,
      subjectBaselineDaily: subject.baselineDaily,
      anchorNames: [anchorEntity.canonicalName],
      relationOrReason: `${relation.relation} (stated relation)`,
      label: "observed",
      firstObservedAt: relation.firstSeenAt,
      lastObservedAt: relation.lastSeenAt,
      fullEvidence: mergeRelationEvidence(pairEvidence, resolvedEvidence),
      relation: relation.relation,
    });
  }
  return drafts;
}

async function buildRelationSourceDrafts(sql: Sql, ctx: CardContext): Promise<CardDraft[]> {
  const relations = await loadRelationsInWindow(sql);
  if (relations.length === 0) return [];

  const pairs = relations.map((r) => ({ a: r.sourceId, b: r.targetId }));
  const evidenceArticleIds = relations.map((r) => r.evidenceArticleId).filter((id): id is number => id !== null);
  const [pairArticles, resolvedEvidenceById] = await Promise.all([
    loadPairEvidenceArticles(sql, pairs),
    loadArticlesByIds(sql, evidenceArticleIds),
  ]);
  return buildRelationCardDrafts(relations, ctx.entityIndex, pairArticles, resolvedEvidenceById, ctx.anchorThreshold);
}

// ---- source N: newly tracked satellite ----

interface NewSatelliteRow {
  id: number;
  canonicalName: string;
  type: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function parseNewSatelliteRow(row: SqlRow): NewSatelliteRow {
  return {
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    firstSeenAt: toDate(row.first_seen_at),
    // entities.last_seen_at is nullable; a freshly tracked entity is
    // expected to have it set to the same value as first_seen_at, but this
    // falls back defensively rather than assuming that invariant holds.
    lastSeenAt: toDate(row.last_seen_at ?? row.first_seen_at),
  };
}

// Mirrors brief.ts's loadNewEntities bootstrap-guard SQL (own local copy).
async function loadNewSatelliteEntities(sql: Sql): Promise<NewSatelliteRow[]> {
  const rows = await sql`
    SELECT id, canonical_name, type, first_seen_at, last_seen_at
    FROM entities
    WHERE status = 'tracked'
      AND first_seen_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
      AND first_seen_at >= (SELECT MIN(first_seen_at) FROM entities WHERE status = 'tracked')
        + make_interval(hours => ${BOOTSTRAP_GUARD_HOURS}::int)
  `;
  return rows.map(parseNewSatelliteRow);
}

async function loadClusterHeadArticlesForEntities(
  sql: Sql,
  entityIds: number[],
): Promise<Map<number, RawEvidenceArticle[]>> {
  const map = new Map<number, RawEvidenceArticle[]>();
  if (entityIds.length === 0) return map;
  const rows = await sql`
    SELECT ae.entity_id, a.id, a.title, a.link, a.source_name, a.published_at, a.first_seen_at
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id AND a.dup_group_id IS NULL
    WHERE ae.entity_id = ANY(${entityIds}::bigint[])
  `;
  for (const row of rows) {
    const entityId = Number(row.entity_id);
    const article = parseEvidenceArticleRow(row);
    const list = map.get(entityId);
    if (list) list.push(article);
    else map.set(entityId, [article]);
  }
  return map;
}

// Discovers who else co-occurs on a given set of articles — unlike
// detectors.ts's edge-article lookups, this doesn't start from a known pair.
async function loadCoOccurringEntityIds(sql: Sql, articleIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (articleIds.length === 0) return map;
  const rows = await sql`
    SELECT article_id, entity_id
    FROM article_entities
    WHERE article_id = ANY(${articleIds}::bigint[])
  `;
  for (const row of rows) {
    const articleId = Number(row.article_id);
    const entityId = Number(row.entity_id);
    const list = map.get(articleId);
    if (list) list.push(entityId);
    else map.set(articleId, [entityId]);
  }
  return map;
}

function resolveCoOccurringAnchors(
  evidence: RawEvidenceArticle[],
  selfId: number,
  coOccurringByArticle: Map<number, number[]>,
  entityIndex: Map<number, TrackedEntityMeta>,
  anchorThreshold: number,
): TrackedEntityMeta[] {
  const coEntityIds = new Set<number>();
  for (const article of evidence) {
    for (const id of coOccurringByArticle.get(article.articleId) ?? []) {
      if (id !== selfId) coEntityIds.add(id);
    }
  }
  const anchors = Array.from(coEntityIds)
    .map((id) => entityIndex.get(id))
    .filter((meta): meta is TrackedEntityMeta => meta !== undefined)
    .filter((meta) => isAnchor(meta.type, meta.baselineDaily, anchorThreshold));
  return rankAnchors(anchors);
}

function buildNewEntityCardDrafts(
  entities: NewSatelliteRow[],
  evidenceByEntity: Map<number, RawEvidenceArticle[]>,
  coOccurringByArticle: Map<number, number[]>,
  entityIndex: Map<number, TrackedEntityMeta>,
  anchorThreshold: number,
): CardDraft[] {
  const drafts: CardDraft[] = [];
  for (const entity of entities) {
    const baselineDaily = entityIndex.get(entity.id)?.baselineDaily ?? 0;
    if (isAnchor(entity.type, baselineDaily, anchorThreshold)) continue;

    const evidence = evidenceByEntity.get(entity.id) ?? [];
    if (evidence.length === 0) continue;

    const anchors = resolveCoOccurringAnchors(evidence, entity.id, coOccurringByArticle, entityIndex, anchorThreshold);
    if (anchors.length === 0) continue;

    drafts.push({
      sourceKind: "N",
      subjectName: entity.canonicalName,
      subjectType: entity.type,
      subjectBaselineDaily: baselineDaily,
      anchorNames: anchors.map((a) => a.canonicalName),
      relationOrReason: `first observed around ${anchors[0].canonicalName}`,
      label: "observed",
      firstObservedAt: entity.firstSeenAt,
      lastObservedAt: entity.lastSeenAt,
      fullEvidence: evidence,
    });
  }
  return drafts;
}

async function buildNewEntitySourceDrafts(sql: Sql, ctx: CardContext): Promise<CardDraft[]> {
  const entities = await loadNewSatelliteEntities(sql);
  if (entities.length === 0) return [];

  const entityIds = entities.map((e) => e.id);
  const evidenceByEntity = await loadClusterHeadArticlesForEntities(sql, entityIds);
  const articleIds = Array.from(new Set(Array.from(evidenceByEntity.values()).flat().map((a) => a.articleId)));
  const coOccurringByArticle = await loadCoOccurringEntityIds(sql, articleIds);
  return buildNewEntityCardDrafts(entities, evidenceByEntity, coOccurringByArticle, ctx.entityIndex, ctx.anchorThreshold);
}

// ---- source C: corroborated candidate ----

interface CandidateRow {
  nameNorm: string;
  displayName: string;
  typeHint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
    typeHint: String(row.type_hint),
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    sourceNames: toStringArray(row.source_names),
    dayCount: Number(row.day_count),
    sampleTitles: toStringArray(row.sample_titles),
    contexts: toStringArray(row.contexts),
    coEntities: toStringArray(row.co_entities),
  };
}

// Window-only filter; day_count/source-name-count eligibility is a JS
// threshold check (isCorroboratedCandidate), not duplicated here in SQL.
async function loadCandidatesInWindow(sql: Sql): Promise<CandidateRow[]> {
  const rows = await sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
      source_names, day_count, sample_titles, contexts, co_entities
    FROM entity_candidates
    WHERE last_seen_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
  `;
  return rows.map(parseCandidateRow);
}

// co_entities values are freeform extracted name strings; normalizeName
// (NFKD-fold/lowercase/corporate-suffix-strip) against tracked entities'
// canonical_name+aliases is the same deterministic matching entity-ingest.ts
// already uses everywhere to resolve a name string to an entity — not the
// fuzzy/broad/display-name matching banned for the sample_titles<->articles
// evidence match (a wrong match there fabricates evidence; a wrong anchor
// match here only affects eligibility, no black-box evidence risk).
function resolveCandidateAnchors(
  candidates: CandidateRow[],
  nameIndex: Map<string, TrackedEntityMeta>,
  anchorThreshold: number,
): Map<string, TrackedEntityMeta[]> {
  const map = new Map<string, TrackedEntityMeta[]>();
  for (const candidate of candidates) {
    const resolved = candidate.coEntities
      .map((name) => nameIndex.get(normalizeName(name)))
      .filter((meta): meta is TrackedEntityMeta => meta !== undefined)
      .filter((meta) => isAnchor(meta.type, meta.baselineDaily, anchorThreshold));
    map.set(candidate.nameNorm, rankAnchors(resolved));
  }
  return map;
}

function candidateMatchWindow(candidate: CandidateRow): { start: Date; end: Date } {
  const padMs = CANDIDATE_MATCH_WINDOW_PAD_DAYS * DAY_MS;
  return {
    start: new Date(candidate.firstSeenAt.getTime() - padMs),
    end: new Date(candidate.lastSeenAt.getTime() + padMs),
  };
}

// Strict, exact match only: title equality, source_name membership, and a
// narrow window around the candidate's own (news-time) seen range. One
// query per candidate — sample_titles is capped at 3 by entity-ingest.ts,
// and this only runs for candidates that already cleared every cheaper
// eligibility gate, so the candidate set here is small.
async function loadTitleMatchesForCandidate(sql: Sql, candidate: CandidateRow): Promise<RawTitleMatch[]> {
  if (candidate.sampleTitles.length === 0) return [];
  const window = candidateMatchWindow(candidate);
  const rows = await sql`
    SELECT title, id, dup_group_id
    FROM articles
    WHERE title = ANY(${candidate.sampleTitles}::text[])
      AND source_name = ANY(${candidate.sourceNames}::text[])
      AND COALESCE(published_at, first_seen_at) BETWEEN ${window.start.toISOString()} AND ${window.end.toISOString()}
  `;
  return rows.map((row) => ({
    title: String(row.title),
    articleId: Number(row.id),
    dupGroupId: row.dup_group_id == null ? null : Number(row.dup_group_id),
  }));
}

async function loadCandidateTitleMatches(
  sql: Sql,
  candidates: CandidateRow[],
): Promise<Map<string, RawTitleMatch[]>> {
  const entries = await Promise.all(
    candidates.map(async (c) => [c.nameNorm, await loadTitleMatchesForCandidate(sql, c)] as const),
  );
  return new Map(entries);
}

function resolveCandidateEvidence(
  titleMatches: RawTitleMatch[],
  headArticlesById: Map<number, RawEvidenceArticle>,
): RawEvidenceArticle[] {
  const survivingHeadIds = resolveAmbiguousTitles(titleMatches);
  return survivingHeadIds
    .map((id) => headArticlesById.get(id))
    .filter((article): article is RawEvidenceArticle => article !== undefined);
}

function buildCandidateCardDrafts(
  candidates: CandidateRow[],
  anchorsByCandidate: Map<string, TrackedEntityMeta[]>,
  titleMatchesByCandidate: Map<string, RawTitleMatch[]>,
  headArticlesById: Map<number, RawEvidenceArticle>,
): CardDraft[] {
  const drafts: CardDraft[] = [];
  for (const candidate of candidates) {
    const anchors = anchorsByCandidate.get(candidate.nameNorm) ?? [];
    if (anchors.length === 0) continue;

    const titleMatches = titleMatchesByCandidate.get(candidate.nameNorm) ?? [];
    // Candidate observed times NEVER come from the candidate row itself
    // (news-time, search-window-only) — always min/max of the SURVIVING
    // evidence articles' own (arrival-based) first_seen_at.
    const evidence = resolveCandidateEvidence(titleMatches, headArticlesById);
    if (evidence.length === 0) continue;

    const firstObservedAt = new Date(Math.min(...evidence.map((e) => e.firstSeenAt.getTime())));
    const lastObservedAt = new Date(Math.max(...evidence.map((e) => e.firstSeenAt.getTime())));

    drafts.push({
      sourceKind: "C",
      subjectName: candidate.displayName,
      subjectType: candidate.typeHint,
      subjectBaselineDaily: null,
      anchorNames: anchors.map((a) => a.canonicalName),
      relationOrReason: candidate.contexts[0] ?? `recurring alongside ${anchors[0].canonicalName}`,
      label: "observed",
      firstObservedAt,
      lastObservedAt,
      fullEvidence: evidence,
      candidateDayCount: candidate.dayCount,
    });
  }
  return drafts;
}

async function buildCandidateSourceDrafts(sql: Sql, ctx: CardContext): Promise<CardDraft[]> {
  const candidates = (await loadCandidatesInWindow(sql)).filter((c) =>
    isCorroboratedCandidate(c.dayCount, c.sourceNames.length),
  );
  if (candidates.length === 0) return [];

  const anchorsByCandidate = resolveCandidateAnchors(candidates, ctx.nameIndex, ctx.anchorThreshold);
  const eligible = candidates.filter((c) => (anchorsByCandidate.get(c.nameNorm) ?? []).length > 0);
  if (eligible.length === 0) return [];

  const titleMatchesByCandidate = await loadCandidateTitleMatches(sql, eligible);
  const headIds = Array.from(
    new Set(Array.from(titleMatchesByCandidate.values()).flat().map((m) => m.dupGroupId ?? m.articleId)),
  );
  const headArticlesById = await loadArticlesByIds(sql, headIds);
  return buildCandidateCardDrafts(eligible, anchorsByCandidate, titleMatchesByCandidate, headArticlesById);
}

// ---- source E: co-coverage edge ----

// Own local copy of detectors.ts's private loadGlobalMinFirstSeen(sql,
// "entity_edges") — that function isn't exported and entity-ingest.ts /
// detectors.ts are forbidden to edit; only isBootstrapCohort itself is
// imported.
async function loadEdgeBootstrapFloor(sql: Sql): Promise<Date | null> {
  const rows = await sql`
    SELECT MIN(ee.first_seen_at) AS min_first_seen
    FROM entity_edges ee
    JOIN entities ea ON ea.id = ee.entity_a
    JOIN entities eb ON eb.id = ee.entity_b
    WHERE ea.status = 'tracked' AND eb.status = 'tracked'
  `;
  const value = rows[0]?.min_first_seen;
  return value == null ? null : toDate(value);
}

interface EdgeRow {
  entityA: number;
  entityB: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function parseEdgeRow(row: SqlRow): EdgeRow {
  return {
    entityA: Number(row.entity_a),
    entityB: Number(row.entity_b),
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
  };
}

async function loadEdgesInWindow(sql: Sql): Promise<EdgeRow[]> {
  const rows = await sql`
    SELECT ee.entity_a, ee.entity_b, ee.first_seen_at, ee.last_seen_at
    FROM entity_edges ee
    JOIN entities ea ON ea.id = ee.entity_a AND ea.status = 'tracked'
    JOIN entities eb ON eb.id = ee.entity_b AND eb.status = 'tracked'
    WHERE ee.first_seen_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
      AND ee.article_count >= ${MIN_EDGE_ARTICLE_COUNT}
  `;
  return rows.map(parseEdgeRow);
}

function buildEdgeCardDrafts(
  edges: EdgeRow[],
  globalMin: Date | null,
  entityIndex: Map<number, TrackedEntityMeta>,
  pairArticles: Map<string, RawEvidenceArticle[]>,
  anchorThreshold: number,
): CardDraft[] {
  if (!globalMin) return [];
  const drafts: CardDraft[] = [];
  for (const edge of edges) {
    if (isBootstrapCohort(edge.firstSeenAt, globalMin)) continue;
    const entityA = entityIndex.get(edge.entityA);
    const entityB = entityIndex.get(edge.entityB);
    if (!entityA || !entityB) continue;

    const aIsAnchor = isAnchor(entityA.type, entityA.baselineDaily, anchorThreshold);
    const bIsAnchor = isAnchor(entityB.type, entityB.baselineDaily, anchorThreshold);
    if (aIsAnchor === bIsAnchor) continue;

    const subject = aIsAnchor ? entityB : entityA;
    const anchorEntity = aIsAnchor ? entityA : entityB;
    const evidence = pairArticles.get(pairKey(edge.entityA, edge.entityB)) ?? [];

    drafts.push({
      sourceKind: "E",
      subjectName: subject.canonicalName,
      subjectType: subject.type,
      subjectBaselineDaily: subject.baselineDaily,
      anchorNames: [anchorEntity.canonicalName],
      relationOrReason: `recurring co-coverage with ${anchorEntity.canonicalName}`,
      label: "pattern",
      firstObservedAt: edge.firstSeenAt,
      lastObservedAt: edge.lastSeenAt,
      fullEvidence: evidence,
    });
  }
  return drafts;
}

async function buildEdgeSourceDrafts(sql: Sql, ctx: CardContext): Promise<CardDraft[]> {
  const [edges, globalMin] = await Promise.all([loadEdgesInWindow(sql), loadEdgeBootstrapFloor(sql)]);
  if (edges.length === 0) return [];

  const pairs = edges.map((e) => ({ a: e.entityA, b: e.entityB }));
  const pairArticles = await loadPairEvidenceArticles(sql, pairs);
  return buildEdgeCardDrafts(edges, globalMin, ctx.entityIndex, pairArticles, ctx.anchorThreshold);
}

// ---- assembly + orchestration ----

interface CardContext {
  entityIndex: Map<number, TrackedEntityMeta>;
  nameIndex: Map<string, TrackedEntityMeta>;
  anchorThreshold: number;
}

function scoreCard(draft: CardDraft, anchorThreshold: number, now: Date): ScoredCard {
  const distinctSources = countDistinctSources(draft.fullEvidence);
  const distinctDays = draft.candidateDayCount ?? countDistinctUtcDays(draft.fullEvidence);
  const staleReporting = computeStaleReporting(draft.firstObservedAt, draft.fullEvidence);
  const ageDays = (now.getTime() - draft.firstObservedAt.getTime()) / DAY_MS;

  const parts: ScoreParts = {
    novelty: computeNovelty(ageDays),
    corroboration: computeCorroboration(distinctSources),
    persistence: computePersistence(distinctDays),
    relationStrength: computeRelationStrength(draft.sourceKind, draft.relation),
    anchorContext: computeAnchorContext(draft.anchorNames.length),
    penalty: computePenalty(staleReporting, draft.subjectBaselineDaily, anchorThreshold),
  };
  const whyShown = buildWhyShown({
    ageDays,
    distinctSources,
    distinctDays,
    anchorName: draft.anchorNames[0],
    sourceKind: draft.sourceKind,
    relation: draft.relation,
  });

  return { ...draft, score: scoreDevelopment(parts), scoreParts: parts, whyShown, staleReporting };
}

function toDevelopmentCardJson(card: ScoredCard): DevelopmentCardJson {
  return {
    subjectName: card.subjectName,
    subjectType: card.subjectType,
    anchorNames: card.anchorNames,
    relationOrReason: card.relationOrReason,
    whyShown: card.whyShown,
    label: card.label,
    firstObservedAt: card.firstObservedAt.toISOString(),
    lastObservedAt: card.lastObservedAt.toISOString(),
    staleReporting: card.staleReporting,
    evidence: selectDisplayEvidence(card.fullEvidence, MAX_EVIDENCE_ARTICLES).map(toEvidenceJson),
    score: card.score,
    scoreParts: card.scoreParts,
  };
}

async function buildAllCardDrafts(sql: Sql, ctx: CardContext): Promise<CardDraft[]> {
  const [relationDrafts, newEntityDrafts, candidateDrafts, edgeDrafts] = await Promise.all([
    buildRelationSourceDrafts(sql, ctx),
    buildNewEntitySourceDrafts(sql, ctx),
    buildCandidateSourceDrafts(sql, ctx),
    buildEdgeSourceDrafts(sql, ctx),
  ]);
  return [...relationDrafts, ...newEntityDrafts, ...candidateDrafts, ...edgeDrafts];
}

// Eligibility (uniform, incl. the subject-is-anchor check) -> score ->
// cross-source dedupe -> sort/cap, strictly in that order: dedupe needs the
// scored relationStrength, and eligibility must run before scoring per spec.
function finalizeCards(drafts: CardDraft[], anchorThreshold: number, now: Date): DevelopmentCardJson[] {
  const eligible = drafts.filter((draft) => {
    const subjectIsAnchor = isAnchor(draft.subjectType, draft.subjectBaselineDaily ?? 0, anchorThreshold);
    return passesEligibility({
      subjectIsAnchor,
      distinctSourceCount: countDistinctSources(draft.fullEvidence),
      evidenceCount: draft.fullEvidence.length,
      anchorCount: draft.anchorNames.length,
    });
  });
  const scored = eligible.map((draft) => scoreCard(draft, anchorThreshold, now));
  const deduped = dedupeCards(scored);
  const capped = sortAndCapCards(deduped, CARD_CAP);
  return capped.map(toDevelopmentCardJson);
}

/** Read-only, request-time-computed development cards: lower-frequency
 * satellite entities surfaced with high-volume anchor context, evidence,
 * and honest (arrival-based) observation times. Returns [] before the
 * system has any operating history at all — callers that already gate on
 * computeWarmupState (getBrief) never reach that case, but this must still
 * tolerate being called directly (e.g. from a test) with no epoch yet. */
export async function getDevelopments(sql: Sql, now: Date = new Date()): Promise<DevelopmentCardJson[]> {
  const epoch = await getSystemEpoch(sql);
  if (!epoch) return [];

  const effectiveBaselineDays = computeEffectiveBaselineDays(computeDaysSinceEpoch(now, epoch));
  const baselineRows = await loadEntityBaselinePanel(sql);
  const entities = toTrackedEntityMeta(baselineRows, effectiveBaselineDays);
  const anchorThreshold = computeAnchorThreshold(collectBaselinePopulation(baselineRows, effectiveBaselineDays));

  const ctx: CardContext = {
    entityIndex: buildEntityIndex(entities),
    nameIndex: buildNameIndex(entities),
    anchorThreshold,
  };
  const drafts = await buildAllCardDrafts(sql, ctx);
  return finalizeCards(drafts, anchorThreshold, now);
}
