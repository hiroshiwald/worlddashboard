import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { OTHER_COLOR, PALETTE, edgeHidden, legend, litSet, nodeLook, paintGraph } from "../universe-view";

function pair(): Graph {
  const g = new Graph({ type: "undirected" });
  g.addNode("a", { type: "person" });
  g.addNode("b", { type: "person" });
  g.addNode("c", { type: "person" });
  g.addEdge("a", "b");
  return g;
}

describe("legend", () => {
  it("orders communities by size and keeps their labels", () => {
    const byNode = new Map([["a", 0], ["b", 1], ["c", 1]]);
    const labels = new Map([[0, "A"], [1, "B, C"]]);
    const entries = legend({ byNode, labels });
    expect(entries.map((e) => e.label)).toEqual(["B, C", "A"]);
    expect(entries[0].size).toBe(2);
  });

  it("caps at ten entries", () => {
    const byNode = new Map(Array.from({ length: 15 }, (_, i) => [`n${i}`, i] as [string, number]));
    expect(legend({ byNode, labels: new Map() })).toHaveLength(10);
  });
});

describe("paintGraph", () => {
  it("colours legend communities by rank, others grey, seeds positions and drops the type attribute", () => {
    const g = pair();
    const result = { byNode: new Map([["a", 1], ["b", 1], ["c", 2]]), labels: new Map() };
    paintGraph(g, result, legend(result).slice(0, 1), () => 0.5);
    expect(g.getNodeAttribute("a", "color")).toBe(PALETTE[0]);
    expect(g.getNodeAttribute("c", "color")).toBe(OTHER_COLOR);
    expect(g.getNodeAttribute("a", "x")).toBe(50);
    expect(g.hasNodeAttribute("a", "type")).toBe(false);
  });
});

describe("selection", () => {
  it("lights the node and its neighbours only", () => {
    const g = pair();
    expect([...litSet(g, "a")!].sort()).toEqual(["a", "b"]);
    expect(litSet(g, null)).toBeNull();
    expect(litSet(g, "cand:x")).toBeNull();
  });

  it("dims and unlabels nodes outside the lit set", () => {
    const lit = new Set(["a", "b"]);
    expect(nodeLook("a", "#111111", "A", lit, "a", "#000000")).toMatchObject({ label: "A", highlighted: true, zIndex: 1 });
    expect(nodeLook("c", "#111111", "C", lit, "a", "#000000")).toMatchObject({ label: null, zIndex: 0, color: "#00000033" });
    expect(nodeLook("c", "#111111", "C", null, null, "#000000").label).toBe("C");
  });

  it("hides edges that do not touch the selected node", () => {
    const lit = new Set(["a", "b", "c"]);
    expect(edgeHidden("a", lit, "a", "b")).toBe(false);
    expect(edgeHidden("a", lit, "b", "c")).toBe(true);
    expect(edgeHidden(null, null, "b", "c")).toBe(false);
  });
});
