"use client";

import { getThemeClasses } from "@/lib/theme";
import { useEntitiesTab } from "@/hooks/useEntitiesTab";
import { StatsStrip, ControlsRow, EntitiesTable } from "./entities";

interface EntitiesTabProps {
  dark: boolean;
}

function EmptyState({ dark, message }: { dark: boolean; message: string }) {
  return <p className={`text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>{message}</p>;
}

export default function EntitiesTab({ dark }: EntitiesTabProps) {
  const {
    q, setQ, status, setStatus, fame, setFame,
    stats, entities, total, loading, error, dbUnconfigured,
    busyIds, updateEntity,
    offset, hasPrev, hasNext, goPrev, goNext,
  } = useEntitiesTab();
  const t = getThemeClasses(dark);
  const isFiltered = q.trim() !== "" || status !== "all" || fame !== "all";

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      {dbUnconfigured && <EmptyState dark={dark} message="Entity management requires a configured database." />}

      {!dbUnconfigured && error && (
        <div className={`mb-4 border text-sm px-4 py-3 rounded-xl ${dark ? "bg-red-950 border-red-800 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          {error}
        </div>
      )}

      {!dbUnconfigured && loading && !stats && !error && (
        <EmptyState dark={dark} message="Loading entities..." />
      )}

      {!dbUnconfigured && stats && (
        <>
          <StatsStrip stats={stats} dark={dark} />
          <ControlsRow q={q} setQ={setQ} status={status} setStatus={setStatus} fame={fame} setFame={setFame} t={t} />

          {entities.length === 0 ? (
            <EmptyState dark={dark} message={isFiltered ? "No entities match" : "No entities tracked yet"} />
          ) : (
            <EntitiesTable
              entities={entities} dark={dark} t={t} busyIds={busyIds} onPatch={updateEntity}
              offset={offset} total={total} hasPrev={hasPrev} hasNext={hasNext} goPrev={goPrev} goNext={goNext}
            />
          )}
        </>
      )}
    </div>
  );
}
