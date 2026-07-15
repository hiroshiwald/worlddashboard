import { describe, it, expect } from "vitest";
import { normalizeName, extractCandidates } from "../extract-v2";

describe("normalizeName", () => {
  it("folds diacritics", () => {
    expect(normalizeName("Müller")).toBe("muller");
  });

  it("strips a trailing corporate suffix", () => {
    expect(normalizeName("Veltrax Industries Inc")).toBe("veltrax industries");
  });

  it("strips a trailing corporate suffix with a period", () => {
    expect(normalizeName("Zenmark Corp.")).toBe("zenmark");
  });

  it("lowercases and collapses whitespace", () => {
    expect(normalizeName("  FOO   Bar  ")).toBe("foo bar");
  });

  it("leaves a name with no suffix untouched beyond casing", () => {
    expect(normalizeName("Kestrel Basin")).toBe("kestrel basin");
  });
});

describe("extractCandidates", () => {
  it("dictionary layer returns the canonical name", () => {
    const candidates = extractCandidates("Russia launches new policy", "");
    const russia = candidates.find((c) => c.norm === "russia");
    expect(russia).toEqual({
      display: "Russia",
      norm: "russia",
      typeHint: "country",
      layer: "dictionary",
    });
  });

  it("compromise layer finds an unlisted two-word person name", () => {
    const candidates = extractCandidates(
      "Reuters said Jonas Kestrel met with officials in the capital.",
      "",
    );
    const person = candidates.find((c) => c.norm === "jonas kestrel");
    expect(person).toBeDefined();
    expect(person!.typeHint).toBe("person");
    expect(person!.layer).toBe("compromise");
  });

  it("acronym layer finds a made-up 4-letter agency", () => {
    const candidates = extractCandidates("The ZURN agency confirmed the ceasefire.", "");
    const zurn = candidates.find((c) => c.norm === "zurn");
    expect(zurn).toEqual({
      display: "ZURN",
      norm: "zurn",
      typeHint: "organization",
      layer: "acronym",
    });
  });

  it("acronym layer skips stoplisted words and dictionary-owned terms", () => {
    const candidates = extractCandidates("The CEO met NATO officials today.", "");
    expect(candidates.find((c) => c.norm === "ceo")).toBeUndefined();
    const nato = candidates.find((c) => c.norm === "nato");
    expect(nato!.layer).toBe("dictionary");
  });

  it("dedups within one text by norm, keeping the longest display", () => {
    const candidates = extractCandidates(
      "Veltrax Industries signed a deal with Veltrax Industries Inc over new contracts.",
      "",
    );
    const matches = candidates.filter((c) => c.norm === "veltrax industries");
    expect(matches).toHaveLength(1);
    expect(matches[0].display).toBe("Veltrax Industries Inc");
  });

  it("person-regex layer is filtered by PERSON_STOPWORDS", () => {
    const candidates = extractCandidates("Just In: Sky News reports new developments today.", "");
    expect(candidates.find((c) => c.norm === "just in")).toBeUndefined();
  });
});
