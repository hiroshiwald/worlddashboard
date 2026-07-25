import type { Sql, SqlRow } from "./db";
import { lookupWikidataFame } from "./wikidata";
import { computeWikiFameVerdict } from "./fame";
import { normalizeName } from "./extract-v2";
import { COUNTRY_DICT, ORG_DICT, REGION_DICT, DictEntry } from "../entity-dictionaries";

const BATCH_LIMIT = 40;
const CHUNK_SIZE = 3;
const MAX_ALIASES = 24;
// Wall-clock budget for one whole sweep tick — mirrors entity-ingest.ts's
// LLM_TIME_BUDGET_MS pattern: checked between chunks of CHUNK_SIZE entities
// (LLM batches there), never pre-empting a chunk already in flight — the
// same convention as before, one level up from per-entity to per-chunk.
// Ceiling math: this budget (12s) plus one in-flight chunk's worst case —
// bounded by its slowest entity, since a chunk's entities run concurrently
// rather than stacked, so up to 3 sequential Wikidata calls at 4s timeout
// each (12s) — is ~24s absolute worst, ~4s more than the previous
// 8s-budget/20s-worst ceiling. Still safely inside Vercel's 60s function
// ceiling alongside ingest's other budgets (FABLE-ROADMAP.md §14b): the LLM
// extraction stage's own timeout plus feed fetch/persist/detect-signals all
// share that same 60s invocation.
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

/** Tracked entities needing a (re)check: fame='unknown' never checked or
 * checked >7 days ago (retry window for a prior lookup failure, which
 * leaves fame='unknown' — see checkAndWriteEntityFame); fame='not_famous'
 * checked >30 days ago (a rising entity can graduate to famous).
 * fame='famous' is permanent and never appears here. Never-checked entities
 * sort first, then newest first_seen_at — both the freshest unchecked
 * arrivals and, within the recheck group, the newest entities are
 * prioritized over older ones once the batch is capped at 40. */
async function selectSweepBatch(sql: Sql): Promise<FameCheckEntity[]> {
  const rows = await sql`
    SELECT id, canonical_name, aliases
    FROM entities
    WHERE status = 'tracked'
      AND (
        (fame = 'unknown' AND (fame_checked_at IS NULL OR fame_checked_at < now() - INTERVAL '7 days'))
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

/** One entity's lookup + write — shared by runFameSweep's batch loop and
 * the candidates route's inline post-accept check. A lookup failure writes
 * ONLY fame_checked_at (plus the alias merge, which never depends on the
 * network) — fame itself stays whatever it already was ('unknown' stays
 * unknown), and fame_checked_at still advances so the retry queue rotates
 * to the next-due entity instead of head-of-line blocking on a
 * persistently-unreachable one. */
export async function checkAndWriteEntityFame(sql: Sql, entity: FameCheckEntity, now: Date = new Date()): Promise<"success" | "failure"> {
  const result = await lookupWikidataFame(entity.canonicalName, now);
  const wikidataAliases = result.ok ? result.lookup.aliases : [];
  const aliases = mergeAliases(entity.aliases, wikidataAliases, entity.canonicalName);

  if (!result.ok) {
    await writeFailure(sql, entity.id, aliases);
    return "failure";
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
  return "success";
}

export interface FameSweepStats {
  checked: number;
  succeeded: number;
  failed: number;
}

function chunkEntities(entities: FameCheckEntity[], size: number): FameCheckEntity[][] {
  const chunks: FameCheckEntity[][] = [];
  for (let i = 0; i < entities.length; i += size) chunks.push(entities.slice(i, i + size));
  return chunks;
}

function tallyOutcomes(outcomes: Array<"success" | "failure">): FameSweepStats {
  const stats: FameSweepStats = { checked: 0, succeeded: 0, failed: 0 };
  for (const outcome of outcomes) {
    stats.checked += 1;
    stats[outcome === "success" ? "succeeded" : "failed"] += 1;
  }
  return stats;
}

/** Per-tick background sweep: (re)checks up to 40 tracked entities against
 * Wikidata/Wikipedia, CHUNK_SIZE (3) at a time — each chunk's entities run
 * concurrently via Promise.all, bounded parallelism that stays polite to
 * Wikimedia's APIs without the complexity of a streaming pool. Runs within
 * a ~12s wall-clock budget checked between chunks (never pre-empting one
 * already in flight) — a sweep that runs long simply processes fewer
 * chunks this tick and picks up the rest next time, the same degrade
 * entity-ingest.ts's LLM wall-clock budget uses. Each chunk's outcomes are
 * collected via Promise.all and reduced into stats afterward — never a
 * counter mutated from inside the concurrent section. */
export async function runFameSweep(
  sql: Sql,
  now: Date = new Date(),
  deadline: number = Date.now() + SWEEP_WALL_CLOCK_BUDGET_MS,
): Promise<FameSweepStats> {
  const batch = await selectSweepBatch(sql);
  const outcomes: Array<"success" | "failure"> = [];

  for (const chunk of chunkEntities(batch, CHUNK_SIZE)) {
    if (Date.now() >= deadline) break;
    const chunkOutcomes = await Promise.all(chunk.map((entity) => checkAndWriteEntityFame(sql, entity, now)));
    outcomes.push(...chunkOutcomes);
  }
  return tallyOutcomes(outcomes);
}
