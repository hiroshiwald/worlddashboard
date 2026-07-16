import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { tryAcquireLock } from "../../tick";
import { makePgSql, freshSchema } from "../helpers/pg-sql";
import type { Sql } from "../../db";

const TEST_SCHEMA = "wd_test_tick";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const pool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` })
  : null;
const sql: Sql | null = pool ? makePgSql(pool) : null;

describe.skipIf(!TEST_DATABASE_URL)("tick lock integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("the first caller wins when no lock row exists yet", async () => {
    expect(await tryAcquireLock(sql!)).toBe(true);
  });

  it("a second caller loses immediately after the first wins", async () => {
    expect(await tryAcquireLock(sql!)).toBe(true);
    expect(await tryAcquireLock(sql!)).toBe(false);
  });

  it("two concurrent callers racing an absent lock: exactly one wins", async () => {
    const results = await Promise.all([tryAcquireLock(sql!), tryAcquireLock(sql!)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reclaims a lock older than the threshold", async () => {
    await sql!`INSERT INTO settings (key, value) VALUES ('tick_lock', to_jsonb(now() - interval '15 minutes'))`;
    expect(await tryAcquireLock(sql!)).toBe(true);
  });

  it("does not reclaim a lock still within the threshold", async () => {
    await sql!`INSERT INTO settings (key, value) VALUES ('tick_lock', to_jsonb(now() - interval '5 minutes'))`;
    expect(await tryAcquireLock(sql!)).toBe(false);
  });
});
