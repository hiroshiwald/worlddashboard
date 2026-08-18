import { describe, it, expect } from "vitest";
import { persistSignals, transitionSignal, loadSignals } from "../signal-store";
import { DEFAULTS } from "../settings";
import type { CandidateSignal } from "../detectors";
import type { Sql, SqlRow } from "../db";

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

const candidate: CandidateSignal = {
  dedupeKey: "surge:1",
  type: "surge",
  severity: "critical",
  confidence: 0.9,
  title: "Surge: Testland",
  entityIds: [1],
  evidence: { observed24h: 10 },
};

describe("persistSignals", () => {
  it("returns all-zero counts for an empty candidate list (still runs the purge pass every call)", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const result = await persistSignals(sql, [], DEFAULTS);
    expect(result).toEqual({ created: 0, refreshed: 0, suppressed: 0, purged: 0, expired: 0 });
    // No candidate upsert queries — but purgeFamousSignals still queries the
    // existing 'new' pile (finds none here), matching Change 2's "every run".
    expect(calls.some((c) => c.query.includes("INSERT INTO signals"))).toBe(false);
    expect(calls.some((c) => c.query.includes("SELECT id, type, entity_ids"))).toBe(true);
  });

  it("passes the expiredCount parameter straight through into the result (no recomputation)", async () => {
    const { sql } = makeMockSql(() => []);
    const result = await persistSignals(sql, [], DEFAULTS, 7);
    expect(result.expired).toBe(7);
  });

  it("suppresses a candidate whose dedupe_key was dismissed within the cooldown window", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("state = 'dismissed'")) return [{ dedupe_key: "surge:1" }];
      return [];
    });
    const result = await persistSignals(sql, [candidate], DEFAULTS);
    expect(result).toEqual({ created: 0, refreshed: 0, suppressed: 1, purged: 0, expired: 0 });
    expect(calls.some((c) => c.query.includes("INSERT INTO signals"))).toBe(false);
  });

  it("uses settings.dismiss_cooldown_hours in the cooldown query", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await persistSignals(sql, [candidate], { ...DEFAULTS, dismiss_cooldown_hours: 48 });
    const cooldownCall = calls.find((c) => c.query.includes("state = 'dismissed'"));
    expect(cooldownCall!.values).toContain(48);
  });

  it("counts a brand-new dedupe_key as created", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const result = await persistSignals(sql, [candidate], DEFAULTS);
    expect(result).toEqual({ created: 1, refreshed: 0, suppressed: 0, purged: 0, expired: 0 });
    const insertCall = calls.find((c) => c.query.includes("INSERT INTO signals"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.query).toContain("ON CONFLICT (dedupe_key) WHERE state IN ('new', 'seen', 'promoted')");
  });

  it("counts an already-active dedupe_key as refreshed, not created", async () => {
    const { sql } = makeMockSql((call) => {
      if (call.query.includes("state = ANY(") && !call.query.includes("make_interval")) {
        return [{ dedupe_key: "surge:1" }];
      }
      return [];
    });
    const result = await persistSignals(sql, [candidate], DEFAULTS);
    expect(result).toEqual({ created: 0, refreshed: 1, suppressed: 0, purged: 0, expired: 0 });
  });
});

describe("purgeFamousSignals (via persistSignals)", () => {
  // Entities: 1=famous single-entity subject, 2=non-famous subject,
  // 10/11=famous-famous edge endpoints, 20/21=one-famous edge endpoints.
  function makeEntityRow(id: number, fame: string) {
    return { id, canonical_name: `Entity${id}`, aliases: [], fame };
  }

  function routePurgeQueries(
    signalsNewRows: SqlRow[],
    entityRows: SqlRow[],
    breadthRows: SqlRow[] = [],
    aggRows: SqlRow[] = [],
    epochRows: SqlRow[] = [{ min_first_seen: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }],
  ) {
    return (call: RecordedCall): SqlRow[] => {
      if (call.query.includes("SELECT id, type, entity_ids")) return signalsNewRows;
      if (call.query.includes("canonical_name, aliases, fame")) return entityRows;
      if (call.query.includes("source_breadth")) return breadthRows;
      if (call.query.includes("MIN(first_seen_at)") && call.query.includes("FROM articles")) return epochRows;
      if (call.query.includes("FROM entity_mentions_hourly")) return aggRows;
      if (call.query.includes("DELETE FROM signals") && call.query.includes("id = ANY(")) return [];
      return [];
    };
  }

  it("deletes a 'new' surge row whose subject is famous, keeps a non-famous one", async () => {
    const { sql, calls } = makeMockSql(
      routePurgeQueries(
        [
          { id: 1, type: "surge", entity_ids: [1] },
          { id: 2, type: "surge", entity_ids: [2] },
        ],
        [makeEntityRow(1, "famous"), makeEntityRow(2, "not_famous")],
      ),
    );

    const result = await persistSignals(sql, [], DEFAULTS);
    expect(result.purged).toBe(1);

    const deleteCall = calls.find((c) => c.query.includes("DELETE FROM signals") && c.query.includes("id = ANY("));
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.values[0]).toEqual([1]);
    expect(deleteCall!.query).toContain("state = 'new'");
  });

  it("deletes a famous-famous novel_edge row, keeps a one-famous edge row", async () => {
    const { sql } = makeMockSql(
      routePurgeQueries(
        [
          { id: 10, type: "novel_edge", entity_ids: [10, 11] },
          { id: 20, type: "novel_edge", entity_ids: [20, 21] },
        ],
        [
          makeEntityRow(10, "famous"),
          makeEntityRow(11, "famous"),
          makeEntityRow(20, "famous"),
          makeEntityRow(21, "not_famous"),
        ],
      ),
    );

    const result = await persistSignals(sql, [], DEFAULTS);
    expect(result.purged).toBe(1);
  });

  it("never touches 'seen'/'promoted'/'dismissed' rows — only queries state='new'", async () => {
    const { sql, calls } = makeMockSql(routePurgeQueries([], []));
    await persistSignals(sql, [], DEFAULTS);
    const selectCall = calls.find((c) => c.query.includes("SELECT id, type, entity_ids"));
    expect(selectCall!.query).toContain("state = 'new'");
  });

  it("keeps non-famous rows of every type, and issues no DELETE when nothing violates the gate", async () => {
    const { sql, calls } = makeMockSql(
      routePurgeQueries(
        [{ id: 1, type: "sentiment", entity_ids: [1] }],
        [makeEntityRow(1, "not_famous")],
      ),
    );
    const result = await persistSignals(sql, [], DEFAULTS);
    expect(result.purged).toBe(0);
    expect(calls.some((c) => c.query.includes("DELETE FROM signals") && c.query.includes("id = ANY("))).toBe(false);
  });
});

describe("transitionSignal", () => {
  // transitionSignal is a single conditional UPDATE (state doubles as the
  // WHERE guard) rather than a separate SELECT-then-UPDATE — a mocked sql
  // client has no real row to guard against, so each test just tells the
  // mock whether the (id, state-guard) pair "matches" by returning a row
  // from RETURNING or not, exactly like a real UPDATE would.

  it("returns false when the guarded UPDATE matches no row (unknown id or wrong current state)", async () => {
    const { sql } = makeMockSql(() => []);
    expect(await transitionSignal(sql, 999, "seen")).toBe(false);
  });

  it("returns false for an action outside the allowed set without querying", async () => {
    const { sql, calls } = makeMockSql(() => [{ id: 1 }]);
    expect(await transitionSignal(sql, 1, "bogus" as never)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("seen/dismissed/promoted guard on the active-states set and return true when a row matches", async () => {
    for (const action of ["seen", "dismissed", "promoted"] as const) {
      const { sql, calls } = makeMockSql(() => [{ id: 1 }]);
      const ok = await transitionSignal(sql, 1, action);
      expect(ok).toBe(true);
      expect(calls[0].query).toContain("state = ANY(");
      expect(calls[0].values).toEqual([action, 1, ["new", "seen", "promoted"]]);
    }
  });

  it("reopen guards on state = 'dismissed' and sets state to 'new'", async () => {
    const { sql, calls } = makeMockSql(() => [{ id: 1 }]);
    const ok = await transitionSignal(sql, 1, "reopen");
    expect(ok).toBe(true);
    expect(calls[0].query).toContain("state = 'dismissed'");
    expect(calls[0].values).toEqual([1]);
  });
});

describe("loadSignals", () => {
  it("orders by severity then last_evidence_at desc and resolves entity names via a single LATERAL join", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await loadSignals(sql, ["new", "seen", "promoted"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("LEFT JOIN LATERAL");
    expect(calls[0].query).toContain("ORDER BY CASE s.severity");
  });

  it("passes a limit through to the query", async () => {
    const { sql, calls } = makeMockSql(() => []);
    await loadSignals(sql, ["new"], 5);
    expect(calls[0].values).toContain(5);
  });

  it("parses rows into camelCase JSON with resolved entity names", async () => {
    const { sql } = makeMockSql(() => [
      {
        id: "1", dedupe_key: "surge:1", type: "surge", severity: "critical", state: "new",
        title: "Surge: Testland", entity_ids: [1], entity_names: ["Testland"],
        confidence: 0.9, evidence: { observed24h: 10 },
        first_detected_at: "2026-07-15T00:00:00Z", last_evidence_at: "2026-07-15T01:00:00Z", state_changed_at: null,
      },
    ]);
    const [signal] = await loadSignals(sql, ["new"]);
    expect(signal).toMatchObject({
      id: 1, dedupeKey: "surge:1", entityIds: [1], entityNames: ["Testland"], confidence: 0.9,
    });
  });

  it("resolves evidence.articleIds to article refs via one batched query", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("FROM signals s")) {
        return [
          {
            id: "1", dedupe_key: "surge:1", type: "surge", severity: "critical", state: "new",
            title: "Surge: Testland", entity_ids: [1], entity_names: ["Testland"],
            confidence: 0.9, evidence: { observed24h: 10, articleIds: [5, 6] },
            first_detected_at: "2026-07-15T00:00:00Z", last_evidence_at: "2026-07-15T01:00:00Z", state_changed_at: null,
          },
        ];
      }
      if (call.query.includes("FROM articles")) {
        return [{ id: "5", title: "Article Five", link: "https://x.example.com/5", source_name: "Source X" }];
      }
      return [];
    });
    const [signal] = await loadSignals(sql, ["new"]);
    expect(signal.articles).toEqual([{ id: 5, title: "Article Five", link: "https://x.example.com/5", sourceName: "Source X" }]);
    expect(calls.some((c) => c.query.includes("FROM articles WHERE id = ANY"))).toBe(true);
  });

  it("skips the article query entirely when no signal has evidence.articleIds", async () => {
    const { sql, calls } = makeMockSql(() => [
      {
        id: "1", dedupe_key: "cross_category:1", type: "cross_category", severity: "advisory", state: "new",
        title: "Category spread: Testland", entity_ids: [1], entity_names: ["Testland"],
        confidence: 0.6, evidence: { categoryCount24h: 3 },
        first_detected_at: "2026-07-15T00:00:00Z", last_evidence_at: "2026-07-15T01:00:00Z", state_changed_at: null,
      },
    ]);
    const [signal] = await loadSignals(sql, ["new"]);
    expect(signal.articles).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
