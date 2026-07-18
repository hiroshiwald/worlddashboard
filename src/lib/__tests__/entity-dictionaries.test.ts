import { describe, it, expect } from "vitest";
import { COUNTRY_DICT, ORG_DICT, REGION_DICT, DictEntry } from "../entity-dictionaries";
import { matchDictionaryEntries } from "../entity-extractor";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
  "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington State", "West Virginia", "Wisconsin", "Wyoming",
  "District of Columbia",
];

function allTerms(dict: DictEntry[]): string[] {
  return dict.flatMap((e) => [e.name, ...e.aliases]);
}

describe("entity-dictionaries: US states", () => {
  it("adds all 49 non-colliding states + DC as type region, full names only", () => {
    const regionNames = new Set(REGION_DICT.map((e) => e.name));
    expect(US_STATES).toHaveLength(50);
    for (const state of US_STATES) {
      expect(regionNames.has(state)).toBe(true);
      expect(REGION_DICT.find((e) => e.name === state)?.type).toBe("region");
    }
  });

  it("never adds a two-letter (or shorter) abbreviation as a state name or alias", () => {
    for (const entry of REGION_DICT) {
      for (const form of [entry.name, ...entry.aliases]) {
        expect(form.length).toBeGreaterThan(2);
      }
    }
  });

  it("deliberately omits Georgia (state): the country Georgia already owns that exact name", () => {
    expect(REGION_DICT.some((e) => e.name === "Georgia")).toBe(false);
    expect(COUNTRY_DICT.some((e) => e.name === "Georgia")).toBe(true);
  });

  it("renames Washington (state) to avoid overriding the United States alias", () => {
    expect(REGION_DICT.some((e) => e.name === "Washington")).toBe(false);
    expect(REGION_DICT.some((e) => e.name === "Washington State")).toBe(true);
    expect(COUNTRY_DICT.find((e) => e.name === "United States")?.aliases).toContain("Washington");
  });

  it("introduces no new name/alias collision across the three dictionaries", () => {
    // These four collide today and predate this change entirely (verified by
    // running this same check against the pre-change file) — anything else
    // is a new, unintended collision and must fail loudly.
    const preexisting = new Set(["hezbollah", "hamas", "brussels", "al qaeda"]);
    const seenBy = new Map<string, string>();

    for (const [label, dict] of [
      ["country", COUNTRY_DICT],
      ["org", ORG_DICT],
      ["region", REGION_DICT],
    ] as const) {
      for (const term of allTerms(dict as DictEntry[])) {
        const key = term.toLowerCase();
        if (seenBy.has(key) && !preexisting.has(key)) {
          throw new Error(`New collision: "${term}" in ${label} vs ${seenBy.get(key)}`);
        }
        if (!seenBy.has(key)) seenBy.set(key, label);
      }
    }
  });

  it("resolves a plain mention of a state to the region entity", () => {
    const matches = matchDictionaryEntries("Wildfires spread across California this week");
    expect(matches.some((m) => m.name === "California" && m.type === "region")).toBe(true);
  });

  it("still resolves bare 'Washington' to United States, not the state", () => {
    const matches = matchDictionaryEntries("Washington announced new sanctions today");
    expect(matches).toEqual([{ name: "United States", type: "country" }]);
  });

  it("still resolves bare 'Georgia' to the country, not the state", () => {
    const matches = matchDictionaryEntries("Georgia signed a new trade deal this year");
    expect(matches).toEqual([{ name: "Georgia", type: "country" }]);
  });
});
