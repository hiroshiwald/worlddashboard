// Pure shaping for the Universe force graph: known entities plus new names, as nodes and links.
import type { EmergingItem } from "@/lib/emerging-types";
import type { GraphEdge, GraphNode } from "@/lib/server/graph";

const MAJOR_MENTIONS = 30; // known entities this busy are always labelled

export interface UniNode {
  id: string; // entity id, or the candidate key for a name not yet an entity
  name: string;
  isNew: boolean;
  radius: number;
  labelled: boolean; // always labelled; others only on hover or selection
}

export interface UniLink {
  source: string;
  target: string;
}

export interface Universe {
  nodes: UniNode[];
  links: UniLink[];
  neighbours: Map<string, Set<string>>;
}

export function nodeRadius(mentions: number, isNew: boolean): number {
  const base = isNew ? 4 : 2;
  return base + Math.min(10, Math.sqrt(Math.max(0, mentions)) * 0.8);
}

function knownNode(n: GraphNode, isNew: boolean): UniNode {
  return {
    id: n.id, name: n.name, isNew, radius: nodeRadius(n.mentions14d, isNew),
    labelled: isNew || n.mentions14d >= MAJOR_MENTIONS,
  };
}

function nameNode(item: EmergingItem): UniNode {
  return { id: item.key, name: item.name, isNew: true, radius: nodeRadius(item.mentions, true), labelled: true };
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Merge the graph and the emerging names. A name that is already a graph entity is marked new, not duplicated. */
export function buildUniverse(graphNodes: GraphNode[], edges: GraphEdge[], names: EmergingItem[]): Universe {
  const newIds = new Set(names.map((i) => i.key));
  const nodes = graphNodes.map((n) => knownNode(n, newIds.has(n.id)));
  const ids = new Set(nodes.map((n) => n.id));
  for (const item of names) {
    if (ids.has(item.key)) continue;
    nodes.push(nameNode(item));
    ids.add(item.key);
  }
  const pairs: Array<[string, string]> = edges.map((e) => [e.a, e.b]);
  for (const item of names) {
    for (const anchor of item.anchors) pairs.push([item.key, anchor.id]);
  }
  const seen = new Set<string>();
  const links: UniLink[] = [];
  const neighbours = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const [a, b] of pairs) {
    if (a === b || !ids.has(a) || !ids.has(b) || seen.has(linkKey(a, b))) continue;
    seen.add(linkKey(a, b));
    links.push({ source: a, target: b });
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  return { nodes, links, neighbours };
}

/** Which labels to draw: the always-labelled, the hovered, the selected and its neighbours. */
export function showLabel(node: UniNode, hovered: string | null, selected: string | null, neighbours: Map<string, Set<string>>): boolean {
  if (node.labelled || node.id === hovered || node.id === selected) return true;
  return selected !== null && neighbours.get(selected)?.has(node.id) === true;
}
