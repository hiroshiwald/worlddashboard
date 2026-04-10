import { NoveltyReasonType } from "@/lib/types";

export interface CardTheme {
  cardBg: string;
  text: string;
  textMuted: string;
  entityName: string;
  linkText: string;
  confidenceBg: string;
  noveltyBar: string;
}

export const URGENCY_DOT_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  advisory: "bg-yellow-500",
  monitoring: "bg-sky-500",
  system: "bg-slate-500",
  neutral: "bg-gray-400",
};

export const TEMPO_STYLES: Record<string, { dark: string; light: string }> = {
  accelerating: {
    dark: "text-red-400 bg-red-500/15",
    light: "text-red-700 bg-red-50",
  },
  steady: {
    dark: "text-slate-400 bg-slate-500/10",
    light: "text-gray-500 bg-gray-100",
  },
  fading: {
    dark: "text-slate-500 bg-slate-500/10 italic",
    light: "text-gray-400 bg-gray-100 italic",
  },
  new: {
    dark: "text-emerald-400 bg-emerald-500/15",
    light: "text-emerald-700 bg-emerald-50",
  },
};

export function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 0) return "now";
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function reasonBadgeClasses(type: NoveltyReasonType, dark: boolean): string {
  const base = "text-[10px] font-semibold px-2 py-0.5 rounded-full";
  switch (type) {
    case "novel_edge":
      return `${base} ${dark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-700"}`;
    case "category_crossover":
      return `${base} ${dark ? "bg-orange-500/15 text-orange-400" : "bg-orange-50 text-orange-700"}`;
    case "quiet_mover":
      return `${base} ${dark ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-700"}`;
    case "entity_emergence":
      return `${base} ${dark ? "bg-violet-500/15 text-violet-400" : "bg-violet-50 text-violet-700"}`;
    case "baseline_surprise":
      return `${base} ${dark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-700"}`;
  }
}

export function reasonTypeLabel(type: NoveltyReasonType): string {
  switch (type) {
    case "novel_edge": return "Novel Link";
    case "category_crossover": return "Cross-Category";
    case "quiet_mover": return "Quiet Mover";
    case "entity_emergence": return "New Entity";
    case "baseline_surprise": return "Spiking";
  }
}
