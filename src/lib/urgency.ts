import { UrgencyLevel } from "./types";

export function getUrgencyLevel(category: string): UrgencyLevel {
  const cat = category.toLowerCase();

  // Critical — immediate threat to life or security
  if (
    cat.startsWith("conflict") ||
    cat.startsWith("cyber") ||
    cat.startsWith("military") ||
    cat.startsWith("radiation") ||
    cat.startsWith("space weather")
  ) {
    return "critical";
  }

  // Warning — natural hazards, health emergencies, displacement
  if (
    cat.startsWith("natural disaster") ||
    cat.startsWith("health") ||
    cat.startsWith("displacement")
  ) {
    return "warning";
  }

  // Advisory — government alerts, sanctions, travel warnings
  if (
    cat.startsWith("government") ||
    cat.startsWith("sanctions") ||
    cat.startsWith("aviation")
  ) {
    return "advisory";
  }

  // Monitoring — economic, trade, supply chain, markets
  if (
    cat.startsWith("economic") ||
    cat.startsWith("supply chain") ||
    cat.startsWith("prediction") ||
    cat.startsWith("trade") ||
    cat.startsWith("humanitarian")
  ) {
    return "monitoring";
  }

  // System — infrastructure, tools, AI
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
      return "bg-red-50/70 border-l-4 border-l-red-500";
    case "warning":
      return "bg-amber-50/70 border-l-4 border-l-amber-400";
    case "advisory":
      return "bg-yellow-50/60 border-l-4 border-l-yellow-400";
    case "monitoring":
      return "bg-sky-50/60 border-l-4 border-l-sky-400";
    case "system":
      return "bg-slate-50 border-l-4 border-l-slate-300";
    case "neutral":
      return "border-l-4 border-l-transparent";
  }
}

export function getUrgencyBadgeClasses(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "warning":
      return "bg-amber-100 text-amber-800";
    case "advisory":
      return "bg-yellow-100 text-yellow-800";
    case "monitoring":
      return "bg-sky-100 text-sky-700";
    case "system":
      return "bg-slate-100 text-slate-600";
    case "neutral":
      return "bg-slate-100 text-slate-500";
  }
}
