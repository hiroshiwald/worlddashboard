import { Signal, FeedItem } from "@/lib/types";
import { SignalsTabTheme } from "@/hooks/useSignalsTab";
import { SignalIcon, severityColor, timeAgo } from "./utils";

interface SignalCardProps {
  signal: Signal;
  evidence: FeedItem[];
  relatedSituation: string | undefined;
  dark: boolean;
  onEntityClick: (name: string) => void;
  onMute: (name: string) => void;
  t: SignalsTabTheme;
}

export default function SignalCard({
  signal, evidence, relatedSituation, dark, onEntityClick, onMute, t,
}: SignalCardProps) {
  const sc = severityColor(signal.severity, dark);

  return (
    <div className={`border border-l-4 rounded-xl ${sc.border} ${t.cardBg} px-4 py-3`}>
      {/* Header: icon + title + confidence */}
      <div className="flex items-start gap-2.5 mb-2">
        <span className={`mt-0.5 flex-shrink-0 ${sc.text}`}>
          <SignalIcon type={signal.type} />
        </span>
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-bold uppercase tracking-wide ${sc.text} truncate block`}>
            {signal.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className={`w-14 h-2 rounded-full overflow-hidden ${t.confidenceBg}`}>
            <div className={`h-full rounded-full ${sc.bar}`} style={{ width: `${signal.confidence * 100}%` }} />
          </div>
          <span className={`text-[10px] ${t.textMuted}`}>{Math.round(signal.confidence * 100)}%</span>
        </div>
      </div>

      {/* Description */}
      <p className={`text-xs leading-relaxed mb-2.5 ${t.textMuted}`}>
        {signal.description}
      </p>

      {/* Evidence articles */}
      {evidence.length > 0 && (
        <div className={`rounded-lg border px-3 py-2 mb-2.5 ${t.evidenceBg}`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.textMuted}`}>
            Triggering articles
          </span>
          <div className="mt-1.5 space-y-1">
            {evidence.map((article) => (
              <div key={article.id} className="flex items-center gap-1.5 text-[11px]">
                <span className={`font-medium flex-shrink-0 ${t.textMuted}`}>
                  {article.sourceName}
                </span>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`truncate hover:underline ${t.linkText}`}
                >
                  {article.title}
                </a>
                <span className={`flex-shrink-0 text-[10px] ${t.textMuted}`}>
                  {timeAgo(article.published)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related situation link */}
      {relatedSituation && (
        <p className={`text-[10px] mb-2 ${t.textMuted}`}>
          Related: <span className="font-medium">{relatedSituation.length > 60 ? relatedSituation.slice(0, 60) + "..." : relatedSituation}</span>
        </p>
      )}

      {/* Entity chips with mute buttons */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {signal.entities.map((name) => (
          <span key={name} className="inline-flex items-center gap-0.5">
            <button
              onClick={() => onEntityClick(name)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:underline ${sc.bg} ${sc.text}`}
            >
              {name}
            </button>
            <button
              onClick={() => onMute(name)}
              className={`text-[10px] p-0.5 rounded-full transition-colors ${t.muteBtnBg}`}
              title={`Mute "${name}" for 24h`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${dark ? "bg-slate-800 text-slate-500" : "bg-gray-100 text-gray-400"}`}>
          {signal.type.replace(/_/g, " ")}
        </span>
      </div>
    </div>
  );
}
