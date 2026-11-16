"use client";

import { useState } from "react";
import { ThemeClasses, getThemeClasses } from "@/lib/theme";
import { useEntitiesTab } from "@/hooks/useEntitiesTab";
import { useCandidateQueue } from "@/hooks/useCandidateQueue";
import {
  StatsStrip, ControlsRow, EntitiesTable, SegmentedControl, CandidateTable,
  BulkActionsBar, ErrorToast, SuccessToast, EntitiesView,
} from "./entities";

interface EntitiesTabProps {
  dark: boolean;
  onEntitySelect: (id: number) => void;
  onCandidatesChanged: (count: number) => void;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>;
}

function TrackedView({ dark, t, tab, onEntitySelect }: { dark: boolean; t: ThemeClasses; tab: ReturnType<typeof useEntitiesTab>; onEntitySelect: (id: number) => void }) {
  const {
    q, setQ, status, setStatus, fame, setFame, fameChecked, setFameChecked, fameLocked, setFameLocked,
    sort, setSort, stats, entities, total, loading, busyIds, updateEntity,
    offset, pageSize, setPageSize, hasPrev, hasNext, goPrev, goNext,
  } = tab;
  // The Tracked stat tile counts as the "status=tracked, fame=all,
  // fameChecked=all, !fameLocked" default, not as an active filter
  // narrowing an otherwise-broader view.
  const isFiltered = q.trim() !== "" || status !== "tracked" || fame !== "all" || fameChecked !== "all" || fameLocked;

  if (loading && !stats) return <EmptyState dark={dark} message="Loading entities..." />;
  if (!stats) return null;

  return (
    <>
      <StatsStrip
        stats={stats} dark={dark} status={status} fame={fame} fameChecked={fameChecked} fameLocked={fameLocked}
        setStatus={setStatus} setFame={setFame} setFameChecked={setFameChecked} setFameLocked={setFameLocked}
      />
      <ControlsRow q={q} setQ={setQ} status={status} setStatus={setStatus} fame={fame} setFame={setFame} t={t} />
      {entities.length === 0 ? (
        <EmptyState dark={dark} message={isFiltered ? "No entities match" : "No entities tracked yet"} />
      ) : (
        <EntitiesTable
          entities={entities} dark={dark} t={t} busyIds={busyIds} onPatch={updateEntity} onEntitySelect={onEntitySelect}
          offset={offset} total={total} hasPrev={hasPrev} hasNext={hasNext} goPrev={goPrev} goNext={goNext}
          pageSize={pageSize} onPageSizeChange={setPageSize} sort={sort} onSortChange={setSort}
        />
      )}
    </>
  );
}

function QueueView({ dark, t, queue }: { dark: boolean; t: ThemeClasses; queue: ReturnType<typeof useCandidateQueue> }) {
  if (queue.loading && queue.total === 0) return <EmptyState dark={dark} message="Loading review queue..." />;
  if (!queue.loading && queue.total === 0) return <EmptyState dark={dark} message="No entities awaiting review." />;

  return (
    <>
      <BulkActionsBar
        selectedCount={queue.selected.size} bulkBusy={queue.bulkBusy} dark={dark}
        onAcceptSelected={queue.bulkAccept} onDismissSelected={queue.bulkDismiss}
      />
      <CandidateTable
        candidates={queue.pageItems} dark={dark} t={t}
        selected={queue.selected} onToggleSelect={queue.toggleSelect}
        isAllPageSelected={queue.isAllPageSelected} onToggleSelectAll={queue.toggleSelectAllOnPage}
        getRowType={queue.getRowType} onTypeChange={queue.setRowType}
        busyNorms={queue.busyNorms}
        onAccept={queue.acceptOne} onMerge={queue.mergeOne} onDismiss={queue.dismissOne}
        offset={queue.offset} total={queue.total} hasPrev={queue.hasPrev} hasNext={queue.hasNext}
        goPrev={queue.goPrev} goNext={queue.goNext}
      />
    </>
  );
}

export default function EntitiesTab({ dark, onEntitySelect, onCandidatesChanged }: EntitiesTabProps) {
  const [view, setView] = useState<EntitiesView>("tracked");
  const tab = useEntitiesTab();
  const queue = useCandidateQueue(onCandidatesChanged);
  const t = getThemeClasses(dark);

  const dbUnconfigured = tab.dbUnconfigured || queue.dbUnconfigured;
  const errorMessages = view === "tracked"
    ? [tab.error, tab.actionError].filter((m): m is string => !!m)
    : [queue.error, queue.actionError, ...queue.bulkErrors.map((f) => `${f.nameNorm}: ${f.error ?? "failed"}`)].filter((m): m is string => !!m);
  const dismissErrorToast = view === "tracked" ? tab.dismissErrors : queue.dismissErrors;
  const successToast = view === "tracked" ? tab.toast : queue.toast;
  const dismissSuccessToast = view === "tracked" ? tab.dismissToast : queue.dismissToast;

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <ErrorToast messages={errorMessages} dark={dark} onDismiss={dismissErrorToast} />
      <SuccessToast toast={successToast} dark={dark} onDismiss={dismissSuccessToast} />

      {dbUnconfigured && <EmptyState dark={dark} message="Entity management requires a configured database." />}

      {!dbUnconfigured && (
        <>
          <SegmentedControl view={view} onChange={setView} queueCount={queue.total} dark={dark} />
          {view === "tracked"
            ? <TrackedView dark={dark} t={t} tab={tab} onEntitySelect={onEntitySelect} />
            : <QueueView dark={dark} t={t} queue={queue} />}
        </>
      )}
    </div>
  );
}
