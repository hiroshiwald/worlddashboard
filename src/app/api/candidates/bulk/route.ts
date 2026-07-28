import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql } from "@/lib/server/db";
import {
  loadCandidate,
  acceptCandidate,
  dismissCandidate,
  inlineFameCheck,
  isBoundedNonEmpty,
  TYPES,
  CONFLICT_MESSAGE,
} from "@/lib/server/candidate-actions";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 100;
const BULK_ACTIONS = new Set(["accept", "dismiss"]);
type BulkAction = "accept" | "dismiss";

interface BulkItem {
  nameNorm: string;
  type?: string;
}

interface BulkItemResult {
  nameNorm: string;
  ok: boolean;
  error?: string;
}

function parseItems(raw: unknown): BulkItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: BulkItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.nameNorm !== "string") return null;
    if (e.type !== undefined && typeof e.type !== "string") return null;
    items.push({ nameNorm: e.nameNorm, type: e.type });
  }
  return items;
}

/** One item's accept/dismiss, isolated from its siblings: a validation
 * failure, a not-found candidate, or a naming conflict all resolve to
 * {ok: false, error} rather than throwing, so one bad row in a batch never
 * takes down the rest (partial failure must stay visible, never silent). */
async function processItem(sql: Sql, action: BulkAction, item: BulkItem): Promise<BulkItemResult> {
  if (!isBoundedNonEmpty(item.nameNorm)) {
    return { nameNorm: item.nameNorm, ok: false, error: "Invalid nameNorm" };
  }
  if (action === "accept" && (item.type === undefined || !TYPES.has(item.type))) {
    return { nameNorm: item.nameNorm, ok: false, error: "type is required for accept" };
  }

  const candidate = await loadCandidate(sql, item.nameNorm);
  if (!candidate) return { nameNorm: item.nameNorm, ok: false, error: "Candidate not found" };

  if (action === "accept") {
    const accepted = await acceptCandidate(sql, candidate, item.type!);
    if (accepted === null) return { nameNorm: item.nameNorm, ok: false, error: CONFLICT_MESSAGE };
    await inlineFameCheck(sql, accepted, candidate.displayName);
    return { nameNorm: item.nameNorm, ok: true };
  }

  const dismissed = await dismissCandidate(sql, candidate);
  if (!dismissed) return { nameNorm: item.nameNorm, ok: false, error: CONFLICT_MESSAGE };
  return { nameNorm: item.nameNorm, ok: true };
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.action !== "string" || !BULK_ACTIONS.has(b.action)) {
    return NextResponse.json({ error: "action must be 'accept' or 'dismiss'" }, { status: 400 });
  }

  const items = parseItems(b.items);
  if (items === null) {
    return NextResponse.json({ error: "items must be an array of {nameNorm, type?}" }, { status: 400 });
  }
  if (items.length === 0 || items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `items must contain between 1 and ${MAX_ITEMS} entries` }, { status: 400 });
  }

  const sql = getSql();
  const action = b.action as BulkAction;
  const results: BulkItemResult[] = [];
  for (const item of items) {
    results.push(await processItem(sql, action, item));
  }

  return NextResponse.json({ results });
}
