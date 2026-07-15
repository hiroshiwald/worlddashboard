"use client";

import { useEffect, useState, useCallback } from "react";

interface EntityProfile {
  id: number;
  canonicalName: string;
  type: string;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string | null;
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

interface RelatedEntity {
  id: number;
  name: string;
  articleCount: number;
}

interface EntityDetail {
  entity: EntityProfile;
  series: SeriesPoint[];
  articles: ArticleItem[];
  edges: RelatedEntity[];
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
  return (
    <div className="mb-4">
      <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-gray-900"}`}>{entity.canonicalName}</h2>
      <p className={`text-xs uppercase tracking-wide mt-1 ${dark ? "text-slate-500" : "text-gray-400"}`}>
        {entity.type} &middot; {entity.status}
      </p>
      <p className={`text-xs mt-1 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        First seen {new Date(entity.firstSeenAt).toLocaleDateString()}
      </p>
    </div>
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

function RelatedEntities({ edges, dark, onSelect }: { edges: RelatedEntity[]; dark: boolean; onSelect: (id: number) => void }) {
  if (edges.length === 0) {
    return <p className={`text-xs ${dark ? "text-slate-500" : "text-gray-400"}`}>No related entities yet</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {edges.map((edge) => (
        <button
          key={edge.id}
          onClick={() => onSelect(edge.id)}
          className={`text-xs px-2.5 py-1 rounded-full ${dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-600"}`}
        >
          {edge.name} ({edge.articleCount})
        </button>
      ))}
    </div>
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

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      setDetail(await fetchEntityDetail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entity");
    } finally {
      setLoading(false);
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
            <Sparkline series={detail.series} dark={dark} />

            <section className="mt-5">
              <h3 className={`text-sm font-semibold mb-2 ${dark ? "text-slate-200" : "text-gray-800"}`}>Recent articles</h3>
              <ArticleList articles={detail.articles} dark={dark} />
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
