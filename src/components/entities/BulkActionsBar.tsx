"use client";

interface BulkActionsBarProps {
  selectedCount: number;
  bulkBusy: boolean;
  dark: boolean;
  onAcceptSelected: () => void;
  onDismissSelected: () => void;
}

export default function BulkActionsBar({ selectedCount, bulkBusy, dark, onAcceptSelected, onDismissSelected }: BulkActionsBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className={`flex items-center gap-3 mb-3 px-4 py-2.5 rounded-xl border ${dark ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100 shadow-sm"}`}>
      <span className={`text-sm font-medium ${dark ? "text-slate-200" : "text-gray-700"}`}>{selectedCount} selected</span>
      <button
        onClick={onAcceptSelected}
        disabled={bulkBusy}
        title={`Tracks all ${selectedCount} selected candidates, each as its chosen type. Reversible individually: dismiss any of them afterward.`}
        className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
      >
        {bulkBusy ? "Working…" : "Accept selected"}
      </button>
      <button
        onClick={onDismissSelected}
        disabled={bulkBusy}
        title={`Dismisses all ${selectedCount} selected candidates — none will be suggested again. Reversible individually from Status: Dismissed in the Tracked view.`}
        className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
      >
        {bulkBusy ? "Working…" : "Dismiss selected"}
      </button>
    </div>
  );
}
