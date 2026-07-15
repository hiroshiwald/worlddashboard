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
  it("returns all-zero counts for an empty candidate list without querying", async () => {
    const { sql, calls } = makeMockSql(() => []);
    const result = await persistSignals(sql, [], DEFAULTS);
    expect(result).toEqual({ created: 0, refreshed: 0, suppressed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("suppresses a candidate whose dedupe_key was dismissed within the cooldown window", async () => {
    const { sql, calls } = makeMockSql((call) => {
      if (call.query.includes("state = 'dismissed'")) return [{ dedupe_key: "surge:1" }];
      return [];
    });
    const result = await persistSignals(sql, [candidate], DEFAULTS);
    expect(result).toEqual({ created: 0, refreshed: 0, suppressed: 1 });
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
    expect(result).toEqual({ created: 1, refreshed: 0, suppressed: 0 });
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
    expect(result).toEqual({ created: 0, refreshed: 1, suppressed: 0 });
  });
});

describe("transitionSignal", () => {
  it("returns false for an unknown id", async () => {
    const { sql } = makeMockSql(() => []);
    expect(await transitionSignal(sql, 999, "seen")).toBe(false);
  });

  it("allows any active state to move to seen/dismissed/promoted", async () => {
    for (const from of ["new", "seen", "promoted"]) {
      for (const action of ["seen", "dismissed", "promoted"] as const) {
        const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT state") ? [{ state: from }] : []));
        const ok = await transitionSignal(sql, 1, action);
        expect(ok).toBe(true);
        const updateCall = calls.find((c) => c.query.includes("UPDATE signals"));
        expect(updateCall!.values[0]).toBe(action);
      }
    }
  });

  it("allows dismissed -> new via reopen", async () => {
    const { sql, calls } = makeMockSql((call) => (call.query.includes("SELECT state") ? [{ state: "dismissed" }] : []));
    const ok = await transitionSignal(sql, 1, "reopen");
    expect(ok).toBe(true);
    const updateCall = calls.find((c) => c.query.includes("UPDATE signals"));
    expect(updateCall!.values[0]).toBe("new");
  });

  it("rejects reopen on a non-dismissed signal", async () => {
    const { sql } = makeMockSql((call) => (call.query.includes("SELECT state") ? [{ state: "new" }] : []));
    expect(await transitionSignal(sql, 1, "reopen")).toBe(false);
  });

  it("rejects seen/dismissed/promoted actions on an already-dismissed signal", async () => {
    for (const action of ["seen", "dismissed", "promoted"] as const) {
      const { sql } = makeMockSql((call) => (call.query.includes("SELECT state") ? [{ state: "dismissed" }] : []));
      expect(await transitionSignal(sql, 1, action)).toBe(false);
    }
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
        title: "Cross-category: Testland", entity_ids: [1], entity_names: ["Testland"],
        confidence: 0.6, evidence: { categoryCount: 3 },
        first_detected_at: "2026-07-15T00:00:00Z", last_evidence_at: "2026-07-15T01:00:00Z", state_changed_at: null,
      },
    ]);
    const [signal] = await loadSignals(sql, ["new"]);
    expect(signal.articles).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
