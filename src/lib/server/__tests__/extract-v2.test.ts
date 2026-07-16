import { describe, it, expect } from "vitest";
import { normalizeName, extractCandidates, addCandidate, Candidate } from "../extract-v2";

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

  it("'U.K.' resolves to United Kingdom via the dictionary layer", () => {
    const candidates = extractCandidates("U.K. ministers announced new sanctions today.", "");
    const uk = candidates.find((c) => c.norm === "united kingdom");
    expect(uk).toEqual({
      display: "United Kingdom",
      norm: "united kingdom",
      typeHint: "country",
      layer: "dictionary",
    });
  });

  it("bare all-caps 'UK' resolves to United Kingdom (acronym case-sensitivity lifts the 2-char floor)", () => {
    const candidates = extractCandidates("UK strikes trade deal", "");
    const uk = candidates.find((c) => c.norm === "united kingdom");
    expect(uk).toEqual({
      display: "United Kingdom",
      norm: "united kingdom",
      typeHint: "country",
      layer: "dictionary",
    });
  });

  it("'Kane on ice' yields no ICE mention (lowercase acronym collision blocked)", () => {
    const candidates = extractCandidates("Kane on ice", "");
    expect(candidates.find((c) => c.norm === "ice")).toBeUndefined();
  });

  it("'DeepSeek releases R2' yields a product-pattern candidate", () => {
    const candidates = extractCandidates("DeepSeek releases R2", "");
    const deepseek = candidates.find((c) => c.norm === "deepseek");
    expect(deepseek).toEqual({
      display: "DeepSeek",
      norm: "deepseek",
      typeHint: "other",
      layer: "product-pattern",
    });
  });

  it("product-pattern layer skips stoplisted disease/date shapes", () => {
    const candidates = extractCandidates("COVID-19 cases rise across the region.", "");
    expect(candidates.find((c) => c.layer === "product-pattern" && c.norm === "covid-19")).toBeUndefined();
  });

  it("product-pattern layer catches a digit-token model name (GPT-5o)", () => {
    const candidates = extractCandidates("OpenAI unveils GPT-5o with new capabilities.", "");
    const model = candidates.find((c) => c.norm === "gpt-5o");
    expect(model).toEqual({ display: "GPT-5o", norm: "gpt-5o", typeHint: "other", layer: "product-pattern" });
  });

  it("product-pattern layer catches a digit-token product name (A320neo)", () => {
    const candidates = extractCandidates("Airbus delivers the first A320neo to the airline.", "");
    const model = candidates.find((c) => c.norm === "a320neo");
    expect(model).toEqual({ display: "A320neo", norm: "a320neo", typeHint: "other", layer: "product-pattern" });
  });

  it("product-pattern layer ignores an ordinary capitalized word with no digit or interior cap", () => {
    const candidates = extractCandidates("Analysts issued a report today.", "");
    expect(candidates.find((c) => c.layer === "product-pattern")).toBeUndefined();
  });

  it("the new 'Great Britain' alias resolves to United Kingdom via the dictionary layer", () => {
    const candidates = extractCandidates("Great Britain announced new sanctions today.", "");
    const uk = candidates.find((c) => c.norm === "united kingdom");
    expect(uk).toEqual({
      display: "United Kingdom",
      norm: "united kingdom",
      typeHint: "country",
      layer: "dictionary",
    });
  });

  it("'AI' produces no candidate (topic-word acronym stoplist)", () => {
    // Sentence chosen so compromise's NLP layer doesn't independently tag
    // "AI" as an organization — the acronym stoplist only blocks the
    // acronym-regex layer, not other layers matching the same text.
    const candidates = extractCandidates("The report warned that AI adoption is accelerating.", "");
    expect(candidates.find((c) => c.norm === "ai")).toBeUndefined();
  });
});

describe("addCandidate layer priority", () => {
  it("never demotes a dictionary hit's layer/typeHint when a lower-priority layer produces a longer same-norm display", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Veltrax", "country", "dictionary");
    addCandidate(map, "Veltrax Inc", "organization", "compromise");

    const entry = map.get("veltrax")!;
    expect(entry.layer).toBe("dictionary");
    expect(entry.typeHint).toBe("country");
    expect(entry.display).toBe("Veltrax");
  });

  it("never demotes regardless of arrival order (lower-priority layer arrives first)", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Veltrax", "person", "person-regex");
    addCandidate(map, "Veltrax", "country", "dictionary");

    const entry = map.get("veltrax")!;
    expect(entry.layer).toBe("dictionary");
    expect(entry.typeHint).toBe("country");
  });

  it("upgrades the display to the longer string within the same layer priority", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Veltrax Industries", "organization", "compromise");
    addCandidate(map, "Veltrax Industries Inc", "organization", "compromise");

    expect(map.get("veltrax industries")!.display).toBe("Veltrax Industries Inc");
  });

  it("does not upgrade the display when the new candidate is from a lower-priority layer, even if longer", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Veltrax", "country", "dictionary");
    addCandidate(map, "Veltrax Inc", "organization", "person-regex");

    expect(map.get("veltrax")!.display).toBe("Veltrax");
  });

  it("llm outranks compromise/acronym/person-regex but not dictionary", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Veltrax", "person", "compromise");
    addCandidate(map, "Veltrax", "organization", "llm");
    expect(map.get("veltrax")!.layer).toBe("llm");
    expect(map.get("veltrax")!.typeHint).toBe("organization");

    addCandidate(map, "Veltrax", "country", "dictionary");
    expect(map.get("veltrax")!.layer).toBe("dictionary");
  });

  it("carries roleContext through when the llm candidate wins priority", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Jane Doe", "person", "llm", "former IRGC commander");
    expect(map.get("jane doe")!.roleContext).toBe("former IRGC commander");
  });

  it("drops roleContext when a higher-priority layer without one wins", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Jane Doe", "person", "llm", "former IRGC commander");
    addCandidate(map, "Jane Doe", "organization", "dictionary");
    expect(map.get("jane doe")!.roleContext).toBeUndefined();
  });

  it("carries prominence through when the llm candidate wins priority", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Jane Doe", "person", "llm", undefined, "famous");
    expect(map.get("jane doe")!.prominence).toBe("famous");
  });

  it("drops prominence when a higher-priority layer without one wins", () => {
    const map = new Map<string, Candidate>();
    addCandidate(map, "Jane Doe", "person", "llm", undefined, "famous");
    addCandidate(map, "Jane Doe", "organization", "dictionary");
    expect(map.get("jane doe")!.prominence).toBeUndefined();
  });
});
