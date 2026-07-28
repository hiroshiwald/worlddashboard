import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql, SqlRow } from "@/lib/server/db";
import {
  TYPES,
  isBoundedNonEmpty,
  type CandidateSnapshot,
  loadCandidate,
  deleteCandidate,
  acceptCandidate,
  dismissCandidate,
  inlineFameCheck,
  CONFLICT_MESSAGE,
} from "@/lib/server/candidate-actions";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["accept", "merge", "dismiss"]);

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

async function dispatchAction(sql: Sql, candidate: CandidateSnapshot, action: CandidateAction): Promise<NextResponse> {
  if (action.action === "accept") {
    const accepted = await acceptCandidate(sql, candidate, action.type!);
    if (accepted === null) return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 409 });
    await inlineFameCheck(sql, accepted, candidate.displayName);
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
