import type { Sql, SqlRow } from "./db";
import { lookupWikidataFame, lookupFameFromMatch, resolveNamesBatch, EntityDetails } from "./wikidata";
import { computeWikiFameVerdict } from "./fame";
import { normalizeName } from "./extract-v2";
import { COUNTRY_DICT, ORG_DICT, REGION_DICT, DictEntry } from "../entity-dictionaries";

const BATCH_LIMIT = 40;
const CHUNK_SIZE = 3;
const MAX_ALIASES = 24;
const UNKNOWN_RETRY_HOURS = 6;
// Wall-clock budget for one whole sweep tick — mirrors entity-ingest.ts's
// LLM_TIME_BUDGET_MS pattern: checked between chunks of CHUNK_SIZE entities
// (LLM batches there), never pre-empting a chunk already in flight — the
// same convention as before, one level up from per-entity to per-chunk.
// Ceiling math: this budget (12s) plus one in-flight chunk's worst case —
// bounded by its slowest entity, since a chunk's entities run concurrently
// rather than stacked, so up to 3 sequential Wikidata calls at 4s timeout
// each (12s) — is ~24s absolute worst, ~4s more than the previous
// 8s-budget/20s-worst ceiling. runFameSweep's one upfront resolveNamesBatch
// call (before the chunk loop, so not itself deadline-gated — same
// unaccounted-for-but-bounded treatment as selectSweepBatch's own query
// time) adds up to one more 4s-timeout call on top, ~28s absolute worst.
// Still safely inside Vercel's 60s function ceiling alongside ingest's other
// budgets (FABLE-ROADMAP.md §14b): the LLM extraction stage's own timeout
// plus feed fetch/persist/detect-signals all share that same 60s invocation.
const SWEEP_WALL_CLOCK_BUDGET_MS = 12000;

const ALL_DICT_ENTRIES: DictEntry[] = [...COUNTRY_DICT, ...ORG_DICT, ...REGION_DICT];

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** The minimal shape one fame check needs — a tracked entity's id, name, and
 * current aliases. Shared by the batch sweep below and the candidates
 * route's inline single-entity check after an accept. */
export interface FameCheckEntity {
  id: number;
  canonicalName: string;
  aliases: string[];
}

function parseSweepCandidateRow(row: SqlRow): FameCheckEntity {
  return { id: Number(row.id), canonicalName: String(row.canonical_name), aliases: toStringArray(row.aliases) };
}

/** Tracked entities needing a (re)check: fame='unknown' means never checked
 * or the last attempt failed (a transient lookup failure — see
 * checkAndWriteEntityFame); a failed attempt retries after
 * UNKNOWN_RETRY_HOURS (6h) — frequent enough to converge a
 * transient-failure pool in about a day, infrequent enough to stay polite
 * to Wikimedia for an entity that keeps failing. fame='not_famous' checked
 * >30 days ago (a rising entity can graduate to famous). fame='famous' is
 * permanent and never appears here. fame_locked=true (a human verdict via
 * PATCH /api/entities/[id] — migrations/007) is excluded regardless of
 * which branch would otherwise match, since a human correction must never
 * be silently overwritten by the automated sweep. Never-checked entities
 * sort first, then newest first_seen_at — both the freshest unchecked
 * arrivals and, within the recheck group, the newest entities are
 * prioritized over older ones once the batch is capped at 40. */
async function selectSweepBatch(sql: Sql): Promise<FameCheckEntity[]> {
  const rows = await sql`
    SELECT id, canonical_name, aliases
    FROM entities
    WHERE status = 'tracked'
      AND fame_locked = false
      AND (
        (fame = 'unknown' AND (fame_checked_at IS NULL OR fame_checked_at < now() - make_interval(hours => ${UNKNOWN_RETRY_HOURS}::int)))
        OR (fame = 'not_famous' AND fame_checked_at < now() - INTERVAL '30 days')
      )
    ORDER BY (fame_checked_at IS NULL) DESC, first_seen_at DESC
    LIMIT ${BATCH_LIMIT}
  `;
  return rows.map(parseSweepCandidateRow);
}

/** The DictEntry whose name matches this canonical name, if any — the same
 * name-only match the dictionary fame prong (fame.ts's isDictionaryFamous)
 * uses, just against the entry's own name field rather than membership. */
function findDictionaryAliases(canonicalName: string): string[] {
  const norm = normalizeName(canonicalName);
  const entry = ALL_DICT_ENTRIES.find((e) => normalizeName(e.name) === norm);
  return entry?.aliases ?? [];
}

/** existing ∪ Wikidata labels/aliases ∪ matching seeded-dictionary aliases,
 * deduped via normalizeName. Existing aliases are NEVER dropped — the cap
 * of 24 only bounds how many NEW aliases this merge appends, so an entity
 * that already has 24+ keeps them all. The dictionary lookup is pure and
 * free, so it applies even when wikidataAliases is empty (a failed or
 * no-match lookup) — this alone is the fix for e.g. Ukraine lacking
 * "Kyiv"/"Kiev" (entity-ingest.ts's upsertNewEntities inserts every new
 * entity with an empty aliases array). */
export function mergeAliases(existing: string[], wikidataAliases: string[], canonicalName: string): string[] {
  const merged = [...existing];
  const seen = new Set(existing.map(normalizeName));
  seen.add(normalizeName(canonicalName)); // never add an alias identical to the canonical name itself
  const budget = Math.max(0, MAX_ALIASES - merged.length);

  let added = 0;
  for (const candidate of [...wikidataAliases, ...findDictionaryAliases(canonicalName)]) {
    if (added >= budget) break;
    const key = normalizeName(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
    added += 1;
  }
  return merged;
}

async function writeFailure(sql: Sql, entityId: number, aliases: string[]): Promise<void> {
  await sql`UPDATE entities SET fame_checked_at = now(), aliases = ${aliases} WHERE id = ${entityId}`;
}

async function writeSuccess(
  sql: Sql,
  entityId: number,
  aliases: string[],
  fame: "not_famous" | "famous",
  wikiTitle: string | null,
  sitelinks: number,
  medianMonthlyPageviews: number,
): Promise<void> {
  await sql`
    UPDATE entities
    SET fame = ${fame}, wiki_title = ${wikiTitle}, wiki_sitelinks = ${sitelinks},
        wiki_pageviews_monthly = ${medianMonthlyPageviews}, fame_checked_at = now(), aliases = ${aliases}
    WHERE id = ${entityId}
  `;
}

/** Minimal rescue write for an entity whose check threw — stamps
 * fame_checked_at ONLY, never touching fame/aliases/wiki_* columns. Whatever
 * threw (bad data, a transient DB blip) might throw again on a fuller write,
 * so this is deliberately the smallest possible query. If THIS throws too,
 * it propagates — that means the database itself is down, which the sweep
 * must abort on rather than spin through. */
async function writeRescueStamp(sql: Sql, entityId: number): Promise<void> {
  await sql`UPDATE entities SET fame_checked_at = now() WHERE id = ${entityId}`;
}

export type FameCheckOutcome = { outcome: "success" } | { outcome: "failure"; reason: string };

/** One entity's lookup + write — shared by runFameSweep's batch loop and
 * the candidates route's inline post-accept check. `batchMatch`, when
 * given, is a name this tick's one resolveNamesBatch call already resolved
 * — the search+entities requests are skipped entirely and only the
 * per-article pageviews call remains (see lookupFameFromMatch). Never
 * throws for an entity-scoped problem: a RETURNED lookup failure writes
 * ONLY fame_checked_at (plus the alias merge, which never depends on the
 * network) — fame itself stays whatever it already was ('unknown' stays
 * unknown) — and its specific reason string comes back to the caller for
 * runFameSweep's failureReasons tally and rate-limit circuit breaker.
 * Anything that THROWS instead — a transient DB-query failure, response
 * parsing, the verdict, the alias merge, or the write itself — is caught
 * here and degrades the same way: one loud log line identifying the entity
 * and the error, then the same fame_checked_at-only rescue write, tagged
 * with the generic "unexpected_exception" reason (it's not a Wikidata
 * signal, so it never trips the circuit breaker). Either path advances
 * fame_checked_at so the retry queue rotates to the next-due entity instead
 * of head-of-line blocking on one that keeps failing — and, since every
 * per-entity path now resolves instead of rejecting, a chunk's Promise.all
 * can never take the whole sweep down with it. Only the rescue write itself
 * throwing propagates out (see writeRescueStamp) — an infrastructure-wide
 * failure should still abort the sweep loudly rather than be swallowed
 * here. */
export async function checkAndWriteEntityFame(
  sql: Sql,
  entity: FameCheckEntity,
  now: Date = new Date(),
  batchMatch?: EntityDetails,
): Promise<FameCheckOutcome> {
  try {
    const result = batchMatch ? await lookupFameFromMatch(batchMatch, now) : await lookupWikidataFame(entity.canonicalName, now);
    const wikidataAliases = result.ok ? result.lookup.aliases : [];
    const aliases = mergeAliases(entity.aliases, wikidataAliases, entity.canonicalName);

    if (!result.ok) {
      await writeFailure(sql, entity.id, aliases);
      return { outcome: "failure", reason: result.reason };
    }

    const fame = computeWikiFameVerdict({
      matched: result.lookup.matched,
      sitelinks: result.lookup.sitelinks,
      medianMonthlyPageviews: result.lookup.medianMonthlyPageviews,
    });
    // wiki_title/wiki_sitelinks are stored whenever a match occurred,
    // regardless of the computed verdict — a wrong match (name collision with
    // someone famous) must stay visible and human-correctable later.
    await writeSuccess(sql, entity.id, aliases, fame, result.lookup.wikiTitle, result.lookup.sitelinks, result.lookup.medianMonthlyPageviews);
    return { outcome: "success" };
  } catch (err) {
    console.error(`[fame-sweep] entity check threw id=${entity.id} name=${JSON.stringify(entity.canonicalName)}`, err);
    await writeRescueStamp(sql, entity.id);
    return { outcome: "failure", reason: "unexpected_exception" };
  }
}

export interface FameSweepStats {
  checked: number;
  succeeded: number;
  failed: number;
  /** reason string (see wikidata.ts's fetchFailureReason) -> count, across
   * every failure this run — the diagnostic this module lacked during the
   * 24h 100%-failure incident (see DEVLOG): this is what actually lands in
   * the ingest endpoint's JSON response and, from there, the GitHub Actions
   * job log, since Vercel's own runtime logs only retain for an hour. */
  failureReasons: Record<string, number>;
  /** Present only when the circuit breaker (see runFameSweep) cut a run
   * short after a 429/403 — currently always "rate_limited". */
  abortedReason?: string;
}

function chunkEntities(entities: FameCheckEntity[], size: number): FameCheckEntity[][] {
  const chunks: FameCheckEntity[][] = [];
  for (let i = 0; i < entities.length; i += size) chunks.push(entities.slice(i, i + size));
  return chunks;
}

function tallyOutcomes(outcomes: FameCheckOutcome[]): FameSweepStats {
  const stats: FameSweepStats = { checked: 0, succeeded: 0, failed: 0, failureReasons: {} };
  for (const outcome of outcomes) {
    stats.checked += 1;
    if (outcome.outcome === "success") {
      stats.succeeded += 1;
    } else {
      stats.failed += 1;
      stats.failureReasons[outcome.reason] = (stats.failureReasons[outcome.reason] ?? 0) + 1;
    }
  }
  return stats;
}

// HTTP 429 (Too Many Requests) or 403 (Forbidden) from ANY stage, at ANY
// point in a run, means Wikidata/Wikimedia is actively refusing us — not a
// one-off blip like a 500 or a timeout. Matches wikidata.ts's
// "<stage>_http_<status>" reason shape regardless of which stage or call
// (single-name search/entities/pageviews, or the batch resolution call)
// produced it.
function isRateLimitReason(reason: string): boolean {
  return reason.endsWith("_http_429") || reason.endsWith("_http_403");
}

/** Per-tick background sweep: (re)checks up to 40 tracked entities against
 * Wikidata/Wikipedia. Tries resolveNamesBatch first — ONE wbgetentities
 * call for the whole batch's names — so entities whose canonical name is an
 * exact Wikipedia title skip straight to pageviews; everything the batch
 * didn't resolve falls back to the full per-name lookupWikidataFame path,
 * CHUNK_SIZE (3) at a time, each chunk's entities running concurrently via
 * Promise.all — bounded parallelism that stays polite to Wikimedia's APIs
 * without the complexity of a streaming pool. Runs within a ~12s wall-clock
 * budget checked between chunks (never pre-empting one already in flight)
 * — a sweep that runs long simply processes fewer chunks this tick and
 * picks up the rest next time, the same degrade entity-ingest.ts's LLM
 * wall-clock budget uses. Each chunk's outcomes are collected via
 * Promise.all and reduced into stats afterward — never a counter mutated
 * from inside the concurrent section.
 *
 * Circuit breaker: continuing to hammer a service that just told us "no"
 * both sustains whatever block triggered it and is simply impolite to a
 * free public API. One 429/403 is enough signal for one run — abort the
 * rest immediately and let the next run (another ~30 minutes away, per the
 * ingest cron schedule) try again with a clean slate. Entities in chunks
 * never reached are simply never passed to checkAndWriteEntityFame, so
 * their fame_checked_at is left completely untouched and they retry on the
 * normal schedule next time — the same "never stamp what you didn't
 * attempt" invariant the wall-clock budget above already relies on. */
export async function runFameSweep(
  sql: Sql,
  now: Date = new Date(),
  deadline: number = Date.now() + SWEEP_WALL_CLOCK_BUDGET_MS,
): Promise<FameSweepStats> {
  const batch = await selectSweepBatch(sql);

  const batchResolution = await resolveNamesBatch(batch.map((entity) => entity.canonicalName));
  if (!batchResolution.ok && isRateLimitReason(batchResolution.reason)) {
    // Blocked on the very first request of this tick — abort before
    // touching a single entity.
    return { checked: 0, succeeded: 0, failed: 0, failureReasons: { [batchResolution.reason]: 1 }, abortedReason: "rate_limited" };
  }
  // A non-rate-limit batch failure (timeout, 500, malformed body) just means
  // no names get the shortcut this tick — every entity falls back to its
  // own per-name lookup below, exactly as if resolveNamesBatch didn't exist.
  const matchesByName = batchResolution.ok ? batchResolution.matches : new Map<string, EntityDetails>();

  const outcomes: FameCheckOutcome[] = [];
  let abortedReason: string | undefined;

  for (const chunk of chunkEntities(batch, CHUNK_SIZE)) {
    if (Date.now() >= deadline) break;
    const chunkOutcomes = await Promise.all(
      chunk.map((entity) => checkAndWriteEntityFame(sql, entity, now, matchesByName.get(entity.canonicalName))),
    );
    outcomes.push(...chunkOutcomes);

    const rateLimited = chunkOutcomes.some((o) => o.outcome === "failure" && isRateLimitReason(o.reason));
    if (rateLimited) {
      abortedReason = "rate_limited";
      break;
    }
  }

  const stats = tallyOutcomes(outcomes);
  return abortedReason ? { ...stats, abortedReason } : stats;
}
