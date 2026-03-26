import { NextResponse } from "next/server";
import sourcesData from "@/lib/sources-data.json";
import { fetchAllFeeds } from "@/lib/feed-fetcher";
import { SourceMeta } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const sources: SourceMeta[] = sourcesData.map((s) => ({
    name: s.name,
    category: s.category,
    tier: s.tier,
    url: s.url,
    type: s.type,
    altUrl: (s as Record<string, unknown>).altUrl as string | undefined,
  }));

  const { items, feedsAttempted, feedsSucceeded, relayConfigured, feedDiagnostics } =
    await fetchAllFeeds(sources);

  return NextResponse.json({
    items,
    feedsAttempted,
    feedsSucceeded,
    relayConfigured,
    feedDiagnostics,
    fetchedAt: new Date().toISOString(),
    count: items.length,
  });
}
