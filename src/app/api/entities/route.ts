import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/server/db";
import type { SqlRow } from "@/lib/server/db";
import { normalizeName } from "@/lib/server/extract-v2";
import { searchEntities, loadEntityStats, ValidationError } from "@/lib/server/entity-admin";

export const dynamic = "force-dynamic";

// Three-mode contract: ?view=stats returns entity-admin.ts's loadEntityStats
// shape directly (EM-2a: the Entities tab's stats strip) and is checked
// first since it takes no other params. Otherwise, ?name=<n> resolves a
// single entity by exact (normalized) canonical name or alias match —
// {id, canonicalName, type, status}, unchanged since before this file
// existed. Any OTHER request (name entirely absent from the query string)
// is list/search mode, backed by entity-admin.ts's searchEntities:
// ?q=&status=&fame=&limit=&offset= -> {entities: [...], total}. The three
// modes never overlap: ?view=stats always wins, and among the rest a
// request with ?name= (even blank) always takes the single-lookup path.

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

function parseNumberParam(raw: string | null): number | undefined {
  return raw === null ? undefined : Number(raw);
}

async function listEntities(params: URLSearchParams): Promise<NextResponse> {
  const sql = getSql();
  try {
    const result = await searchEntities(sql, {
      q: params.get("q") ?? undefined,
      status: params.get("status") ?? undefined,
      fame: params.get("fame") ?? undefined,
      limit: parseNumberParam(params.get("limit")),
      offset: parseNumberParam(params.get("offset")),
    });
    return NextResponse.json({ entities: result.entities, total: result.total });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const params = new URL(req.url).searchParams;
  if (params.get("view") === "stats") {
    return NextResponse.json(await loadEntityStats(getSql()));
  }

  const name = params.get("name");
  if (name === null) {
    return listEntities(params);
  }

  if (!name || name.trim().length === 0 || name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: "name query parameter is required" }, { status: 400 });
  }

  const sql = getSql();
  const rows = await sql`SELECT id, canonical_name, type, status, aliases FROM entities ORDER BY id ASC`;
  const match = findByNormalizedName(rows.map(parseEntityRow), normalizeName(name));
  if (!match) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  return NextResponse.json({
    id: match.id,
    canonicalName: match.canonicalName,
    type: match.type,
    status: match.status,
  });
}
