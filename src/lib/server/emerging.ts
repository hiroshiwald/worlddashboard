import type { EmergingAnchor, EmergingItem, EmergingResponse } from "../emerging-types";
import type { Sql, SqlRow } from "./db";
import { ValidationError, type EntityRole } from "./entity-admin";
import { loadRoleMap } from "./graph";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const MAX_ITEMS = 200;
const MAX_ROWS_PER_KIND = 500;
const MAX_ANCHORS = 3;
const MAX_SAMPLE_TITLES = 3;
const DAY_MS = 24 * 3600 * 1000;

/** Pure. null -> default; otherwise a whole number 1..30 or ValidationError. */
export function parseDays(raw: string | null): number {
  if (raw === null) return DEFAULT_DAYS;
  if (!/^\d+$/.test(raw)) throw new ValidationError(`days must be a whole number 1..${MAX_DAYS}`);
  const days = Number(raw);
  if (days < 1 || days > MAX_DAYS) throw new ValidationError(`days must be a whole number 1..${MAX_DAYS}`);
  return days;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/** Pure. Rows are (subject key, article id, anchor entity). Counts distinct
 * articles per (subject, anchor), keeps famous/anchor roles, top 3 by count. */
export function rankAnchors(
  links: { subject: string; articleId: string; anchorId: string; anchorName: string }[],
  roleById: Map<string, EntityRole>,
): Map<string, EmergingAnchor[]> {
  const articles = new Map<string, { anchor: EmergingAnchor; seen: Set<string> }>();
  for (const link of links) {
    const role = roleById.get(link.anchorId);
    if (role !== "famous" && role !== "anchor") continue;
    const pairKey = `${link.subject}|${link.anchorId}`;
    const entry = articles.get(pairKey) ?? {
      anchor: { id: link.anchorId, name: link.anchorName, articleCount: 0 },
      seen: new Set<string>(),
    };
    entry.seen.add(link.articleId);
    entry.anchor.articleCount = entry.seen.size;
    articles.set(pairKey, entry);
  }
  const bySubject = new Map<string, EmergingAnchor[]>();
  for (const [pairKey, entry] of articles) {
    const subject = pairKey.slice(0, pairKey.indexOf("|"));
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), entry.anchor]);
  }
  for (const [subject, anchors] of bySubject) {
    anchors.sort((a, b) => b.articleCount - a.articleCount || a.name.localeCompare(b.name));
    bySubject.set(subject, anchors.slice(0, MAX_ANCHORS));
  }
  return bySubject;
}

/** Pure. Anchored items first, then newest, then most mentioned; capped. */
export function sortAndCap(items: EmergingItem[]): EmergingItem[] {
  const anchored = (item: EmergingItem) => (item.anchors.length > 0 ? 1 : 0);
  return [...items]
    .sort(
      (a, b) =>
        anchored(b) - anchored(a) ||
        b.firstSeenAt.localeCompare(a.firstSeenAt) ||
        b.mentions - a.mentions ||
        a.key.localeCompare(b.key),
    )
    .slice(0, MAX_ITEMS);
}

export interface EmergingInput {
  candidateRows: SqlRow[]; // emg_cand_* columns
  candidateLinkRows: SqlRow[]; // emg_link_title, emg_link_article, anchor columns
  entityRows: SqlRow[]; // emg_ent_* columns
  entityLinkRows: SqlRow[]; // emg_ent_id, emg_link_article, anchor columns
}

/** Pure. roleById must cover entityRows and every anchor id in the link rows. */
export function assembleEmerging(
  input: EmergingInput,
  roleById: Map<string, EntityRole>,
  days: number,
  now: Date,
): EmergingResponse {
  const candidateAnchors = rankAnchors(
    input.candidateRows.flatMap((cand) =>
      toStrings(cand.sample_titles).flatMap((title) =>
        input.candidateLinkRows
          .filter((link) => String(link.emg_link_title) === title)
          .map((link) => ({
            subject: `cand:${String(cand.name_norm)}`,
            articleId: String(link.emg_link_article),
            anchorId: String(link.id),
            anchorName: String(link.canonical_name),
          })),
      ),
    ),
    roleById,
  );
  const entityAnchors = rankAnchors(
    input.entityLinkRows.map((link) => ({
      subject: String(link.emg_ent_id),
      articleId: String(link.emg_link_article),
      anchorId: String(link.id),
      anchorName: String(link.canonical_name),
    })),
    roleById,
  );
  const items: EmergingItem[] = [];
  for (const cand of input.candidateRows) {
    const key = `cand:${String(cand.name_norm)}`;
    items.push({
      key,
      kind: "candidate",
      name: String(cand.display_name),
      type: String(cand.type_hint),
      firstSeenAt: toIso(cand.first_seen_at),
      mentions: Number(cand.mention_count),
      anchors: candidateAnchors.get(key) ?? [],
      sampleTitles: toStrings(cand.sample_titles).slice(0, MAX_SAMPLE_TITLES),
    });
  }
  for (const ent of input.entityRows) {
    const key = String(ent.id);
    if (roleById.get(key) !== "satellite") continue;
    items.push({
      key,
      kind: "entity",
      name: String(ent.canonical_name),
      type: String(ent.type),
      firstSeenAt: toIso(ent.first_seen_at),
      mentions: Number(ent.emg_mentions),
      anchors: entityAnchors.get(key) ?? [],
      sampleTitles: toStrings(ent.emg_titles).slice(0, MAX_SAMPLE_TITLES),
    });
  }
  return { items: sortAndCap(items), days, generatedAt: now.toISOString() };
}

// sample_titles are the raw titles of the articles that produced the sighting
// (entity-ingest rollupCandidate), so an exact title match finds those articles.
async function loadCandidates(sql: Sql, since: string): Promise<SqlRow[]> {
  return sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, mention_count, sample_titles
    FROM entity_candidates c
    WHERE first_seen_at >= ${since}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM entities d
        WHERE d.status = 'dismissed' AND lower(d.canonical_name) = lower(c.display_name))
    ORDER BY first_seen_at DESC
    LIMIT ${MAX_ROWS_PER_KIND}`;
}

async function loadCandidateLinks(sql: Sql, titles: string[], since: string): Promise<SqlRow[]> {
  if (titles.length === 0) return [];
  return sql`
    SELECT a.title AS emg_link_title, a.id AS emg_link_article,
           t.id, t.canonical_name, t.type, t.aliases, t.fame
    FROM articles a
    JOIN article_entities ae ON ae.article_id = a.id
    JOIN entities t ON t.id = ae.entity_id AND t.status = 'tracked'
    WHERE a.title = ANY(${titles}::text[])
      AND COALESCE(a.published_at, a.first_seen_at) >= ${since}::timestamptz`;
}

async function loadEntities(sql: Sql, since: string): Promise<SqlRow[]> {
  return sql`
    SELECT e.id, e.canonical_name, e.type, e.aliases, e.fame, e.first_seen_at,
      (SELECT COUNT(*) FROM article_entities m WHERE m.entity_id = e.id) AS emg_mentions,
      ARRAY(
        SELECT s.title FROM article_entities sae JOIN articles s ON s.id = sae.article_id
        WHERE sae.entity_id = e.id ORDER BY s.first_seen_at DESC LIMIT ${MAX_SAMPLE_TITLES}
      ) AS emg_titles
    FROM entities e
    WHERE e.first_seen_at >= ${since}::timestamptz AND e.status <> 'dismissed'
    ORDER BY e.first_seen_at DESC
    LIMIT ${MAX_ROWS_PER_KIND}`;
}

async function loadEntityLinks(sql: Sql, ids: string[]): Promise<SqlRow[]> {
  if (ids.length === 0) return [];
  return sql`
    SELECT ne.entity_id AS emg_ent_id, ne.article_id AS emg_link_article,
           t.id, t.canonical_name, t.type, t.aliases, t.fame
    FROM article_entities ne
    JOIN article_entities te ON te.article_id = ne.article_id AND te.entity_id <> ne.entity_id
    JOIN entities t ON t.id = te.entity_id AND t.status = 'tracked'
    WHERE ne.entity_id = ANY(${ids}::bigint[])`;
}

function uniqueById(rows: SqlRow[]): SqlRow[] {
  return [...new Map(rows.map((row) => [String(row.id), row])).values()];
}

export async function loadEmerging(sql: Sql, days: number, now: Date): Promise<EmergingResponse> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const candidateRows = await loadCandidates(sql, since);
  const titles = [...new Set(candidateRows.flatMap((row) => toStrings(row.sample_titles)))];
  const candidateLinkRows = await loadCandidateLinks(sql, titles, since);
  const entityRows = await loadEntities(sql, since);
  const entityLinkRows = await loadEntityLinks(sql, entityRows.map((row) => String(row.id)));
  const roleById = await loadRoleMap(sql, uniqueById([...entityRows, ...candidateLinkRows, ...entityLinkRows]));
  return assembleEmerging({ candidateRows, candidateLinkRows, entityRows, entityLinkRows }, roleById, days, now);
}
