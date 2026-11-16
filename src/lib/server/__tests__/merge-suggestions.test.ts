import { describe, it, expect } from "vitest";
import { assembleMergeSuggestions, computeReason, loadMergeSuggestions } from "../merge-suggestions";
import type { MergeEntity } from "../../soft-merge";
import type { Sql, SqlRow } from "../db";

function ent(id: string, name: string, extra: Partial<MergeEntity> = {}): MergeEntity {
  return { id, name, type: "org", aliases: [], wikiTitle: null, mentions: 0, ...extra };
}

function row(id: number, name: string, extra: SqlRow = {}): SqlRow {
  return { id, canonical_name: name, type: "org", status: "tracked", aliases: [], wiki_title: null, ...extra };
}

describe("computeReason", () => {
  it("alias", () => {
    expect(computeReason([ent("1", "Russia", { aliases: ["Russland"] }), ent("2", "Russland")])).toBe("alias");
  });
  it("wiki", () => {
    const a = ent("1", "USA", { wikiTitle: "United States" });
    const b = ent("2", "US", { wikiTitle: "United States" });
    expect(computeReason([a, b])).toBe("wiki");
  });
  it("alias+wiki, even across different pairs", () => {
    const members = [
      ent("1", "A", { aliases: ["B"] }),
      ent("2", "B"),
      ent("3", "C", { wikiTitle: "Z" }),
      ent("4", "D", { wikiTitle: "Z" }),
    ];
    expect(computeReason(members)).toBe("alias+wiki");
  });
});

describe("assembleMergeSuggestions", () => {
  const entities = [
    row(1, "Russia", { aliases: ["Russland"], wiki_title: "Russia" }),
    row(2, "Russland", { status: "candidate", wiki_title: "Russia" }),
    row(3, "Solo"),
  ];

  it("shapes groups with mentions, canonical first, and reason", () => {
    const mentions = [{ entity_id: 1, mentions: 9 }, { entity_id: 2, mentions: 3 }];
    const [group] = assembleMergeSuggestions(entities, mentions, 50);
    expect(group.canonical).toEqual({ id: "1", name: "Russia", type: "org", mentions14d: 9 });
    expect(group.members.map((m) => [m.id, m.mentions14d, m.status])).toEqual([
      ["1", 9, "tracked"],
      ["2", 3, "candidate"],
    ]);
    expect(group.reason).toBe("alias+wiki");
  });

  it("applies limit and treats missing counts as 0", () => {
    const more = [...entities, row(4, "Fed", { aliases: ["Federal Reserve"] }), row(5, "Federal Reserve")];
    expect(assembleMergeSuggestions(more, [], 50)).toHaveLength(2);
    expect(assembleMergeSuggestions(more, [], 1)).toHaveLength(1);
    expect(assembleMergeSuggestions(more, [], 50)[0].canonical.mentions14d).toBe(0);
  });

  it("does not suggest merges for names differing only by number", () => {
    const kings = [
      row(1, "King Charles II", { wiki_title: "Charles" }),
      row(2, "King Charles III", { wiki_title: "Charles" }),
    ];
    expect(assembleMergeSuggestions(kings, [], 50)).toEqual([]);
  });
});

describe("loadMergeSuggestions", () => {
  it("issues two read-only SELECTs with an ISO timestamp param", async () => {
    const queries: { text: string; values: unknown[] }[] = [];
    const sql = (async (s: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: s.join("?"), values });
      if (queries.length === 1) {
        return [row(1, "A", { aliases: ["B"] }), row(2, "B")];
      }
      return [{ entity_id: 2, mentions: 4 }];
    }) as Sql;
    const groups = await loadMergeSuggestions(sql, 10, new Date("2026-03-15T12:00:00Z"));
    expect(queries.every((q) => q.text.trimStart().startsWith("SELECT"))).toBe(true);
    expect(queries[0].text).toContain("<> 'dismissed'");
    expect(queries[1].values).toEqual(["2026-03-01T12:00:00.000Z"]);
    expect(groups[0].canonical.id).toBe("2");
  });
});
