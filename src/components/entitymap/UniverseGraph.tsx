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
const EDGE_LIGHT = "#cbd5e1aa";

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
    paintGraph(graph, result, Math.random);
    return legend(result);
  }, [graph]);
}

interface View {
  dark: boolean;
  selected: string | null;
}

/**
 * sigma and the FA2 worker live and die with the graph. Layout runs a few seconds, then stops.
 * Reducers read `view` (a ref local to this hook) so selection and theme changes need only a refresh.
 */
function useSigma(graph: Graph, view: View, onSelect: Props["onSelect"]) {
  const box = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sigma = useRef<Sigma | null>(null);
  useEffect(() => {
    if (box.current === null) return;
    const s = new Sigma(graph, box.current, {
      settings: { labelDensity: 0.5, labelGridCellSize: 90, labelRenderedSizeThreshold: 8 },
      nodeReducer: (id, d) => {
        const { dark, selected } = viewRef.current;
        return nodeLook(id, d.color, d.label ?? "", litSet(graph, selected), selected, dark ? TEXT_DARK : TEXT_LIGHT);
      },
      edgeReducer: (edge) => {
        const { dark, selected } = viewRef.current;
        const [source, target] = graph.extremities(edge);
        const hidden = edgeHidden(selected, litSet(graph, selected), source, target);
        return { color: dark ? EDGE_DARK : EDGE_LIGHT, visibility: hidden ? "hidden" : "visible" };
      },
    });
    const layout = new FA2Layout(graph, { settings: { ...forceAtlas2.inferSettings(graph), edgeWeightInfluence: 0 } });
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
