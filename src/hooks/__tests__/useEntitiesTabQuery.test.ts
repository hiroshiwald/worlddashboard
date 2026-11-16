import { describe, it, expect } from "vitest";
import { buildListQuery } from "../useEntitiesTab";
import { parseMergeGroups } from "../useMergeSuggestions";

describe("buildListQuery", () => {
  it("always sends sort and omits status for All", () => {
    const q = new URLSearchParams(buildListQuery("", "all", "all", "all", false, "growth", 0, 50));
    expect(q.get("sort")).toBe("growth");
    expect(q.has("status")).toBe(false);
    expect(q.get("limit")).toBe("50");
  });

  it("sends status and the other sorts", () => {
    const q = new URLSearchParams(buildListQuery(" ru ", "dismissed", "all", "all", false, "diversity", 50, 100));
    expect(q.get("status")).toBe("dismissed");
    expect(q.get("sort")).toBe("diversity");
    expect(q.get("q")).toBe("ru");
    expect(q.get("offset")).toBe("50");
  });
});

const group = {
  canonical: { id: "1", name: "Russia", type: "country", mentions14d: 9 },
  members: [{ id: "2", name: "Russland", type: "country", mentions14d: 2, status: "tracked" }],
  reason: "alias",
};

describe("parseMergeGroups", () => {
  it("accepts a valid body, including no groups", () => {
    expect(parseMergeGroups({ groups: [group] })).toHaveLength(1);
    expect(parseMergeGroups({ groups: [] })).toEqual([]);
  });

  it("throws on a wrong shape", () => {
    expect(() => parseMergeGroups({})).toThrow();
    expect(() => parseMergeGroups(null)).toThrow();
    expect(() => parseMergeGroups({ groups: [{ ...group, reason: "other" }] })).toThrow();
  });
});
