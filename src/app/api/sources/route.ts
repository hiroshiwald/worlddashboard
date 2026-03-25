import { NextResponse } from "next/server";
import sourcesData from "@/lib/sources-data.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    sources: sourcesData,
    fetchedAt: new Date().toISOString(),
    count: sourcesData.length,
  });
}
