import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { getBrief } from "@/lib/server/brief";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const sql = getSql();
  const settings = await getSettings(sql);
  const brief = await getBrief(sql, settings);

  return NextResponse.json(brief, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}
