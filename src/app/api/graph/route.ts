import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import { loadGraph } from "@/lib/server/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  return NextResponse.json(await loadGraph(getSql(), new Date()));
}
