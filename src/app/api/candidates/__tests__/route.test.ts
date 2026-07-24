import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/candidates", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const { GET, POST } = await import("../route");

describe("GET /api/candidates", () => {
  const originalDbUrl = process.env.DATABASE_URL;
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
  });
  afterEach(() => {
    process.env.DATABASE_URL = originalDbUrl;
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("filters on distinct-source, distinct-day, and 14-day recency thresholds", async () => {
    const { sql, calls } = makeMockSql(() => []);
    currentSql = sql;
    await GET();

    expect(calls[0].query).toContain("array_length(source_names, 1) >= 3");
    expect(calls[0].query).toContain("day_count >= 2");
    expect(calls[0].query).toContain("14 days");
    expect(calls[0].query).toContain("ORDER BY array_length(source_names, 1) DESC");
  });

  it("shapes rows into camelCase candidate JSON with a derived sourceCount", async () => {
    const { sql } = makeMockSql(() => [
      {
        name_norm: "kestrel basin",
        display_name: "Kestrel Basin",
        type_hint: "region",
        first_seen_at: "2026-07-01T00:00:00Z",
        last_seen_at: "2026-07-10T00:00:00Z",
        mention_count: 12,
        source_names: ["A", "B", "C"],
        day_count: 3,
        sample_titles: ["Title 1"],
        contexts: ["former IRGC commander"],
        co_entities: ["Iran"],
      },
    ]);
    currentSql = sql;
    const res = await GET();
    const body = await res.json();

    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      nameNorm: "kestrel basin",
      displayName: "Kestrel Basin",
      typeHint: "region",
      mentionCount: 12,
      sourceCount: 3,
      dayCount: 3,
      sampleTitles: ["Title 1"],
      contexts: ["former IRGC commander"],
      coEntities: ["Iran"],
    });
  });

  it("defaults contexts/coEntities to empty arrays when the columns are absent", async () => {
    const { sql } = makeMockSql(() => [
      {
        name_norm: "kestrel basin", display_name: "Kestrel Basin", type_hint: "region",
        first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-10T00:00:00Z",
        mention_count: 1, source_names: ["A"], day_count: 1, sample_titles: [],
      },
    ]);
    currentSql = sql;
    const res = await GET();
    const body = await res.json();
    expect(body.candidates[0].contexts).toEqual([]);
    expect(body.candidates[0].coEntities).toEqual([]);
  });
});

// A clean "no Wikidata match" response — the safe default for every accept
// test below that isn't specifically about the inline fame check itself.
// This sandbox has no internet egress, so without a stub every accept path
// would otherwise attempt (and fail) a real network call — see the
// dedicated "inline fame check" tests for stubs that exercise the fame
// write itself.
function noMatchFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ search: [] }) });
}

describe("POST /api/candidates", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
    vi.stubGlobal("fetch", noMatchFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("400s on an unknown action", async () => {
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "delete" }));
    expect(res.status).toBe(400);
  });

  it("400s on an empty nameNorm", async () => {
    const res = await POST(postRequest({ nameNorm: "", action: "dismiss" }));
    expect(res.status).toBe(400);
  });

  it("400s accept without a type", async () => {
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept" }));
    expect(res.status).toBe(400);
  });

  it("400s accept with an invalid type", async () => {
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "planet" }));
    expect(res.status).toBe(400);
  });

  it("accepts a new-ontology type (e.g. government_body) rejected by the old 5-type whitelist", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) {
        return [{
          name_norm: "kestrel basin", display_name: "Kestrel Basin", type_hint: "government_body",
          first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-10T00:00:00Z",
        }];
      }
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "government_body" }));
    expect(res.status).toBe(200);
  });

  it("400s merge without mergeInto", async () => {
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "merge" }));
    expect(res.status).toBe(400);
  });

  it("404s when the candidate doesn't exist", async () => {
    const { sql } = makeMockSql(() => []);
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "missing", action: "dismiss" }));
    expect(res.status).toBe(404);
  });

  const candidateRow = {
    name_norm: "kestrel basin", display_name: "Kestrel Basin", type_hint: "region",
    first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-10T00:00:00Z",
  };

  it("accept inserts a tracked entity using last_seen_at (not first_seen_at) and deletes the candidate", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

    expect(res.status).toBe(200);
    const insertCall = calls.find((c) => c.query.includes("INSERT INTO entities"));
    expect(insertCall!.query).toContain("'tracked'");
    expect(insertCall!.query).toContain("ON CONFLICT (canonical_name) DO NOTHING");
    expect(insertCall!.values).toEqual(["Kestrel Basin", "region", "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z"]);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(true);
  });

  it("accept race: a candidate resurrected by a concurrent ingest resolves as success and is deleted, not stranded on 409", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) return [{ id: "42" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

    expect(res.status).toBe(200);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(true);
  });

  it("accept 409s only when the conflicting entity genuinely doesn't exist", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) return [];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

    expect(res.status).toBe(409);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(false);
  });

  it("dismiss inserts a dismissed entity using the candidate's type_hint and last_seen_at", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "dismiss" }));

    expect(res.status).toBe(200);
    const insertCall = calls.find((c) => c.query.includes("INSERT INTO entities"));
    expect(insertCall!.query).toContain("'dismissed'");
    expect(insertCall!.values).toEqual(["Kestrel Basin", "region", "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z"]);
  });

  it("dismiss race: a candidate resurrected by a concurrent ingest resolves as success, not stranded on 409", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) return [{ id: "42" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "dismiss" }));

    expect(res.status).toBe(200);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(true);
  });

  it("dismiss 409s only when the conflicting entity genuinely doesn't exist", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
      if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) return [];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "dismiss" }));
    expect(res.status).toBe(409);
  });

  it("merge appends norm and display to the target entity's aliases and deletes the candidate", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) {
        return [{ name_norm: "kestrel basin", display_name: "Kestrel Basin", type_hint: "region", first_seen_at: "2026-07-01T00:00:00Z" }];
      }
      if (call.query.includes("UPDATE entities")) {
        return [{ id: "7" }];
      }
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "merge", mergeInto: "Kestrel Region" }));

    expect(res.status).toBe(200);
    const updateCall = calls.find((c) => c.query.includes("UPDATE entities"));
    expect(updateCall!.values).toEqual(["kestrel basin", "Kestrel Basin", "Kestrel Region"]);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(true);
  });

  it("merge 404s when mergeInto names no existing entity", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) {
        return [{ name_norm: "kestrel basin", display_name: "Kestrel Basin", type_hint: "region", first_seen_at: "2026-07-01T00:00:00Z" }];
      }
      if (call.query.includes("UPDATE entities")) return [];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "merge", mergeInto: "Nonexistent" }));

    expect(res.status).toBe(404);
    expect(calls.some((c) => c.query.includes("DELETE FROM entity_candidates"))).toBe(false);
  });

  describe("inline fame check after accept", () => {
    it("runs the same lookup+write as the sweep, keeping the response contract unchanged", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ search: [] }) }),
      );
      const { sql, calls } = makeMockSql((call) => {
        if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
        if (call.query.includes("INSERT INTO entities")) return [{ id: "55" }];
        return [];
      });
      currentSql = sql;

      const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true }); // response contract unchanged
      const fameUpdate = calls.find((c) => c.query.includes("UPDATE entities") && c.query.includes("fame ="));
      expect(fameUpdate).toBeDefined();
      expect(fameUpdate!.values).toContain("not_famous"); // no Wikidata match -> not_famous, not left unknown
      expect(fameUpdate!.values).toContain(55);
    });

    it("a failed inline lookup still 200s the accept, writing only fame_checked_at (fame stays unknown)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const { sql, calls } = makeMockSql((call) => {
        if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
        if (call.query.includes("INSERT INTO entities")) return [{ id: "56" }];
        return [];
      });
      currentSql = sql;

      const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const fameUpdate = calls.find((c) => c.query.includes("UPDATE entities"));
      expect(fameUpdate!.query).not.toContain("fame =");
      expect(fameUpdate!.query).toContain("fame_checked_at = now()");
      consoleError.mockRestore();
    });

    it("on a conflict-resolved accept, preserves the pre-existing entity's real aliases instead of wiping them", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ search: [] }) }),
      );
      const { sql, calls } = makeMockSql((call) => {
        if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
        if (call.query.includes("INSERT INTO entities")) return []; // ON CONFLICT DO NOTHING: already exists
        if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) {
          return [{ id: "42", aliases: ["Existing Alias"] }];
        }
        return [];
      });
      currentSql = sql;

      const res = await POST(postRequest({ nameNorm: "kestrel basin", action: "accept", type: "region" }));

      expect(res.status).toBe(200);
      const fameUpdate = calls.find((c) => c.query.includes("UPDATE entities") && c.query.includes("fame ="));
      const aliases = fameUpdate!.values.find((v) => Array.isArray(v)) as string[];
      expect(aliases).toContain("Existing Alias");
    });
  });
});
