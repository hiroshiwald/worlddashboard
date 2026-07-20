import { FeedItem } from "@/lib/types";
import { ThemeClasses } from "@/lib/theme";
import { formatDate, timeAgo } from "@/lib/date-utils";
import FeedItemImage from "../FeedItemImage";
import { ColumnKey } from "@/hooks/useDashboardTable";

interface FeedTableProps {
  sortedItems: FeedItem[];
  dark: boolean;
  t: ThemeClasses;
  onSort: (key: ColumnKey) => void;
  getSortArrow: (key: ColumnKey) => string;
}

function TableHeader({ onSort, getSortArrow, t }: Pick<FeedTableProps, "onSort" | "getSortArrow" | "t">) {
  const thClass = (extra: string) =>
    `${extra} px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${t.theadText}`;

  return (
    <thead className="sticky top-0 z-10">
      <tr className={t.theadBg}>
        <th onClick={() => onSort("published")} className={thClass("w-28")}>DTG{getSortArrow("published")}</th>
        <th onClick={() => onSort("sourceName")} className={thClass("min-w-[130px]")}>Source{getSortArrow("sourceName")}</th>
        <th onClick={() => onSort("sourceCategory")} className={thClass("min-w-[120px]")}>Category{getSortArrow("sourceCategory")}</th>
        <th onClick={() => onSort("title")} className={thClass("min-w-[400px]")}>Headline{getSortArrow("title")}</th>
        <th onClick={() => onSort("summary")} className={thClass("min-w-[240px]")}>Summary{getSortArrow("summary")}</th>
        <th onClick={() => onSort("sourceTier")} className={thClass("w-28")}>Tier{getSortArrow("sourceTier")}</th>
      </tr>
    </thead>
  );
}

// Honest time, two facts: when db mode supplies updatedAt (the cluster's
// latest arrival), it's primary and the story's own publish-relative time
// is secondary. Live mode has no updatedAt — renders exactly as before.
function FeedTimestamp({ item, t }: { item: FeedItem; t: ThemeClasses }) {
  if (!item.updatedAt) return formatDate(item.published);
  return (
    <div className="flex flex-col leading-tight">
      <span>updated {timeAgo(item.updatedAt)} ago</span>
      <span className={t.tierText}>{formatDate(item.published)}</span>
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

function TableRow({ item, idx, dark, t }: { item: FeedItem; idx: number; dark: boolean; t: ThemeClasses }) {
  return (
    <tr
      key={item.id + idx}
      className={`${idx % 2 === 0 ? t.rowAltA : t.rowAltB} ${t.rowHover} transition-colors ${t.rowBorder}`}
    >
      <td className={`px-4 py-3 text-xs whitespace-nowrap ${t.dtgText}`}><FeedTimestamp item={item} t={t} /></td>
      <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${t.sourceText}`}>
        <span className="inline-flex items-center gap-1.5">
          {item.sourceName}
          <ClusterSizeChip item={item} dark={dark} />
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={categoryChipClasses(dark)}>{item.sourceCategory.toUpperCase()}</span>
      </td>
      <td className="px-4 py-3 max-w-[500px]">
        <div className="flex items-start gap-3">
          <FeedItemImage
            imageUrl={item.imageUrl}
            link={item.link}
            sourceName={item.sourceName}
            dark={dark}
            size="desktop"
            imgPlaceholder={t.imgPlaceholder}
          />
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm font-medium hover:underline leading-snug line-clamp-2 ${t.headlineText}`}
            title={item.title}
          >
            {item.title}
          </a>
        </div>
      </td>
      <td className={`px-4 py-3 text-sm max-w-[300px] ${t.summaryText}`} title={item.summary}>
        <span className="line-clamp-2">{item.summary}</span>
      </td>
      <td className={`px-4 py-3 text-xs whitespace-nowrap uppercase ${t.tierText}`}>{item.sourceTier}</td>
    </tr>
  );
}

export default function FeedTable({ sortedItems, dark, t, onSort, getSortArrow }: FeedTableProps) {
  return (
    <div className="hidden md:block max-w-[1920px] mx-auto px-4 md:px-6 py-4">
      <div className={`rounded-xl overflow-hidden shadow-sm ${dark ? "shadow-black/20" : ""} ${t.tableBorder}`}>
        <table className="w-full border-collapse text-sm">
          <TableHeader onSort={onSort} getSortArrow={getSortArrow} t={t} />
          <tbody>
            {sortedItems.map((item, idx) => (
              <TableRow key={item.id + idx} item={item} idx={idx} dark={dark} t={t} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
