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
  const base = isNew ? 5 : 3;
  return base + Math.min(12, Math.sqrt(Math.max(0, mentions)) * 1.2);
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

const TOP_KNOWN = 40;

/** Pure. The known entities worth drawing: every anchor of a new name, every
 * graph entity that is itself new, and the 40 busiest. The full graph (1,600+
 * nodes) is one unreadable knot. */
export function universeNodes(graphNodes: GraphNode[], names: EmergingItem[]): GraphNode[] {
  const keep = new Set<string>();
  for (const item of names) {
    keep.add(item.key);
    for (const a of item.anchors) keep.add(a.id);
  }
  const busiest = [...graphNodes].sort((a, b) => b.mentions14d - a.mentions14d).slice(0, TOP_KNOWN);
  for (const n of busiest) keep.add(n.id);
  return graphNodes.filter((n) => keep.has(n.id));
}

/** Merge the graph and the emerging names. A name that is already a graph entity is marked new, not duplicated. */
export function buildUniverse(graphNodes: GraphNode[], edges: GraphEdge[], names: EmergingItem[]): Universe {
  const newIds = new Set(names.map((i) => i.key));
  const nodes = universeNodes(graphNodes, names).map((n) => knownNode(n, newIds.has(n.id)));
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
  // Unlinked nodes drift to the edge and make zoom-to-fit shrink the core; leave them out.
  const linked = nodes.filter((n) => (neighbours.get(n.id)?.size ?? 0) > 0);
  for (const n of nodes) if ((neighbours.get(n.id)?.size ?? 0) === 0) neighbours.delete(n.id);
  return { nodes: pickLabelled(linked), links, neighbours };
}

const LABELLED_NEW = 12;
const LABELLED_KNOWN = 10;

/** Pure. At the overview only the biggest names carry a label: the top 12 new
 * names and the top 10 known entities by size. Others show on hover or selection. */
export function pickLabelled(nodes: UniNode[]): UniNode[] {
  const top = (isNew: boolean, n: number) =>
    new Set(nodes.filter((x) => x.isNew === isNew).sort((a, b) => b.radius - a.radius || a.name.localeCompare(b.name)).slice(0, n).map((x) => x.id));
  const keep = new Set([...top(true, LABELLED_NEW), ...top(false, LABELLED_KNOWN)]);
  return nodes.map((x) => ({ ...x, labelled: keep.has(x.id) }));
}

/** Which labels to draw: the always-labelled, the hovered, the selected and its neighbours. */
export function showLabel(node: UniNode, hovered: string | null, selected: string | null, neighbours: Map<string, Set<string>>): boolean {
  if (node.labelled || node.id === hovered || node.id === selected) return true;
  return selected !== null && neighbours.get(selected)?.has(node.id) === true;
}

interface Moving { x?: number; y?: number; vx?: number; vy?: number }

/** Pure d3-style force: pulls every node toward the origin. The built-in
 * "center" force only moves the mean, so small disconnected pieces drift
 * out and zoomToFit shrinks the core. This keeps them near the core. */
export function centringForce(strength: number) {
  let nodes: Moving[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * strength * alpha;
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * strength * alpha;
    }
  };
  force.initialize = (next: Moving[]) => { nodes = next; };
  return force;
}
