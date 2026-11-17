// Pure helpers for the Universe view: community colours, legend, sigma reducers.
import type Graph from "graphology";
import type { CommunityResult } from "./graph-metrics";

// Okabe-Ito colour-blind-safe set plus two neutrals-ish extras; communities beyond 10 wrap.
export const PALETTE = [
  "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00",
  "#56B4E9", "#F0E442", "#7C5CBF", "#5B8C3A", "#A0522D",
];
const LEGEND_MAX = 10;
const DIM_ALPHA = "33";

export interface LegendEntry {
  community: number;
  color: string;
  label: string;
  size: number;
}

export function communityColor(community: number): string {
  return PALETTE[community % PALETTE.length];
}

/** Largest communities first, at most LEGEND_MAX, labelled with their top-3 names. */
export function legend(result: CommunityResult): LegendEntry[] {
  const sizes = new Map<number, number>();
  for (const c of result.byNode.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  return [...sizes]
    .map(([community, size]) => ({
      community,
      color: communityColor(community),
      label: result.labels.get(community) ?? "",
      size,
    }))
    .sort((a, b) => b.size - a.size || a.community - b.community)
    .slice(0, LEGEND_MAX);
}

/** Sets colour and a random start position per node. sigma reads `type` as a program name, so it is removed. */
export function paintGraph(graph: Graph, result: CommunityResult, random: () => number): void {
  graph.forEachNode((id) => {
    graph.mergeNodeAttributes(id, {
      color: communityColor(result.byNode.get(id) ?? 0),
      x: random() * 100,
      y: random() * 100,
    });
    graph.removeNodeAttribute(id, "type");
  });
}

/** The selected node and its neighbours, or null when nothing is selected or the id is not in the graph. */
export function litSet(graph: Graph, selected: string | null): Set<string> | null {
  if (selected === null || !graph.hasNode(selected)) return null;
  return new Set([selected, ...graph.neighbors(selected)]);
}

export interface Look {
  color: string;
  label: string | null;
  labelColor: string;
  zIndex: number;
  highlighted: boolean;
}

/** Display overrides for one node: lit nodes keep their colour, the rest fade and lose their label. */
export function nodeLook(
  id: string, color: string, label: string, lit: Set<string> | null, selected: string | null, textColor: string,
): Look {
  const base = { labelColor: textColor, color, label, zIndex: 1, highlighted: id === selected };
  if (lit === null || lit.has(id)) return base;
  return { ...base, color: `${textColor}${DIM_ALPHA}`, label: null, zIndex: 0 };
}

/** With a selection, only edges touching the selected node are drawn. */
export function edgeHidden(selected: string | null, lit: Set<string> | null, source: string, target: string): boolean {
  if (lit === null) return false;
  return source !== selected && target !== selected;
}
