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
  return new NextRequest("http://localhost/api/candidates/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function noMatchFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ search: [] }) });
}

const { POST } = await import("../route");

describe("POST /api/candidates/bulk", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://fake";
    vi.stubGlobal("fetch", noMatchFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await POST(postRequest({ action: "dismiss", items: [{ nameNorm: "a" }] }));
    expect(res.status).toBe(503);
  });

  it("400s on invalid JSON", async () => {
    const res = await POST(new NextRequest("http://localhost/api/candidates/bulk", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("400s on a non-object body", async () => {
    const res = await POST(postRequest("hello"));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid action", async () => {
    const res = await POST(postRequest({ action: "merge", items: [{ nameNorm: "a" }] }));
    expect(res.status).toBe(400);
  });

  it("400s when items is not an array", async () => {
    const res = await POST(postRequest({ action: "dismiss", items: "a" }));
    expect(res.status).toBe(400);
  });

  it("400s when items is empty", async () => {
    const res = await POST(postRequest({ action: "dismiss", items: [] }));
    expect(res.status).toBe(400);
  });

  it("400s when items exceeds the 100-item cap", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ nameNorm: `item ${i}` }));
    const res = await POST(postRequest({ action: "dismiss", items }));
    expect(res.status).toBe(400);
  });

  it("accepts exactly 100 items without rejecting on the cap boundary", async () => {
    const { sql } = makeMockSql(() => []); // every candidate lookup misses -> per-item "not found", still 200 overall
    currentSql = sql;
    const items = Array.from({ length: 100 }, (_, i) => ({ nameNorm: `item ${i}` }));
    const res = await POST(postRequest({ action: "dismiss", items }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(100);
  });

  const candidateRow = (nameNorm: string) => ({
    name_norm: nameNorm, display_name: `Display ${nameNorm}`, type_hint: "region",
    first_seen_at: "2026-07-01T00:00:00Z", last_seen_at: "2026-07-10T00:00:00Z",
  });

  it("reports a per-item 'not found' for a missing candidate, still 200 overall", async () => {
    const { sql } = makeMockSql(() => []);
    currentSql = sql;
    const res = await POST(postRequest({ action: "dismiss", items: [{ nameNorm: "missing" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ nameNorm: "missing", ok: false, error: "Candidate not found" }]);
  });

  it("reports a per-item error when accept is missing a required type", async () => {
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT name_norm") ? [candidateRow("kestrel basin")] : []));
    currentSql = sql;
    const res = await POST(postRequest({ action: "accept", items: [{ nameNorm: "kestrel basin" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ nameNorm: "kestrel basin", ok: false, error: "type is required for accept" });
  });

  it("reports a per-item error on an invalid accept type", async () => {
    const res = await POST(postRequest({ action: "accept", items: [{ nameNorm: "kestrel basin", type: "planet" }] }));
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
  });

  it("accepts a valid item end to end (inline fame check included)", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm")) return [candidateRow("kestrel basin")];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ action: "accept", items: [{ nameNorm: "kestrel basin", type: "region" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ nameNorm: "kestrel basin", ok: true }]);
    expect(calls.some((c) => c.query.includes("UPDATE entities") && c.query.includes("fame ="))).toBe(true);
  });

  it("dismisses a valid item", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm")) return [candidateRow("kestrel basin")];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ action: "dismiss", items: [{ nameNorm: "kestrel basin" }] }));
    const body = await res.json();
    expect(body.results).toEqual([{ nameNorm: "kestrel basin", ok: true }]);
  });

  it("reports a naming-conflict item error when the conflicting entity doesn't exist", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm")) return [candidateRow("kestrel basin")];
      if (call.query.includes("INSERT INTO entities")) return []; // ON CONFLICT DO NOTHING
      if (call.query.includes("SELECT id, aliases FROM entities WHERE canonical_name")) return []; // genuinely missing
      return [];
    });
    currentSql = sql;
    const res = await POST(postRequest({ action: "dismiss", items: [{ nameNorm: "kestrel basin" }] }));
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/naming conflict/i);
  });

  it("surfaces partial failure: one item succeeds, one is not found, in the same response", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("SELECT name_norm") && call.values.includes("known basin")) return [candidateRow("known basin")];
      if (call.query.includes("SELECT name_norm")) return [];
      if (call.query.includes("INSERT INTO entities")) return [{ id: "1" }];
      return [];
    });
    currentSql = sql;
    const res = await POST(
      postRequest({
        action: "dismiss",
        items: [{ nameNorm: "known basin" }, { nameNorm: "unknown basin" }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { nameNorm: "known basin", ok: true },
      { nameNorm: "unknown basin", ok: false, error: "Candidate not found" },
    ]);
  });

  it("400s on a malformed item (missing nameNorm entirely)", async () => {
    const res = await POST(postRequest({ action: "dismiss", items: [{ type: "region" }] }));
    expect(res.status).toBe(400);
  });
});
