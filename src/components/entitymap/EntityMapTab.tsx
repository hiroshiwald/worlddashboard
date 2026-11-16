"use client";

import type { MapFocus } from "@/hooks/useDashboardTable";

// Placeholder: the Entity map build replaces this file. Contract: default export, these props.
export interface EntityMapTabProps {
  dark: boolean;
  focus: MapFocus;
}

export default function EntityMapTab({ dark }: EntityMapTabProps) {
  return <p className={`p-4 text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>Entity map is being built.</p>;
}
