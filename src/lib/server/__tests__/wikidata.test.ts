import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeWindowMonths,
  computeMedianPageviews,
  parseSearchResponse,
  parseEntitiesResponse,
  parsePageviewsResponse,
  lookupWikidataFame,
  ALIAS_LANGUAGES,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
} from "../wikidata";

beforeEach(() => {
  // Guard: any test that reaches fetch without installing its own mock
  // throws instead of silently making a real network call (this sandbox has
  // no internet egress, so a live call is a bug twice over).
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
function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

function mockFetchSequence(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const SEARCH_HIT = { search: [{ id: "Q7747", label: "Vladimir Putin" }] };

function entitiesBody(
  id: string,
  opts: {
    sitelinks?: Record<string, { site: string; title: string }>;
    labels?: Record<string, { language: string; value: string }>;
    aliases?: Record<string, { language: string; value: string }[]>;
  } = {},
) {
  return {
    entities: {
      [id]: {
        id,
        sitelinks: opts.sitelinks ?? { enwiki: { site: "enwiki", title: "Vladimir Putin" } },
        labels: opts.labels ?? { en: { language: "en", value: "Vladimir Putin" } },
        aliases: opts.aliases ?? {},
      },
    },
  };
}

function pageviewsBody(entries: [string, number][]) {
  return {
    items: entries.map(([yyyymm, views]) => ({
      project: "en.wikipedia",
      article: "Vladimir_Putin",
      granularity: "monthly",
      timestamp: `${yyyymm}0100`,
      access: "all-access",
      agent: "all-agents",
      views,
    })),
  };
}

describe("computeWindowMonths", () => {
  it("hand-checked: 12 months ending 2 months before now, mid-year", () => {
    const months = computeWindowMonths(new Date("2026-07-24T12:00:00Z"));
    expect(months).toEqual([
      "202506", "202507", "202508", "202509", "202510", "202511",
      "202512", "202601", "202602", "202603", "202604", "202605",
    ]);
  });

  it("hand-checked: year rollover when now is in January", () => {
    const months = computeWindowMonths(new Date("2026-01-15T00:00:00Z"));
    expect(months).toEqual([
      "202412", "202501", "202502", "202503", "202504", "202505",
      "202506", "202507", "202508", "202509", "202510", "202511",
    ]);
  });

  it("always returns exactly 12 months, oldest first", () => {
    const months = computeWindowMonths(new Date("2026-03-01T00:00:00Z"));
    expect(months).toHaveLength(12);
    expect(months[0] < months[11]).toBe(true);
  });
});

describe("computeMedianPageviews — the spike-immunity linchpin", () => {
  it("a 3-month-old article with huge recent views produces a LOW median over the full 12-month window", () => {
    const windowMonths = computeWindowMonths(new Date("2026-07-24T12:00:00Z"));
    // Only the last 3 window months have any data at all (the article's
    // whole lifetime); those 3 months are enormous.
    const recentThree = windowMonths.slice(-3);
    const viewsByMonth = new Map(recentThree.map((m) => [m, 5_000_000]));

    const median = computeMedianPageviews(viewsByMonth, windowMonths);
    expect(median).toBe(0); // 9 of 12 months are real zeros; the middle two sorted values are both 0
  });

  it("odd-length window: missing months count as zero, not skipped", () => {
    const windowMonths = ["202501", "202502", "202503"];
    const viewsByMonth = new Map([["202503", 900_000]]);
    expect(computeMedianPageviews(viewsByMonth, windowMonths)).toBe(0);
  });

  it("even-length window: median averages the two middle (zero-filled) values", () => {
    const windowMonths = ["202501", "202502", "202503", "202504"];
    const viewsByMonth = new Map([["202504", 500_000]]);
    expect(computeMedianPageviews(viewsByMonth, windowMonths)).toBe(0);
  });

  it("even-length window with a genuine sustained history returns a real nonzero median", () => {
    const windowMonths = ["202501", "202502", "202503", "202504"];
    const viewsByMonth = new Map([
      ["202501", 10_000],
      ["202502", 20_000],
      ["202503", 30_000],
      ["202504", 40_000],
    ]);
    // sorted [10k,20k,30k,40k] -> avg(20k,30k) = 25k
    expect(computeMedianPageviews(viewsByMonth, windowMonths)).toBe(25_000);
  });

  it("odd-length window with a genuine sustained history returns the exact middle value", () => {
    const windowMonths = ["202501", "202502", "202503"];
    const viewsByMonth = new Map([
      ["202501", 10_000],
      ["202502", 999_999],
      ["202503", 20_000],
    ]);
    // sorted [10k, 20k, 999999] -> middle = 20k
    expect(computeMedianPageviews(viewsByMonth, windowMonths)).toBe(20_000);
  });
});

describe("parseSearchResponse", () => {
  it("returns the top hit's id", () => {
    expect(parseSearchResponse(SEARCH_HIT)).toBe("Q7747");
  });

  it("returns null for an empty search array", () => {
    expect(parseSearchResponse({ search: [] })).toBeNull();
  });

  it("returns null when search is missing entirely", () => {
    expect(parseSearchResponse({})).toBeNull();
  });

  it("returns null for non-object json", () => {
    expect(parseSearchResponse(null)).toBeNull();
    expect(parseSearchResponse("nope")).toBeNull();
  });

  it("returns null when the top hit has no id", () => {
    expect(parseSearchResponse({ search: [{ label: "no id here" }] })).toBeNull();
  });
});

describe("parseEntitiesResponse", () => {
  it("extracts wikiTitle, total sitelinks count, and deduped ALIAS_LANGUAGES labels+aliases", () => {
    const body = entitiesBody("Q7747", {
      sitelinks: {
        enwiki: { site: "enwiki", title: "Vladimir Putin" },
        dewiki: { site: "dewiki", title: "Wladimir Putin" },
        frwiki: { site: "frwiki", title: "Vladimir Poutine" },
      },
      labels: {
        en: { language: "en", value: "Vladimir Putin" },
        de: { language: "de", value: "Wladimir Putin" },
        ja: { language: "ja", value: "ウラジーミル・プーチン" }, // not in ALIAS_LANGUAGES
      },
      aliases: {
        en: [{ language: "en", value: "Putin" }],
        de: [{ language: "de", value: "Wladimir Wladimirowitsch Putin" }],
      },
    });

    const result = parseEntitiesResponse(body, "Q7747");
    expect(result).not.toBeNull();
    expect(result!.wikiTitle).toBe("Vladimir Putin");
    expect(result!.sitelinks).toBe(3);
    expect(result!.aliases.sort()).toEqual(
      ["Vladimir Putin", "Wladimir Putin", "Putin", "Wladimir Wladimirowitsch Putin"].sort(),
    );
    expect(result!.aliases).not.toContain("ウラジーミル・プーチン");
  });

  it("dedupes an identical label/alias value repeated across languages", () => {
    const body = entitiesBody("Q1", {
      labels: { en: { language: "en", value: "Acme" }, de: { language: "de", value: "Acme" } },
    });
    const result = parseEntitiesResponse(body, "Q1");
    expect(result!.aliases).toEqual(["Acme"]);
  });

  it("wikiTitle is null when no enwiki sitelink exists, sitelinks count still reflects other wikis", () => {
    const body = entitiesBody("Q2", { sitelinks: { dewiki: { site: "dewiki", title: "Etwas" } } });
    const result = parseEntitiesResponse(body, "Q2");
    expect(result!.wikiTitle).toBeNull();
    expect(result!.sitelinks).toBe(1);
  });

  it("returns null when the requested id is missing from entities", () => {
    const body = entitiesBody("Q7747");
    expect(parseEntitiesResponse(body, "Q9999")).toBeNull();
  });

  it("returns null for a malformed/empty entity", () => {
    expect(parseEntitiesResponse({ entities: { Q1: {} } }, "Q1")).toBeNull();
    expect(parseEntitiesResponse(null, "Q1")).toBeNull();
  });
});

describe("parsePageviewsResponse", () => {
  it("keys monthly items by YYYYMM (truncating the 10-digit timestamp)", () => {
    const map = parsePageviewsResponse(pageviewsBody([["202601", 1000], ["202602", 2000]]));
    expect(map.get("202601")).toBe(1000);
    expect(map.get("202602")).toBe(2000);
    expect(map.size).toBe(2);
  });

  it("skips malformed entries but keeps the well-formed rest", () => {
    const body = {
      items: [
        { timestamp: "2026010100", views: 500 },
        { timestamp: "2026020100" }, // missing views
        { timestamp: "bad", views: 999 }, // too-short timestamp
        { views: 100 }, // missing timestamp
      ],
    };
    const map = parsePageviewsResponse(body);
    expect(map.size).toBe(1);
    expect(map.get("202601")).toBe(500);
  });

  it("returns an empty map for a malformed or itemless body", () => {
    expect(parsePageviewsResponse({}).size).toBe(0);
    expect(parsePageviewsResponse(null).size).toBe(0);
    expect(parsePageviewsResponse({ items: "nope" }).size).toBe(0);
  });
});

describe("ALIAS_LANGUAGES", () => {
  it("matches the feed corpus's language spread", () => {
    expect(ALIAS_LANGUAGES).toEqual(["en", "de", "fr", "es", "it", "pl", "pt", "nl", "tr"]);
  });
});

describe("lookupWikidataFame", () => {
  it("full success: search -> entities -> pageviews, User-Agent present on every request", async () => {
    const fetchMock = mockFetchSequence(
      okResponse(SEARCH_HIT),
      okResponse(entitiesBody("Q7747")),
      okResponse(pageviewsBody([["202605", 40_000]])),
    );

    const result = await lookupWikidataFame("Vladimir Putin", new Date("2026-07-24T12:00:00Z"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lookup.matched).toBe(true);
      expect(result.lookup.wikiTitle).toBe("Vladimir Putin");
      expect(result.lookup.sitelinks).toBe(1);
      expect(result.lookup.aliases).toEqual(["Vladimir Putin"]);
      // Only one of 12 window months has data -> low median, not 40,000.
      expect(result.lookup.medianMonthlyPageviews).toBe(0);
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as { headers: Record<string, string> };
      expect(init.headers["User-Agent"]).toBe(USER_AGENT);
    }
    expect(String(fetchMock.mock.calls[0][0])).toContain("wbsearchentities");
    expect(String(fetchMock.mock.calls[1][0])).toContain("wbgetentities");
    expect(String(fetchMock.mock.calls[2][0])).toContain("pageviews/per-article");
  });

  it("no Wikidata match at all -> ok:true, matched:false, stops after one call", async () => {
    const fetchMock = mockFetchSequence(okResponse({ search: [] }));
    const result = await lookupWikidataFame("Some Obscure Nobody");
    expect(result).toEqual({ ok: true, lookup: { matched: false, wikiTitle: null, sitelinks: 0, aliases: [], medianMonthlyPageviews: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no enwiki sitelink -> matched true, wikiTitle null, zero median, pageviews never called", async () => {
    const fetchMock = mockFetchSequence(
      okResponse(SEARCH_HIT),
      okResponse(entitiesBody("Q7747", { sitelinks: { dewiki: { site: "dewiki", title: "Etwas" } } })),
    );
    const result = await lookupWikidataFame("Someone");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lookup.wikiTitle).toBeNull();
      expect(result.lookup.medianMonthlyPageviews).toBe(0);
      expect(result.lookup.sitelinks).toBe(1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pageviews 404 (no data yet for a brand-new article) resolves to a zero median, not a failure", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse(entitiesBody("Q7747")), notFoundResponse());
    const result = await lookupWikidataFame("Vladimir Putin");
    expect(result).toEqual({
      ok: true,
      lookup: { matched: true, wikiTitle: "Vladimir Putin", sitelinks: 1, aliases: ["Vladimir Putin"], medianMonthlyPageviews: 0 },
    });
  });

  it("non-2xx on the search call -> typed failure", async () => {
    mockFetchSequence(errorResponse(503));
    const result = await lookupWikidataFame("Anyone");
    expect(result.ok).toBe(false);
  });

  it("non-2xx on the entities call -> typed failure", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), errorResponse(500));
    const result = await lookupWikidataFame("Anyone");
    expect(result.ok).toBe(false);
  });

  it("non-2xx on the pageviews call -> typed failure (not the same as a 404)", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse(entitiesBody("Q7747")), errorResponse(500));
    const result = await lookupWikidataFame("Anyone");
    expect(result.ok).toBe(false);
  });

  it("a malformed entities response (entity missing) -> typed failure", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse({ entities: {} }));
    const result = await lookupWikidataFame("Anyone");
    expect(result.ok).toBe(false);
  });

  it("timeout on the search call aborts and resolves to a typed failure, never throwing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = lookupWikidataFame("Anyone");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const result = await pending;

    expect(result.ok).toBe(false);
    vi.useRealTimers();
  });

  it("a rejected fetch (network error) never throws to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "search_failed" });
  });
});
