import { describe, it, expect } from "vitest";
import { buildCandidateMatcher, foldText, isMatchableName, stripPublisherSuffix } from "../candidate-match";

const c = (displayName: string) => ({ nameNorm: displayName.toLowerCase(), displayName });

describe("buildCandidateMatcher", () => {
  const matcher = buildCandidateMatcher([c("Okonjo"), c("São Tomé"), c("US"), c("Port Said"), c("Ana")]);

  it("matches whole words, case and accent insensitive", () => {
    expect(matcher.match("OKONJO wins vote in Sao Tome", new Set()).map((x) => x.displayName)).toEqual(["Okonjo", "São Tomé"]);
  });

  it("does not match inside a longer word", () => {
    expect(matcher.match("Banana prices and Okonjoism", new Set())).toEqual([]);
  });

  it("drops names shorter than 3 characters and short single words", () => {
    expect(matcher.match("US and EU talks with Ana", new Set())).toEqual([]);
  });

  it("keeps only the longest of overlapping names", () => {
    const m = buildCandidateMatcher([c("Daily News"), c("Hürriyet Daily News"), c("Hürriyet Daily")]);
    expect(m.match("Report in Hurriyet Daily News today", new Set()).map((x) => x.displayName)).toEqual(["Hürriyet Daily News"]);
  });

  it("matches multi-word names and skips excluded names", () => {
    expect(matcher.match("Ships wait at Port Said", new Set()).map((x) => x.displayName)).toEqual(["Port Said"]);
    expect(matcher.match("Ships wait at Port Said", new Set(["port said"]))).toEqual([]);
  });

  it("treats regex characters in names as text", () => {
    const m = buildCandidateMatcher([c("C++ Corp")]);
    expect(m.match("C++ Corp files", new Set())).toHaveLength(1);
    expect(m.match("CCC Corp files", new Set())).toEqual([]);
  });
});

describe("foldText", () => {
  it("removes accents and lowercases", () => {
    expect(foldText("Ñandú Élan")).toBe("nandu elan");
  });
});

describe("isMatchableName", () => {
  it("rejects junk names", () => {
    expect(isMatchableName("The")).toBe(false);
    expect(isMatchableName("DIE")).toBe(false);
    expect(isMatchableName("administration")).toBe(false);
    expect(isMatchableName("- BBC")).toBe(false);
  });

  it("accepts real names", () => {
    expect(isMatchableName("Apec")).toBe(true);
    expect(isMatchableName("Crimean Bridge")).toBe(true);
    expect(isMatchableName("Shenzhen")).toBe(true);
  });
});

describe("stripPublisherSuffix", () => {
  it("removes a trailing publisher", () => {
    expect(stripPublisherSuffix("Ships sink in Black Sea - Hürriyet Daily News")).toBe("Ships sink in Black Sea");
    expect(stripPublisherSuffix("Do the Dems need new leadership? | Vox")).toBe("Do the Dems need new leadership?");
  });

  it("keeps a title without a suffix", () => {
    expect(stripPublisherSuffix("Port-Said reopens")).toBe("Port-Said reopens");
  });
});
