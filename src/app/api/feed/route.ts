import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { FeedParamError, loadFeed, parseFeedParams } from "@/lib/server/feed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  try {
    const params = parseFeedParams(new URL(req.url).searchParams);
    return NextResponse.json(await loadFeed(getSql(), params));
  } catch (err) {
    if (err instanceof FeedParamError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
