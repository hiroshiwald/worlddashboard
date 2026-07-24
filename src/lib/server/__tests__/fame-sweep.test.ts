import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runFameSweep, mergeAliases } from "../fame-sweep";
import { computeWindowMonths } from "../wikidata";
import type { Sql, SqlRow } from "../db";

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
  it("scopes to tracked status, the unknown/not_famous recheck windows, and orders never-checked first then newest first_seen_at, capped at 10", async () => {
    const { sql, calls } = makeMockSql((call) => (call.query.includes("FROM entities") ? [] : []));
    await runFameSweep(sql);

    const selectCall = calls.find((c) => c.query.includes("SELECT id, canonical_name, aliases"));
    expect(selectCall).toBeDefined();
    const q = selectCall!.query;
    expect(q).toContain("status = 'tracked'");
    expect(q).toContain("fame = 'unknown'");
    expect(q).toContain("fame_checked_at IS NULL");
    expect(q).toContain("7 days");
    expect(q).toContain("fame = 'not_famous'");
    expect(q).toContain("30 days");
    expect(q).not.toContain("'famous'"); // famous is permanent, never re-swept
    expect(q).toContain("ORDER BY (fame_checked_at IS NULL) DESC, first_seen_at DESC");
    expect(q).toContain("LIMIT");
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
  it("stops early once the deadline has passed, checked between entities", async () => {
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
