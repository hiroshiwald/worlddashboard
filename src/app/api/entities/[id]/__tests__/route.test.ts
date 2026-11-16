import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Sql, SqlRow } from "@/lib/server/db";

interface RecordedCall {
  query: string;
  values: unknown[];
}

let currentSql: Sql;

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));

function makeMockSql(handler: (call: RecordedCall) => SqlRow[]) {
  const calls: RecordedCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: RecordedCall = { query: strings.join(" ? "), values };
    calls.push(call);
    return handler(call);
  }) as Sql;
  return { sql, calls };
}

const req = new NextRequest("http://localhost/api/entities/1");

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/entities/1", { method: "PATCH", body: JSON.stringify(body) });
}

function entityRow(overrides: Partial<SqlRow> = {}): SqlRow {
  return {
    id: "1", canonical_name: "Russia", type: "country", status: "tracked", aliases: [],
    fame: "unknown", fame_locked: false, wiki_title: null, wiki_sitelinks: null,
    wiki_pageviews_monthly: null, fame_checked_at: null, first_seen_at: "2026-07-01T00:00:00Z",
    last_seen_at: null,
    ...overrides,
  };
}

const { GET, PATCH } = await import("../route");

describe("GET /api/entities/[id]", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(req, { params: { id: "1" } });
    expect(res.status).toBe(503);
  });

  it("400s on a non-numeric id", async () => {
    const res = await GET(req, { params: { id: "not-a-number" } });
    expect(res.status).toBe(400);
  });

  it("400s on a non-positive id", async () => {
    const res = await GET(req, { params: { id: "0" } });
    expect(res.status).toBe(400);
  });

  it("404s when the entity doesn't exist", async () => {
    const { sql } = makeMockSql(() => []);
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    expect(res.status).toBe(404);
  });

  it("scopes the hourly series to a 7-day window and orders ascending", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "1", last_seen_at: "2026-07-15T00:00:00Z" })];
      }
      return [];
    });
    currentSql = sql;
    await GET(req, { params: { id: "1" } });

    // Disambiguated from the new mentions-aggregate query (also FROM
    // entity_mentions_hourly) by its distinctive ORDER BY.
    const seriesCall = calls.find((c) => c.query.includes("ORDER BY bucket ASC"));
    expect(seriesCall!.query).toContain("FROM entity_mentions_hourly");
    expect(seriesCall!.query).toContain("make_interval(days =>");
    expect(seriesCall!.values).toContain(7);
  });

  it("scopes recent articles to cluster heads, newest first, limited to 20", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "1" })];
      }
      return [];
    });
    currentSql = sql;
    await GET(req, { params: { id: "1" } });

    const articlesCall = calls.find((c) => c.query.includes("FROM article_entities") && c.query.includes("LIMIT"));
    expect(articlesCall!.query).toContain("a.dup_group_id IS NULL");
    expect(articlesCall!.query).toContain("ORDER BY COALESCE(a.published_at, a.first_seen_at) DESC");
    expect(articlesCall!.values).toContain(20);
  });

  it("resolves the 'other' entity id/name for edges regardless of a/b position, and carries firstSeenAt", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "5" })];
      }
      if (call.query.includes("FROM entity_edges")) {
        return [{ other_id: "9", other_name: "Ukraine", article_count: "12", first_seen_at: "2026-06-01T00:00:00Z" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "5" } });
    const body = await res.json();

    expect(body.edges).toEqual([
      { id: 9, name: "Ukraine", articleCount: 12, firstSeenAt: "2026-06-01T00:00:00.000Z" },
    ]);
    const edgesCall = calls.find((c) => c.query.includes("FROM entity_edges"));
    expect(edgesCall!.query).toContain("ORDER BY ee.article_count DESC");
    expect(edgesCall!.values).toContain(10);
  });

  it("returns the full shape: entity + activity + series + articles + edges + relations", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "1", last_seen_at: "2026-07-15T00:00:00Z" })];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entity).toEqual({
      id: 1,
      canonicalName: "Russia",
      type: "country",
      status: "tracked",
      aliases: [],
      fame: "unknown",
      fameLocked: false,
      wikiTitle: null,
      wikiSitelinks: null,
      wikiPageviewsMonthly: null,
      fameCheckedAt: null,
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-15T00:00:00.000Z",
      // type=country fires isAnchor's type prong regardless of baseline —
      // deterministic even with no baseline-panel mock response.
      role: "anchor",
      roleReasons: ["country_or_region_type"],
    });
    expect(body.activity).toEqual({ mentions30d: 0, sources30d: 0 });
    expect(body.series).toEqual([]);
    expect(body.articles).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.relations).toEqual({ incoming: [], outgoing: [] });
  });

  it("loads outgoing (source=id) and incoming (target=id) relations as one query each, correctly shaped", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "5", canonical_name: "Hyundai", type: "company" })];
      }
      if (call.query.includes("er.source_id = ")) {
        return [{ relation: "acquisition", other_id: "9", other_name: "Boston Dynamics", article_count: "3", last_seen_at: "2026-07-10T00:00:00Z" }];
      }
      if (call.query.includes("er.target_id = ")) {
        return [{ relation: "investment", other_id: "12", other_name: "SoftBank", article_count: "2", last_seen_at: "2026-07-11T00:00:00Z" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "5" } });
    const body = await res.json();

    expect(body.relations.outgoing).toEqual([
      { relation: "acquisition", id: 9, name: "Boston Dynamics", articleCount: 3, lastSeenAt: "2026-07-10T00:00:00.000Z", evidence: null },
    ]);
    expect(body.relations.incoming).toEqual([
      { relation: "investment", id: 12, name: "SoftBank", articleCount: 2, lastSeenAt: "2026-07-11T00:00:00.000Z", evidence: null },
    ]);

    const relationsCalls = calls.filter((c) => c.query.includes("FROM entity_relations"));
    expect(relationsCalls).toHaveLength(2);
  });

  it("relations LEFT JOIN articles on evidence_article_id, excluding demoted duplicate members", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) return [entityRow({ id: "5" })];
      return [];
    });
    currentSql = sql;
    await GET(req, { params: { id: "5" } });

    const outgoingCall = calls.find((c) => c.query.includes("er.source_id = "));
    expect(outgoingCall!.query).toContain("LEFT JOIN articles ev ON ev.id = er.evidence_article_id");
    expect(outgoingCall!.query).toContain("ev.dup_group_id IS NULL");
  });

  it("carries relation evidence {title, link} when the article resolves, else null", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) return [entityRow({ id: "5" })];
      if (call.query.includes("er.source_id = ")) {
        return [{
          relation: "acquisition", other_id: "9", other_name: "Boston Dynamics",
          article_count: "3", last_seen_at: "2026-07-10T00:00:00Z",
          evidence_title: "Hyundai completes Boston Dynamics deal", evidence_link: "https://example.com/a",
        }];
      }
      if (call.query.includes("er.target_id = ")) {
        return [{
          relation: "investment", other_id: "12", other_name: "SoftBank",
          article_count: "2", last_seen_at: "2026-07-11T00:00:00Z",
          evidence_title: null, evidence_link: null,
        }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "5" } });
    const body = await res.json();

    expect(body.relations.outgoing[0].evidence).toEqual({
      title: "Hyundai completes Boston Dynamics deal",
      link: "https://example.com/a",
    });
    expect(body.relations.incoming[0].evidence).toBeNull();
  });
});

describe("GET /api/entities/[id] — activity", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns mentions30d/sources30d over a 30-day window, zero-filled when no aggregate row exists", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) return [entityRow({ id: "1" })];
      if (call.query.includes("FROM entity_mentions_hourly") && call.query.includes("GROUP BY entity_id")) {
        return [{ entity_id: "1", mentions_in_window: "22" }];
      }
      if (call.query.includes("FROM article_entities") && call.query.includes("GROUP BY ae.entity_id")) {
        return [{ entity_id: "1", sources_in_window: "6" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    const body = await res.json();

    expect(body.activity).toEqual({ mentions30d: 22, sources30d: 6 });
    const mentionsCall = calls.find(
      (c) => c.query.includes("FROM entity_mentions_hourly") && c.query.includes("GROUP BY entity_id"),
    );
    expect(mentionsCall!.values).toContain(30);
  });

  it("zero-fills when the entity has no activity in the window", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) return [entityRow({ id: "1" })];
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "1" } });
    const body = await res.json();
    expect(body.activity).toEqual({ mentions30d: 0, sources30d: 0 });
  });
});

describe("GET /api/entities/[id] — role classification", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("classifies a famous (non-anchor-type) entity via the dictionary prong, and scopes breadth to this one id", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "7", canonical_name: "Kremlin", type: "organization" })];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "7" } });
    const body = await res.json();

    expect(body.entity.role).toBe("famous");
    expect(body.entity.roleReasons).toEqual(["famous_dictionary"]);

    const breadthCall = calls.find((c) => c.query.includes("source_breadth"));
    expect(breadthCall).toBeDefined();
    expect(breadthCall!.values[0]).toEqual([7]);
  });

  it("classifies a plain, non-famous entity as satellite with no reasons", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("FROM entities WHERE id")) {
        return [entityRow({ id: "8", canonical_name: "Acme Corp", type: "company" })];
      }
      return [];
    });
    currentSql = sql;
    const res = await GET(req, { params: { id: "8" } });
    const body = await res.json();

    expect(body.entity.role).toBe("satellite");
    expect(body.entity.roleReasons).toEqual([]);
  });
});

describe("PATCH /api/entities/[id]", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await PATCH(patchRequest({ status: "dismissed" }), { params: { id: "1" } });
    expect(res.status).toBe(503);
  });

  it("400s on a non-positive id", async () => {
    const res = await PATCH(patchRequest({ status: "dismissed" }), { params: { id: "0" } });
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON", async () => {
    const res = await PATCH(new NextRequest("http://localhost/api/entities/1", { method: "PATCH", body: "not json" }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("400s on an empty patch body", async () => {
    const res = await PATCH(patchRequest({}), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid type", async () => {
    const res = await PATCH(patchRequest({ type: "planet" }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid status", async () => {
    const res = await PATCH(patchRequest({ status: "archived" }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid fame value", async () => {
    const res = await PATCH(patchRequest({ fame: "legendary" }), { params: { id: "1" } });
    expect(res.status).toBe(400);
  });

  it("404s on an unknown id", async () => {
    currentSql = makeMockSql(() => []).sql;
    const res = await PATCH(patchRequest({ status: "dismissed" }), { params: { id: "999" } });
    expect(res.status).toBe(404);
  });

  it("updates type independently, leaving fame_locked untouched (COALESCE null)", async () => {
    const { sql, calls } = makeMockSql(() => [entityRow({ type: "company" })]);
    currentSql = sql;
    const res = await PATCH(patchRequest({ type: "company" }), { params: { id: "1" } });
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.values).toContain("company");
    // status/fame absent from the patch -> COALESCE(null, column): null present in values, not the literal.
    expect(call.values.filter((v) => v === null).length).toBeGreaterThanOrEqual(3);
  });

  it("status round-trips both ways: tracked -> dismissed", async () => {
    currentSql = makeMockSql(() => [entityRow({ status: "dismissed" })]).sql;
    const res = await PATCH(patchRequest({ status: "dismissed" }), { params: { id: "1" } });
    const body = await res.json();
    expect(body.status).toBe("dismissed");
  });

  it("status round-trips both ways: dismissed -> tracked", async () => {
    currentSql = makeMockSql(() => [entityRow({ status: "tracked" })]).sql;
    const res = await PATCH(patchRequest({ status: "tracked" }), { params: { id: "1" } });
    const body = await res.json();
    expect(body.status).toBe("tracked");
  });

  it("setting fame also sets fame_locked=true", async () => {
    const { sql, calls } = makeMockSql(() => [entityRow({ fame: "famous", fame_locked: true })]);
    currentSql = sql;
    const res = await PATCH(patchRequest({ fame: "famous" }), { params: { id: "1" } });
    const body = await res.json();
    expect(body.fame).toBe("famous");
    expect(body.fameLocked).toBe(true);
    expect(calls[0].values).toContain("famous");
    expect(calls[0].values).toContain(true);
  });

  it("{fameLocked: false} releases an override back to the sweep, without requiring fame", async () => {
    const { sql, calls } = makeMockSql(() => [entityRow({ fame: "famous", fame_locked: false })]);
    currentSql = sql;
    const res = await PATCH(patchRequest({ fameLocked: false }), { params: { id: "1" } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.fameLocked).toBe(false);
    expect(calls[0].values).toContain(false);
  });

  it("an explicit fameLocked wins even when fame is set in the same request", async () => {
    const { sql, calls } = makeMockSql(() => [entityRow({ fame: "famous", fame_locked: false })]);
    currentSql = sql;
    await PATCH(patchRequest({ fame: "famous", fameLocked: false }), { params: { id: "1" } });
    // fameLocked explicitly false must be the bound value, not the fame-implied true.
    expect(calls[0].values).toContain(false);
    expect(calls[0].values).not.toContain(true);
  });

  it("returns the updated row including its fame evidence fields", async () => {
    const { sql } = makeMockSql(() => [
      entityRow({ fame: "famous", fame_locked: true, wiki_title: "Russia", wiki_sitelinks: 200, wiki_pageviews_monthly: 500000, fame_checked_at: "2026-07-20T00:00:00Z" }),
    ]);
    currentSql = sql;
    const res = await PATCH(patchRequest({ fame: "famous" }), { params: { id: "1" } });
    const body = await res.json();
    expect(body).toEqual({
      id: 1, canonicalName: "Russia", type: "country", status: "tracked", aliases: [],
      fame: "famous", fameLocked: true, wikiTitle: "Russia", wikiSitelinks: 200,
      wikiPageviewsMonthly: 500000, fameCheckedAt: "2026-07-20T00:00:00.000Z",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
    });
  });
});
