"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { timeAgo } from "@/lib/date-utils";
import {
  EntityRole, FAME_VERDICT_LABELS, roleDescription, formatActivity30d, formatSinceDate, isNewEdge, formatWikiEvidence,
} from "@/components/entities";

interface EntityProfile {
  id: number;
  canonicalName: string;
  type: string;
  status: string;
  aliases: string[];
  fame: string;
  fameLocked: boolean;
  wikiTitle: string | null;
  wikiSitelinks: number | null;
  wikiPageviewsMonthly: number | null;
  fameCheckedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string | null;
  role: EntityRole;
  roleReasons: string[];
}

interface ActivitySummary {
  mentions30d: number;
  sources30d: number;
}

interface SeriesPoint {
  bucket: string;
  mentions: number;
}

interface ArticleItem {
  id: number;
  title: string;
  link: string;
  sourceName: string;
  published: string;
}

// The article behind a stated relation, when it still resolves to a
// retained cluster head — spine #2 fix: relations previously dropped this
// entirely (evidence_article_id was never joined or rendered).
interface RelationEvidence {
  title: string;
  link: string;
}

interface RelatedEntity {
  id: number;
  name: string;
  articleCount: number;
  firstSeenAt: string;
}

interface RelationEdge {
  relation: string;
  id: number;
  name: string;
  articleCount: number;
  lastSeenAt: string;
  evidence: RelationEvidence | null;
}

interface EntityDetail {
  entity: EntityProfile;
  activity: ActivitySummary;
  series: SeriesPoint[];
  articles: ArticleItem[];
  edges: RelatedEntity[];
  relations: { incoming: RelationEdge[]; outgoing: RelationEdge[] };
}

async function fetchEntityDetail(id: number): Promise<EntityDetail> {
  const res = await fetch(`/api/entities/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load entity (${res.status})`);
  return res.json();
}

function Sparkline({ series, dark }: { series: SeriesPoint[]; dark: boolean }) {
  if (series.length === 0) {
    return <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>No recent activity</p>;
  }
  const width = 280;
  const height = 48;
  const max = Math.max(1, ...series.map((p) => p.mentions));
  const stepX = series.length > 1 ? width / (series.length - 1) : width;
  const points = series
    .map((p, i) => `${(i * stepX).toFixed(1)},${(height - (p.mentions / max) * height).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={dark ? "#38bdf8" : "#2563eb"} strokeWidth={2} />
      {series.map((p, i) => (
        <circle key={p.bucket} cx={i * stepX} cy={height - (p.mentions / max) * height} r={1.5} fill={dark ? "#38bdf8" : "#2563eb"}>
          <title>{`${new Date(p.bucket).toLocaleString()}: ${p.mentions} mentions`}</title>
        </circle>
      ))}
    </svg>
  );
}

function EntityHeader({ entity, dark }: { entity: EntityProfile; dark: boolean }) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  return (
    <div className="mb-4">
      <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-gray-900"}`}>{entity.canonicalName}</h2>
      <p className={`text-xs uppercase tracking-wide mt-1 ${dark ? "text-slate-500" : "text-gray-400"}`}>
        {entity.type} &middot; {entity.status}
      </p>
      {entity.aliases.length > 0 && <p className={`text-xs mt-1 ${muted}`}>{entity.aliases.join(", ")}</p>}
      <p className={`text-xs mt-1 ${muted}`}>{roleDescription(entity.role, entity.roleReasons)}</p>
      <p className={`text-xs mt-1 ${muted}`}>First seen {new Date(entity.firstSeenAt).toLocaleDateString()}</p>
    </div>
  );
}

// The fame verdict, its lock state, and its Wikipedia evidence — the fame
// block the tab already surfaced in the table now moves fully into the
// panel (fameCheckedAt included), alongside the wiki fields the dossier
// previously omitted entirely. Missing values render nothing (never "null").
function FameBlock({ entity, dark }: { entity: EntityProfile; dark: boolean }) {
  const muted = dark ? "text-slate-400" : "text-gray-500";
  const verdict = FAME_VERDICT_LABELS[entity.fame as keyof typeof FAME_VERDICT_LABELS] ?? entity.fame;
  const wikiEvidence = formatWikiEvidence(entity.wikiSitelinks, entity.wikiPageviewsMonthly);
  const wikiUrl = entity.wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(entity.wikiTitle.replace(/ /g, "_"))}`
    : null;
  return (
    <section className="mt-5">
      <h3 className={`text-sm font-semibold mb-2 ${dark ? "text-slate-200" : "text-gray-800"}`}>Fame</h3>
      <p className={`text-sm ${dark ? "text-slate-100" : "text-gray-900"}`}>
        {verdict}{entity.fameLocked ? " · locked" : ""}
      </p>
      {wikiUrl && (
        <a
          href={wikiUrl} target="_blank" rel="noopener noreferrer"
          className={`text-xs hover:underline ${dark ? "text-blue-300" : "text-blue-600"}`}
        >
          {entity.wikiTitle} ↗
        </a>
      )}
      {wikiEvidence && <p className={`text-xs mt-0.5 ${muted}`}>{wikiEvidence}</p>}
      <p className={`text-xs mt-0.5 ${muted}`}>
        {entity.fameCheckedAt ? `checked ${timeAgo(entity.fameCheckedAt)}` : "never checked"}
      </p>
    </section>
  );
}

function ArticleList({ articles, dark }: { articles: ArticleItem[]; dark: boolean }) {
  if (articles.length === 0) {
    return <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>No articles yet</p>;
  }
  return (
    <ul className="space-y-2.5">
      {articles.map((a) => (
        <li key={a.id}>
          <a
            href={a.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm hover:underline ${dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600"}`}
          >
            {a.title}
          </a>
          <p className={`text-xs mt-0.5 ${dark ? "text-slate-500" : "text-gray-400"}`}>
            {a.sourceName} &middot; {new Date(a.published).toLocaleDateString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

// One relation row: the stated claim plus (spine #2 fix) an evidence link
// when the relation carries a still-resolvable article — a relation with
// null evidence renders exactly as before, no link, no placeholder.
function RelationRow({ r, label, dark, onSelect }: { r: RelationEdge; label: string; dark: boolean; onSelect: (id: number) => void }) {
  const rowCls = `text-xs px-2.5 py-1.5 rounded-lg text-left flex-1 ${dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-600"}`;
  const evidenceCls = dark ? "text-slate-500 hover:text-blue-300" : "text-gray-400 hover:text-blue-600";
  return (
    <li className="flex items-center gap-1.5">
      <button onClick={() => onSelect(r.id)} className={rowCls}>{label}</button>
      {r.evidence && (
        <a href={r.evidence.link} target="_blank" rel="noopener noreferrer" title={r.evidence.title} aria-label={`Evidence: ${r.evidence.title}`} className={evidenceCls}>
          ↗
        </a>
      )}
    </li>
  );
}

// Typed, directed relations (spine #2: evidence one click away) — distinct
// from the plain co-occurrence chips below: each line states the specific
// stated relation, not just "appears together".
function RelationsList({
  relations, entityName, dark, onSelect,
}: { relations: { incoming: RelationEdge[]; outgoing: RelationEdge[] }; entityName: string; dark: boolean; onSelect: (id: number) => void }) {
  if (relations.incoming.length === 0 && relations.outgoing.length === 0) {
    return <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>No stated relations yet</p>;
  }
  return (
    <ul className="space-y-1.5">
      {relations.outgoing.map((r) => (
        <RelationRow key={`out-${r.relation}-${r.id}`} r={r} label={`${entityName} ${r.relation.replace(/_/g, " ")} ${r.name}`} dark={dark} onSelect={onSelect} />
      ))}
      {relations.incoming.map((r) => (
        <RelationRow key={`in-${r.relation}-${r.id}`} r={r} label={`${r.name} ${r.relation.replace(/_/g, " ")} ${entityName}`} dark={dark} onSelect={onSelect} />
      ))}
    </ul>
  );
}

// Each chip gains its connection recency ("since <date>") and a "new"
// marker when the first co-occurrence is within the trailing 7 days.
function RelatedEntities({ edges, dark, onSelect }: { edges: RelatedEntity[]; dark: boolean; onSelect: (id: number) => void }) {
  if (edges.length === 0) {
    return <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>No related entities yet</p>;
  }
  const chipCls = dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-600";
  const newBadgeCls = dark ? "text-emerald-400" : "text-emerald-600";
  return (
    <div className="flex flex-wrap gap-2">
      {edges.map((edge) => (
        <button key={edge.id} onClick={() => onSelect(edge.id)} className={`text-xs px-2.5 py-1 rounded-full ${chipCls}`}>
          {edge.name} ({edge.articleCount}) &middot; {formatSinceDate(edge.firstSeenAt)}
          {isNewEdge(edge.firstSeenAt) && <span className={`ml-1 font-semibold ${newBadgeCls}`}>new</span>}
        </button>
      ))}
    </div>
  );
}

// The 30-day activity summary sits next to the (7-day) sparkline — labeled
// separately so the two windows can never be confused (DESIGN.md spine #4).
function ActivitySection({ series, activity, dark }: { series: SeriesPoint[]; activity: ActivitySummary; dark: boolean }) {
  const headingCls = dark ? "text-slate-200" : "text-gray-800";
  const mutedCls = dark ? "text-slate-500" : "text-gray-400";
  return (
    <section>
      <h3 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${headingCls}`}>
        Activity <span className={`text-[10px] font-normal uppercase tracking-wide ${mutedCls}`}>7d</span>
      </h3>
      <Sparkline series={series} dark={dark} />
      <p className={`text-xs mt-1.5 ${mutedCls}`}>{formatActivity30d(activity.mentions30d, activity.sources30d)}</p>
    </section>
  );
}

interface EntityPanelProps {
  entityId: number;
  dark: boolean;
  onClose: () => void;
  onSelectRelated: (id: number) => void;
}

export default function EntityPanel({ entityId, dark, onClose, onSelectRelated }: EntityPanelProps) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  // Guards against an older entity's response landing after a newer one was
  // requested (e.g. clicking a related entity before the current load finishes).
  const load = useCallback(async (id: number) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const data = await fetchEntityDetail(id);
      if (seq !== loadSeq.current) return;
      setDetail(data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load entity");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget: load() owns its own try/catch and reports via state.
    load(entityId);
  }, [entityId, load]);

  const panelBg = dark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-gray-200 text-gray-900";
  const closeBtn = dark ? "text-slate-400 hover:text-slate-100" : "text-gray-400 hover:text-gray-700";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full max-w-md h-full overflow-y-auto border-l p-5 ${panelBg}`}>
        <button onClick={onClose} className={`absolute top-4 right-4 text-sm ${closeBtn}`} aria-label="Close">
          ✕
        </button>

        {loading && <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>Loading...</p>}
        {error && (
          <div className={`text-sm px-4 py-3 rounded-xl border ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
            {error}
          </div>
        )}

        {detail && (
          <>
            <EntityHeader entity={detail.entity} dark={dark} />
            <FameBlock entity={detail.entity} dark={dark} />

            <div className="mt-5">
              <ActivitySection series={detail.series} activity={detail.activity} dark={dark} />
            </div>

            <section className="mt-5">
              <h3 className={`text-sm font-semibold mb-2 ${dark ? "text-slate-200" : "text-gray-800"}`}>Recent articles</h3>
              <ArticleList articles={detail.articles} dark={dark} />
            </section>

            <section className="mt-5">
              <h3 className={`text-sm font-semibold mb-2 ${dark ? "text-slate-200" : "text-gray-800"}`}>Relations</h3>
              <RelationsList relations={detail.relations} entityName={detail.entity.canonicalName} dark={dark} onSelect={onSelectRelated} />
            </section>

            <section className="mt-5">
              <h3 className={`text-sm font-semibold mb-2 ${dark ? "text-slate-200" : "text-gray-800"}`}>Related entities</h3>
              <RelatedEntities edges={detail.edges} dark={dark} onSelect={onSelectRelated} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
