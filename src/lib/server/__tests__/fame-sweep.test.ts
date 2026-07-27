import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runFameSweep, mergeAliases } from "../fame-sweep";
import { computeWindowMonths } from "../wikidata";
import { makePgSql, freshSchema } from "./helpers/pg-sql";
import type { Sql, SqlRow } from "../db";

// A "POISON" canonical name makes lookupWikidataFame reject outright (a
// THROWN failure, as opposed to its normal never-throws {ok:false} return)
// — every other name delegates to the real implementation, so this doesn't
// change any other test's behavior. Same POISON-sentinel technique as
// entity-ingest.test.ts's extract-v2 mock.
vi.mock("../wikidata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../wikidata")>();
  return {
    ...actual,
    lookupWikidataFame: (name: string, now?: Date) => {
      if (name.includes("POISON")) return Promise.reject(new Error("simulated lookup crash"));
      return actual.lookupWikidataFame(name, now);
    },
  };
});

const NOW = new Date("2026-07-24T00:00:00Z");

interface RecordedCall {
  query: string;
  values: unknown[];
}

function makeMockSql(handler: (call: RecordedCall) => SqlRow[]) {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { query: strings.join(" ? "), values };
    calls.push(call);
    return handler(call);
  }) as Sql;
  return { sql, calls };
}

function entityRow(id: number, canonicalName: string, aliases: string[] = []) {
  return { id, canonical_name: canonicalName, aliases };
}

beforeEach(() => {
  // Same per-test fetch guard as llm-extract.test.ts/wikidata.test.ts — this
  // sandbox has no internet egress, so an un-mocked call is a bug twice over.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch must be mocked per test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

function searchHit(id: string) {
  return { search: [{ id }] };
}
function entitiesBody(id: string, sitelinks: Record<string, { site: string; title: string }>, aliases: Record<string, { language: string; value: string }[]> = {}) {
  return { entities: { [id]: { id, sitelinks, labels: {}, aliases } } };
}
// Sustained views across every window month (not just one) — a single huge
// month would correctly median down to ~0 by the spike-immunity rule this
// PR exists to enforce, so a genuinely "famous" fixture needs the whole
// 12-month window populated, matching NOW's own computeWindowMonths.
function sustainedPageviewsBody(views: number) {
  return { items: computeWindowMonths(NOW).map((yyyymm) => ({ timestamp: `${yyyymm}0100`, views })) };
}
function onePageviewsBody(yyyymm: string, views: number) {
  return { items: [{ timestamp: `${yyyymm}0100`, views }] };
}

// A full famous-verdict fetch sequence: search -> entities (enwiki, high
// sitelinks) -> pageviews (huge, sustained across the whole window).
function mockFamousLookup() {
  vi.stubGlobal(
    "fetch",
    vi.fn()
      .mockResolvedValueOnce(okResponse(searchHit("Q1")))
      .mockResolvedValueOnce(okResponse(entitiesBody("Q1", { enwiki: { site: "enwiki", title: "Famous Person" } })))
      .mockResolvedValueOnce(okResponse(sustainedPageviewsBody(1_000_000))),
  );
}

// A full not-famous-verdict fetch sequence: matched, but low everything.
function mockNotFamousLookup() {
  vi.stubGlobal(
    "fetch",
    vi.fn()
      .mockResolvedValueOnce(okResponse(searchHit("Q2")))
      .mockResolvedValueOnce(okResponse(entitiesBody("Q2", { enwiki: { site: "enwiki", title: "Minor Person" } })))
      .mockResolvedValueOnce(okResponse(onePageviewsBody(computeWindowMonths(NOW)[11], 10))),
  );
}

describe("selectSweepBatch (via runFameSweep's SELECT query shape)", () => {
  it("scopes to tracked status, the unknown/not_famous recheck windows, and orders never-checked first then newest first_seen_at, capped at 40", async () => {
    const { sql, calls } = makeMockSql((call) => (call.query.includes("FROM entities") ? [] : []));
    await runFameSweep(sql);

    const selectCall = calls.find((c) => c.query.includes("SELECT id, canonical_name, aliases"));
    expect(selectCall).toBeDefined();
    const q = selectCall!.query;
    expect(q).toContain("status = 'tracked'");
    expect(q).toContain("fame = 'unknown'");
    expect(q).toContain("fame_checked_at IS NULL");
    expect(q).toContain("make_interval(hours =>");
    expect(q).toContain("fame = 'not_famous'");
    expect(q).toContain("30 days");
    expect(q).not.toContain("'famous'"); // famous is permanent, never re-swept
    expect(q).toContain("ORDER BY (fame_checked_at IS NULL) DESC, first_seen_at DESC");
    expect(q).toContain("LIMIT");
    expect(selectCall!.values).toEqual([6, 40]); // UNKNOWN_RETRY_HOURS, BATCH_LIMIT
  });
});

// Real-Postgres boundary tests: the mock above can only prove the SQL text
// looks right, not that now() - make_interval(...) actually filters
// correctly at the hour/day boundary — that requires executing the real
// query against seeded timestamps.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_SCHEMA = "wd_test_fame_sweep";
const pgPool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` })
  : null;
const pgSql: Sql | null = pgPool ? makePgSql(pgPool) : null;

/** Seeds one tracked entity with fame_checked_at hoursAgo hours before
 * Postgres's own now() (null means never checked, i.e. NULL) — computed in
 * SQL so it lines up exactly with what selectSweepBatch's WHERE clause
 * evaluates against. */
async function seedFameEntity(name: string, fame: string, hoursAgo: number | null): Promise<number> {
  const rows =
    hoursAgo === null
      ? await pgSql!`
          INSERT INTO entities (canonical_name, type, status, fame, fame_checked_at, first_seen_at, last_seen_at)
          VALUES (${name}, 'country', 'tracked', ${fame}, NULL, now(), now())
          RETURNING id
        `
      : await pgSql!`
          INSERT INTO entities (canonical_name, type, status, fame, fame_checked_at, first_seen_at, last_seen_at)
          VALUES (${name}, 'country', 'tracked', ${fame}, now() - make_interval(hours => ${hoursAgo}::int), now(), now())
          RETURNING id
        `;
  const [{ id }] = rows as [{ id: number }];
  return Number(id);
}

async function loadFameCheckedAt(id: number): Promise<Date | null> {
  const rows = await pgSql!`SELECT fame_checked_at FROM entities WHERE id = ${id}`;
  return (rows[0]?.fame_checked_at as Date | null) ?? null;
}

describe.skipIf(!TEST_DATABASE_URL)("selectSweepBatch retry-window boundaries (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pgPool!, TEST_SCHEMA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));
  });

  afterAll(async () => {
    await pgPool?.end();
  });

  it("does not re-check an unknown entity checked 5h ago", async () => {
    const id = await seedFameEntity("Unknown5h", "unknown", 5);
    const before = await loadFameCheckedAt(id);
    await runFameSweep(pgSql!);
    expect(await loadFameCheckedAt(id)).toEqual(before);
  });

  it("re-checks an unknown entity checked 7h ago", async () => {
    const id = await seedFameEntity("Unknown7h", "unknown", 7);
    await runFameSweep(pgSql!);
    expect((await loadFameCheckedAt(id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("re-checks a never-checked unknown entity", async () => {
    const id = await seedFameEntity("NeverChecked", "unknown", null);
    await runFameSweep(pgSql!);
    expect((await loadFameCheckedAt(id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("does not re-check a not_famous entity checked 29 days ago", async () => {
    const id = await seedFameEntity("NotFamous29d", "not_famous", 29 * 24);
    const before = await loadFameCheckedAt(id);
    await runFameSweep(pgSql!);
    expect(await loadFameCheckedAt(id)).toEqual(before);
  });

  it("re-checks a not_famous entity checked 31 days ago", async () => {
    const id = await seedFameEntity("NotFamous31d", "not_famous", 31 * 24);
    await runFameSweep(pgSql!);
    expect((await loadFameCheckedAt(id))!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("never re-checks a famous entity, regardless of age", async () => {
    const id = await seedFameEntity("FamousOld", "famous", 365 * 24);
    const before = await loadFameCheckedAt(id);
    await runFameSweep(pgSql!);
    expect(await loadFameCheckedAt(id)).toEqual(before);
  });
});

describe("runFameSweep: success path", () => {
  it("writes all five columns on a successful lookup", async () => {
    mockFamousLookup();
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(1, "Famous Person")];
      return [];
    });

    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0 });

    const updateCall = calls.find((c) => c.query.includes("UPDATE entities"));
    expect(updateCall!.query).toContain("fame = ");
    expect(updateCall!.query).toContain("wiki_title = ");
    expect(updateCall!.query).toContain("wiki_sitelinks = ");
    expect(updateCall!.query).toContain("wiki_pageviews_monthly = ");
    expect(updateCall!.query).toContain("fame_checked_at = now()");
    expect(updateCall!.values).toContain("famous");
    expect(updateCall!.values).toContain("Famous Person");
  });

  it("a not-famous verdict is still a success (writes fame='not_famous', not a failure)", async () => {
    mockNotFamousLookup();
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(2, "Minor Person")];
      return [];
    });
    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0 });
  });
});

describe("runFameSweep: failure path", () => {
  it("writes ONLY fame_checked_at (plus aliases) on a lookup failure — fame column untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(errorResponse(503)));
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(3, "Unreachable Co")];
      return [];
    });

    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 1, succeeded: 0, failed: 1 });

    const updateCall = calls.find((c) => c.query.includes("UPDATE entities"));
    expect(updateCall!.query).not.toContain("fame = ");
    expect(updateCall!.query).not.toContain("wiki_title");
    expect(updateCall!.query).toContain("fame_checked_at = now()");
    expect(updateCall!.query).toContain("aliases = ");
  });

  it("dictionary aliases still merge in on a network failure (the Ukraine/Kyiv fix applies even offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network down")));
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(4, "Ukraine", [])];
      return [];
    });

    await runFameSweep(sql, NOW);

    const updateCall = calls.find((c) => c.query.includes("UPDATE entities"));
    const aliases = updateCall!.values.find((v) => Array.isArray(v)) as string[];
    expect(aliases).toEqual(expect.arrayContaining(["Ukrainian", "Kyiv", "Kiev"]));
  });
});

describe("runFameSweep: wall-clock budget", () => {
  it("stops early once the deadline has passed, checked between chunks", async () => {
    mockFamousLookup();
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) {
        return [entityRow(1, "A"), entityRow(2, "B"), entityRow(3, "C")];
      }
      return [];
    });

    // Deadline already passed before the loop starts — zero entities processed.
    const stats = await runFameSweep(sql, new Date(), Date.now() - 1);
    expect(stats).toEqual({ checked: 0, succeeded: 0, failed: 0 });
  });

  it("processes entities normally when comfortably inside the budget", async () => {
    mockFamousLookup();
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(1, "A")];
      return [];
    });
    const stats = await runFameSweep(sql, new Date(), Date.now() + 60_000);
    expect(stats.checked).toBe(1);
  });
});

describe("runFameSweep: chunking", () => {
  it("processes a 40-entity batch in chunks of CHUNK_SIZE (3), running each chunk's entities concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return errorResponse(503);
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = Array.from({ length: 40 }, (_, i) => entityRow(i + 1, `Entity ${i + 1}`));
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({ checked: 40, succeeded: 0, failed: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(40); // one search call per entity, each failing immediately
    // Never exceeds CHUNK_SIZE concurrent lookups, and reaches exactly that on every full chunk.
    expect(maxInFlight).toBe(3);
  });
});

describe("runFameSweep: deadline between chunks", () => {
  it("finishes an in-flight chunk when the deadline expires mid-chunk, then skips the remaining chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return errorResponse(503);
      }),
    );

    // 7 entities -> chunks of [3, 3, 1]. The deadline expires 50ms in, well
    // before chunk 1's 300ms (concurrent) lookup finishes — proving the
    // in-flight chunk is never pre-empted, only the chunks queued after it.
    const entities = Array.from({ length: 7 }, (_, i) => entityRow(i + 1, `Entity ${i + 1}`));
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW, Date.now() + 50);

    expect(stats).toEqual({ checked: 3, succeeded: 0, failed: 3 });
  });
});

describe("runFameSweep: mixed outcomes within one chunk", () => {
  it("aggregates success and failure correctly when a chunk's entities resolve differently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("search=FailingCo")) return errorResponse(503);
        if (url.includes("search=NoMatchOne") || url.includes("search=NoMatchTwo")) return okResponse({ search: [] });
        throw new Error(`unexpected fetch url in test: ${url}`);
      }),
    );

    const entities = [entityRow(1, "NoMatchOne"), entityRow(2, "FailingCo"), entityRow(3, "NoMatchTwo")];
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    // NoMatchOne/Two: a clean "nothing matched" is still a success (not_famous).
    // FailingCo: a network failure. All three land in the same concurrent chunk.
    expect(stats).toEqual({ checked: 3, succeeded: 2, failed: 1 });
  });
});

describe("runFameSweep: thrown per-entity failures (poison guard)", () => {
  it("a lookup that throws degrades to failure, stamps only fame_checked_at, logs once, and the sweep continues past it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("search=Alpha") || url.includes("search=Beta") || url.includes("search=Gamma")) {
          return okResponse({ search: [] });
        }
        throw new Error(`unexpected fetch url in test: ${url}`);
      }),
    );

    // CHUNK_SIZE 3: chunk1 = [Alpha, POISON Co, Beta], chunk2 = [Gamma].
    // POISON Co's thrown lookup must not affect its chunk-mates, and the
    // sweep must still reach chunk 2 rather than dying with the chunk.
    const entities = [entityRow(1, "Alpha"), entityRow(2, "POISON Co"), entityRow(3, "Beta"), entityRow(4, "Gamma")];
    const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 4, succeeded: 3, failed: 1 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, err] = errorSpy.mock.calls[0];
    expect(message).toContain("[fame-sweep] entity check threw");
    expect(message).toContain("id=2");
    expect(message).toContain(JSON.stringify("POISON Co"));
    expect(err).toBeInstanceOf(Error);

    const poisonWrite = calls.find((c) => c.query.includes("UPDATE entities") && c.values.includes(2));
    expect(poisonWrite!.query).not.toContain("wiki_title");
    expect(poisonWrite!.query).not.toContain("aliases");
    expect(poisonWrite!.query).toContain("fame_checked_at = now()");
  });

  it("a successful lookup whose full write throws still degrades to a stamp-only failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFamousLookup();
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(5, "Crashy Writer")];
      if (call.query.includes("wiki_title")) throw new Error("write failed: connection reset");
      return [];
    });

    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 1, succeeded: 0, failed: 1 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(message).toContain("[fame-sweep] entity check threw");
    expect(message).toContain("id=5");
    expect(message).toContain(JSON.stringify("Crashy Writer"));

    const rescueWrite = calls.filter((c) => c.query.includes("UPDATE entities")).pop();
    expect(rescueWrite!.query).not.toContain("wiki_title");
    expect(rescueWrite!.query).not.toContain("aliases");
    expect(rescueWrite!.query).toContain("fame_checked_at = now()");
  });

  it("propagates when the rescue write itself throws — an infrastructure-wide failure, not an entity-scoped one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(6, "POISON Corp")];
      if (call.query.includes("fame_checked_at = now()") && !call.query.includes("aliases")) {
        throw new Error("database unreachable");
      }
      return [];
    });

    await expect(runFameSweep(sql, NOW)).rejects.toThrow("database unreachable");
  });
});

describe("mergeAliases", () => {
  it("dedupes wikidata + dictionary aliases against existing via normalizeName", () => {
    const result = mergeAliases(["US"], ["U.S.", "america"], "United States");
    // "U.S." normalizes the same as existing "US"? No — normalizeName only
    // folds case/diacritics/corporate suffixes, so "US" and "U.S." are
    // distinct norms; both plus the dictionary's own aliases should appear,
    // deduped only against exact normalized repeats.
    expect(result).toContain("US");
    expect(result).toContain("U.S.");
    expect(result).toContain("USA"); // from COUNTRY_DICT's United States entry
  });

  it("never drops an existing alias, even one that would exceed the cap", () => {
    const existing = Array.from({ length: 30 }, (_, i) => `Existing${i}`);
    const result = mergeAliases(existing, ["New Alias"], "Some Company");
    for (const alias of existing) expect(result).toContain(alias);
  });

  it("caps newly-added aliases so the total never exceeds 24", () => {
    const wikidataAliases = Array.from({ length: 30 }, (_, i) => `Alias${i}`);
    const result = mergeAliases([], wikidataAliases, "Some Company");
    expect(result).toHaveLength(24);
  });

  it("does not add an alias identical to the canonical name itself", () => {
    const result = mergeAliases([], ["Ukraine", "Kyiv"], "Ukraine");
    expect(result).not.toContain("Ukraine");
    expect(result).toContain("Kyiv");
  });

  it("merges seeded-dictionary aliases when canonical_name matches a DictEntry name", () => {
    const result = mergeAliases([], [], "Ukraine");
    expect(result).toEqual(expect.arrayContaining(["Ukrainian", "Kyiv", "Kiev"]));
  });

  it("adds no dictionary aliases when canonical_name matches nothing", () => {
    const result = mergeAliases(["Existing"], [], "Some Obscure Company");
    expect(result).toEqual(["Existing"]);
  });

  it("skips a duplicate candidate already present (case/diacritic-insensitive)", () => {
    const result = mergeAliases(["kremlin"], [], "Russia");
    // COUNTRY_DICT's Russia entry has alias "Kremlin" — already present via
    // normalizeName's lowercase fold, so it must not be added a second time.
    expect(result.filter((a) => a.toLowerCase() === "kremlin")).toHaveLength(1);
  });
});
