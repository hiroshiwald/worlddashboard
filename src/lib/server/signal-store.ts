import type { Sql, SqlRow } from "./db";
import type { CandidateSignal } from "./detectors";
import type { Settings } from "./settings";

const ACTIVE_STATES = ["new", "seen", "promoted"];
export type SignalAction = "seen" | "dismissed" | "promoted" | "reopen";

export interface PersistResult {
  created: number;
  refreshed: number;
  suppressed: number;
}

export interface EvidenceArticle {
  id: number;
  title: string;
  link: string;
  sourceName: string;
}

export interface SignalJson {
  id: number;
  dedupeKey: string;
  type: string;
  severity: string;
  state: string;
  title: string;
  entityIds: number[];
  entityNames: string[];
  confidence: number;
  evidence: Record<string, unknown>;
  articles: EvidenceArticle[];
  firstDetectedAt: string;
  lastEvidenceAt: string;
  stateChangedAt: string | null;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

function toBigIntArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((v) => Number(v)) : [];
}

function evidenceArticleIds(evidence: Record<string, unknown>): number[] {
  const ids = evidence.articleIds;
  return Array.isArray(ids) ? ids.map((id) => Number(id)) : [];
}

function parseSignalRow(row: SqlRow): Omit<SignalJson, "articles"> {
  return {
    id: Number(row.id),
    dedupeKey: String(row.dedupe_key),
    type: String(row.type),
    severity: String(row.severity),
    state: String(row.state),
    title: String(row.title),
    entityIds: toBigIntArray(row.entity_ids),
    entityNames: Array.isArray(row.entity_names) ? (row.entity_names as string[]) : [],
    confidence: Number(row.confidence),
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    firstDetectedAt: toIsoString(row.first_detected_at),
    lastEvidenceAt: toIsoString(row.last_evidence_at),
    stateChangedAt: row.state_changed_at == null ? null : toIsoString(row.state_changed_at),
  };
}

/** Resolves evidence.articleIds to title/link/sourceName in one batched
 * query shared across every signal in the result set (not a per-signal
 * fetch) — an article referenced by an older signal's evidence may have
 * aged out of retention, so a ref that resolves to nothing is dropped. */
async function loadEvidenceArticles(sql: Sql, articleIds: number[]): Promise<Map<number, EvidenceArticle>> {
  if (articleIds.length === 0) return new Map();
  const rows = await sql`SELECT id, title, link, source_name FROM articles WHERE id = ANY(${articleIds}::bigint[])`;
  return new Map(
    rows.map((row) => [
      Number(row.id),
      { id: Number(row.id), title: String(row.title), link: String(row.link), sourceName: String(row.source_name) },
    ]),
  );
}

/** Signals in the given states, severity-first (critical, warning, advisory)
 * then most-recent-evidence-first, with entity names resolved in the same
 * query (a LATERAL join, not a per-row fetch) — used by both /api/signals
 * and /api/brief. `limit` of undefined means no cap (Postgres treats
 * `LIMIT NULL` as unlimited). */
export async function loadSignals(sql: Sql, states: string[], limit?: number): Promise<SignalJson[]> {
  const rows = await sql`
    SELECT s.*, en.names AS entity_names
    FROM signals s
    LEFT JOIN LATERAL (
      SELECT array_agg(e.canonical_name ORDER BY array_position(s.entity_ids, e.id)) AS names
      FROM entities e WHERE e.id = ANY(s.entity_ids)
    ) en ON true
    WHERE s.state = ANY(${states}::text[])
    ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, s.last_evidence_at DESC
    LIMIT ${limit ?? null}
  `;
  const signals = rows.map(parseSignalRow);

  const allArticleIds = Array.from(new Set(signals.flatMap((s) => evidenceArticleIds(s.evidence))));
  const articlesById = await loadEvidenceArticles(sql, allArticleIds);

  return signals.map((signal) => ({
    ...signal,
    articles: evidenceArticleIds(signal.evidence)
      .map((id) => articlesById.get(id))
      .filter((a): a is EvidenceArticle => a !== undefined),
  }));
}

async function loadDismissedWithinCooldown(sql: Sql, dedupeKeys: string[], cooldownHours: number): Promise<Set<string>> {
  const rows = await sql`
    SELECT dedupe_key FROM signals
    WHERE dedupe_key = ANY(${dedupeKeys}::text[])
      AND state = 'dismissed'
      AND state_changed_at >= now() - make_interval(hours => ${cooldownHours}::int)
  `;
  return new Set(rows.map((r) => String(r.dedupe_key)));
}

async function loadActiveDedupeKeys(sql: Sql, dedupeKeys: string[]): Promise<Set<string>> {
  const rows = await sql`
    SELECT dedupe_key FROM signals
    WHERE dedupe_key = ANY(${dedupeKeys}::text[]) AND state = ANY(${ACTIVE_STATES}::text[])
  `;
  return new Set(rows.map((r) => String(r.dedupe_key)));
}

async function upsertCandidates(sql: Sql, candidates: CandidateSignal[]): Promise<void> {
  const payload = candidates.map((c) => ({
    dedupe_key: c.dedupeKey,
    type: c.type,
    severity: c.severity,
    title: c.title,
    entity_ids: c.entityIds,
    confidence: c.confidence,
    evidence: c.evidence,
  }));

  await sql`
    INSERT INTO signals (dedupe_key, type, severity, title, entity_ids, confidence, evidence, first_detected_at, last_evidence_at)
    SELECT dedupe_key, type, severity, title, entity_ids, confidence, evidence, now(), now()
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS t(
      dedupe_key text, type text, severity text, title text,
      entity_ids bigint[], confidence real, evidence jsonb
    )
    ON CONFLICT (dedupe_key) WHERE state IN ('new', 'seen', 'promoted')
    DO UPDATE SET
      last_evidence_at = now(),
      confidence = EXCLUDED.confidence,
      severity = EXCLUDED.severity,
      evidence = EXCLUDED.evidence,
      title = EXCLUDED.title
  `;
}

/** Upserts detector output into `signals`. A candidate whose dedupe_key was
 * DISMISSED within settings.dismiss_cooldown_hours is suppressed entirely —
 * re-detection doesn't resurrect something the user just dismissed.
 * Everything else upserts against the active partial unique index; state is
 * never touched by re-detection (a 'seen' signal stays seen). */
export async function persistSignals(
  sql: Sql,
  candidates: CandidateSignal[],
  settings: Settings,
): Promise<PersistResult> {
  if (candidates.length === 0) return { created: 0, refreshed: 0, suppressed: 0 };

  const dedupeKeys = candidates.map((c) => c.dedupeKey);
  const suppressedKeys = await loadDismissedWithinCooldown(sql, dedupeKeys, settings.dismiss_cooldown_hours);
  const toPersist = candidates.filter((c) => !suppressedKeys.has(c.dedupeKey));
  const suppressed = candidates.length - toPersist.length;
  if (toPersist.length === 0) return { created: 0, refreshed: 0, suppressed };

  const existingActiveKeys = await loadActiveDedupeKeys(sql, toPersist.map((c) => c.dedupeKey));
  await upsertCandidates(sql, toPersist);

  const refreshed = toPersist.filter((c) => existingActiveKeys.has(c.dedupeKey)).length;
  return { created: toPersist.length - refreshed, refreshed, suppressed };
}

const ALLOWED_ACTIONS = new Set<SignalAction>(["seen", "dismissed", "promoted", "reopen"]);

/** Legal transitions: any active state (new/seen/promoted) -> seen/dismissed/
 * promoted; dismissed -> new via 'reopen'. Returns false on an unknown id or
 * an illegal transition (e.g. reopening a non-dismissed signal, or acting on
 * a dismissed one with anything but reopen) — the caller turns that into a
 * 404/409. */
// A single conditional UPDATE (state as both the target and a WHERE guard)
// rather than a separate SELECT-then-UPDATE: two concurrent transitions on
// the same id can no longer race, since only the UPDATE that still matches
// the guard at commit time affects any row — the loser's zero-row result
// falls straight out as `false`, the same value an unknown id or an
// already-illegal transition produces.
export async function transitionSignal(sql: Sql, id: number, action: SignalAction): Promise<boolean> {
  if (!ALLOWED_ACTIONS.has(action)) return false;

  const rows = action === "reopen"
    ? await sql`
        UPDATE signals SET state = 'new', state_changed_at = now()
        WHERE id = ${id} AND state = 'dismissed'
        RETURNING id
      `
    : await sql`
        UPDATE signals SET state = ${action}, state_changed_at = now()
        WHERE id = ${id} AND state = ANY(${ACTIVE_STATES}::text[])
        RETURNING id
      `;

  return rows.length > 0;
}
