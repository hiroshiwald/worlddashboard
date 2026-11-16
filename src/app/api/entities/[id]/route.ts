import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql, SqlRow } from "@/lib/server/db";
import { toEntityAdminJson, loadMentionsInWindow, loadSourcesInWindow, attachEntityRoles } from "@/lib/server/entity-admin";

export const dynamic = "force-dynamic";

const RECENT_ARTICLES_LIMIT = 20;
const TOP_EDGES_LIMIT = 10;
const SERIES_WINDOW_DAYS = 7;
const ACTIVITY_WINDOW_DAYS = 30;

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

/** Full dossier shape: every entities column (fame verdict + its Wikipedia
 * evidence, aliases, timestamps) — DESIGN.md spine #2, nothing about the
 * fame classification stays hidden in the detail view. */
function toEntityDetailJson(row: SqlRow) {
  return {
    ...toEntityAdminJson(row),
    lastSeenAt: row.last_seen_at != null ? toIsoString(row.last_seen_at) : null,
  };
}

/** mentions30d/sources30d — same aggregate shapes list mode uses for its 7d
 * activity column, windowed to 30 days and scoped to this one entity. */
async function loadActivitySummary(sql: Sql, id: number) {
  const [mentionsById, sourcesById] = await Promise.all([
    loadMentionsInWindow(sql, [id], ACTIVITY_WINDOW_DAYS),
    loadSourcesInWindow(sql, [id], ACTIVITY_WINDOW_DAYS),
  ]);
  return { mentions30d: mentionsById.get(id) ?? 0, sources30d: sourcesById.get(id) ?? 0 };
}

async function loadHourlySeries(sql: Sql, id: number) {
  const rows = await sql`
    SELECT bucket, mentions, source_count, sentiment_sum
    FROM entity_mentions_hourly
    WHERE entity_id = ${id}
      AND bucket >= now() - make_interval(days => ${SERIES_WINDOW_DAYS}::int)
    ORDER BY bucket ASC
  `;
  return rows.map((row) => ({
    bucket: toIsoString(row.bucket),
    mentions: Number(row.mentions),
    sourceCount: Number(row.source_count),
    sentimentSum: Number(row.sentiment_sum),
  }));
}

async function loadRecentArticles(sql: Sql, id: number) {
  const rows = await sql`
    SELECT a.id, a.title, a.link, a.source_name, a.published_at, a.first_seen_at
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ${id} AND a.dup_group_id IS NULL
    ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC
    LIMIT ${RECENT_ARTICLES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    link: String(row.link),
    sourceName: String(row.source_name),
    published: toIsoString(row.published_at ?? row.first_seen_at),
  }));
}

/** evidence is null when evidence_article_id is null OR the referenced
 * article no longer resolves to a retained cluster head (aged out of
 * retention, or demoted to a duplicate member) — absence is shown, not
 * faked (DESIGN.md spine #2/#5). The row's own article_count/lastSeenAt are
 * unaffected either way. */
function toRelationJson(row: SqlRow) {
  return {
    relation: String(row.relation),
    id: Number(row.other_id),
    name: String(row.other_name),
    articleCount: Number(row.article_count),
    lastSeenAt: toIsoString(row.last_seen_at),
    evidence:
      row.evidence_title != null && row.evidence_link != null
        ? { title: String(row.evidence_title), link: String(row.evidence_link) }
        : null,
  };
}

async function loadOutgoingRelations(sql: Sql, id: number) {
  const rows = await sql`
    SELECT er.relation, er.target_id AS other_id, e.canonical_name AS other_name,
           er.article_count, er.last_seen_at, ev.title AS evidence_title, ev.link AS evidence_link
    FROM entity_relations er
    JOIN entities e ON e.id = er.target_id
    LEFT JOIN articles ev ON ev.id = er.evidence_article_id AND ev.dup_group_id IS NULL
    WHERE er.source_id = ${id}
    ORDER BY er.article_count DESC
  `;
  return rows.map(toRelationJson);
}

async function loadIncomingRelations(sql: Sql, id: number) {
  const rows = await sql`
    SELECT er.relation, er.source_id AS other_id, e.canonical_name AS other_name,
           er.article_count, er.last_seen_at, ev.title AS evidence_title, ev.link AS evidence_link
    FROM entity_relations er
    JOIN entities e ON e.id = er.source_id
    LEFT JOIN articles ev ON ev.id = er.evidence_article_id AND ev.dup_group_id IS NULL
    WHERE er.target_id = ${id}
    ORDER BY er.article_count DESC
  `;
  return rows.map(toRelationJson);
}

async function loadTopEdges(sql: Sql, id: number) {
  const rows = await sql`
    SELECT
      CASE WHEN ee.entity_a = ${id} THEN ee.entity_b ELSE ee.entity_a END AS other_id,
      e.canonical_name AS other_name,
      ee.article_count,
      ee.first_seen_at
    FROM entity_edges ee
    JOIN entities e ON e.id = CASE WHEN ee.entity_a = ${id} THEN ee.entity_b ELSE ee.entity_a END
    WHERE ee.entity_a = ${id} OR ee.entity_b = ${id}
    ORDER BY ee.article_count DESC
    LIMIT ${TOP_EDGES_LIMIT}
  `;
  return rows.map((row) => ({
    id: Number(row.other_id),
    name: String(row.other_name),
    articleCount: Number(row.article_count),
    firstSeenAt: toIsoString(row.first_seen_at),
  }));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid entity id" }, { status: 400 });
  }

  const sql = getSql();
  const entityRows = await sql`
    SELECT id, canonical_name, type, status, aliases, fame, fame_locked,
           wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at,
           first_seen_at, last_seen_at
    FROM entities WHERE id = ${id}
  `;
  if (entityRows.length === 0) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const [series, articles, edges, outgoing, incoming, activity, [entityWithRole]] = await Promise.all([
    loadHourlySeries(sql, id),
    loadRecentArticles(sql, id),
    loadTopEdges(sql, id),
    loadOutgoingRelations(sql, id),
    loadIncomingRelations(sql, id),
    loadActivitySummary(sql, id),
    // role/roleReasons: bounded to this one entity, never the tracked
    // roster — see entity-admin.ts's attachEntityRoles.
    attachEntityRoles(sql, [toEntityDetailJson(entityRows[0])]),
  ]);

  return NextResponse.json({
    entity: entityWithRole,
    activity,
    series,
    articles,
    edges,
    relations: { incoming, outgoing },
  });
}

// ---- PATCH: partial update of {type, status, fame, fameLocked} ----

const VALID_TYPES = new Set([
  "person", "company", "organization", "government_body", "armed_group",
  "political_party", "country", "region", "city", "product", "technology",
  "financial_asset", "disease", "infrastructure", "other",
]);
const VALID_STATUSES = new Set(["tracked", "dismissed"]);
const VALID_FAME = new Set(["unknown", "not_famous", "famous"]);

interface EntityPatch {
  type?: string;
  status?: string;
  fame?: string;
  fameLocked?: boolean;
}

function parseEntityPatch(body: unknown): EntityPatch | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: EntityPatch = {};

  if ("type" in b) {
    if (typeof b.type !== "string" || !VALID_TYPES.has(b.type)) return null;
    patch.type = b.type;
  }
  if ("status" in b) {
    if (typeof b.status !== "string" || !VALID_STATUSES.has(b.status)) return null;
    patch.status = b.status;
  }
  if ("fame" in b) {
    if (typeof b.fame !== "string" || !VALID_FAME.has(b.fame)) return null;
    patch.fame = b.fame;
  }
  if ("fameLocked" in b) {
    if (typeof b.fameLocked !== "boolean") return null;
    patch.fameLocked = b.fameLocked;
  }
  return patch;
}

/** An explicit fameLocked always wins. Otherwise setting fame implies
 * fame_locked=true (a human verdict is final until a human changes it —
 * migrations/007's whole reason to exist); with neither field present, the
 * column is left untouched. */
function resolveFameLocked(patch: EntityPatch): boolean | null {
  if (patch.fameLocked !== undefined) return patch.fameLocked;
  if (patch.fame !== undefined) return true;
  return null;
}

/** Partial update via COALESCE: each column is set to its new value or, for
 * a field absent from the patch, left unchanged — a single query rather
 * than building a dynamic SET clause. */
async function applyEntityPatch(sql: Sql, id: number, patch: EntityPatch): Promise<SqlRow | null> {
  const rows = await sql`
    UPDATE entities SET
      type = COALESCE(${patch.type ?? null}, type),
      status = COALESCE(${patch.status ?? null}, status),
      fame = COALESCE(${patch.fame ?? null}, fame),
      fame_locked = COALESCE(${resolveFameLocked(patch)}, fame_locked)
    WHERE id = ${id}
    RETURNING id, canonical_name, type, status, aliases, fame, fame_locked,
              wiki_title, wiki_sitelinks, wiki_pageviews_monthly, fame_checked_at, first_seen_at
  `;
  return rows[0] ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid entity id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch = parseEntityPatch(body);
  if (patch === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const sql = getSql();
  const updated = await applyEntityPatch(sql, id, patch);
  if (updated === null) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  return NextResponse.json(toEntityAdminJson(updated));
}
