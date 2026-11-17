"use client";

import { ratioText } from "@/lib/entity-growth";
import { useEntityArticles, type EntityMapState } from "@/hooks/useEntityMap";
import type { EmergingState } from "@/hooks/useEmerging";
import {
  edgeBetween, growingFastest, isContext, isGrowing, isNewLink, neighboursOf, type MapData,
} from "./model";
import { BubbleDetail, NameCard } from "./NameCard";
import { nearKnown } from "./universe";
import type { GraphNode } from "@/lib/server/graph";

interface Props {
  dark: boolean;
  data: MapData;
  emerging: EmergingState;
  generatedAt: string;
  state: EntityMapState;
}

function growthText(n: GraphNode): string {
  if (n.state === "New") return "New";
  if (n.state === "Rising") return `▲ ×${ratioText(n.ratio)}`;
  return n.state;
}

export default function SidePanel({ dark, data, emerging, generatedAt, state }: Props) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const card = `rounded border p-3 ${dark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"}`;
  const subject = state.entityId;
  return (
    <aside className="flex flex-col gap-3 text-sm" aria-label="Map details">
      <Trace data={data} state={state} muted={muted} card={card} dark={dark} generatedAt={generatedAt} />
      <div className={card} data-testid="detail">
        {subject !== null && <EntityDetail data={data} id={subject} state={state} muted={muted} />}
        {subject === null && state.item !== null && <NameCard data={data} emerging={emerging} state={state} muted={muted} />}
        {subject === null && state.item === null && state.bubble !== null && <BubbleDetail emerging={emerging} state={state} muted={muted} />}
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
            <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => state.openName(i.anchors[0].id, i.key)}>
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
