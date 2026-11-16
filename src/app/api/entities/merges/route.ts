import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { loadMergeSuggestions } from "@/lib/server/merge-suggestions";

export const dynamic = "force-dynamic";

// Read-only, display-only duplicate suggestions. Changes no database rows.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number | null {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    return null;
  }
  return n;
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
  if (limit === null) {
    return NextResponse.json({ error: `limit must be an integer 1..${MAX_LIMIT}` }, { status: 400 });
  }
  const groups = await loadMergeSuggestions(getSql(), limit, new Date());
  return NextResponse.json({ groups });
}
