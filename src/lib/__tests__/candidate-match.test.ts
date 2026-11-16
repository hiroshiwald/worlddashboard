import { describe, it, expect } from "vitest";
import { buildCandidateMatcher, foldText } from "../candidate-match";

const c = (displayName: string) => ({ nameNorm: displayName.toLowerCase(), displayName });

describe("buildCandidateMatcher", () => {
  const matcher = buildCandidateMatcher([c("Okonjo"), c("São Tomé"), c("US"), c("Port Said"), c("Ana")]);

  it("matches whole words, case and accent insensitive", () => {
    expect(matcher.match("OKONJO wins vote in Sao Tome", new Set()).map((x) => x.displayName)).toEqual(["Okonjo", "São Tomé"]);
  });

  it("does not match inside a longer word", () => {
    expect(matcher.match("Banana prices and Okonjoism", new Set())).toEqual([]);
  });

  it("drops names shorter than 3 characters", () => {
    expect(matcher.match("US and EU talks", new Set())).toEqual([]);
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
