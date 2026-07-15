"use client";

import ManagedSignalCard from "./ManagedSignalCard";
import { SignalCardData, SignalAction } from "./types";

const ACTIVE_ACTIONS: SignalAction[] = ["seen", "promoted", "dismissed"];
const DISMISSED_ACTIONS: SignalAction[] = ["reopen"];

function actionsFor(state: string): SignalAction[] {
  return state === "dismissed" ? DISMISSED_ACTIONS : ACTIVE_ACTIONS;
}

interface ManagedSignalGridProps {
  signals: SignalCardData[];
  busyIds: Set<number>;
  dark: boolean;
  onAction: (id: number, action: SignalAction) => void;
  onEntityClick: (name: string) => void;
}

export default function ManagedSignalGrid({ signals, busyIds, dark, onAction, onEntityClick }: ManagedSignalGridProps) {
  if (signals.length === 0) {
    return (
      <div className={`text-center py-12 text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>
        No signals in this view.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
      {signals.map((signal) => (
        <ManagedSignalCard
          key={signal.id}
          signal={signal}
          dark={dark}
          busy={busyIds.has(signal.id)}
          actions={actionsFor(signal.state)}
          onAction={onAction}
          onEntityClick={onEntityClick}
        />
      ))}
    </div>
  );
}
