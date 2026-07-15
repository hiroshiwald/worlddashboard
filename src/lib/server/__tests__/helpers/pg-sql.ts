import type { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql, SqlRow } from "../../db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "migrations");

/** Adapts a node-postgres Pool to the tagged-template Sql contract: builds
 * $1..$n positional text from the template's string parts and hands the
 * interpolated values straight to pool.query — node-postgres already
 * serializes JS arrays/strings correctly for the ::text[]/::jsonb casts the
 * production queries use. */
export function makePgSql(pool: Pool): Sql {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.slice(1).reduce((acc, part, i) => `${acc}$${i + 1}${part}`, strings[0]);
    const result = await pool.query(text, values);
    return result.rows as SqlRow[];
  };
}

function splitStatements(sqlText: string): string[] {
  const withoutComments = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

/** Applies migrations/*.sql, in filename order, against a real Postgres —
 * exercising the actual migration files rather than a hand-copied schema. */
export async function applyMigrations(pool: Pool): Promise<void> {
  const filenames = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const sqlText = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
    for (const statement of splitStatements(sqlText)) {
      await pool.query(statement);
    }
  }
}

/** Drops and recreates the given schema, then reapplies every migration —
 * each test suite starts from a clean, real application of the actual
 * migration files. Callers must give each test FILE its own schema name
 * (via Pool's `options: "-c search_path=<name>"`) — vitest runs test files
 * concurrently against the one shared TEST_DATABASE_URL, so two files
 * sharing a schema would race each other's DROP/CREATE mid-test. */
export async function freshSchema(pool: Pool, schema: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error(`freshSchema: invalid schema name "${schema}"`);
  }
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await applyMigrations(pool);
}
