import { describe, it, expect } from "vitest";
import {
  OTHER_TOPIC,
  entityTopics,
  cosineWeight,
  topicLinks,
} from "../topic-membership";
import type { ArticleTopic } from "../topic-membership";

function article(articleId: string, topic: string, entityIds: string[]): ArticleTopic {
  return { articleId, topic, entityIds };
}

describe("entityTopics", () => {
  it("returns an empty map for empty input", () => {
    expect(entityTopics([]).size).toBe(0);
  });

  it("assigns a single-article entity to its only topic as a fallback", () => {
    const result = entityTopics([article("a1", "Politics", ["e1"])]);
    expect(result.get("e1")).toEqual(["Politics"]);
  });

  it("maps blank and whitespace-only topics to Other", () => {
    const result = entityTopics([
      article("a1", "", ["e1"]),
      article("a2", "   ", ["e2"]),
    ]);
    expect(result.get("e1")).toEqual([OTHER_TOPIC]);
    expect(result.get("e2")).toEqual([OTHER_TOPIC]);
  });

  it("trims topic names before grouping", () => {
    const result = entityTopics([
      article("a1", " Politics ", ["e1"]),
      article("a2", "Politics", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Politics"]);
  });

  it("counts the same article id only once", () => {
    const result = entityTopics([
      article("a1", "Politics", ["e1"]),
      article("a1", "Politics", ["e1"]),
      article("a2", "Energy", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Energy"]);
  });

  it("gives an entity every topic where it appears in 2+ distinct articles", () => {
    const result = entityTopics([
      article("a1", "Politics", ["e1"]),
      article("a2", "Politics", ["e1"]),
      article("a3", "Energy", ["e1"]),
      article("a4", "Energy", ["e1"]),
      article("a5", "Energy", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Energy", "Politics"]);
  });

  it("orders qualifying topics by article count descending, then name", () => {
    const result = entityTopics([
      article("a1", "Zeta", ["e1"]),
      article("a2", "Zeta", ["e1"]),
      article("a3", "Alpha", ["e1"]),
      article("a4", "Alpha", ["e1"]),
      article("a5", "Beta", ["e1"]),
      article("a6", "Beta", ["e1"]),
      article("a7", "Beta", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Beta", "Alpha", "Zeta"]);
  });

  it("uses the global topic article count for ordering", () => {
    const result = entityTopics([
      article("a1", "Alpha", ["e1"]),
      article("a2", "Alpha", ["e1"]),
      article("a3", "Beta", ["e1"]),
      article("a4", "Beta", ["e1"]),
      article("a5", "Beta", []),
      article("a6", "Beta", []),
    ]);
    expect(result.get("e1")).toEqual(["Beta", "Alpha"]);
  });

  it("breaks fallback ties alphabetically", () => {
    const result = entityTopics([
      article("a1", "Zeta", ["e1"]),
      article("a2", "Alpha", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Alpha"]);
  });

  it("can fall back to Other when Other is the most common topic", () => {
    const result = entityTopics([
      article("a1", "", ["e1"]),
      article("a2", "", ["e1"]),
      article("a3", "Politics", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual([OTHER_TOPIC]);
  });

  it("never lets Other qualify when a named topic has 2+ articles", () => {
    const result = entityTopics([
      article("a1", "", ["e1"]),
      article("a2", "", ["e1"]),
      article("a3", "", ["e1"]),
      article("a4", "Politics", ["e1"]),
      article("a5", "Politics", ["e1"]),
    ]);
    expect(result.get("e1")).toEqual(["Politics"]);
  });

  it("rejects an empty articleId", () => {
    expect(() => entityTopics([article("", "Politics", ["e1"])])).toThrow(
      "articleId must not be empty",
    );
  });

  it("rejects a non-string topic", () => {
    const bad = { articleId: "a1", topic: 7, entityIds: ["e1"] } as unknown as ArticleTopic;
    expect(() => entityTopics([bad])).toThrow("topic must be a string");
  });

  it("rejects an empty entityId", () => {
    expect(() => entityTopics([article("a1", "Politics", [""])])).toThrow(
      "entityId must not be empty",
    );
  });
});

describe("cosineWeight", () => {
  it("computes shared / sqrt(countA * countB)", () => {
    expect(cosineWeight(2, 4, 9)).toBeCloseTo(2 / 6);
  });

  it("returns 0 when shared is 0", () => {
    expect(cosineWeight(0, 4, 9)).toBe(0);
  });

  it("returns 0 when countA is 0", () => {
    expect(cosineWeight(2, 0, 9)).toBe(0);
  });

  it("returns 0 when countB is 0", () => {
    expect(cosineWeight(2, 4, 0)).toBe(0);
  });

  it("throws on a negative argument", () => {
    expect(() => cosineWeight(-1, 4, 9)).toThrow("shared must not be negative");
    expect(() => cosineWeight(1, -4, 9)).toThrow("countA must not be negative");
    expect(() => cosineWeight(1, 4, -9)).toThrow("countB must not be negative");
  });

  it("throws on a non-finite argument", () => {
    expect(() => cosineWeight(Number.NaN, 4, 9)).toThrow("shared must be a finite number");
  });
});

describe("topicLinks", () => {
  it("returns no links for an empty membership map", () => {
    expect(topicLinks(new Map())).toEqual([]);
  });

  it("returns no links when every entity has one topic", () => {
    const membership = new Map([["e1", ["A"]], ["e2", ["B"]]]);
    expect(topicLinks(membership)).toEqual([]);
  });

  it("links two topics that share an entity", () => {
    const membership = new Map([["e1", ["A", "B"]]]);
    expect(topicLinks(membership)).toEqual([
      { a: "A", b: "B", sharedEntities: 1, weight: 1 },
    ]);
  });

  it("orders each pair alphabetically regardless of list order", () => {
    const membership = new Map([["e1", ["B", "A"]]]);
    const [link] = topicLinks(membership);
    expect(link.a).toBe("A");
    expect(link.b).toBe("B");
  });

  it("weights links by cosine of entity counts and sorts by weight", () => {
    const membership = new Map([
      ["e1", ["A", "B"]],
      ["e2", ["A"]],
      ["e3", ["B", "C"]],
    ]);
    const links = topicLinks(membership);
    expect(links.map((l) => [l.a, l.b])).toEqual([
      ["B", "C"],
      ["A", "B"],
    ]);
    expect(links[0].weight).toBeCloseTo(1 / Math.sqrt(2));
    expect(links[1].weight).toBeCloseTo(1 / Math.sqrt(4));
  });

  it("creates one pair per topic combination for a three-topic entity", () => {
    const membership = new Map([["e1", ["A", "B", "C"]]]);
    const links = topicLinks(membership);
    expect(links.map((l) => [l.a, l.b])).toEqual([
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
    ]);
  });

  it("breaks weight ties by a, then b", () => {
    const membership = new Map([
      ["e1", ["C", "D"]],
      ["e2", ["A", "B"]],
    ]);
    const links = topicLinks(membership);
    expect(links.map((l) => [l.a, l.b])).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });
});
