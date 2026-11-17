import { describe, it, expect, vi } from "vitest";
import type { Sql, SqlRow } from "../db";
import type { EntityRole } from "../entity-admin";
import { ValidationError } from "../entity-admin";
import { assembleEmerging, loadEmerging, parseDays, rankAnchors, sortAndCap } from "../emerging";
import type { EmergingItem } from "../../emerging-types";

vi.mock("../graph", () => ({
  loadRoleMap: async (_sql: Sql, rows: SqlRow[]) =>
    new Map(rows.map((r) => [String(r.id), (r.id === 1 ? "famous" : "satellite") as EntityRole])),
}));

const NOW = new Date("2026-11-17T12:00:00Z");

function anchorRow(id: number, name: string, extra: SqlRow): SqlRow {
  return { id, canonical_name: name, type: "person", aliases: [], fame: "unknown", ...extra };
}

describe("parseDays", () => {
  it("defaults to 7 and accepts 1..30", () => {
    expect(parseDays(null)).toBe(7);
    expect(parseDays("1")).toBe(1);
    expect(parseDays("30")).toBe(30);
  });
  it.each(["0", "31", "-1", "2.5", "abc", ""])("rejects %j", (raw) => {
    expect(() => parseDays(raw)).toThrow(ValidationError);
  });
});

describe("rankAnchors", () => {
  const roles = new Map<string, EntityRole>([["1", "famous"], ["2", "anchor"], ["3", "satellite"], ["4", "famous"], ["5", "famous"]]);
  const link = (anchorId: string, articleId: string, anchorType = "organization") => ({ subject: "s", articleId, anchorId, anchorName: `A${anchorId}`, anchorType });

  it("counts distinct articles, drops satellites, keeps top 3 desc", () => {
    const out = rankAnchors(
      [link("1", "a"), link("1", "a"), link("1", "b"), link("2", "a"), link("3", "a"), link("4", "a"), link("5", "a"), link("5", "b"), link("5", "c")],
      roles,
    ).get("s");
    expect(out?.map((a) => [a.id, a.articleCount])).toEqual([["5", 3], ["1", 2], ["2", 1]]);
  });

  it("ranks people and companies before other types, and places last", () => {
    const out = rankAnchors(
      [link("1", "a", "country"), link("1", "b", "country"), link("1", "c", "country"), link("2", "a", "company"), link("4", "a", "government_body")],
      roles,
    ).get("s");
    expect(out?.map((a) => a.id)).toEqual(["2", "4", "1"]);
  });
});

describe("assembleEmerging name hygiene", () => {
  it("drops names with HTML codes and trims a trailing dash", () => {
    const cand = (name_norm: string, display_name: string) => ({
      name_norm, display_name, type_hint: "person", first_seen_at: "2026-11-16T00:00:00Z", mention_count: 1, sample_titles: [], contexts: [],
    });
    const res = assembleEmerging(
      { candidateRows: [cand("a", "James Bond&nbsp;&nbsp;BILD"), cand("b", "Daniel Craig -")], candidateLinkRows: [], entityRows: [], entityLinkRows: [], titleLinkRows: [] },
      new Map(), 7, new Date("2026-11-17T00:00:00Z"),
    );
    expect(res.items.map((i) => i.name)).toEqual(["Daniel Craig"]);
  });
});

describe("sortAndCap", () => {
  const item = (key: string, anchors: number, firstSeenAt: string, mentions: number, anchorType = "organization"): EmergingItem => ({
    key, kind: "entity", name: key, type: "other", firstSeenAt, mentions, sampleTitles: [], links: [], context: null,
    anchors: Array.from({ length: anchors }, (_, i) => ({ id: String(i), name: "x", type: anchorType, articleCount: 1 })),
  });

  it("orders anchored, then newest, then mentions", () => {
    const out = sortAndCap([
      item("old", 0, "2026-11-16T00:00:00Z", 9),
      item("new-none", 0, "2026-11-17T00:00:00Z", 1),
      item("anch-old", 1, "2026-11-10T00:00:00Z", 1),
      item("anch-few", 1, "2026-11-12T00:00:00Z", 1),
      item("anch-many", 1, "2026-11-12T00:00:00Z", 5),
    ]);
    expect(out.map((i) => i.key)).toEqual(["anch-many", "anch-few", "anch-old", "new-none", "old"]);
  });

  it("puts items near people and companies before items near places", () => {
    const out = sortAndCap([
      item("near-country", 1, "2026-11-17T00:00:00Z", 9, "country"),
      item("near-person", 1, "2026-11-10T00:00:00Z", 1, "person"),
    ]);
    expect(out.map((i) => i.key)).toEqual(["near-person", "near-country"]);
  });

  it("caps at 200", () => {
    const many = Array.from({ length: 250 }, (_, i) => item(`k${i}`, 0, "2026-11-17T00:00:00Z", i));
    expect(sortAndCap(many)).toHaveLength(200);
  });
});

describe("assembleEmerging", () => {
  it("links candidates by exact title and skips famous entities as items", () => {
    const res = assembleEmerging(
      {
        candidateRows: [{
          name_norm: "newco", display_name: "NewCo", type_hint: "organization",
          first_seen_at: "2026-11-16T00:00:00Z", mention_count: 4, sample_titles: ["NewCo meets Altman", "Other"],
          contexts: ["A drone maker.", "second"],
        }],
        candidateLinkRows: [anchorRow(1, "Sam Altman", { emg_link_title: "NewCo meets Altman", emg_link_article: 10 })],
        entityRows: [
          { id: 1, canonical_name: "Sam Altman", type: "person", first_seen_at: "2026-11-16T00:00:00Z", emg_mentions: 50, emg_titles: [] },
          { id: 7, canonical_name: "Jane Doe", type: "person", first_seen_at: "2026-11-15T00:00:00Z", emg_mentions: 2, emg_titles: ["t"], emg_links: ["https://x/t"] },
        ],
        entityLinkRows: [anchorRow(1, "Sam Altman", { emg_ent_id: 7, emg_link_article: 11 })],
        titleLinkRows: [{ emg_url_title: "NewCo meets Altman", emg_url: "https://x/newco" }],
      },
      new Map<string, EntityRole>([["1", "famous"], ["7", "satellite"]]),
      7,
      NOW,
    );
    expect(res.items.map((i) => i.key)).toEqual(["cand:newco", "7"]);
    expect(res.items[0].anchors).toEqual([{ id: "1", name: "Sam Altman", type: "person", articleCount: 1 }]);
    expect(res.items[1].anchors[0].name).toBe("Sam Altman");
    expect(res.days).toBe(7);
    expect(res.items[0].context).toBe("A drone maker.");
    expect(res.items[0].links).toEqual(["https://x/newco", ""]);
    expect(res.items[1]).toMatchObject({ context: null, links: ["https://x/t"] });
  });
});

describe("loadEmerging", () => {
  it("routes queries and assembles", async () => {
    const sql: Sql = async (strings) => {
      const text = strings.join("?");
      if (text.includes("FROM entity_candidates")) {
        return [{ name_norm: "newco", display_name: "NewCo", type_hint: "organization", first_seen_at: NOW, mention_count: 3, sample_titles: ["T1"], contexts: [] }];
      }
      if (text.includes("emg_url_title")) return [{ emg_url_title: "T1", emg_url: "https://x/t1" }];
      if (text.includes("emg_link_title")) return [anchorRow(1, "Sam Altman", { emg_link_title: "T1", emg_link_article: 5 })];
      if (text.includes("AS emg_mentions")) return [];
      return [];
    };
    const res = await loadEmerging(sql, 7, NOW);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].anchors[0].id).toBe("1");
    expect(res.items[0]).toMatchObject({ links: ["https://x/t1"], context: null });
  });
});
