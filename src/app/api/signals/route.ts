import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { Sql } from "@/lib/server/db";
import { loadSignals, transitionSignal, SignalAction } from "@/lib/server/signal-store";
import { getSettings } from "@/lib/server/settings";
import { computeWarmupState } from "@/lib/server/detectors";

export const dynamic = "force-dynamic";

const VALID_STATES = new Set(["new", "seen", "dismissed", "promoted"]);
const DEFAULT_STATES = ["new", "seen", "promoted"];
const VALID_ACTIONS = new Set<SignalAction>(["seen", "dismissed", "promoted", "reopen"]);

function parseStates(param: string | null): string[] | null {
  if (!param) return DEFAULT_STATES;
  const states = param.split(",").map((s) => s.trim()).filter(Boolean);
  if (states.length === 0) return DEFAULT_STATES;
  if (!states.every((s) => VALID_STATES.has(s))) return null;
  return states;
}

// The platform's operating epoch (earliest article ARRIVAL ever recorded) —
// duplicated from detectors.ts's private getSystemEpoch rather than
// exported from there, keeping this route decoupled from detector
// internals. Same precedent as brief.ts and /api/ingest's compute-warmup
// stage, both of which duplicate this exact tiny query for the same reason.
async function getSystemEpoch(sql: Sql): Promise<Date | null> {
  const rows = await sql`SELECT MIN(first_seen_at) AS min_first_seen FROM articles`;
  const value = rows[0]?.min_first_seen;
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value as string);
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const states = parseStates(new URL(req.url).searchParams.get("state"));
  if (!states) return NextResponse.json({ error: "Invalid state parameter" }, { status: 400 });

  const sql = getSql();
  const [signals, settings, epoch] = await Promise.all([
    loadSignals(sql, states),
    getSettings(sql),
    getSystemEpoch(sql),
  ]);
  const warmup = computeWarmupState(epoch, settings.warmup_days, new Date());

  return NextResponse.json({ signals, warmup });
}

interface SignalActionBody {
  id: number;
  action: SignalAction;
}

function parseBody(body: unknown): SignalActionBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "number" || !Number.isInteger(b.id) || b.id <= 0) return null;
  if (typeof b.action !== "string" || !VALID_ACTIONS.has(b.action as SignalAction)) return null;
  return { id: b.id, action: b.action as SignalAction };
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

  const parsed = parseBody(body);
  if (!parsed) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const sql = getSql();
  const existing = await sql`SELECT id FROM signals WHERE id = ${parsed.id}`;
  if (existing.length === 0) return NextResponse.json({ error: "Signal not found" }, { status: 404 });

  const ok = await transitionSignal(sql, parsed.id, parsed.action);
  if (!ok) return NextResponse.json({ error: "Illegal state transition" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
