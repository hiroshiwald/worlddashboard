import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { getBackfillStatus } from "@/lib/server/backfill";

export const dynamic = "force-dynamic";

// One-off November catch-up progress; delete with src/lib/server/backfill.ts.
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  return NextResponse.json(await getBackfillStatus(getSql()));
}
