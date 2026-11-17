"use client";

import { useEffect, useMemo, useRef } from "react";
import type Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { communities } from "./graph-metrics";
import { edgeHidden, legend, litSet, nodeLook, paintGraph } from "./universe-view";

const LAYOUT_MS = 4000;
const TEXT_DARK = "#e2e8f0";
const TEXT_LIGHT = "#1e293b";
const EDGE_DARK = "#33415566";
const EDGE_LIGHT = "#94a3b866";

interface Props {
  dark: boolean;
  graph: Graph;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** Colours and positions a graph once; the result is the same object, painted. */
function usePaintedGraph(graph: Graph) {
  return useMemo(() => {
    const result = communities(graph);
    const entries = legend(result);
    paintGraph(graph, result, entries, Math.random);
    return entries;
  }, [graph]);
}

interface View {
  dark: boolean;
  selected: string | null;
}

interface ViewState extends View {
  lit: Set<string> | null;
}

// Label density grid: at the default zoom only the biggest node per cell gets a
// label; zooming in shrinks the cells in graph space, so more names appear.
// Strong gravity keeps small disconnected pieces next to the core.
const SIGMA_SETTINGS = {
  labelDensity: 1,
  labelGridCellSize: 100,
  labelRenderedSizeThreshold: 0,
  labelColor: { attribute: "labelColor" },
  zIndex: true,
};

/**
 * sigma and the FA2 worker live and die with the graph. Layout runs a few seconds, then stops.
 * Reducers read `view` (a ref local to this hook) so selection and theme changes need only a refresh.
 */
function useSigma(graph: Graph, view: View, onSelect: Props["onSelect"]) {
  const box = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>({ ...view, lit: null });
  viewRef.current = { ...view, lit: litSet(graph, view.selected) };
  const sigma = useRef<Sigma | null>(null);
  useEffect(() => {
    if (box.current === null) return;
    const s = new Sigma(graph, box.current, {
      ...SIGMA_SETTINGS,
      nodeReducer: (id, d) => {
        const { dark, selected, lit } = viewRef.current;
        return { ...d, ...nodeLook(id, d.color, d.label ?? "", lit, selected, dark ? TEXT_DARK : TEXT_LIGHT) };
      },
      edgeReducer: (edge, d) => {
        const { dark, selected, lit } = viewRef.current;
        const [source, target] = graph.extremities(edge);
        return { ...d, color: dark ? EDGE_DARK : EDGE_LIGHT, hidden: edgeHidden(selected, lit, source, target) };
      },
    });
    const settings = { ...forceAtlas2.inferSettings(graph), strongGravityMode: true, gravity: 1, edgeWeightInfluence: 0 };
    const layout = new FA2Layout(graph, { settings });
    layout.start();
    const stop = window.setTimeout(() => layout.stop(), LAYOUT_MS);
    s.on("clickNode", ({ node }) => onSelect(node));
    s.on("clickStage", () => onSelect(null));
    sigma.current = s;
    return () => {
      window.clearTimeout(stop);
      layout.kill();
      s.kill();
      sigma.current = null;
    };
  }, [graph, onSelect]);
  useEffect(() => {
    sigma.current?.refresh();
  }, [view.dark, view.selected]);
  return box;
}

/** The whole universe in one sigma view. Click a node to light it and its neighbours. */
export default function UniverseGraph({ dark, graph, selected, onSelect }: Props) {
  const entries = usePaintedGraph(graph);
  const box = useSigma(graph, { dark, selected }, onSelect);
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs" data-testid="universe-legend">
        {entries.map((e) => (
          <li key={e.community} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: e.color }} />
            {e.label}
          </li>
        ))}
      </ul>
      <div ref={box} className="h-[60vh] min-h-[320px] w-full lg:h-[calc(100vh-10rem)]" data-testid="universe-graph" />
    </div>
  );
}
