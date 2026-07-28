import { NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const IDS = [477, 175, 523, 335];

function describeFame(row: Record<string, unknown>) {
  return { ...row, fame_type: typeof row.fame, fame_json: JSON.stringify(row.fame) };
}

function dbHostFirstSegment(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0];
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const sql = getSql();

    const directRows = await sql`
      SELECT id, canonical_name, fame, fame_checked_at FROM entities
      WHERE id IN (477, 175, 523, 335)
    `;

    const panelRows = await sql`
      SELECT e.id, e.canonical_name, e.type, e.aliases, e.fame,
        COALESCE(SUM(emh.mentions) FILTER (WHERE emh.bucket < now() - INTERVAL '24 hours'), 0) AS baseline_mentions,
        COALESCE(SUM(emh.mentions), 0) AS total_mentions_15d
      FROM entities e
      LEFT JOIN entity_mentions_hourly emh
        ON emh.entity_id = e.id AND emh.bucket >= now() - INTERVAL '15 days'
      WHERE e.status = 'tracked'
        AND e.id IN (477, 175, 523, 335)
      GROUP BY e.id
    `;

    const famousCountRows = await sql`SELECT COUNT(*) AS count FROM entities WHERE fame = 'famous'`;

    return NextResponse.json({
      direct: directRows.map(describeFame),
      panel: panelRows.map(describeFame),
      meta: {
        dbHostFirstSegment: dbHostFirstSegment(),
        famousCount: Number(famousCountRows[0]?.count ?? 0),
      },
      ids: IDS,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
