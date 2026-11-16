// TEMPORARY, read-only. Daily counts to choose the growth denominator
// (DEVLOG 2026-11-16). Delete this route once the numbers are recorded.
import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const sql = getSql();
  const byArrival = await sql`
    SELECT date_trunc('day', a.first_seen_at) AS day,
      COUNT(*) AS articles,
      COUNT(a.entities_processed_at) AS processed,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM article_entities ae WHERE ae.article_id = a.id)) AS with_entities
    FROM articles a
    WHERE a.first_seen_at >= now() - make_interval(days => 15)
    GROUP BY 1 ORDER BY 1`;
  const byPublish = await sql`
    SELECT date_trunc('day', bucket) AS day, SUM(mentions) AS mentions, COUNT(DISTINCT entity_id) AS entities
    FROM entity_mentions_hourly
    WHERE bucket >= now() - make_interval(days => 15)
    GROUP BY 1 ORDER BY 1`;
  const llmUsage = await sql`SELECT * FROM llm_usage ORDER BY month`;
  const settings = await sql`SELECT key, value FROM settings`;
  const migrations = await sql`SELECT * FROM schema_migrations ORDER BY 1`;
  const pendingBatches = await sql`SELECT batch_id, submitted_at, cardinality(article_ids) AS articles FROM llm_batches`;
  return NextResponse.json({ byArrival, byPublish, llmUsage, settings, migrations, pendingBatches });
}
