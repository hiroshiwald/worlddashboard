import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { getSettings, setActivityPaused } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

function activityJson(paused: boolean, since: number) {
  return { paused, since: paused ? new Date(since).toISOString() : null };
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const settings = await getSettings(getSql());
  return NextResponse.json(activityJson(settings.activity_paused === 1, settings.activity_paused_since));
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
  const paused = (body as { paused?: unknown } | null)?.paused;
  if (typeof paused !== "boolean") {
    return NextResponse.json({ error: "Invalid request body: paused must be a boolean" }, { status: 400 });
  }

  const sql = getSql();
  await setActivityPaused(sql, paused, new Date());
  const settings = await getSettings(sql);
  return NextResponse.json(activityJson(settings.activity_paused === 1, settings.activity_paused_since));
}
