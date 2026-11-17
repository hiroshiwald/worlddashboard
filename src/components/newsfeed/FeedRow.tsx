"use client";
import {
  headline,
  rowEntities,
  worldNote,
  timeLabel,
  sourceHost,
  isContext,
  type FeedArticle,
  type RowEntity,
} from "./feed-logic";
import type { EntityGrowth } from "@/hooks/useNewsfeed";

export interface RowHandlers {
  dark: boolean;
  now: Date;
  growth: Record<string, EntityGrowth>;
  busy: string[];
  onSelect: (row: RowEntity) => void;
  onTrack: (row: RowEntity) => void;
  onIgnore: (row: RowEntity) => void;
}

function muted(dark: boolean): string {
  return dark ? "text-slate-400" : "text-gray-500";
}

function dividerBorder(dark: boolean): string {
  return dark ? "border-slate-600" : "border-gray-300";
}

function WorldBox({ article, dark }: { article: FeedArticle; dark: boolean }) {
  const note = worldNote(article);
  const box = dark ? "border-slate-700" : "border-gray-200";
  return (
    <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs space-y-0.5 ${box} ${muted(dark)}`}>
      {note.inWorld.length > 0 ? (
        <p>In your world: <b className="font-medium">{note.inWorld.join(", ")}</b></p>
      ) : (
        <p>Nothing you track is named here.</p>
      )}
      {note.notTracked.length > 0 && <p>Not tracked yet: <b className="font-medium">{note.notTracked.join(", ")}</b></p>}
    </div>
  );
}

function nameClasses(row: RowEntity, dark: boolean): string {
  if (row.status === "dismissed") return `line-through ${muted(dark)}`;
  if (row.status === "candidate") return "border-b border-dashed border-current";
  return "";
}

function EntityLine({ row, index, h }: { row: RowEntity; index: number; h: RowHandlers }) {
  const rising = row.entity !== null && h.growth[row.entity.id]?.state === "Rising";
  const isBusy = h.busy.includes(row.key);
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-1.5 text-sm">
      <span className={`font-mono text-[11px] ${muted(h.dark)}`}>{index + 1}</span>
      <span className="min-w-0">
        <button
          type="button"
          onClick={() => h.onSelect(row)}
          className={`text-left font-medium hover:underline ${nameClasses(row, h.dark)}`}
        >
          {row.name}
        </button>
        {rising && <span title="Rising" aria-label="Rising" className="ml-1 text-[10px] text-emerald-500">▲</span>}
        {row.entity !== null && isContext(row.entity) && (
          <span className={`ml-1.5 rounded px-1 text-[9px] uppercase tracking-wide ${h.dark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-500"}`}>
            Context
          </span>
        )}
      </span>
      {row.status === "tracked" && <span className="font-bold text-emerald-500" aria-label="Tracked">✓</span>}
      {row.status === "candidate" && (
        <span className="flex gap-1">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => h.onTrack(row)}
            className="rounded-full border border-blue-500 px-2 text-[11px] text-blue-500 hover:bg-blue-600 hover:text-white disabled:opacity-50"
          >
            {isBusy ? "…" : "+ Track"}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => h.onIgnore(row)}
            className={`rounded-full border px-2 text-[11px] hover:underline disabled:opacity-50 ${dividerBorder(h.dark)} ${muted(h.dark)}`}
          >
            Ignore
          </button>
        </span>
      )}
      {row.status === "dismissed" && <span className={`text-[11px] ${muted(h.dark)}`}>Ignored</span>}
    </li>
  );
}

export default function FeedRow({ article, h }: { article: FeedArticle; h: RowHandlers }) {
  const rows = rowEntities(article);
  const title = headline(article);
  const divider = h.dark ? "border-slate-700" : "border-gray-200";
  return (
    <article className={`grid gap-x-5 gap-y-1.5 border-t px-4 py-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.3fr)] ${divider}`}>
      <div>
        <a href={article.link} target="_blank" rel="noopener noreferrer" title={title.original ?? undefined} className="text-[15px] font-semibold leading-snug hover:underline">
          {title.text}
        </a>
        {title.original && <span className={`ml-2 text-[11px] ${muted(h.dark)}`}>Translated</span>}
        <WorldBox article={article} dark={h.dark} />
      </div>
      <div className="text-sm">
        <p className="font-semibold">{article.sourceName}</p>
        <p className={`break-all font-mono text-[11px] ${muted(h.dark)}`}>{sourceHost(article.link)}</p>
        <p className={`mt-1 text-xs ${muted(h.dark)}`}>{article.sourceCategory} · {timeLabel(article, h.now)}</p>
      </div>
      <ol className="grid list-none gap-1 p-0">
        {rows.map((row, i) => (
          <EntityLine key={row.key} row={row} index={i} h={h} />
        ))}
      </ol>
    </article>
  );
}
