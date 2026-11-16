import { neon } from "@neondatabase/serverless";

export type SqlRow = Record<string, unknown>;

/** Minimal contract for a Postgres tagged-template client. Narrower than
 * NeonQueryFunction so ingest/query code can be unit-tested with a plain
 * mock function instead of the real Neon client. */
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<SqlRow[]>;

/** Creates a fresh Neon HTTP client from DATABASE_URL. No module-level
 * instance is kept — callers own the client they get back and pass it
 * down as an argument.
 *
 * Every query is a fetch() POST. Next.js 14's Data Cache replays a stored
 * response when the SQL text and parameters repeat, even under
 * `dynamic = "force-dynamic"`, so repeated identical queries froze on old
 * data. `cache: "no-store"` turns that off for every query. */
export function getSql(): Sql {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("getSql: DATABASE_URL environment variable is not set");
  }
  return neon(connectionString, { fetchOptions: { cache: "no-store" } });
}
