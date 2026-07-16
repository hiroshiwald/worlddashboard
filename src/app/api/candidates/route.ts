import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql, SqlRow } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["accept", "merge", "dismiss"]);
const TYPES = new Set([
  "person", "company", "organization", "government_body", "armed_group",
  "political_party", "country", "region", "city", "product", "technology",
  "financial_asset", "disease", "infrastructure", "other",
]);
const MAX_STRING_LEN = 200;

// ---- GET: promotable candidates (>=3 distinct sources, >=2 distinct days, seen within 14d) ----

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

function toCandidateJson(row: SqlRow) {
  const sourceNames = Array.isArray(row.source_names) ? (row.source_names as string[]) : [];
  const sampleTitles = Array.isArray(row.sample_titles) ? (row.sample_titles as string[]) : [];
  const contexts = Array.isArray(row.contexts) ? (row.contexts as string[]) : [];
  const coEntities = Array.isArray(row.co_entities) ? (row.co_entities as string[]) : [];
  return {
    nameNorm: String(row.name_norm),
    displayName: String(row.display_name),
    typeHint: String(row.type_hint),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    mentionCount: Number(row.mention_count),
    sourceNames,
    sourceCount: sourceNames.length,
    dayCount: Number(row.day_count),
    sampleTitles,
    contexts,
    coEntities,
  };
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const sql = getSql();
  const rows = await sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at,
           mention_count, source_names, day_count, sample_titles, contexts, co_entities
    FROM entity_candidates
    WHERE array_length(source_names, 1) >= 3
      AND day_count >= 2
      AND last_seen_at >= now() - INTERVAL '14 days'
    ORDER BY array_length(source_names, 1) DESC
  `;

  return NextResponse.json({ candidates: rows.map(toCandidateJson) });
}

// ---- POST: accept / merge / dismiss ----

interface CandidateAction {
  nameNorm: string;
  action: "accept" | "merge" | "dismiss";
  type?: string;
  mergeInto?: string;
}

function isBoundedNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_STRING_LEN;
}

function parseAction(body: unknown): CandidateAction | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isBoundedNonEmpty(b.nameNorm)) return null;
  if (typeof b.action !== "string" || !ACTIONS.has(b.action)) return null;
  if (b.type !== undefined && (typeof b.type !== "string" || !TYPES.has(b.type))) return null;
  if (b.mergeInto !== undefined && !isBoundedNonEmpty(b.mergeInto)) return null;

  return {
    nameNorm: b.nameNorm,
    action: b.action as CandidateAction["action"],
    type: b.type as string | undefined,
    mergeInto: b.mergeInto as string | undefined,
  };
}

interface CandidateSnapshot {
  nameNorm: string;
  displayName: string;
  typeHint: string;
  firstSeenAt: unknown;
  lastSeenAt: unknown;
}

async function loadCandidate(sql: Sql, nameNorm: string): Promise<CandidateSnapshot | null> {
  const rows = await sql`
    SELECT name_norm, display_name, type_hint, first_seen_at, last_seen_at
    FROM entity_candidates
    WHERE name_norm = ${nameNorm}
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    nameNorm: String(row.name_norm),
    displayName: String(row.display_name),
    typeHint: String(row.type_hint),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function deleteCandidate(sql: Sql, nameNorm: string): Promise<void> {
  await sql`DELETE FROM entity_candidates WHERE name_norm = ${nameNorm}`;
}

// ON CONFLICT (canonical_name) can only no-op for one reason: an entity with
// that name already exists. So on zero returned rows we check for it
// explicitly and, if found, treat the name as resolved and clean up the
// candidate anyway — otherwise a candidate an hourly ingest re-inserted
// between the reviewer's page load and their click would 409 forever and
// sit stranded for the full 14-day retention window. Read-then-delete below
// isn't transactional; a single-writer app accepts that as a rare, bounded
// undercount rather than added complexity, never data corruption.
async function resolveConflictedCandidate(sql: Sql, candidate: CandidateSnapshot): Promise<boolean> {
  const existing = await sql`SELECT id FROM entities WHERE canonical_name = ${candidate.displayName}`;
  if (existing.length === 0) return false;
  await deleteCandidate(sql, candidate.nameNorm);
  return true;
}

async function acceptCandidate(sql: Sql, candidate: CandidateSnapshot, type: string): Promise<boolean> {
  const result = await sql`
    INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
    VALUES (${candidate.displayName}, ${type}, 'tracked', ${candidate.firstSeenAt}, ${candidate.lastSeenAt})
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id
  `;
  if (result.length > 0) {
    await deleteCandidate(sql, candidate.nameNorm);
    return true;
  }
  return resolveConflictedCandidate(sql, candidate);
}

async function dismissCandidate(sql: Sql, candidate: CandidateSnapshot): Promise<boolean> {
  const result = await sql`
    INSERT INTO entities (canonical_name, type, status, first_seen_at, last_seen_at)
    VALUES (${candidate.displayName}, ${candidate.typeHint}, 'dismissed', ${candidate.firstSeenAt}, ${candidate.lastSeenAt})
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id
  `;
  if (result.length > 0) {
    await deleteCandidate(sql, candidate.nameNorm);
    return true;
  }
  return resolveConflictedCandidate(sql, candidate);
}

/** Returns false if mergeInto doesn't name an existing entity (caller 404s). */
async function mergeCandidate(sql: Sql, candidate: CandidateSnapshot, mergeInto: string): Promise<boolean> {
  const result = await sql`
    UPDATE entities
    SET aliases = array_cat(aliases, ARRAY[${candidate.nameNorm}, ${candidate.displayName}]::text[])
    WHERE canonical_name = ${mergeInto}
    RETURNING id
  `;
  if (result.length === 0) return false;
  await deleteCandidate(sql, candidate.nameNorm);
  return true;
}

function validateActionFields(action: CandidateAction): string | null {
  if (action.action === "accept" && !action.type) return "type is required for accept";
  if (action.action === "merge" && !action.mergeInto) return "mergeInto is required for merge";
  return null;
}

const CONFLICT_MESSAGE = "Could not resolve a naming conflict for this candidate — please retry";

async function dispatchAction(sql: Sql, candidate: CandidateSnapshot, action: CandidateAction): Promise<NextResponse> {
  if (action.action === "accept") {
    const accepted = await acceptCandidate(sql, candidate, action.type!);
    if (!accepted) return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (action.action === "merge") {
    const merged = await mergeCandidate(sql, candidate, action.mergeInto!);
    if (!merged) {
      return NextResponse.json({ error: `No entity found with canonical_name "${action.mergeInto}"` }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }
  const dismissed = await dismissCandidate(sql, candidate);
  if (!dismissed) return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = parseAction(body);
  if (!action) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const fieldError = validateActionFields(action);
  if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });

  const sql = getSql();
  const candidate = await loadCandidate(sql, action.nameNorm);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  return dispatchAction(sql, candidate, action);
}
