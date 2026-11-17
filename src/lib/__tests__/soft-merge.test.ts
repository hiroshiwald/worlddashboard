import { describe, it, expect } from "vitest";
import {
  buildMergeGroups,
  namesDifferOnlyByNumber,
  type MergeEntity,
} from "../soft-merge";

function makeEntity(overrides: Partial<MergeEntity> & { id: string }): MergeEntity {
  return {
    name: "Untitled",
    type: "country",
    aliases: [],
    wikiTitle: null,
    mentions: 1,
    ...overrides,
  };
}

describe("buildMergeGroups country folding", () => {
  const group = (names: string[]) =>
    buildMergeGroups(names.map((name, i) => makeEntity({ id: `e${i}`, name, type: "org" })));

  it("groups U.S. Navy, US Navy and United States Navy", () => {
    const groups = group(["U.S. Navy", "US Navy", "United States Navy"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toHaveLength(3);
  });

  it("groups US Steel with United States Steel", () => {
    expect(group(["US Steel", "United States Steel"])).toHaveLength(1);
  });

  it("groups US/USA/U.S. with United States", () => {
    expect(group(["US", "USA", "U.S.", "United States"])[0].memberIds).toHaveLength(4);
  });

  it("does not group USA Today with United States", () => {
    expect(group(["USA Today", "United States"])).toEqual([]);
  });

  it("leaves Usher unchanged", () => {
    expect(group(["Usher", "United States her"])).toEqual([]);
  });

  it("groups UK variants", () => {
    expect(group(["UK Parliament", "United Kingdom Parliament"])).toHaveLength(1);
    expect(group(["UK", "United Kingdom"])).toHaveLength(1);
  });

  it("does not use the fold for Wikipedia titles", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "a", name: "A", wikiTitle: "US Navy" }),
      makeEntity({ id: "b", name: "B", wikiTitle: "United States Navy" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("still separates names differing only by number", () => {
    expect(group(["US Fleet 2", "United States Fleet 3"])).toEqual([]);
  });
});

describe("buildMergeGroups", () => {
  it("returns no groups for empty input", () => {
    expect(buildMergeGroups([])).toEqual([]);
  });

  it("returns no groups for a single entity", () => {
    const groups = buildMergeGroups([makeEntity({ id: "a", name: "Russia" })]);
    expect(groups).toEqual([]);
  });

  it("merges Russia (alias Russland) with Russland", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "r1", name: "Russia", aliases: ["Russland"], mentions: 10 }),
      makeEntity({ id: "r2", name: "Russland", mentions: 3 }),
    ]);
    expect(groups).toEqual([
      { canonicalId: "r1", memberIds: ["r1", "r2"], otherNames: ["Russland"] },
    ]);
  });

  it("merges U.S. and US through alias normalization", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "us1", name: "US", aliases: ["U.S."], mentions: 5 }),
      makeEntity({ id: "us2", name: "U.S.", mentions: 2 }),
    ]);
    expect(groups).toEqual([
      { canonicalId: "us1", memberIds: ["us1", "us2"], otherNames: ["U.S."] },
    ]);
  });

  it("merges entities of the same type with the same non-empty wikiTitle", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "b", name: "Ukraine Govt", wikiTitle: "Ukraine", mentions: 1 }),
      makeEntity({ id: "a", name: "Kyiv Govt", wikiTitle: "Ukraine", mentions: 1 }),
    ]);
    expect(groups).toEqual([
      { canonicalId: "a", memberIds: ["a", "b"], otherNames: ["Ukraine Govt"] },
    ]);
  });

  it("does not merge across types even with a shared wikiTitle", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "country", name: "Mercury", type: "country", wikiTitle: "Mercury" }),
      makeEntity({ id: "org", name: "Mercury Inc", type: "organization", wikiTitle: "Mercury" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("does not merge a name and an alias across types", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "country", name: "Russia", type: "country" }),
      makeEntity({ id: "org", name: "Russia", type: "organization", aliases: ["Russia"] }),
    ]);
    expect(groups).toEqual([]);
  });

  it("does not merge King Charles II and King Charles III sharing a wikiTitle", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "c2", name: "King Charles II", type: "person", wikiTitle: "Charles" }),
      makeEntity({ id: "c3", name: "King Charles III", type: "person", wikiTitle: "Charles" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("groups three entities transitively through a shared link", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "a", name: "Ukraine", aliases: ["Ukrayina"], mentions: 1 }),
      makeEntity({ id: "b", name: "Ukrayina", wikiTitle: "Ukraine", mentions: 1 }),
      makeEntity({ id: "c", name: "Republic of Ukraine", wikiTitle: "Ukraine", mentions: 9 }),
    ]);
    expect(groups).toEqual([
      {
        canonicalId: "c",
        memberIds: ["c", "a", "b"],
        otherNames: ["Ukraine", "Ukrayina"],
      },
    ]);
  });

  it("splits a transitive group whose members differ by a number", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "a", name: "King Charles II", aliases: ["Charles"] }),
      makeEntity({ id: "b", name: "Charles", aliases: ["King Charles II", "King Charles III"] }),
      makeEntity({ id: "c", name: "King Charles III" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("picks the canonical member by mentions, breaking ties by smallest id", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "z", name: "Iran", aliases: ["Persia"], wikiTitle: "Iran", mentions: 4 }),
      makeEntity({ id: "m", name: "Persia", mentions: 4 }),
      makeEntity({ id: "a", name: "Islamic Republic", wikiTitle: "Iran", mentions: 4 }),
    ]);
    expect(groups).toEqual([
      {
        canonicalId: "a",
        memberIds: ["a", "m", "z"],
        otherNames: ["Iran", "Persia"],
      },
    ]);
  });

  it("returns groups sorted by canonical mentions, descending", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "x1", name: "Alpha", aliases: ["Alef"], mentions: 2 }),
      makeEntity({ id: "x2", name: "Alef", mentions: 1 }),
      makeEntity({ id: "y1", name: "Beta", aliases: ["Bet"], mentions: 7 }),
      makeEntity({ id: "y2", name: "Bet", mentions: 1 }),
    ]);
    expect(groups.map((g) => g.canonicalId)).toEqual(["y1", "x1"]);
  });

  it("omits singletons from the output", () => {
    const groups = buildMergeGroups([
      makeEntity({ id: "a", name: "Alpha", aliases: ["Alef"] }),
      makeEntity({ id: "b", name: "Alef" }),
      makeEntity({ id: "c", name: "Gamma" }),
    ]);
    expect(groups.map((g) => g.memberIds)).toEqual([["a", "b"]]);
  });

  it("rejects duplicate entity ids", () => {
    expect(() =>
      buildMergeGroups([makeEntity({ id: "a", name: "A" }), makeEntity({ id: "a", name: "B" })]),
    ).toThrow('soft-merge: duplicate entity id "a"');
  });

  it("rejects negative mentions", () => {
    expect(() => buildMergeGroups([makeEntity({ id: "a", mentions: -1 })])).toThrow(
      'soft-merge: invalid entity field "mentions"',
    );
  });

  it("rejects an empty name", () => {
    expect(() => buildMergeGroups([makeEntity({ id: "a", name: "  . " })])).toThrow(
      'soft-merge: invalid entity field "name"',
    );
  });

  it("rejects an empty id", () => {
    expect(() => buildMergeGroups([makeEntity({ id: "" })])).toThrow(
      'soft-merge: invalid entity field "id"',
    );
  });

  it("rejects non-string aliases", () => {
    const bad = { ...makeEntity({ id: "a" }), aliases: [42 as unknown as string] };
    expect(() => buildMergeGroups([bad])).toThrow('soft-merge: invalid entity field "aliases"');
  });

  it("rejects a non-string, non-null wikiTitle", () => {
    const bad = { ...makeEntity({ id: "a" }), wikiTitle: 7 as unknown as string };
    expect(() => buildMergeGroups([bad])).toThrow('soft-merge: invalid entity field "wikiTitle"');
  });
});

describe("namesDifferOnlyByNumber", () => {
  it("is true for King Charles II vs King Charles III", () => {
    expect(namesDifferOnlyByNumber("King Charles II", "King Charles III")).toBe(true);
  });

  it("is true when only arabic digits differ", () => {
    expect(namesDifferOnlyByNumber("Apollo 11", "Apollo 13")).toBe(true);
  });

  it("is true when one name has a numeral and the other does not", () => {
    expect(namesDifferOnlyByNumber("Apple", "Apple II")).toBe(true);
  });

  it("is false for identical names", () => {
    expect(namesDifferOnlyByNumber("Russia", "Russia")).toBe(false);
  });

  it("is false when names differ only by case, dots or spacing", () => {
    expect(namesDifferOnlyByNumber("U.S.", "us")).toBe(false);
  });

  it("is false when the names differ in letters", () => {
    expect(namesDifferOnlyByNumber("Russia", "Russland")).toBe(false);
  });

  it("is case-insensitive about numerals", () => {
    expect(namesDifferOnlyByNumber("Henry viii", "Henry VIII 2")).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(() => namesDifferOnlyByNumber(1 as unknown as string, "a")).toThrow(
      "soft-merge: names must be strings",
    );
  });
});
