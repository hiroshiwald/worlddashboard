import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

// The Neon HTTP driver runs one statement per call, so a migration file's
// statements must be split and sent individually (bundled into one
// transaction via sql.transaction()).
function splitStatements(sqlText) {
  const withoutComments = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

async function readMigrationFiles(dir) {
  const filenames = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const files = [];
  for (const filename of filenames) {
    const sqlText = await readFile(path.join(dir, filename), "utf8");
    files.push({ version: filename, statements: splitStatements(sqlText) });
  }
  return files;
}

async function ensureMigrationsTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`;
}

async function getAppliedVersions(sql) {
  const rows = await sql`SELECT version FROM schema_migrations`;
  return new Set(rows.map((row) => row.version));
}

async function applyMigration(sql, version, statements) {
  const queries = statements.map((stmt) => sql.query(stmt));
  queries.push(
    sql.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())", [version]),
  );
  await sql.transaction(queries);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("migrate: DATABASE_URL environment variable is not set");
    process.exit(1);
    return;
  }

  const sql = neon(connectionString);
  await ensureMigrationsTable(sql);
  const applied = await getAppliedVersions(sql);
  const migrations = await readMigrationFiles(MIGRATIONS_DIR);

  for (const { version, statements } of migrations) {
    if (applied.has(version)) {
      console.log(`migrate: ${version} already applied, skipping`);
      continue;
    }
    console.log(`migrate: applying ${version} (${statements.length} statements)`);
    await applyMigration(sql, version, statements);
    console.log(`migrate: applied ${version}`);
  }
}

main().catch((err) => {
  console.error("migrate: failed", err);
  process.exit(1);
});
