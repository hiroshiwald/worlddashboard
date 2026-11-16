"use client";

import { useState } from "react";
import { SegmentBar, DevelopmentsSegment } from "./developments";
import { SignalsSegment } from "./signals";

type Segment = "developments" | "signals";

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "developments", label: "Developments" },
  { value: "signals", label: "Signals" },
];

interface DevelopmentsTabProps {
  dark: boolean;
  onEntityClick: (name: string) => void;
}

// Two segments over one DB-backed tab: Developments (the full, filterable
// eligible set — default) and Signals (the raw detector engine room). See
// TABS-REDESIGN-PLAN.md §6 Phase 2b.
export default function DevelopmentsTab({ dark, onEntityClick }: DevelopmentsTabProps) {
  const [segment, setSegment] = useState<Segment>("developments");

  return (
    <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <SegmentBar value={segment} options={SEGMENTS} dark={dark} onChange={setSegment} />
      {segment === "developments"
        ? <DevelopmentsSegment dark={dark} onEntityClick={onEntityClick} />
        : <SignalsSegment dark={dark} onEntityClick={onEntityClick} />}
    </div>
  );
}
