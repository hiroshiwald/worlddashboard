import { describe, it, expect } from "vitest";
import {
  isAnchor,
  computeAnchorThreshold,
  rankAnchors,
  computeNovelty,
  computeCorroboration,
  computePersistence,
  computeRelationStrength,
  computeAnchorContext,
  computePenalty,
  scoreDevelopment,
  countDistinctSources,
  countDistinctUtcDays,
  computeStaleReporting,
  buildWhyShown,
  passesEligibility,
  isCorroboratedCandidate,
  resolveAmbiguousTitles,
  selectDisplayEvidence,
  dedupeCards,
  sortAndCapCards,
  getDevelopments,
} from "../developments";
import type { Sql, SqlRow } from "../db";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function daysBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 3600 * 1000);
}

function iso(n: number): string {
  return daysBefore(n).toISOString();
}

const OLD_EPOCH = iso(60);

// ---- pure function unit tests ----

describe("isAnchor", () => {
  it("is always an anchor by type, regardless of baseline", () => {
    expect(isAnchor("country", 0, 100)).toBe(true);
    expect(isAnchor("region", 0, 100)).toBe(true);
  });

  it("is an anchor by volume when baseline clears the threshold", () => {
    expect(isAnchor("company", 10, 5)).toBe(true);
    expect(isAnchor("company", 4, 5)).toBe(false);
  });

  it("is inclusive at the threshold boundary", () => {
    expect(isAnchor("company", 5, 5)).toBe(true);
  });
});

describe("computeAnchorThreshold", () => {
  it("floors at 3 with an empty population", () => {
    expect(computeAnchorThreshold([])).toBe(3);
  });

  it("degenerates to the single value, floored at 3", () => {
    expect(computeAnchorThreshold([10])).toBe(10);
    expect(computeAnchorThreshold([1])).toBe(3);
  });

  it("hand-checked: exact-index case, no interpolation (n=11, rank=9.0)", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(computeAnchorThreshold(values)).toBe(10);
  });

  it("hand-checked: interpolated case (n=10, rank=8.1)", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(computeAnchorThreshold(values)).toBeCloseTo(9.1, 5);
  });
});

describe("rankAnchors", () => {
  function meta(canonicalName: string, baselineDaily: number) {
    return { id: 1, canonicalName, type: "country", aliases: [], baselineDaily };
  }

  it("sorts by baselineDaily descending", () => {
    const result = rankAnchors([meta("Low", 1), meta("High", 10), meta("Mid", 5)]);
    expect(result.map((a) => a.canonicalName)).toEqual(["High", "Mid", "Low"]);
  });

  it("breaks a baseline tie alphabetically", () => {
    const result = rankAnchors([meta("Zeta", 5), meta("Alpha", 5)]);
    expect(result.map((a) => a.canonicalName)).toEqual(["Alpha", "Zeta"]);
  });

  it("caps at 3", () => {
    const result = rankAnchors([meta("A", 4), meta("B", 3), meta("C", 2), meta("D", 1)]);
    expect(result).toHaveLength(3);
  });
});

describe("computeNovelty", () => {
  it("hand-checked: ageDays=7 -> exp(-1)", () => {
    expect(computeNovelty(7)).toBeCloseTo(Math.exp(-1), 6);
  });

  it("age 0 applies no decay", () => {
    expect(computeNovelty(0)).toBe(1);
  });
});

describe("computeCorroboration", () => {
  it("caps at 5", () => {
    expect(computeCorroboration(3)).toBeCloseTo(0.6, 5);
    expect(computeCorroboration(5)).toBe(1);
    expect(computeCorroboration(8)).toBe(1);
  });
});

describe("computePersistence", () => {
  it("caps at 5", () => {
    expect(computePersistence(2)).toBeCloseTo(0.4, 5);
    expect(computePersistence(9)).toBe(1);
  });
});

describe("computeRelationStrength", () => {
  it("strong relations score 1.0 for source R", () => {
    for (const relation of ["sanction", "supply", "acquisition", "investment", "regulation", "legal_action"]) {
      expect(computeRelationStrength("R", relation)).toBe(1.0);
    }
  });

  it("weak relations score 0.5 for source R", () => {
    expect(computeRelationStrength("R", "statement_about")).toBe(0.5);
    expect(computeRelationStrength("R", "other")).toBe(0.5);
  });

  it("other named relations score 0.8 for source R", () => {
    for (const relation of ["appointment", "partnership", "funding", "conflict", "membership"]) {
      expect(computeRelationStrength("R", relation)).toBe(0.8);
    }
  });

  it("N/C/E have their own fixed relationStrength regardless of relation", () => {
    expect(computeRelationStrength("N")).toBe(0.6);
    expect(computeRelationStrength("C")).toBe(0.5);
    expect(computeRelationStrength("E")).toBe(0.35);
  });
});

describe("computeAnchorContext", () => {
  it("caps at 3 anchors", () => {
    expect(computeAnchorContext(1)).toBeCloseTo((1 / 3) * 0.5, 5);
    expect(computeAnchorContext(3)).toBe(0.5);
    expect(computeAnchorContext(5)).toBe(0.5);
  });
});

describe("computePenalty", () => {
  it("no penalty when fresh and below the drift floor", () => {
    expect(computePenalty(false, 1, 10)).toBe(0);
  });

  it("adds 0.5 for stale reporting", () => {
    expect(computePenalty(true, 1, 10)).toBe(0.5);
  });

  it("adds 1.0 when subject baseline clears half the anchor threshold", () => {
    expect(computePenalty(false, 6, 10)).toBe(1.0);
    expect(computePenalty(true, 6, 10)).toBe(1.5);
  });

  it("never applies the drift penalty when subjectBaselineDaily is null (candidate subjects)", () => {
    expect(computePenalty(false, null, 10)).toBe(0);
    expect(computePenalty(true, null, 10)).toBe(0.5);
  });
});

describe("scoreDevelopment", () => {
  it("hand-checked weighted sum", () => {
    const parts = { novelty: 0.5, corroboration: 0.6, persistence: 0.4, relationStrength: 1.0, anchorContext: 0.5, penalty: 0.5 };
    expect(scoreDevelopment(parts)).toBeCloseTo(5.0, 5);
  });
});

describe("countDistinctSources", () => {
  it("counts distinct source names", () => {
    expect(countDistinctSources([{ sourceName: "A" }, { sourceName: "B" }, { sourceName: "A" }])).toBe(2);
  });
});

describe("countDistinctUtcDays", () => {
  it("counts distinct UTC calendar days", () => {
    const evidence = [
      { firstSeenAt: new Date("2026-07-01T23:00:00Z") },
      { firstSeenAt: new Date("2026-07-02T01:00:00Z") },
      { firstSeenAt: new Date("2026-07-01T05:00:00Z") },
    ];
    expect(countDistinctUtcDays(evidence)).toBe(2);
  });
});

describe("computeStaleReporting", () => {
  const firstObservedAt = new Date("2026-07-15T00:00:00Z");

  it("is false when no evidence has a publish date", () => {
    expect(computeStaleReporting(firstObservedAt, [{ publishedAt: null }])).toBe(false);
  });

  it("is false when the gap is exactly 7 days (boundary, not stale)", () => {
    expect(computeStaleReporting(firstObservedAt, [{ publishedAt: new Date("2026-07-08T00:00:00Z") }])).toBe(false);
  });

  it("is true when the newest publish date lags more than 7 days", () => {
    expect(computeStaleReporting(firstObservedAt, [{ publishedAt: new Date("2026-07-01T00:00:00Z") }])).toBe(true);
  });

  it("uses the newest publish date among several", () => {
    const evidence = [{ publishedAt: new Date("2026-06-01T00:00:00Z") }, { publishedAt: new Date("2026-07-10T00:00:00Z") }];
    expect(computeStaleReporting(firstObservedAt, evidence)).toBe(false);
  });
});

describe("buildWhyShown", () => {
  it("matches the spec's example exactly for source R", () => {
    const result = buildWhyShown({
      ageDays: 4, distinctSources: 3, distinctDays: 2, anchorName: "Russia", sourceKind: "R", relation: "sanction",
    });
    expect(result).toBe(
      "First observed 4 days ago, reported by 3 sources over 2 days, linked to Russia by a stated sanction relation.",
    );
  });

  it("builds the N-source clause", () => {
    const result = buildWhyShown({ ageDays: 1, distinctSources: 2, distinctDays: 1, anchorName: "Trump", sourceKind: "N" });
    expect(result).toBe("First observed 1 day ago, reported by 2 sources over 1 day, newly tracked alongside Trump.");
  });

  it("builds the C-source clause", () => {
    const result = buildWhyShown({ ageDays: 2, distinctSources: 2, distinctDays: 2, anchorName: "Russia", sourceKind: "C" });
    expect(result).toBe("First observed 2 days ago, reported by 2 sources over 2 days, recurring alongside Russia.");
  });

  it("builds the E-source clause", () => {
    const result = buildWhyShown({ ageDays: 3, distinctSources: 2, distinctDays: 2, anchorName: "Shipping Co", sourceKind: "E" });
    expect(result).toBe(
      "First observed 3 days ago, reported by 2 sources over 2 days, recurring in coverage alongside Shipping Co.",
    );
  });
});

describe("passesEligibility", () => {
  const base = { subjectIsAnchor: false, distinctSourceCount: 2, evidenceCount: 2, anchorCount: 1 };

  it("passes when every condition clears", () => {
    expect(passesEligibility(base)).toBe(true);
  });

  it("fails when the subject is an anchor, no exceptions", () => {
    expect(passesEligibility({ ...base, subjectIsAnchor: true })).toBe(false);
  });

  it("fails below the distinct-source floor", () => {
    expect(passesEligibility({ ...base, distinctSourceCount: 1 })).toBe(false);
  });

  it("fails with zero evidence", () => {
    expect(passesEligibility({ ...base, evidenceCount: 0 })).toBe(false);
  });

  it("fails with zero anchors", () => {
    expect(passesEligibility({ ...base, anchorCount: 0 })).toBe(false);
  });
});

describe("isCorroboratedCandidate", () => {
  it("requires both day_count>=2 and distinct source names >=2", () => {
    expect(isCorroboratedCandidate(2, 2)).toBe(true);
    expect(isCorroboratedCandidate(1, 2)).toBe(false);
    expect(isCorroboratedCandidate(2, 1)).toBe(false);
  });
});

describe("resolveAmbiguousTitles", () => {
  it("keeps a title whose matches all resolve to one cluster head", () => {
    const result = resolveAmbiguousTitles([
      { title: "X", articleId: 1, dupGroupId: null },
      { title: "X", articleId: 2, dupGroupId: 1 },
    ]);
    expect(result).toEqual([1]);
  });

  it("discards a title whose matches resolve to more than one distinct head (fixture 12)", () => {
    const result = resolveAmbiguousTitles([
      { title: "X", articleId: 1, dupGroupId: null },
      { title: "X", articleId: 2, dupGroupId: null },
    ]);
    expect(result).toEqual([]);
  });

  it("evaluates each title independently", () => {
    const result = resolveAmbiguousTitles([
      { title: "X", articleId: 1, dupGroupId: null },
      { title: "X", articleId: 2, dupGroupId: null },
      { title: "Y", articleId: 3, dupGroupId: null },
    ]);
    expect(result).toEqual([3]);
  });
});

describe("selectDisplayEvidence", () => {
  function article(firstSeenAt: string) {
    return { articleId: 1, title: "t", link: "l", sourceName: "s", publishedAt: null, firstSeenAt: new Date(firstSeenAt) };
  }

  it("sorts newest first and caps at the given number", () => {
    const evidence = [article("2026-07-01T00:00:00Z"), article("2026-07-05T00:00:00Z"), article("2026-07-03T00:00:00Z")];
    const result = selectDisplayEvidence(evidence, 2);
    expect(result.map((a) => a.firstSeenAt.toISOString())).toEqual([
      new Date("2026-07-05T00:00:00Z").toISOString(),
      new Date("2026-07-03T00:00:00Z").toISOString(),
    ]);
  });
});

describe("dedupeCards", () => {
  function card(sourceKind: "R" | "N" | "C" | "E", subjectName: string, relationStrength: number) {
    return {
      sourceKind,
      subjectName,
      subjectType: "company",
      subjectBaselineDaily: 1,
      anchorNames: ["Anchor"],
      relationOrReason: "x",
      label: "observed" as const,
      firstObservedAt: new Date("2026-07-01T00:00:00Z"),
      lastObservedAt: new Date("2026-07-01T00:00:00Z"),
      fullEvidence: [],
      score: relationStrength,
      scoreParts: { novelty: 0, corroboration: 0, persistence: 0, relationStrength, anchorContext: 0, penalty: 0 },
      whyShown: "x",
      staleReporting: false,
    };
  }

  it("keeps the higher-relationStrength card when the same subject appears from two sources", () => {
    const result = dedupeCards([card("E", "Acme", 0.35), card("R", "Acme", 1.0)]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceKind).toBe("R");
  });

  it("breaks a relationStrength tie by source precedence R>N>C>E", () => {
    const result = dedupeCards([card("E", "Acme", 0.5), card("C", "Acme", 0.5)]);
    expect(result[0].sourceKind).toBe("C");
  });

  it("treats differently-cased/normalized names as the same subject", () => {
    const result = dedupeCards([card("R", "Acme Corp", 1.0), card("E", "ACME CORP.", 0.35)]);
    expect(result).toHaveLength(1);
  });

  it("keeps distinct subjects separate", () => {
    const result = dedupeCards([card("R", "Acme", 1.0), card("R", "Beta", 1.0)]);
    expect(result).toHaveLength(2);
  });
});

describe("sortAndCapCards", () => {
  function card(score: number, firstObservedAt: string) {
    return {
      sourceKind: "R" as const,
      subjectName: `Subject-${score}-${firstObservedAt}`,
      subjectType: "company",
      subjectBaselineDaily: 1,
      anchorNames: ["Anchor"],
      relationOrReason: "x",
      label: "observed" as const,
      firstObservedAt: new Date(firstObservedAt),
      lastObservedAt: new Date(firstObservedAt),
      fullEvidence: [],
      score,
      scoreParts: { novelty: 0, corroboration: 0, persistence: 0, relationStrength: 0, anchorContext: 0, penalty: 0 },
      whyShown: "x",
      staleReporting: false,
    };
  }

  it("sorts by score descending", () => {
    const result = sortAndCapCards(
      [card(1, "2026-07-01T00:00:00Z"), card(3, "2026-07-01T00:00:00Z"), card(2, "2026-07-01T00:00:00Z")],
      8,
    );
    expect(result.map((c) => c.score)).toEqual([3, 2, 1]);
  });

  it("breaks a score tie by firstObservedAt descending", () => {
    const result = sortAndCapCards([card(1, "2026-07-01T00:00:00Z"), card(1, "2026-07-05T00:00:00Z")], 8);
    expect(result[0].firstObservedAt.toISOString()).toBe(new Date("2026-07-05T00:00:00Z").toISOString());
  });

  it("caps at the given limit", () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i, "2026-07-01T00:00:00Z"));
    expect(sortAndCapCards(cards, 8)).toHaveLength(8);
  });
});

// ---- getDevelopments integration fixtures ----
//
// Each query is routed by a distinguishing substring of its own STATIC SQL
// text (interpolated values become " ? " placeholders, mirroring brief.test.ts
// /detectors.test.ts's makeMockSql convention) — unmatched queries default to
// [], which is exactly the behavior needed for the three source pipelines not
// under test in any given fixture.
function makeDevelopmentsSql(responses: Partial<Record<string, SqlRow[]>>): Sql {
  return (async (strings: TemplateStringsArray) => {
    const query = strings.join(" ? ");
    if (query.includes("MIN(ee.first_seen_at)")) return responses.edgeBootstrapFloor ?? [];
    if (query.includes("min_first_seen") && query.includes("FROM articles")) return responses.epoch ?? [];
    if (query.includes("baseline_mentions")) return responses.baseline ?? [];
    if (query.includes("FROM entity_relations")) return responses.relations ?? [];
    if (query.includes("SELECT id, canonical_name, type, first_seen_at, last_seen_at")) return responses.newEntities ?? [];
    if (query.includes("ae.entity_id = ANY(")) return responses.clusterHeadArticles ?? [];
    if (query.includes("SELECT article_id, entity_id")) return responses.coOccurring ?? [];
    if (query.includes("FROM entity_candidates")) return responses.candidates ?? [];
    if (query.includes("WHERE title = ANY(")) return responses.titleMatches ?? [];
    if (query.includes("WHERE id = ANY(") && query.includes("dup_group_id IS NULL")) return responses.resolvedArticles ?? [];
    if (query.includes("AS entity_a, v.b AS entity_b")) return responses.pairEvidence ?? [];
    if (query.includes("ee.entity_a, ee.entity_b, ee.first_seen_at")) return responses.edges ?? [];
    return [];
  }) as Sql;
}

function baseResponses(): Partial<Record<string, SqlRow[]>> {
  return { epoch: [{ min_first_seen: OLD_EPOCH }] };
}

function entityRow(id: number, canonicalName: string, type: string, baselineMentions: number) {
  return {
    id, canonical_name: canonicalName, type, aliases: [],
    baseline_mentions: baselineMentions, total_mentions_15d: baselineMentions,
  };
}

describe("getDevelopments — required fixtures", () => {
  it("fixture 1: low-frequency company, 3 sources/3 days, anchor Russia, sanction relation — eligible, high score, observed, anchor Russia", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "Russia", "country", 0), entityRow(2, "Company", "company", 14)],
      relations: [
        { source_id: 2, target_id: 1, relation: "sanction", first_seen_at: iso(5), last_seen_at: iso(2), evidence_article_id: null },
      ],
      pairEvidence: [
        { entity_a: 1, entity_b: 2, id: 101, title: "A", link: "http://a", source_name: "Source A", published_at: iso(5), first_seen_at: iso(5) },
        { entity_a: 1, entity_b: 2, id: 102, title: "B", link: "http://b", source_name: "Source B", published_at: iso(4), first_seen_at: iso(4) },
        { entity_a: 1, entity_b: 2, id: 103, title: "C", link: "http://c", source_name: "Source C", published_at: iso(3), first_seen_at: iso(3) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    const card = result[0];
    expect(card.subjectName).toBe("Company");
    expect(card.subjectType).toBe("company");
    expect(card.anchorNames).toEqual(["Russia"]);
    expect(card.label).toBe("observed");
    expect(card.relationOrReason).toBe("sanction (stated relation)");
    expect(card.staleReporting).toBe(false);
    expect(card.evidence).toHaveLength(3);
    expect(card.scoreParts.relationStrength).toBe(1.0);
    // Full hand-check of the formula end to end: novelty=exp(-5/7), corroboration=0.6,
    // persistence=0.6, relationStrength=1.0, anchorContext=(1/3)*0.5, penalty=0.
    const expectedScore = 3 * 1.0 + 2 * Math.exp(-5 / 7) + 0.6 + 0.6 + (1 / 3) * 0.5 - 0;
    expect(card.score).toBeCloseTo(expectedScore, 5);
  });

  it("fixture 2: infrastructure entity, 2 sources/2 days, edge to shipping anchor — eligible, pattern", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(10, "ShippingAnchor", "organization", 140), entityRow(11, "Infrastructure", "infrastructure", 14)],
      edgeBootstrapFloor: [{ min_first_seen: iso(90) }],
      edges: [{ entity_a: 10, entity_b: 11, first_seen_at: iso(5), last_seen_at: iso(2) }],
      pairEvidence: [
        { entity_a: 10, entity_b: 11, id: 110, title: "D", link: "http://d", source_name: "Shipping Times", published_at: iso(5), first_seen_at: iso(5) },
        { entity_a: 10, entity_b: 11, id: 111, title: "E", link: "http://e", source_name: "Port Weekly", published_at: iso(4), first_seen_at: iso(4) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].subjectName).toBe("Infrastructure");
    expect(result[0].anchorNames).toEqual(["ShippingAnchor"]);
    expect(result[0].label).toBe("pattern");
    expect(result[0].relationOrReason).toBe("recurring co-coverage with ShippingAnchor");
  });

  it("fixture 3: obscure person, 2 sources, anchor Trump, legal_action relation — eligible, Trump only ever an anchor", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(20, "Trump", "person", 280), entityRow(21, "ObscurePerson", "person", 14)],
      relations: [
        { source_id: 21, target_id: 20, relation: "legal_action", first_seen_at: iso(3), last_seen_at: iso(1), evidence_article_id: null },
      ],
      pairEvidence: [
        { entity_a: 20, entity_b: 21, id: 120, title: "F", link: "http://f", source_name: "Legal Times", published_at: iso(3), first_seen_at: iso(3) },
        { entity_a: 20, entity_b: 21, id: 121, title: "G", link: "http://g", source_name: "Court Watch", published_at: iso(2), first_seen_at: iso(2) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].subjectName).toBe("ObscurePerson");
    expect(result[0].anchorNames).toEqual(["Trump"]);
    expect(result.every((c) => c.subjectName !== "Trump")).toBe(true);
  });

  it("fixture 4: disease entity evidenced across health + travel sources — eligible, corroboration counts distinct sources", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(30, "AirlineAlliance", "organization", 140), entityRow(31, "DiseaseEntity", "disease", 14)],
      edgeBootstrapFloor: [{ min_first_seen: iso(90) }],
      edges: [{ entity_a: 30, entity_b: 31, first_seen_at: iso(4), last_seen_at: iso(1) }],
      pairEvidence: [
        { entity_a: 30, entity_b: 31, id: 130, title: "H", link: "http://h", source_name: "Health Weekly", published_at: iso(4), first_seen_at: iso(4) },
        { entity_a: 30, entity_b: 31, id: 131, title: "I", link: "http://i", source_name: "Travel Times", published_at: iso(3), first_seen_at: iso(3) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].subjectType).toBe("disease");
    expect(result[0].evidence.map((e) => e.sourceName).sort()).toEqual(["Health Weekly", "Travel Times"]);
  });

  it("fixture 5: new relation, famous anchor -> specific satellite — card is headlined by the satellite", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(40, "China", "country", 0), entityRow(41, "SpecificCompany", "company", 14)],
      relations: [
        { source_id: 41, target_id: 40, relation: "acquisition", first_seen_at: iso(1), last_seen_at: iso(1), evidence_article_id: null },
      ],
      pairEvidence: [
        { entity_a: 40, entity_b: 41, id: 140, title: "J", link: "http://j", source_name: "Business Wire", published_at: iso(1), first_seen_at: iso(1) },
        { entity_a: 40, entity_b: 41, id: 141, title: "K", link: "http://k", source_name: "Reuters", published_at: iso(1), first_seen_at: iso(1) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].subjectName).toBe("SpecificCompany");
    expect(result[0].subjectName).not.toBe("China");
    expect(result[0].scoreParts.novelty).toBeCloseTo(Math.exp(-1 / 7), 5);
  });

  it("fixture 6: Russia as subject — ineligible because country is always an anchor, even with anchor context otherwise present", async () => {
    expect(isAnchor("country", 0, 100)).toBe(true);

    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "Russia", "country", 0), entityRow(2, "Ukraine", "country", 0)],
      newEntities: [{ id: 1, canonical_name: "Russia", type: "country", first_seen_at: iso(5), last_seen_at: iso(1) }],
      clusterHeadArticles: [
        { entity_id: 1, id: 201, title: "L", link: "http://l", source_name: "World News", published_at: iso(5), first_seen_at: iso(5) },
        { entity_id: 1, id: 202, title: "M", link: "http://m", source_name: "Global Times", published_at: iso(4), first_seen_at: iso(4) },
      ],
      coOccurring: [{ article_id: 201, entity_id: 2 }, { article_id: 202, entity_id: 2 }],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 7: high-baseline entity above anchor threshold as subject — ineligible regardless of mention count", async () => {
    expect(isAnchor("organization", 10, 5)).toBe(true);

    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [
        entityRow(1, "HighVolumeOrg", "organization", 140),
        entityRow(2, "LowVolumeFiller", "organization", 14),
        entityRow(3, "CountryX", "country", 0),
      ],
      newEntities: [{ id: 1, canonical_name: "HighVolumeOrg", type: "organization", first_seen_at: iso(5), last_seen_at: iso(1) }],
      clusterHeadArticles: [
        { entity_id: 1, id: 210, title: "N", link: "http://n", source_name: "Biz Daily", published_at: iso(5), first_seen_at: iso(5) },
        { entity_id: 1, id: 211, title: "O", link: "http://o", source_name: "Market Watch", published_at: iso(4), first_seen_at: iso(4) },
      ],
      coOccurring: [{ article_id: 210, entity_id: 3 }, { article_id: 211, entity_id: 3 }],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 8: single-source subject — ineligible", async () => {
    expect(passesEligibility({ subjectIsAnchor: false, distinctSourceCount: 1, evidenceCount: 1, anchorCount: 1 })).toBe(false);

    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "CountryA", "country", 0), entityRow(2, "Company", "company", 14)],
      relations: [
        { source_id: 2, target_id: 1, relation: "sanction", first_seen_at: iso(3), last_seen_at: iso(1), evidence_article_id: null },
      ],
      pairEvidence: [
        { entity_a: 1, entity_b: 2, id: 220, title: "Solo", link: "http://s", source_name: "Only Source", published_at: iso(3), first_seen_at: iso(3) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 9: old reporting (newest publish date 10 days before firstObservedAt) — eligible, staleReporting true, penalty applied", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "CountryB", "country", 0), entityRow(2, "Company", "company", 14)],
      relations: [
        { source_id: 2, target_id: 1, relation: "supply", first_seen_at: iso(2), last_seen_at: iso(1), evidence_article_id: null },
      ],
      pairEvidence: [
        { entity_a: 1, entity_b: 2, id: 230, title: "P", link: "http://p", source_name: "Old News Co", published_at: iso(13), first_seen_at: iso(2) },
        { entity_a: 1, entity_b: 2, id: 231, title: "Q", link: "http://q", source_name: "Archive Times", published_at: iso(12), first_seen_at: iso(1) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].staleReporting).toBe(true);
    expect(result[0].scoreParts.penalty).toBe(0.5);
  });

  it("fixture 10: zero resolvable evidence — suppressed", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "CountryC", "country", 0), entityRow(2, "Company", "company", 14)],
      relations: [
        { source_id: 2, target_id: 1, relation: "sanction", first_seen_at: iso(3), last_seen_at: iso(1), evidence_article_id: 999 },
      ],
      // no pairEvidence rows, and evidence_article_id 999 doesn't resolve (resolvedArticles left empty)
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 11: candidate sample_titles have no exact article-title match — suppressed", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "Russia", "country", 0)],
      candidates: [
        {
          name_norm: "obscureco", display_name: "ObscureCo", type_hint: "company",
          first_seen_at: iso(6), last_seen_at: iso(3), source_names: ["Source A", "Source B"],
          day_count: 2, sample_titles: ["Some Exact Title"], contexts: [], co_entities: ["Russia"],
        },
      ],
      titleMatches: [],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 12: candidate ambiguous match (one title resolves to two distinct clusters) — suppressed", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "Russia", "country", 0)],
      candidates: [
        {
          name_norm: "ambiguousco", display_name: "AmbiguousCo", type_hint: "company",
          first_seen_at: iso(6), last_seen_at: iso(3), source_names: ["Source A", "Source B"],
          day_count: 2, sample_titles: ["Ambiguous Title"], contexts: [], co_entities: ["Russia"],
        },
      ],
      titleMatches: [
        { title: "Ambiguous Title", id: 501, dup_group_id: null },
        { title: "Ambiguous Title", id: 502, dup_group_id: null },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });

  it("fixture 13: candidate observed times use matched article first_seen_at, never candidate news-time timestamps", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      baseline: [entityRow(1, "Russia", "country", 0)],
      candidates: [
        {
          name_norm: "divergentco", display_name: "DivergentCo", type_hint: "company",
          first_seen_at: iso(10), last_seen_at: iso(8), source_names: ["Source A", "Source B"],
          day_count: 2, sample_titles: ["Title One", "Title Two"], contexts: [], co_entities: ["Russia"],
        },
      ],
      titleMatches: [
        { title: "Title One", id: 701, dup_group_id: null },
        { title: "Title Two", id: 702, dup_group_id: null },
      ],
      resolvedArticles: [
        { id: 701, title: "Title One", link: "http://701", source_name: "Source A", published_at: iso(9), first_seen_at: iso(2) },
        { id: 702, title: "Title Two", link: "http://702", source_name: "Source B", published_at: iso(7), first_seen_at: iso(1) },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].firstObservedAt).toBe(iso(2));
    expect(result[0].lastObservedAt).toBe(iso(1));
    expect(result[0].firstObservedAt).not.toBe(iso(10));
    expect(result[0].lastObservedAt).not.toBe(iso(8));
  });

  it("fixture 14: generic term (type_hint other, no anchor in co_entities) — ineligible", async () => {
    const sql = makeDevelopmentsSql({
      ...baseResponses(),
      candidates: [
        {
          name_norm: "genericterm", display_name: "Generic Term", type_hint: "other",
          first_seen_at: iso(6), last_seen_at: iso(3), source_names: ["Source A", "Source B"],
          day_count: 2, sample_titles: ["Some Title"], contexts: [], co_entities: [],
        },
      ],
    });

    const result = await getDevelopments(sql, NOW);
    expect(result).toHaveLength(0);
  });
});

describe("getDevelopments query shape", () => {
  it("new-satellite query mirrors brief.ts's bootstrap guard and tracked-status filter", async () => {
    const queries: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      const query = strings.join(" ? ");
      queries.push(query);
      if (query.includes("min_first_seen") && query.includes("FROM articles")) return [{ min_first_seen: OLD_EPOCH }];
      return [];
    }) as Sql;

    await getDevelopments(sql, NOW);

    const newEntityQuery = queries.find((q) => q.includes("SELECT id, canonical_name, type, first_seen_at, last_seen_at"));
    expect(newEntityQuery).toContain("make_interval(hours =>");
    expect(newEntityQuery).toContain("status = 'tracked'");
  });

  it("returns [] with no operating history at all, without throwing", async () => {
    const sql = (async () => []) as Sql;
    expect(await getDevelopments(sql, NOW)).toEqual([]);
  });
});
