import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/lib/server/run-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Accepts either the direct ingest key or Vercel's Authorization: Bearer
// CRON_SECRET convention (Vercel cron requests can't set custom headers).
function isAuthorized(req: NextRequest): boolean {
  const ingestKey = req.headers.get("x-ingest-key");
  if (ingestKey && ingestKey === process.env.INGEST_SECRET) return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
}

function checkAccess(req: NextRequest): NextResponse | null {
  if (!process.env.INGEST_SECRET) {
    return NextResponse.json(
      { error: "INGEST_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function handleIngest(): Promise<NextResponse> {
  const result = await runIngest();
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return denied;
  return handleIngest();
}

// Vercel Cron Jobs always trigger via GET, so vercel.json's daily fallback
// cron needs a GET handler too, authorized via the CRON_SECRET bearer path.
export async function GET(req: NextRequest) {
  const denied = checkAccess(req);
  if (denied) return denied;
  return handleIngest();
}
