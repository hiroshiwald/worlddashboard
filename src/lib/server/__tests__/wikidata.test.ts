import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeWindowMonths,
  computeMedianPageviews,
  parseSearchResponse,
  parseSearchResponseIds,
  parseEntitiesResponse,
  parseEntitiesResponseMulti,
  parseBatchEntitiesResponse,
  parsePageviewsResponse,
  lookupWikidataFame,
  lookupFameFromMatch,
  resolveNamesBatch,
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
function malformedBodyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  };
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

describe("parseSearchResponseIds", () => {
  it("returns every hit's id, in relevance order", () => {
    const json = { search: [{ id: "Q1" }, { id: "Q2" }, { id: "Q3" }] };
    expect(parseSearchResponseIds(json)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("skips an entry with no id but keeps the rest", () => {
    const json = { search: [{ id: "Q1" }, { label: "no id here" }, { id: "Q3" }] };
    expect(parseSearchResponseIds(json)).toEqual(["Q1", "Q3"]);
  });

  it("returns an empty array for missing/non-array search or non-object json", () => {
    expect(parseSearchResponseIds({})).toEqual([]);
    expect(parseSearchResponseIds(null)).toEqual([]);
    expect(parseSearchResponseIds({ search: "nope" })).toEqual([]);
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

describe("parseEntitiesResponseMulti", () => {
  function multiBody(ids: Record<string, { sitelinks?: Record<string, { site: string; title: string }> }>) {
    const entities: Record<string, unknown> = {};
    for (const [id, opts] of Object.entries(ids)) {
      entities[id] = { id, sitelinks: opts.sitelinks ?? {}, labels: {}, aliases: {} };
    }
    return { entities };
  }

  it("parses every requested id present in the response, keyed by id", () => {
    const json = multiBody({
      Q1: { sitelinks: { enwiki: { site: "enwiki", title: "Alpha" } } },
      Q2: { sitelinks: { enwiki: { site: "enwiki", title: "Beta" } } },
    });
    const result = parseEntitiesResponseMulti(json, ["Q1", "Q2"]);
    expect(result.get("Q1")!.wikiTitle).toBe("Alpha");
    expect(result.get("Q2")!.wikiTitle).toBe("Beta");
  });

  it("an id missing from the response is simply absent — it does not corrupt the ids present", () => {
    const json = multiBody({ Q1: { sitelinks: { enwiki: { site: "enwiki", title: "Alpha" } } } });
    const result = parseEntitiesResponseMulti(json, ["Q1", "Q2", "Q3"]);
    expect(result.size).toBe(1);
    expect(result.get("Q1")!.wikiTitle).toBe("Alpha");
  });
});

describe("parseBatchEntitiesResponse", () => {
  function batchBody(entries: Array<{ id: string; enwikiTitle: string }>) {
    const entities: Record<string, unknown> = {};
    for (const e of entries) {
      entities[e.id] = { id: e.id, sitelinks: { enwiki: { site: "enwiki", title: e.enwikiTitle } }, labels: {}, aliases: {} };
    }
    return { entities };
  }

  it("resolves a name whose text exactly matches the returned enwiki title", () => {
    const json = batchBody([{ id: "Q1", enwikiTitle: "Ukraine" }]);
    const result = parseBatchEntitiesResponse(json, ["Ukraine"]);
    expect(result.get("Ukraine")!.wikiTitle).toBe("Ukraine");
  });

  it("matches case/underscore-insensitively (normalize=1's own leniency)", () => {
    const json = batchBody([{ id: "Q1", enwikiTitle: "Ukraine" }]);
    expect(parseBatchEntitiesResponse(json, ["ukraine"]).get("ukraine")!.wikiTitle).toBe("Ukraine");
    expect(parseBatchEntitiesResponse(json, ["Ukraine"]).size).toBe(1);
  });

  it("does not resolve a name whose returned title differs (e.g. it redirected to a different article)", () => {
    const json = batchBody([{ id: "Q1", enwikiTitle: "Vladimir Putin" }]);
    const result = parseBatchEntitiesResponse(json, ["Putin"]);
    expect(result.size).toBe(0);
  });

  it("skips 'missing title' placeholder entries (negative-numbered keys)", () => {
    const json = { entities: { "-1": { site: "enwiki", title: "NonexistentXYZ", missing: "" } } };
    expect(parseBatchEntitiesResponse(json, ["NonexistentXYZ"]).size).toBe(0);
  });

  it("a response missing some requested titles does not corrupt the ones present", () => {
    const json = batchBody([{ id: "Q1", enwikiTitle: "Ukraine" }]);
    const result = parseBatchEntitiesResponse(json, ["Ukraine", "SomeoneNotInResponse"]);
    expect(result.size).toBe(1);
    expect(result.get("Ukraine")!.wikiTitle).toBe("Ukraine");
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

describe("USER_AGENT", () => {
  it("identifies the app with its own URL and a contact address, per Wikimedia's User-Agent policy", () => {
    expect(USER_AGENT).toContain("worlddashboard/1.0");
    expect(USER_AGENT).toContain("https://worlddashboard.vercel.app");
    expect(USER_AGENT).toMatch(/[\w.+-]+@[\w.-]+\.[a-z]+/i); // an email-shaped contact address is present
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

  it("requests the top 5 search results, not just 1", async () => {
    const fetchMock = mockFetchSequence(okResponse({ search: [] }));
    await lookupWikidataFame("Some Obscure Nobody");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=5");
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

  it("non-2xx on the search call -> typed failure with the specific status", async () => {
    mockFetchSequence(errorResponse(503));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "search_http_503" });
  });

  it("non-2xx on the entities call -> typed failure with the specific status", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), errorResponse(500));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "entities_http_500" });
  });

  it("non-2xx on the pageviews call -> typed failure (not the same as a 404)", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse(entitiesBody("Q7747")), errorResponse(500));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "pageviews_http_500" });
  });

  it("a malformed entities response (entity missing) -> typed failure", async () => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse({ entities: {} }));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "entities_malformed" });
  });

  it("timeout on the search call aborts and resolves to a specific typed failure, never throwing", async () => {
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

    expect(result).toEqual({ ok: false, reason: "search_timeout" });
    vi.useRealTimers();
  });

  it("a rejected fetch (network error, not a timeout) never throws to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: "search_network_error" });
  });
});

describe("lookupWikidataFame: specific failure reasons at every stage", () => {
  const NON_TIMEOUT_CASES: [string, unknown, string][] = [
    ["a 403 (forbidden/blocked)", errorResponse(403), "http_403"],
    ["a 429 (rate limited)", errorResponse(429), "http_429"],
    ["a 500 (server error)", errorResponse(500), "http_500"],
    ["a malformed (unparseable) body", malformedBodyResponse(), "malformed_body"],
  ];

  it.each(NON_TIMEOUT_CASES)("search stage: %s", async (_label, response, suffix) => {
    mockFetchSequence(response);
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: `search_${suffix}` });
  });

  it.each(NON_TIMEOUT_CASES)("entities stage: %s", async (_label, response, suffix) => {
    mockFetchSequence(okResponse(SEARCH_HIT), response);
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: `entities_${suffix}` });
  });

  it.each(NON_TIMEOUT_CASES)("pageviews stage: %s", async (_label, response, suffix) => {
    mockFetchSequence(okResponse(SEARCH_HIT), okResponse(entitiesBody("Q7747")), response);
    const result = await lookupWikidataFame("Anyone");
    expect(result).toEqual({ ok: false, reason: `pageviews_${suffix}` });
  });

  it("entities stage: timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(SEARCH_HIT))
      .mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pending = lookupWikidataFame("Anyone");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "entities_timeout" });
    vi.useRealTimers();
  });

  it("pageviews stage: timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(SEARCH_HIT))
      .mockResolvedValueOnce(okResponse(entitiesBody("Q7747")))
      .mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pending = lookupWikidataFame("Anyone");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "pageviews_timeout" });
    vi.useRealTimers();
  });
});

describe("lookupWikidataFame: disambiguation among the top 5 search results", () => {
  function multiSearchHit(ids: string[]) {
    return { search: ids.map((id) => ({ id })) };
  }
  // `sitelinks` is the TOTAL sitelink count (matching production's
  // Object.keys(sitelinks).length) — when enwikiTitle is given, it counts as
  // one of that total, not an addition on top of it.
  function multiEntitiesBody(entries: Array<{ id: string; sitelinks: number; enwikiTitle: string | null }>) {
    const entities: Record<string, unknown> = {};
    for (const e of entries) {
      const sitelinks: Record<string, { site: string; title: string }> = {};
      const otherCount = e.enwikiTitle ? e.sitelinks - 1 : e.sitelinks;
      for (let i = 0; i < otherCount; i++) sitelinks[`site${i}`] = { site: `site${i}`, title: "x" };
      if (e.enwikiTitle) sitelinks.enwiki = { site: "enwiki", title: e.enwikiTitle };
      entities[e.id] = { id: e.id, sitelinks, labels: {}, aliases: {} };
    }
    return { entities };
  }

  it("real ICC case: the first result (2 sitelinks) loses to a later result (100 sitelinks)", async () => {
    mockFetchSequence(
      okResponse(multiSearchHit(["Q_ANTWERP", "Q_OTHER", "Q_ICC", "Q_X", "Q_Y"])),
      okResponse(
        multiEntitiesBody([
          { id: "Q_ANTWERP", sitelinks: 2, enwikiTitle: "Internationaal Cultureel Centrum" },
          { id: "Q_OTHER", sitelinks: 1, enwikiTitle: null },
          { id: "Q_ICC", sitelinks: 100, enwikiTitle: "International Criminal Court" },
          { id: "Q_X", sitelinks: 5, enwikiTitle: "Something Else" },
          { id: "Q_Y", sitelinks: 3, enwikiTitle: null },
        ]),
      ),
      okResponse(pageviewsBody([["202605", 50_000]])),
    );

    const result = await lookupWikidataFame("ICC");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lookup.wikiTitle).toBe("International Criminal Court");
      expect(result.lookup.sitelinks).toBe(100);
    }
  });

  it("single-candidate response (one search hit) behaves exactly as before disambiguation existed", async () => {
    mockFetchSequence(
      okResponse(multiSearchHit(["Q1"])),
      okResponse(multiEntitiesBody([{ id: "Q1", sitelinks: 5, enwikiTitle: "Some Article" }])),
      okResponse(pageviewsBody([["202605", 40_000]])),
    );
    const result = await lookupWikidataFame("Something");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lookup.wikiTitle).toBe("Some Article");
      expect(result.lookup.sitelinks).toBe(5);
    }
  });

  it("ties break toward the earlier (more relevant) search result", async () => {
    mockFetchSequence(
      okResponse(multiSearchHit(["Q1", "Q2"])),
      okResponse(
        multiEntitiesBody([
          { id: "Q1", sitelinks: 10, enwikiTitle: "First Article" },
          { id: "Q2", sitelinks: 10, enwikiTitle: "Second Article" },
        ]),
      ),
      okResponse(pageviewsBody([])),
    );
    const result = await lookupWikidataFame("Something");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lookup.wikiTitle).toBe("First Article");
  });

  it("no candidate has an enwiki sitelink anywhere -> keeps the original top-hit-only behavior", async () => {
    const fetchMock = mockFetchSequence(
      okResponse(multiSearchHit(["Q1", "Q2", "Q3"])),
      okResponse(
        multiEntitiesBody([
          { id: "Q1", sitelinks: 3, enwikiTitle: null },
          { id: "Q2", sitelinks: 50, enwikiTitle: null }, // most sitelinks, but no English article
          { id: "Q3", sitelinks: 1, enwikiTitle: null },
        ]),
      ),
    );
    const result = await lookupWikidataFame("Something");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lookup.wikiTitle).toBeNull();
      expect(result.lookup.sitelinks).toBe(3); // the top search hit (Q1), not the highest-sitelink Q2
      expect(result.lookup.medianMonthlyPageviews).toBe(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2); // pageviews never called — no wikiTitle to look up
  });
});

describe("lookupFameFromMatch", () => {
  it("wikiTitle null -> matched true, zero median, no pageviews call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await lookupFameFromMatch({ wikiTitle: null, sitelinks: 3, aliases: ["A"] });
    expect(result).toEqual({ ok: true, lookup: { matched: true, wikiTitle: null, sitelinks: 3, aliases: ["A"], medianMonthlyPageviews: 0 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wikiTitle present -> fetches pageviews and computes the spike-immune median", async () => {
    mockFetchSequence(okResponse(pageviewsBody([["202605", 40_000]])));
    const result = await lookupFameFromMatch({ wikiTitle: "Vladimir Putin", sitelinks: 10, aliases: [] }, new Date("2026-07-24T12:00:00Z"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lookup.medianMonthlyPageviews).toBe(0); // only 1 of 12 window months populated
  });

  it("a pageviews failure surfaces the specific pageviews-stage reason", async () => {
    mockFetchSequence(errorResponse(429));
    const result = await lookupFameFromMatch({ wikiTitle: "Someone", sitelinks: 1, aliases: [] });
    expect(result).toEqual({ ok: false, reason: "pageviews_http_429" });
  });
});

describe("resolveNamesBatch", () => {
  it("issues exactly one wbgetentities request for up to 50 names, with sites=enwiki, pipe-joined titles, normalize=1", async () => {
    const names = Array.from({ length: 50 }, (_, i) => `Name${i}`);
    const fetchMock = mockFetchSequence(okResponse({ entities: {} }));

    const result = await resolveNamesBatch(names);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("action=wbgetentities");
    expect(url).toContain("sites=enwiki");
    expect(url).toContain("normalize=1");
    expect(url).toContain("Name0%7CName1"); // pipe-joined, URL-encoded
  });

  it("resolves an exact-title match; a name with no matching title is simply absent from the result map", async () => {
    mockFetchSequence(
      okResponse({
        entities: { Q1: { id: "Q1", sitelinks: { enwiki: { site: "enwiki", title: "Ukraine" } }, labels: {}, aliases: {} } },
      }),
    );

    const result = await resolveNamesBatch(["Ukraine", "Putin"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.get("Ukraine")?.wikiTitle).toBe("Ukraine");
      // "Putin" the canonical name never text-matches an enwiki title of
      // "Putin" (the real article is "Vladimir Putin") — falls through to search.
      expect(result.matches.has("Putin")).toBe(false);
    }
  });

  it("a batch response missing some titles does not corrupt the ones present", async () => {
    mockFetchSequence(
      okResponse({
        entities: {
          Q1: { id: "Q1", sitelinks: { enwiki: { site: "enwiki", title: "Ukraine" } }, labels: {}, aliases: {} },
          "-1": { site: "enwiki", title: "NonexistentXYZ", missing: "" },
        },
      }),
    );

    const result = await resolveNamesBatch(["Ukraine", "NonexistentXYZ", "AlsoNeverResolved"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches.size).toBe(1);
      expect(result.matches.get("Ukraine")?.wikiTitle).toBe("Ukraine");
    }
  });

  it("an empty name list resolves without calling fetch at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveNamesBatch([]);
    expect(result).toEqual({ ok: true, matches: new Map() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a rate-limited batch call returns a typed failure with the specific reason", async () => {
    mockFetchSequence(errorResponse(429));
    const result = await resolveNamesBatch(["Ukraine"]);
    expect(result).toEqual({ ok: false, reason: "batch_entities_http_429" });
  });

  it("a timed-out batch call returns a typed failure, never throwing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = resolveNamesBatch(["Ukraine"]);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "batch_entities_timeout" });
    vi.useRealTimers();
  });
});
