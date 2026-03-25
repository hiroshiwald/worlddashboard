import { UrgencyLevel } from "./types";

export function getUrgencyLevel(category: string): UrgencyLevel {
  const cat = category.toLowerCase();

  if (
    cat.startsWith("conflict") ||
    cat.startsWith("cyber") ||
    cat.startsWith("military")
  ) {
    return "critical";
  }

  if (cat.startsWith("natural disaster") || cat.startsWith("health")) {
    return "warning";
  }

  if (cat.startsWith("government")) {
    return "advisory";
  }

  if (
    cat.startsWith("economic") ||
    cat.startsWith("supply chain") ||
    cat.startsWith("prediction")
  ) {
    return "monitoring";
  }

  if (
    cat.startsWith("infrastructure") ||
    cat.startsWith("ai/ml") ||
    cat.startsWith("caching") ||
    cat.startsWith("compute") ||
    cat.startsWith("proxy")
  ) {
    return "system";
  }

  return "neutral";
}

export function getRowClasses(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "bg-red-50 border-l-4 border-l-red-500";
    case "warning":
      return "bg-orange-50 border-l-4 border-l-orange-400";
    case "advisory":
      return "bg-yellow-50 border-l-4 border-l-yellow-400";
    case "monitoring":
      return "bg-blue-50 border-l-4 border-l-blue-400";
    case "system":
      return "bg-gray-100 border-l-4 border-l-gray-400";
    case "neutral":
      return "border-l-4 border-l-transparent";
  }
}

export function getUrgencyBadgeClasses(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "warning":
      return "bg-orange-100 text-orange-800";
    case "advisory":
      return "bg-yellow-100 text-yellow-800";
    case "monitoring":
      return "bg-blue-100 text-blue-800";
    case "system":
      return "bg-gray-200 text-gray-700";
    case "neutral":
      return "bg-gray-100 text-gray-600";
  }
}
