import { FeedItem } from "@/lib/types";
import { ThemeClasses } from "@/lib/theme";
import { getUrgencyLevel, getRowClasses, getUrgencyBadgeClasses } from "@/lib/urgency";
import { formatDate } from "@/lib/date-utils";
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

function TableRow({ item, idx, dark, t }: { item: FeedItem; idx: number; dark: boolean; t: ThemeClasses }) {
  const level = getUrgencyLevel(item.sourceCategory);
  const rowColor = getRowClasses(level, dark);

  return (
    <tr
      key={item.id + idx}
      className={`${rowColor} ${
        level === "neutral" ? (idx % 2 === 0 ? t.rowAltA : t.rowAltB) : ""
      } ${t.rowHover} transition-colors ${t.rowBorder}`}
    >
      <td className={`px-4 py-3 text-xs whitespace-nowrap ${t.dtgText}`}>{formatDate(item.published)}</td>
      <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${t.sourceText}`}>{item.sourceName}</td>
      <td className="px-4 py-3">
        <span className={getUrgencyBadgeClasses(level, dark)}>{item.sourceCategory.toUpperCase()}</span>
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
