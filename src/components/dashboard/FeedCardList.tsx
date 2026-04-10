import { FeedItem } from "@/lib/types";
import { ThemeClasses } from "@/lib/theme";
import { getUrgencyLevel, getRowClasses, getUrgencyBadgeClasses } from "@/lib/urgency";
import { formatDate } from "@/lib/date-utils";
import FeedItemImage from "../FeedItemImage";

interface FeedCardListProps {
  sortedItems: FeedItem[];
  dark: boolean;
  t: ThemeClasses;
}

function FeedCard({ item, dark, t }: { item: FeedItem; dark: boolean; t: ThemeClasses }) {
  const level = getUrgencyLevel(item.sourceCategory);
  const rowColor = getRowClasses(level, dark);

  return (
    <div className={`${rowColor} ${level === "neutral" ? t.cardBg : ""} border ${t.cardBorder} rounded-xl px-4 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${t.sourceText}`}>{item.sourceName}</span>
        <span className={`text-xs ${t.dtgText}`}>{formatDate(item.published)}</span>
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
        <span className={getUrgencyBadgeClasses(level, dark)}>{item.sourceCategory.toUpperCase()}</span>
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
