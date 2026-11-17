"use client";

import { ratioText } from "@/lib/entity-growth";
import { useEntityArticles, type EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingLoad } from "@/hooks/useEmerging";
import type { EmergingItem } from "@/lib/emerging-types";
import {
  countStats, edgeBetween, growingFastest, isContext, isGrowing, isNewLink, neighboursOf, type MapData,
} from "./model";
import { groupByAnchor, nearKnown, NO_ANCHOR_LABEL } from "./universe";
import type { GraphNode } from "@/lib/server/graph";

interface Props {
  dark: boolean;
  data: MapData;
  emerging: EmergingLoad;
  generatedAt: string;
  total: { nodes: number; edges: number };
  state: EntityMapState;
}

function growthText(n: GraphNode): string {
  if (n.state === "New") return "New";
  if (n.state === "Rising") return `▲ ×${ratioText(n.ratio)}`;
  return n.state;
}

export default function SidePanel({ dark, data, emerging, generatedAt, total, state }: Props) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const card = `rounded border p-3 ${dark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"}`;
  const subject = state.entityId;
  return (
    <aside className="flex flex-col gap-3 text-sm" aria-label="Map details">
      <Stats data={data} total={total} muted={muted} card={card} />
      <Trace data={data} state={state} muted={muted} card={card} dark={dark} generatedAt={generatedAt} />
      <div className={card} data-testid="detail">
        {subject !== null && <EntityDetail data={data} id={subject} state={state} muted={muted} />}
        {subject === null && state.bubble !== null && <BubbleDetail data={data} emerging={emerging} state={state} muted={muted} />}
        {subject === null && state.bubble === null && (
          <>
            <NewNear emerging={emerging} state={state} muted={muted} />
            <Fastest data={data} state={state} muted={muted} />
          </>
        )}
      </div>
    </aside>
  );
}

function Stats({ data, total, muted, card }: { data: MapData; total: Props["total"]; muted: string; card: string }) {
  const withCtx = countStats(data, true);
  const without = countStats(data, false);
  const rows: Array<[string, number, number]> = [
    ["Entities", withCtx.entities, without.entities],
    ["Links", withCtx.links, without.links],
    ["Islands", withCtx.islands, without.islands],
    ["Not connected to anything", withCtx.isolated, without.isolated],
  ];
  return (
    <div className={card} data-testid="stats">
      <table className="w-full">
        <thead className={muted}>
          <tr><th className="text-left font-normal" /><th className="text-right font-normal">With context</th><th className="text-right font-normal">Without</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}><td>{label}</td><td className="text-right tabular-nums">{a}</td><td className="text-right tabular-nums">{b}</td></tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-2 text-xs ${muted}`}>
        Showing new and rising entities and their neighbours: {data.nodes.length} of {total.nodes} entities.
      </p>
    </div>
  );
}

function NewNear({ emerging, state, muted }: { emerging: EmergingLoad; state: EntityMapState; muted: string }) {
  const list = emerging.status === "ready" ? nearKnown(emerging.data.items) : [];
  return (
    <>
      <h3 className="mb-1 font-semibold">New near known</h3>
      {emerging.status === "loading" && <p className={muted}>Loading new names...</p>}
      {emerging.status === "error" && <p className={muted}>New names could not be loaded.</p>}
      {emerging.status === "ready" && list.length === 0 && <p className={muted}>No new names next to known entities.</p>}
      <ol className="flex flex-col gap-1">
        {list.map((i) => (
          <li key={i.key}>
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.setBubble(i.anchors[0].id)}>
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
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.goEntity(n.id)}>
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
      <p className={muted}>{n.type}, {n.status === "tracked" ? "tracked" : "not tracked"}, {n.mentions14d} mentions in 14 days</p>
      {isGrowing(n) && <p className="text-sky-600">{growthText(n)}</p>}
      <div className="my-2 flex flex-wrap gap-1">
        {state.entityId !== id && <button type="button" className="rounded border px-2 py-1" onClick={() => state.goEntity(id)}>Open entity level</button>}
        <button type="button" className="rounded border px-2 py-1" onClick={() => state.setFrom(id)}>Trace from here</button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => state.setTo(id)}>Trace to here</button>
      </div>
      {links.length > 0 && <p className={muted}>Linked to</p>}
      <ul>{links.map(({ node, edge }) => (
        <li key={node.id}><button type="button" className="hover:underline" onClick={() => state.goEntity(node.id)}>{node.name}</button> <span className={muted}>{edge.articleCount} articles</span></li>
      ))}</ul>
      <Articles evidence={evidence} muted={muted} />
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

const MAX_LISTED = 30;

function BubbleDetail({ data, emerging, state, muted }: { data: MapData; emerging: EmergingLoad; state: EntityMapState; muted: string }) {
  const bubble = emerging.status === "ready" ? groupByAnchor(emerging.data.items).find((b) => b.id === state.bubble) : undefined;
  if (bubble === undefined) return <p className={muted}>These new names are no longer listed.</p>;
  const shown = bubble.items.slice(0, MAX_LISTED);
  return (
    <div data-testid="bubble-detail">
      <h3 className="font-semibold">{bubble.label}</h3>
      <p className={muted}>{bubble.items.length} new {bubble.items.length === 1 ? "name" : "names"}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {shown.map((i) => <NewName key={i.key} item={i} data={data} state={state} muted={muted} />)}
      </ul>
      {bubble.items.length > shown.length && <p className={`mt-2 ${muted}`}>and {bubble.items.length - shown.length} more</p>}
    </div>
  );
}

function NewName({ item, data, state, muted }: { item: EmergingItem; data: MapData; state: EntityMapState; muted: string }) {
  const others = item.anchors.slice(1);
  const inGraph = item.kind === "entity" && data.byId.has(item.key);
  return (
    <li>
      <p className="font-medium">{item.name} <span className={`font-normal ${muted}`}>{item.type}</span></p>
      <p className={muted}>First seen {item.firstSeenAt.slice(0, 10)}, {item.mentions} {item.mentions === 1 ? "mention" : "mentions"}</p>
      {others.length > 0 && <p className={muted}>Also near {others.map((a) => a.name).join(", ")}</p>}
      {item.anchors.length === 0 && <p className={muted}>{NO_ANCHOR_LABEL}</p>}
      <ul className="list-disc pl-4">{item.sampleTitles.map((t) => <li key={t}>{t}</li>)}</ul>
      {inGraph && <button type="button" className="mt-1 rounded border px-2 py-0.5 text-xs" onClick={() => state.goEntity(item.key)}>Open entity level</button>}
    </li>
  );
}
