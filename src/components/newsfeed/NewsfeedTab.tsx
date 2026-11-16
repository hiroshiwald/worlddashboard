"use client";

import type { MapFocus } from "@/hooks/useDashboardTable";

// Placeholder: the Newsfeed build replaces this file. Contract: default export, these props.
export interface NewsfeedTabProps {
  dark: boolean;
  onOpenMap: (focus: MapFocus) => void;
}

export default function NewsfeedTab({ dark }: NewsfeedTabProps) {
  return <p className={`p-4 text-sm ${dark ? "text-slate-400" : "text-gray-500"}`}>Newsfeed is being built.</p>;
}
