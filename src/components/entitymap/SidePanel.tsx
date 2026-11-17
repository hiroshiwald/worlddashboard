"use client";

import { useMemo } from "react";
import type Graph from "graphology";
import { ratioText } from "@/lib/entity-growth";
import { useEntityArticles, type EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingState } from "@/hooks/useEmerging";
import {
  edgeBetween, growingFastest, isContext, isGrowing, isNewLink, neighboursOf, type MapData,
} from "./model";
import { NameCard } from "./NameCard";
import { brokers, newEdges } from "./graph-metrics";
import { nearKnown } from "./universe";
import type { GraphNode } from "@/lib/server/graph";

interface Props {
  dark: boolean;
  data: MapData;
  emerging: EmergingState;
  generatedAt: string;
  graph: Graph;
  state: EntityMapState;
}

function growthText(n: GraphNode): string {
  if (n.state === "New") return "New";
  if (n.state === "Rising") return `▲ ×${ratioText(n.ratio)}`;
  return n.state;
}

export default function SidePanel({ dark, data, emerging, generatedAt, graph, state }: Props) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const card = `rounded border p-3 ${dark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"}`;
  const picked = pickedKind(data, emerging, state.selected);
  return (
    <aside className="flex flex-col gap-3 text-sm lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto" aria-label="Map details">
      <div className={card} data-testid="detail">
        {picked === "name" && <NameCard emerging={emerging} state={state} muted={muted} />}
        {picked === "entity" && <EntityDetail data={data} id={state.selected!} state={state} muted={muted} />}
        {picked === "gone" && <p className={muted}>This node is no longer listed.</p>}
        {picked === "none" && (
          <>
            <NewNear emerging={emerging} state={state} muted={muted} />
            <Fastest data={data} state={state} muted={muted} />
          </>
        )}
      </div>
      <div className={card} data-testid="graph-insights">
        <Brokers graph={graph} generatedAt={generatedAt} state={state} muted={muted} />
        <NewLinks data={data} graph={graph} generatedAt={generatedAt} state={state} muted={muted} />
      </div>
      <Trace data={data} state={state} muted={muted} card={card} dark={dark} generatedAt={generatedAt} />
    </aside>
  );
}

type Picked = "none" | "name" | "entity" | "gone";

/** What the clicked node is: a new name (has a card), a known entity, or neither any more. */
function pickedKind(data: MapData, emerging: EmergingState, selected: string | null): Picked {
  if (selected === null) return "none";
  const items = emerging.load.status === "ready" ? emerging.load.data.items : [];
  if (items.some((i) => i.key === selected)) return "name";
  return data.byId.has(selected) ? "entity" : "gone";
}

function NewNear({ emerging, state, muted }: { emerging: EmergingState; state: EntityMapState; muted: string }) {
  const { load } = emerging;
  const list = nearKnown(emerging.visible);
  return (
    <>
      <h3 className="mb-1 font-semibold">New near known</h3>
      {load.status === "loading" && <p className={muted}>Loading new names...</p>}
      {load.status === "error" && <p className={muted}>New names could not be loaded.</p>}
      {load.status === "ready" && list.length === 0 && <p className={muted}>No new names next to known entities.</p>}
      <ol className="flex flex-col gap-1">
        {list.map((i) => (
          <li key={i.key}>
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.select(i.key)}>
              <span>{i.name}</span><span className={muted}>near {i.anchors[0].name}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function Fastest({ data, state, muted }: { data: MapData; state: EntityMapState; muted: string }) {
  const list = growingFastest(data);
  return (
    <>
      <h3 className="mb-1 mt-3 font-semibold">Growing fastest</h3>
      {list.length === 0 && <p className={muted}>Nothing is new or rising right now.</p>}
      <ol className="flex flex-col gap-1">
        {list.map((n) => (
          <li key={n.id}>
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.select(n.id)}>
              <span>{n.name}</span><span className="tabular-nums text-sky-600">{growthText(n)}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function EntityDetail({ data, id, state, muted }: { data: MapData; id: string; state: EntityMapState; muted: string }) {
  const n = data.byId.get(id);
  const evidence = useEntityArticles(id);
  if (!n) return null;
  const links = neighboursOf(data, id).slice(0, 6);
  return (
    <>
      <h3 className="font-semibold">{n.name}{isContext(n) || n.role === "famous" ? <span className={`ml-2 text-xs font-normal ${muted}`}>Context</span> : null}</h3>
      <p className={muted}>{n.type}, {n.followed ? "tracked" : "not tracked"}, {n.mentions14d} mentions in 14 days</p>
      {isGrowing(n) && <p className="text-sky-600">{growthText(n)}</p>}
      <div className="my-2 flex flex-wrap gap-1">
        <button type="button" className="rounded border px-2 py-1" onClick={() => state.setFrom(id)}>Trace from here</button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => state.setTo(id)}>Trace to here</button>
      </div>
      {links.length > 0 && <p className={muted}>Linked to</p>}
      <ul>{links.map(({ node, edge }) => (
        <li key={node.id}><button type="button" className="hover:underline" onClick={() => state.select(node.id)}>{node.name}</button> <span className={muted}>{edge.articleCount} articles</span></li>
      ))}</ul>
      <Articles evidence={evidence} muted={muted} />
    </>
  );
}

function Brokers({ graph, generatedAt, state, muted }: { graph: Graph; generatedAt: string; state: EntityMapState; muted: string }) {
  const list = useMemo(() => brokers(graph, new Date(generatedAt)).filter((b) => b.now > b.before), [graph, generatedAt]);
  return (
    <>
      <h3 className="mb-1 font-semibold">New brokers</h3>
      {list.length === 0 && <p className={muted}>No entity gained a bridging role this week.</p>}
      <ol className="flex flex-col gap-1" data-testid="brokers">
        {list.map((b) => (
          <li key={b.id}>
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.select(b.id)}>
              <span>{b.name}</span><span className={`tabular-nums ${muted}`}>{Math.round(b.before)} to {Math.round(b.now)}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

interface NewLinksProps { data: MapData; graph: Graph; generatedAt: string; state: EntityMapState; muted: string }

function NewLinks({ data, graph, generatedAt, state, muted }: NewLinksProps) {
  const list = useMemo(
    () => newEdges(data.edges, new Date(generatedAt)).filter((e) => graph.hasNode(e.a) && graph.hasNode(e.b)).slice(0, 10),
    [data, graph, generatedAt],
  );
  return (
    <>
      <h3 className="mb-1 mt-3 font-semibold">New links this week</h3>
      {list.length === 0 && <p className={muted}>No new links this week.</p>}
      <ol className="flex flex-col gap-1" data-testid="new-links">
        {list.map((e) => (
          <li key={`${e.a}|${e.b}`}>
            <button type="button" className="text-left hover:underline" onClick={() => state.select(e.a)}>
              {data.byId.get(e.a)?.name} and {data.byId.get(e.b)?.name}
            </button>
            <span className={`ml-1 ${muted}`}>{e.articleCount} articles</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Articles({ evidence, muted }: { evidence: ReturnType<typeof useEntityArticles>; muted: string }) {
  return (
    <div className="mt-2" data-testid="evidence">
      <p className={muted}>Evidence</p>
      {(evidence === null || evidence.status === "loading") && <p className={muted}>Loading articles...</p>}
      {evidence?.status === "error" && <p className={muted}>Articles could not be loaded.</p>}
      {evidence?.status === "ready" && evidence.articles.length === 0 && <p className={muted}>No recent articles.</p>}
      {evidence?.status === "ready" && (
        <ul>{evidence.articles.map((a) => (
          <li key={a.id}><a className="text-sky-600 hover:underline" href={a.link} target="_blank" rel="noopener noreferrer">{a.title}</a> <span className={muted}>{a.sourceName}</span></li>
        ))}</ul>
      )}
    </div>
  );
}

function Trace({ data, state, muted, card, dark, generatedAt }: { data: MapData; state: EntityMapState; muted: string; card: string; dark: boolean; generatedAt: string }) {
  const options = data.nodes.slice().sort((x, y) => x.name.localeCompare(y.name));
  const field = `w-full rounded border px-1 py-1 ${dark ? "border-slate-600 bg-slate-900" : "border-gray-300 bg-white"}`;
  const pick = (label: string, value: string, set: (v: string) => void) => (
    <label className="block">{label}
      <select className={field} value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">Choose an entity</option>
        {options.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
    </label>
  );
  const t = state.trace;
  return (
    <div className={card} data-testid="trace">
      <h3 className="mb-1 font-semibold">Trace a connection</h3>
      <div className="flex flex-col gap-1">{pick("From", state.from, state.setFrom)}{pick("To", state.to, state.setTo)}</div>
      {t.kind === "unreachable" && <p className={`mt-2 ${muted}`}>These two never appear together in the entities shown.</p>}
      {t.kind === "path" && (
        <div className="mt-2" data-testid="trace-result">
          {t.viaContext && <p className={muted}>This path exists only through context entities.</p>}
          <p>{t.path.length - 1} {t.path.length === 2 ? "hop" : "hops"}</p>
          <ol>{t.path.slice(1).map((id, i) => {
            const prev = t.path[i];
            const e = edgeBetween(data, prev, id);
            return <li key={id}>{data.byId.get(prev)?.name} to {data.byId.get(id)?.name}: {e?.articleCount ?? 0} articles{e !== undefined && isNewLink(e, generatedAt) ? ", new" : ""}</li>;
          })}</ol>
          <p className={muted}>Article evidence per hop is not available yet.</p>
        </div>
      )}
      {(state.from !== "" || state.to !== "") && (
        <button type="button" className="mt-2 rounded border px-2 py-1" onClick={() => { state.setFrom(""); state.setTo(""); }}>Clear trace</button>
      )}
    </div>
  );
}
