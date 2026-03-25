import { NextResponse } from "next/server";
import path from "path";
import { parseCsvFile } from "@/lib/csv-parser";

export const dynamic = "force-dynamic";

export async function GET() {
  const csvPath = path.join(process.cwd(), "Dashboard Sources.csv");
  const sources = parseCsvFile(csvPath);

  return NextResponse.json({
    sources,
    fetchedAt: new Date().toISOString(),
    count: sources.length,
  });
}
