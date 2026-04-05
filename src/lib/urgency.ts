import { UrgencyLevel } from "./types";

export function getUrgencyLevel(category: string): UrgencyLevel {
  const cat = category.toLowerCase();

  if (
    cat.startsWith("conflict") ||
    cat.startsWith("cyber") ||
    cat.startsWith("military") ||
    cat.startsWith("radiation") ||
    cat.startsWith("space weather")
  ) {
    return "critical";
  }

  if (
    cat.startsWith("natural disaster") ||
    cat.startsWith("health") ||
    cat.startsWith("displacement")
  ) {
    return "warning";
  }

  if (
    cat.startsWith("government") ||
    cat.startsWith("sanctions") ||
    cat.startsWith("aviation")
  ) {
    return "advisory";
  }

  if (
    cat.startsWith("economic") ||
    cat.startsWith("supply chain") ||
    cat.startsWith("prediction") ||
    cat.startsWith("trade") ||
    cat.startsWith("humanitarian")
  ) {
    return "monitoring";
  }

  if (
    cat.startsWith("infrastructure") ||
    cat.startsWith("ai/ml") ||
    cat.startsWith("caching") ||
    cat.startsWith("compute") ||
    cat.startsWith("proxy") ||
    cat.startsWith("imagery") ||
    cat.startsWith("visual")
  ) {
    return "system";
  }

  return "neutral";
}

export function getRowClasses(level: UrgencyLevel, dark: boolean): string {
  if (dark) {
    switch (level) {
      case "critical":
        return "bg-red-950/50 border-l-4 border-l-red-500";
      case "warning":
        return "bg-amber-950/30 border-l-4 border-l-amber-500";
      case "advisory":
        return "bg-yellow-950/20 border-l-4 border-l-yellow-500";
      case "monitoring":
        return "bg-sky-950/30 border-l-4 border-l-sky-500";
      case "system":
        return "bg-slate-800/30 border-l-4 border-l-slate-500";
      case "neutral":
        return "border-l-4 border-l-transparent";
    }
  } else {
    switch (level) {
      case "critical":
        return "bg-red-50/80 border-l-4 border-l-red-400";
      case "warning":
        return "bg-amber-50/80 border-l-4 border-l-amber-400";
      case "advisory":
        return "bg-yellow-50/60 border-l-4 border-l-yellow-400";
      case "monitoring":
        return "bg-sky-50/60 border-l-4 border-l-sky-400";
      case "system":
        return "bg-gray-50 border-l-4 border-l-gray-300";
      case "neutral":
        return "border-l-4 border-l-transparent";
    }
  }
}

export function getUrgencyBadgeClasses(
  level: UrgencyLevel,
  dark: boolean
): string {
  if (dark) {
    switch (level) {
      case "critical":
        return "text-red-400 bg-red-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "warning":
        return "text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "advisory":
        return "text-yellow-400 bg-yellow-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "monitoring":
        return "text-sky-400 bg-sky-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "system":
        return "text-slate-400 bg-slate-500/15 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "neutral":
        return "text-slate-500 bg-slate-500/10 px-2 py-0.5 rounded-full text-[10px] font-semibold";
    }
  } else {
    switch (level) {
      case "critical":
        return "text-red-700 bg-red-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "warning":
        return "text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "advisory":
        return "text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "monitoring":
        return "text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "system":
        return "text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
      case "neutral":
        return "text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
    }
  }
}
