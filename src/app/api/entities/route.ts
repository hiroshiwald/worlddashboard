import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { SqlRow } from "@/lib/server/db";
import { normalizeName } from "@/lib/server/extract-v2";

export const dynamic = "force-dynamic";

const MAX_NAME_LEN = 200;

interface EntityRow {
  id: number;
  canonicalName: string;
  type: string;
  status: string;
  aliases: string[];
}

function parseEntityRow(row: SqlRow): EntityRow {
  return {
    id: Number(row.id),
    canonicalName: String(row.canonical_name),
    type: String(row.type),
    status: String(row.status),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
  };
}

/** Same normalization scheme used at ingest time (extract-v2's normalizeName),
 * so a name that resolved to an entity during ingest also resolves here. */
function findByNormalizedName(rows: EntityRow[], norm: string): EntityRow | null {
  for (const row of rows) {
    if (normalizeName(row.canonicalName) === norm) return row;
  }
  for (const row of rows) {
    if (row.aliases.some((alias) => normalizeName(alias) === norm)) return row;
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const name = new URL(req.url).searchParams.get("name");
  if (!name || name.trim().length === 0 || name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: "name query parameter is required" }, { status: 400 });
  }

  const sql = getSql();
  const rows = await sql`SELECT id, canonical_name, type, status, aliases FROM entities`;
  const match = findByNormalizedName(rows.map(parseEntityRow), normalizeName(name));
  if (!match) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  return NextResponse.json({
    id: match.id,
    canonicalName: match.canonicalName,
    type: match.type,
    status: match.status,
  });
}
