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

export function getRowClasses(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "bg-red-950/60 border-l-4 border-l-red-500";
    case "warning":
      return "bg-amber-950/40 border-l-4 border-l-amber-500";
    case "advisory":
      return "bg-yellow-950/30 border-l-4 border-l-yellow-500";
    case "monitoring":
      return "bg-sky-950/40 border-l-4 border-l-sky-500";
    case "system":
      return "bg-slate-800/40 border-l-4 border-l-slate-500";
    case "neutral":
      return "border-l-4 border-l-transparent";
  }
}

export function getUrgencyBadgeClasses(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "text-red-400 font-bold";
    case "warning":
      return "text-amber-400 font-bold";
    case "advisory":
      return "text-yellow-400 font-semibold";
    case "monitoring":
      return "text-sky-400 font-semibold";
    case "system":
      return "text-slate-500 font-semibold";
    case "neutral":
      return "text-slate-500";
  }
}
