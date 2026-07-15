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
    });
  });
});

describe("POST /api/candidates", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
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

  it("accept 409s when a concurrent request already promoted the same name", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
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

  it("dismiss 409s when a concurrent request already promoted the same name", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm, display_name, type_hint")) return [candidateRow];
      if (call.query.includes("INSERT INTO entities")) return [];
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
});
