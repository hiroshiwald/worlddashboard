import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { ValidationError } from "@/lib/server/entity-admin";
import { loadEmerging, parseDays } from "@/lib/server/emerging";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  try {
    const days = parseDays(new URL(req.url).searchParams.get("days"));
    return NextResponse.json(await loadEmerging(getSql(), days, new Date()));
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
