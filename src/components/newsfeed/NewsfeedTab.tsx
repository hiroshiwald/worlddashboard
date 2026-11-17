"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapFocus } from "@/hooks/useDashboardTable";
import { useNewsfeed } from "@/hooks/useNewsfeed";
import FeedRow, { type RowHandlers } from "./FeedRow";
import EntityPopup from "./EntityPopup";
import {
  FILTER_LABELS,
  countByFilter,
  matchesFilter,
  matchesSearch,
  rowEntities,
  isStale,
  formatAgo,
  type FeedArticle,
  type FeedFilter,
  type RowEntity,
} from "./feed-logic";

export interface NewsfeedTabProps {
  dark: boolean;
  searchQuery: string;
  onOpenMap: (focus: MapFocus) => void;
}

const CLOCK_MS = 30_000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function findRow(items: FeedArticle[], key: string | null): RowEntity | null {
  if (key === null) return null;
  for (const article of items) {
    const found = rowEntities(article).find((r) => r.key === key);
    if (found !== undefined) return found;
  }
  return null;
}

function clock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function FreshnessLine({ lastIngestAt, now, dark }: { lastIngestAt: string | null; now: Date; dark: boolean }) {
  const stale = isStale(lastIngestAt, now);
  const asOf = lastIngestAt === null ? "no ingest recorded yet" : `${clock(new Date(lastIngestAt))} (${formatAgo(lastIngestAt, now)})`;
  return (
    <p className={`text-xs ${dark ? "text-slate-400" : "text-gray-500"}`}>
      Data as of {asOf}.
      {stale && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-600">Stale</span>}
    </p>
  );
}

function Message({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return <div role="status" className={`px-4 py-10 text-center text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{children}</div>;
}

interface BarProps {
  filter: FeedFilter;
  counts: Record<FeedFilter, number>;
  onFilter: (f: FeedFilter) => void;
  paused: boolean;
  onPause: () => void;
  dark: boolean;
}

function FilterBar({ filter, counts, onFilter, paused, onPause, dark }: BarProps) {
  const idle = dark ? "bg-slate-800 text-slate-300" : "bg-gray-100 text-gray-700";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as FeedFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
            className={`rounded-full px-3 py-1 text-xs ${filter === f ? "bg-blue-600 text-white" : idle}`}
          >
            {FILTER_LABELS[f]} {counts[f]}
          </button>
        ))}
      </div>
      <button type="button" onClick={onPause} className={`rounded-full px-3 py-1 text-xs ${idle}`}>
        {paused ? "Resume live updates" : "Pause live updates"}
      </button>
    </div>
  );
}

export default function NewsfeedTab({ dark, searchQuery, onOpenMap }: NewsfeedTabProps) {
  const feed = useNewsfeed();
  const now = useNow();
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const searched = useMemo(() => feed.items.filter((a) => matchesSearch(a, searchQuery)), [feed.items, searchQuery]);
  const counts = useMemo(() => countByFilter(searched, now), [searched, now]);
  const visible = useMemo(() => searched.filter((a) => matchesFilter(a, filter, now)), [searched, filter, now]);
  const selected = findRow(feed.items, selectedKey);

  const track = (row: RowEntity) => {
    if (row.entity !== null) void feed.setEntityStatus(row.entity, "tracked");
    if (row.candidate !== null) void feed.trackCandidate(row.candidate);
  };
  const dismiss = (row: RowEntity) => {
    if (row.entity !== null) void feed.setEntityStatus(row.entity, "dismissed");
    if (row.candidate !== null) void feed.dismissCandidate(row.candidate);
  };
  const handlers: RowHandlers = {
    dark,
    now,
    growth: feed.growth,
    busy: feed.busy,
    onSelect: (row) => setSelectedKey(row.key),
    onTrack: track,
    onIgnore: dismiss,
  };

  if (feed.dbUnconfigured) return <Message dark={dark}>Database not configured. Set DATABASE_URL and reload.</Message>;
  if (feed.loading && feed.items.length === 0) return <Message dark={dark}>Loading the feed…</Message>;
  if (feed.error !== null && feed.items.length === 0) {
    return (
      <Message dark={dark}>
        <p role="alert">Could not load the feed: {feed.error}</p>
        <button type="button" onClick={() => void feed.reload()} className="mt-3 rounded-md border px-3 py-1 text-xs">Retry</button>
      </Message>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <FreshnessLine lastIngestAt={feed.lastIngestAt} now={now} dark={dark} />
      <FilterBar filter={filter} counts={counts} onFilter={setFilter} paused={feed.paused} onPause={() => feed.setPaused(!feed.paused)} dark={dark} />
      {feed.actionError !== null && <p role="alert" className="text-sm text-red-500">Action failed: {feed.actionError}</p>}
      {feed.error !== null && <p role="alert" className="text-sm text-red-500">{feed.error}</p>}
      {feed.pollError && <p className="text-xs text-amber-600">Could not check for new articles. Retrying every minute.</p>}
      {feed.growthUnavailable && <p className="text-xs text-amber-600">Growth markers are unavailable right now.</p>}
      {feed.pendingCount > 0 && (
        <button type="button" onClick={feed.showPending} className="w-full rounded-md bg-blue-600 py-1.5 text-sm text-white">
          {feed.pendingCount} new {feed.pendingCount === 1 ? "article" : "articles"}, show
        </button>
      )}
      <div className={`overflow-hidden rounded-xl border ${dark ? "border-slate-700" : "border-gray-200"}`}>
        {feed.items.length === 0 && <Message dark={dark}>No articles yet. The next ingest will fill this in.</Message>}
        {feed.items.length > 0 && visible.length === 0 && <Message dark={dark}>Nothing in the loaded articles matches this search or filter.</Message>}
        {visible.map((article) => (
          <FeedRow key={article.id} article={article} h={handlers} />
        ))}
      </div>
      {feed.hasMore && (
        <button type="button" disabled={feed.loadingMore} onClick={() => void feed.loadMore()} className="w-full rounded-md border py-1.5 text-sm disabled:opacity-50">
          {feed.loadingMore ? "Loading…" : "Load older articles"}
        </button>
      )}
      {selected !== null && (
        <EntityPopup
          row={selected}
          growth={selected.entity === null ? undefined : feed.growth[selected.entity.id]}
          growthUnavailable={feed.growthUnavailable}
          busy={feed.busy.includes(selected.key)}
          dark={dark}
          actions={{
            onClose: () => setSelectedKey(null),
            onTrack: track,
            // The API has no "back to candidate"; both actions set status dismissed.
            onStopTracking: dismiss,
            onNotInterested: dismiss,
            onOpenMap: (id) => onOpenMap({ kind: "entity", id }),
          }}
        />
      )}
    </div>
  );
}
