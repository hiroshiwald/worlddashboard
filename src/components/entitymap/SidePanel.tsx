"use client";

import { ratioText } from "@/lib/entity-growth";
import { useEntityArticles, type EntityMapState } from "@/hooks/useEntityMap";
import {
  alsoTouches, countStats, edgeBetween, growingFastest, isContext, isGrowing, isNewLink, neighboursOf,
  TOPICS_NOTE, type MapData,
} from "./model";
import type { GraphNode } from "@/lib/server/graph";

interface Props {
  dark: boolean;
  data: MapData;
  generatedAt: string;
  total: { nodes: number; edges: number };
  state: EntityMapState;
}

function growthText(n: GraphNode): string {
  if (n.state === "New") return "New";
  if (n.state === "Rising") return `▲ ×${ratioText(n.ratio)}`;
  return n.state;
}

export default function SidePanel({ dark, data, generatedAt, total, state }: Props) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const card = `rounded border p-3 ${dark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"}`;
  const subject = state.entityId ?? (state.sel?.t === "n" ? state.sel.id : null);
  return (
    <aside className="flex flex-col gap-3 text-sm" aria-label="Map details">
      <Stats data={data} total={total} muted={muted} card={card} />
      <Trace data={data} state={state} muted={muted} card={card} dark={dark} generatedAt={generatedAt} />
      <div className={card} data-testid="detail">
        {subject !== null && <EntityDetail data={data} id={subject} state={state} muted={muted} />}
        {subject === null && state.sel?.t === "g" && <GroupDetail data={data} id={state.sel.id} state={state} muted={muted} />}
        {subject === null && state.sel?.t === "e" && (
          <EdgeDetail data={data} a={state.sel.a} b={state.sel.b} generatedAt={generatedAt} muted={muted} />
        )}
        {subject === null && state.sel === null && <Fastest data={data} state={state} muted={muted} />}
      </div>
      {state.scope.length > 0 && state.entityId === null && <ScopeDetail data={data} state={state} muted={muted} card={card} />}
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
      {!data.usesClusters && <p className={`mt-1 text-xs ${muted}`}>{TOPICS_NOTE}</p>}
    </div>
  );
}

function Fastest({ data, state, muted }: { data: MapData; state: EntityMapState; muted: string }) {
  const list = growingFastest(data);
  return (
    <>
      <h3 className="mb-1 font-semibold">Growing fastest</h3>
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

function GroupDetail({ data, id, state, muted }: { data: MapData; id: string; state: EntityMapState; muted: string }) {
  const g = data.groups.find((x) => x.id === id);
  if (!g) return null;
  const members = g.ids.map((m) => data.byId.get(m)!).sort((a, b) => b.ratio - a.ratio).slice(0, 12);
  return (
    <>
      <h3 className="font-semibold">{g.label}</h3>
      <p className={muted}>{g.ids.length} entities{g.rising > 0 ? `, ${g.rising} growing` : ""}</p>
      <button type="button" className="my-2 rounded border px-2 py-1" onClick={() => state.goScope([g.id])}>Focus this group</button>
      <ul>{members.map((n) => <li key={n.id}><button type="button" className="hover:underline" onClick={() => state.goEntity(n.id)}>{n.name}</button></li>)}</ul>
    </>
  );
}

function ScopeDetail({ data, state, muted, card }: { data: MapData; state: EntityMapState; muted: string; card: string }) {
  const touches = alsoTouches(data, state.scope).slice(0, 8);
  const ids = state.scope.flatMap((g) => data.groups.find((x) => x.id === g)?.ids ?? []);
  const fastest = ids.map((i) => data.byId.get(i)!).sort((a, b) => b.ratio - a.ratio).slice(0, 10);
  return (
    <div className={card} data-testid="scope-detail">
      <h3 className="mb-1 font-semibold">Fastest growing here</h3>
      <ol>{fastest.map((n) => (
        <li key={n.id}><button type="button" className="hover:underline" onClick={() => state.goEntity(n.id)}>{n.name}</button> <span className={muted}>{growthText(n)}</span></li>
      ))}</ol>
      {touches.length > 0 && <p className={`mt-2 ${muted}`}>Also touches</p>}
      <div className="flex flex-wrap gap-1">
        {touches.map((g) => (
          <button key={g.id} type="button" className="rounded-full border px-2 py-0.5 text-xs" onClick={() => state.goScope([...state.scope, g.id])}>+ {g.label}</button>
        ))}
      </div>
    </div>
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

function EdgeDetail({ data, a, b, generatedAt, muted }: { data: MapData; a: string; b: string; generatedAt: string; muted: string }) {
  const edge = edgeBetween(data, a, b);
  if (!edge) return null;
  return (
    <>
      <h3 className="font-semibold">{data.byId.get(a)?.name} and {data.byId.get(b)?.name}</h3>
      <p className={muted}>{edge.articleCount} articles mention both. First together {edge.firstSeenAt.slice(0, 10)}.</p>
      {isNewLink(edge, generatedAt) && <p className="text-sky-600">New in the last 2 days</p>}
      <p className={muted}>Article evidence for a link is not available yet.</p>
    </>
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
