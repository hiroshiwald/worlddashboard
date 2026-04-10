import { SignalType, SignalSeverity } from "@/lib/types";

export function SignalIcon({ type, className }: { type: SignalType; className?: string }) {
  const cls = className || "w-4 h-4";
  switch (type) {
    case "surge":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.93l-3.042.815a.75.75 0 01-.53-.919z" clipRule="evenodd" />
        </svg>
      );
    case "sentiment_deterioration":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
      );
    case "cross_category":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 4.25A2.25 2.25 0 014.25 2h2.5A2.25 2.25 0 019 4.25v2.5A2.25 2.25 0 016.75 9h-2.5A2.25 2.25 0 012 6.75v-2.5zM2 13.25A2.25 2.25 0 014.25 11h2.5A2.25 2.25 0 019 13.25v2.5A2.25 2.25 0 016.75 18h-2.5A2.25 2.25 0 012 15.75v-2.5zM11 4.25A2.25 2.25 0 0113.25 2h2.5A2.25 2.25 0 0118 4.25v2.5A2.25 2.25 0 0115.75 9h-2.5A2.25 2.25 0 0111 6.75v-2.5zM11 13.25A2.25 2.25 0 0113.25 11h2.5A2.25 2.25 0 0118 13.25v2.5A2.25 2.25 0 0115.75 18h-2.5A2.25 2.25 0 0111 15.75v-2.5z" />
        </svg>
      );
    case "novel_cooccurrence":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
          <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
        </svg>
      );
    case "escalation":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      );
    case "novel_emergence":
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" />
        </svg>
      );
  }
}

export function severityColor(severity: SignalSeverity, dark: boolean) {
  switch (severity) {
    case "critical":
      return {
        border: "border-l-red-500",
        text: dark ? "text-red-400" : "text-red-600",
        bg: dark ? "bg-red-500/10" : "bg-red-50",
        bar: "bg-red-500",
      };
    case "warning":
      return {
        border: "border-l-amber-500",
        text: dark ? "text-amber-400" : "text-amber-600",
        bg: dark ? "bg-amber-500/10" : "bg-amber-50",
        bar: "bg-amber-500",
      };
    case "advisory":
      return {
        border: "border-l-yellow-500",
        text: dark ? "text-yellow-400" : "text-yellow-600",
        bg: dark ? "bg-yellow-500/10" : "bg-yellow-50",
        bar: "bg-yellow-500",
      };
  }
}

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

export function SentimentBadge({ value, dark }: { value: number; dark: boolean }) {
  let label: string;
  let colorClass: string;

  if (value <= -0.3) {
    label = "NEG";
    colorClass = dark ? "text-red-400 bg-red-500/15" : "text-red-700 bg-red-100";
  } else if (value <= -0.1) {
    label = "NEG";
    colorClass = dark ? "text-red-300 bg-red-500/10" : "text-red-600 bg-red-50";
  } else if (value >= 0.3) {
    label = "POS";
    colorClass = dark ? "text-emerald-400 bg-emerald-500/15" : "text-emerald-700 bg-emerald-100";
  } else if (value >= 0.1) {
    label = "POS";
    colorClass = dark ? "text-emerald-300 bg-emerald-500/10" : "text-emerald-600 bg-emerald-50";
  } else {
    label = "NEU";
    colorClass = dark ? "text-slate-400 bg-slate-500/10" : "text-gray-500 bg-gray-100";
  }

  return (
    <span
      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}
      title={`Sentiment: ${value.toFixed(2)}`}
    >
      {label}
    </span>
  );
}
