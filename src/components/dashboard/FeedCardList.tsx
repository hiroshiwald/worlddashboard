import { FeedItem } from "@/lib/types";
import { ThemeClasses } from "@/lib/theme";
import { formatDate, timeAgo } from "@/lib/date-utils";
import FeedItemImage from "../FeedItemImage";

interface FeedCardListProps {
  sortedItems: FeedItem[];
  dark: boolean;
  t: ThemeClasses;
}

// Honest time, two facts: when db mode supplies updatedAt (the cluster's
// latest arrival), it's primary and the story's own publish-relative time
// is secondary. Live mode has no updatedAt — renders exactly as before.
function FeedTimestamp({ item, t }: { item: FeedItem; t: ThemeClasses }) {
  if (!item.updatedAt) return <span className={`text-xs ${t.dtgText}`}>{formatDate(item.published)}</span>;
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={`text-xs ${t.dtgText}`}>updated {timeAgo(item.updatedAt)} ago</span>
      <span className={`text-xs ${t.tierText}`}>{formatDate(item.published)}</span>
    </div>
  );
}

// Feeds carries no severity of its own — that's earned on the Signals tab
// by actual deviation. Every category gets the same quiet chip.
function categoryChipClasses(dark: boolean): string {
  return dark
    ? "text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded-full text-[10px] font-semibold"
    : "text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full text-[10px] font-semibold";
}

// Weight, not alarm: a cluster of 2+ articles about the same story gets a
// muted "+K" chip (K = other members), quieter than the category chip.
function ClusterSizeChip({ item, dark }: { item: FeedItem; dark: boolean }) {
  if (!item.clusterSize || item.clusterSize < 2) return null;
  const more = item.clusterSize - 1;
  return (
    <span
      className={dark
        ? "text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded-full text-[10px]"
        : "text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full text-[10px]"}
      title={`${more} more articles about this story across sources`}
    >
      +{more}
    </span>
  );
}

function FeedCard({ item, dark, t }: { item: FeedItem; dark: boolean; t: ThemeClasses }) {
  return (
    <div className={`${t.cardBg} border ${t.cardBorder} rounded-xl px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${t.sourceText}`}>
          {item.sourceName}
          <ClusterSizeChip item={item} dark={dark} />
        </span>
        <FeedTimestamp item={item} t={t} />
      </div>

      <div className="flex items-start gap-3 mb-2">
        <FeedItemImage
          imageUrl={item.imageUrl}
          link={item.link}
          sourceName={item.sourceName}
          dark={dark}
          size="mobile"
          imgPlaceholder={t.imgPlaceholder}
        />
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-sm font-medium hover:underline leading-snug ${t.headlineText}`}
        >
          {item.title}
        </a>
      </div>

      {item.summary && (
        <p className={`text-xs leading-relaxed line-clamp-2 mb-2 ${t.summaryText}`}>{item.summary}</p>
      )}

      <div className="flex items-center justify-between">
        <span className={categoryChipClasses(dark)}>{item.sourceCategory.toUpperCase()}</span>
        <span className={`text-xs ${t.tierText}`}>{item.sourceTier}</span>
      </div>
    </div>
  );
}

export default function FeedCardList({ sortedItems, dark, t }: FeedCardListProps) {
  return (
    <div className="md:hidden max-w-[1920px] mx-auto px-4 py-3 space-y-2">
      {sortedItems.map((item, idx) => (
        <FeedCard key={item.id + idx} item={item} dark={dark} t={t} />
      ))}
    </div>
  );
}
