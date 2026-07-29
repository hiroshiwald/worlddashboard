import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runFameSweep, mergeAliases, describeException } from "../fame-sweep";
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

// Every runFameSweep call now issues one resolveNamesBatch call (wbgetentities
// by title) BEFORE the per-entity chunk loop — this response is that call's
// "nothing matched" answer, so the per-name search/entities/pageviews
// sequence below it runs exactly as it did before batching existed.
function noBatchMatchResponse() {
  return okResponse({ entities: {} });
}

// A full famous-verdict fetch sequence: batch (no match) -> search ->
// entities (enwiki, high sitelinks) -> pageviews (huge, sustained across the
// whole window).
function mockFamousLookup() {
  vi.stubGlobal(
    "fetch",
    vi.fn()
      .mockResolvedValueOnce(noBatchMatchResponse())
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
      .mockResolvedValueOnce(noBatchMatchResponse())
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
    expect(q).toContain("fame_locked = false");
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
 * evaluates against. `locked` seeds fame_locked (migrations/007), default
 * false. */
async function seedFameEntity(name: string, fame: string, hoursAgo: number | null, locked = false): Promise<number> {
  const rows =
    hoursAgo === null
      ? await pgSql!`
          INSERT INTO entities (canonical_name, type, status, fame, fame_checked_at, fame_locked, first_seen_at, last_seen_at)
          VALUES (${name}, 'country', 'tracked', ${fame}, NULL, ${locked}, now(), now())
          RETURNING id
        `
      : await pgSql!`
          INSERT INTO entities (canonical_name, type, status, fame, fame_checked_at, fame_locked, first_seen_at, last_seen_at)
          VALUES (${name}, 'country', 'tracked', ${fame}, now() - make_interval(hours => ${hoursAgo}::int), ${locked}, now(), now())
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

  it("never re-checks a locked never-checked unknown entity (a human verdict overrides the never-checked-first rule)", async () => {
    const id = await seedFameEntity("LockedNeverChecked", "unknown", null, true);
    const before = await loadFameCheckedAt(id);
    await runFameSweep(pgSql!);
    expect(await loadFameCheckedAt(id)).toEqual(before);
  });

  it("never re-checks a locked not_famous entity checked 31 days ago, though the same row unlocked would be re-checked", async () => {
    const id = await seedFameEntity("LockedNotFamous31d", "not_famous", 31 * 24, true);
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
    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0, failureReasons: {} });

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
    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0, failureReasons: {} });
  });
});

describe("runFameSweep: failure path", () => {
  it("writes ONLY fame_checked_at (plus aliases) on a lookup failure — fame column untouched", async () => {
    // Persistent (not "Once"): the batch resolution call ALSO hits this mock
    // first, so both it and the per-entity fallback search call need an answer.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return [entityRow(3, "Unreachable Co")];
      return [];
    });

    const stats = await runFameSweep(sql, NOW);
    expect(stats).toEqual({ checked: 1, succeeded: 0, failed: 1, failureReasons: { search_http_503: 1 } });

    const updateCall = calls.find((c) => c.query.includes("UPDATE entities"));
    expect(updateCall!.query).not.toContain("fame = ");
    expect(updateCall!.query).not.toContain("wiki_title");
    expect(updateCall!.query).toContain("fame_checked_at = now()");
    expect(updateCall!.query).toContain("aliases = ");
  });

  it("dictionary aliases still merge in on a network failure (the Ukraine/Kyiv fix applies even offline)", async () => {
    // Persistent (not "Once"): same reasoning as above — the upfront batch
    // call needs an answer too, not just the per-entity fallback call.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
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
    expect(stats).toEqual({ checked: 0, succeeded: 0, failed: 0, failureReasons: {} });
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

    expect(stats).toEqual({ checked: 40, succeeded: 0, failed: 40, failureReasons: { search_http_503: 40 } });
    // 1 upfront batch-resolution call (also 503, so nothing resolves via the
    // shortcut) + one search call per entity, each failing immediately.
    expect(fetchMock).toHaveBeenCalledTimes(41);
    // Never exceeds CHUNK_SIZE concurrent lookups, and reaches exactly that on every full chunk.
    expect(maxInFlight).toBe(3);
  });
});

describe("runFameSweep: deadline between chunks", () => {
  it("finishes an in-flight chunk when the deadline expires mid-chunk, then skips the remaining chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // The upfront batch-resolution call must resolve near-instantly (no
        // matches) so it doesn't itself eat the 50ms deadline below — only
        // the per-entity search calls are slow here.
        if (url.includes("sites=enwiki")) return noBatchMatchResponse();
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

    expect(stats).toEqual({ checked: 3, succeeded: 0, failed: 3, failureReasons: { search_http_503: 3 } });
  });
});

describe("runFameSweep: mixed outcomes within one chunk", () => {
  it("aggregates success and failure correctly when a chunk's entities resolve differently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("sites=enwiki")) return noBatchMatchResponse();
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
    expect(stats).toEqual({ checked: 3, succeeded: 2, failed: 1, failureReasons: { search_http_503: 1 } });
  });
});

describe("runFameSweep: thrown per-entity failures (poison guard)", () => {
  it("a lookup that throws degrades to failure, stamps only fame_checked_at, logs once, and the sweep continues past it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("sites=enwiki")) return noBatchMatchResponse();
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
    expect(stats).toEqual({
      checked: 4,
      succeeded: 3,
      failed: 1,
      failureReasons: { exception_Error: 1 },
      exceptionSamples: ["Error: simulated lookup crash"],
    });

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
    expect(stats).toEqual({
      checked: 1,
      succeeded: 0,
      failed: 1,
      failureReasons: { exception_Error: 1 },
      exceptionSamples: ["Error: write failed: connection reset"],
    });

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

    // No fetch mock needed: "POISON Corp" makes the mocked lookupWikidataFame
    // reject directly (no network call), and the upfront resolveNamesBatch
    // call hits this file's default synchronous-throw fetch guard, which
    // fetchJson's own try/catch absorbs as a plain network_error (not a
    // rate-limit reason) — so it never reaches or affects the poison entity.
    await expect(runFameSweep(sql, NOW)).rejects.toThrow("database unreachable");
  });
});

describe("runFameSweep: exceptionSamples", () => {
  it("collapses many identical crashes into one sample line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // No fetch mock: POISON names reject inside the mocked lookupWikidataFame
    // before any network call, and the upfront resolveNamesBatch call hits
    // this file's default throwing fetch guard, which fetchJson absorbs.
    const entities = Array.from({ length: 5 }, (_, i) => entityRow(i + 1, `POISON ${i + 1}`));
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats.failed).toBe(5);
    expect(stats.failureReasons).toEqual({ exception_Error: 5 });
    expect(stats.exceptionSamples).toEqual(["Error: simulated lookup crash"]);
  });

  it("caps distinct sample messages at 3 while still counting every failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("sites=enwiki")) return noBatchMatchResponse();
        if (url.includes("wbsearchentities")) return okResponse(searchHit("Q1"));
        if (url.includes("wbgetentities")) return okResponse(entitiesBody("Q1", { enwiki: { site: "enwiki", title: "Famous Person" } }));
        if (url.includes("pageviews/per-article")) return okResponse(sustainedPageviewsBody(1_000_000));
        throw new Error(`unexpected fetch url in test: ${url}`);
      }),
    );

    // Every lookup succeeds; every full write throws a DIFFERENT message, so
    // five distinct samples compete for three slots.
    const entities = Array.from({ length: 5 }, (_, i) => entityRow(i + 1, `Writer ${i + 1}`));
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT id, canonical_name, aliases")) return entities;
      if (call.query.includes("wiki_title")) throw new Error(`write failed for entity ${call.values[call.values.length - 1]}`);
      return [];
    });

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({
      checked: 5,
      succeeded: 0,
      failed: 5,
      failureReasons: { exception_Error: 5 },
      exceptionSamples: [
        "Error: write failed for entity 1",
        "Error: write failed for entity 2",
        "Error: write failed for entity 3",
      ],
    });
  });

  it("omits the field entirely when nothing threw", async () => {
    mockNotFamousLookup();
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? [entityRow(1, "Minor Person")] : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats.exceptionSamples).toBeUndefined();
    expect("exceptionSamples" in stats).toBe(false);
  });
});

describe("describeException", () => {
  it("keys the reason on the error's own name, so identical crashes tally as one row", () => {
    expect(describeException(new Error("boom")).reason).toBe("exception_Error");
    expect(describeException(new TypeError("bad type")).reason).toBe("exception_TypeError");
  });

  it("returns the message as a sample, prefixed with the error name", () => {
    expect(describeException(new Error("connection reset")).sample).toBe("Error: connection reset");
  });

  it("redacts every URL-shaped substring — a driver error can quote DATABASE_URL", () => {
    const err = new Error("connect failed: postgresql://neondb_owner:npg_S3cret@ep-x.neon.tech/neondb?sslmode=require");
    const { sample } = describeException(err);
    expect(sample).not.toContain("npg_S3cret");
    expect(sample).not.toContain("neon.tech");
    expect(sample).toBe("Error: connect failed: <redacted-url>");
  });

  it("redacts a URL that is not the whole message, keeping the surrounding words", () => {
    const { sample } = describeException(new Error("GET https://api.wikidata.org/w/api.php?x=1 returned 500"));
    expect(sample).toBe("Error: GET <redacted-url> returned 500");
  });

  it("caps the message at 160 characters so one error cannot flood the ingest response", () => {
    const { sample } = describeException(new Error("x".repeat(500)));
    expect(sample).toBe(`Error: ${"x".repeat(160)}`);
  });

  it("handles a thrown non-Error value", () => {
    expect(describeException("plain string")).toEqual({ reason: "exception_string", sample: "string: plain string" });
    expect(describeException(null)).toEqual({ reason: "exception_object", sample: "object: null" });
  });

  it("strips punctuation from an exotic error name, keeping the reason key a safe identifier", () => {
    const err = new Error("boom");
    err.name = "Weird Name!/*";
    expect(describeException(err).reason).toBe("exception_WeirdName");
  });

  it("falls back to Unknown when the sanitized name is empty", () => {
    const err = new Error("boom");
    err.name = "!!!";
    expect(describeException(err).reason).toBe("exception_Unknown");
  });
});

describe("runFameSweep: failureReasons tally", () => {
  it("aggregates distinct failure reasons across a mixed batch, without tripping the circuit breaker", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) return noBatchMatchResponse();
      if (url.includes("search=ServerErrorOne") || url.includes("search=ServerErrorTwo")) return errorResponse(500);
      if (url.includes("search=Healthy")) return okResponse({ search: [] });
      throw new Error(`unexpected fetch url in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = [entityRow(1, "ServerErrorOne"), entityRow(2, "ServerErrorTwo"), entityRow(3, "Healthy")];
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({ checked: 3, succeeded: 1, failed: 2, failureReasons: { search_http_500: 2 } });
    expect(stats.abortedReason).toBeUndefined(); // 500 isn't a rate-limit signal
  });
});

describe("runFameSweep: circuit breaker (429/403 aborts the rest of the run)", () => {
  it("a 429 partway through a chunk aborts remaining chunks; already-processed entities keep their outcomes; unattempted entities are never written", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) return noBatchMatchResponse();
      if (url.includes("search=RateLimited")) return errorResponse(429);
      if (url.includes("search=")) return okResponse({ search: [] }); // everyone else: a clean no-match
      throw new Error(`unexpected fetch url in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // CHUNK_SIZE 3: chunk1 = [A, RateLimited, B] (mixed, one 429),
    // chunk2 = [C, D] — must never be attempted at all.
    const entities = [entityRow(1, "A"), entityRow(2, "RateLimited"), entityRow(3, "B"), entityRow(4, "C"), entityRow(5, "D")];
    const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats.checked).toBe(3); // only chunk 1 ran
    expect(stats.succeeded).toBe(2); // A and B, still processed and written
    expect(stats.failed).toBe(1);
    expect(stats.failureReasons).toEqual({ search_http_429: 1 });
    expect(stats.abortedReason).toBe("rate_limited");

    // Chunk 2's entities (ids 4, 5) were never passed to checkAndWriteEntityFame
    // at all — no UPDATE of any kind was ever issued for them, so their
    // fame_checked_at is left completely untouched for the normal retry schedule.
    const chunk2Writes = calls.filter((c) => c.query.includes("UPDATE entities") && (c.values.includes(4) || c.values.includes(5)));
    expect(chunk2Writes).toHaveLength(0);
  });

  it("a 403 partway through a chunk also aborts the rest of the run", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) return noBatchMatchResponse();
      if (url.includes("search=Blocked")) return errorResponse(403);
      if (url.includes("search=")) return okResponse({ search: [] });
      throw new Error(`unexpected fetch url in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = [entityRow(1, "A"), entityRow(2, "Blocked"), entityRow(3, "B"), entityRow(4, "C")];
    const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats.checked).toBe(3);
    expect(stats.abortedReason).toBe("rate_limited");
    expect(stats.failureReasons).toEqual({ search_http_403: 1 });
    const chunk2Writes = calls.filter((c) => c.query.includes("UPDATE entities") && c.values.includes(4));
    expect(chunk2Writes).toHaveLength(0);
  });

  it("a 429 on the upfront batch-resolution call itself aborts before any entity is attempted", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) return errorResponse(429);
      throw new Error(`unexpected fetch url in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const entities = [entityRow(1, "A"), entityRow(2, "B")];
    const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? entities : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({
      checked: 0,
      succeeded: 0,
      failed: 0,
      failureReasons: { batch_entities_http_429: 1 },
      abortedReason: "rate_limited",
    });
    expect(calls.some((c) => c.query.includes("UPDATE entities"))).toBe(false); // nothing was ever written
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the batch call — no per-entity fallback attempted
  });
});

describe("runFameSweep: batched resolution path", () => {
  it("an entity whose canonical name is an exact Wikipedia title skips straight to pageviews", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) {
        return okResponse({
          entities: { Q1: { id: "Q1", sitelinks: { enwiki: { site: "enwiki", title: "Famous Person" } }, labels: {}, aliases: {} } },
        });
      }
      if (url.includes("pageviews/per-article")) return okResponse(sustainedPageviewsBody(1_000_000));
      throw new Error(`unexpected fetch url in test (expected only batch + pageviews): ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? [entityRow(1, "Famous Person")] : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0, failureReasons: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2); // batch + pageviews only — no search, no per-id entities call
  });

  it("a name the batch does not resolve falls through to the full per-name search path", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("sites=enwiki")) return noBatchMatchResponse(); // "Putin" isn't an exact enwiki title
      if (url.includes("wbsearchentities")) return okResponse(searchHit("Q1"));
      if (url.includes("wbgetentities")) return okResponse(entitiesBody("Q1", { enwiki: { site: "enwiki", title: "Vladimir Putin" } }));
      if (url.includes("pageviews/per-article")) return okResponse(sustainedPageviewsBody(1_000_000));
      throw new Error(`unexpected fetch url in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sql } = makeMockSql((call) => (call.query.includes("SELECT id, canonical_name, aliases") ? [entityRow(1, "Putin")] : []));

    const stats = await runFameSweep(sql, NOW);

    expect(stats).toEqual({ checked: 1, succeeded: 1, failed: 0, failureReasons: {} });
    expect(fetchMock).toHaveBeenCalledTimes(4); // batch + search + entities + pageviews
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
