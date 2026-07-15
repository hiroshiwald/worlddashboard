"use client";

import { BriefSignal, SignalAction } from "@/hooks/useBriefTab";
import ManagedSignalCard from "@/components/signals/ManagedSignalCard";

const SEVERITY_GROUPS: { key: BriefSignal["severity"]; label: string }[] = [
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "advisory", label: "Advisory" },
];

const BRIEF_ACTIONS: SignalAction[] = ["seen", "promoted", "dismissed"];

interface BriefSignalsSectionProps {
  signals: BriefSignal[];
  busyIds: Set<number>;
  dark: boolean;
  onAction: (id: number, action: SignalAction) => void;
  onEntityClick: (name: string) => void;
}

export default function BriefSignalsSection({ signals, busyIds, dark, onAction, onEntityClick }: BriefSignalsSectionProps) {
  if (signals.length === 0) {
    return (
      <p className={`text-sm mb-6 ${dark ? "text-slate-400" : "text-gray-500"}`}>
        No active signals right now — check back after the next ingest.
      </p>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {SEVERITY_GROUPS.map(({ key, label }) => {
        const group = signals.filter((s) => s.severity === key);
        if (group.length === 0) return null;
        return (
          <div key={key}>
            <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-gray-500"}`}>
              {label} ({group.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {group.map((signal) => (
                <ManagedSignalCard
                  key={signal.id}
                  signal={signal}
                  dark={dark}
                  busy={busyIds.has(signal.id)}
                  actions={BRIEF_ACTIONS}
                  onAction={onAction}
                  onEntityClick={onEntityClick}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
