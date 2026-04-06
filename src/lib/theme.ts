export interface ThemeClasses {
  bg: string;
  headerBg: string;
  headerText: string;
  feedBadge: string;
  itemCount: string;
  searchBg: string;
  selectBg: string;
  btnBg: string;
  legendText: string;
  tableBorder: string;
  theadBg: string;
  theadText: string;
  rowAltA: string;
  rowAltB: string;
  rowHover: string;
  rowBorder: string;
  dtgText: string;
  sourceText: string;
  headlineText: string;
  summaryText: string;
  tierText: string;
  imgPlaceholder: string;
  loadingText: string;
  loadingSub: string;
  cardBg: string;
  cardBorder: string;
  tabActive: string;
  tabInactive: string;
}

export function getThemeClasses(dark: boolean): ThemeClasses {
  return {
    bg: dark ? "bg-slate-950" : "bg-gray-50",
    headerBg: dark ? "bg-slate-900/95 backdrop-blur border-b border-slate-800" : "bg-white/95 backdrop-blur shadow-sm",
    headerText: dark ? "text-slate-100" : "text-gray-900",
    feedBadge: dark ? "text-emerald-400" : "text-emerald-600",
    itemCount: dark ? "text-slate-400" : "text-gray-500",
    searchBg: dark
      ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
      : "bg-gray-100 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20",
    selectBg: dark
      ? "bg-slate-800 border-slate-700 text-slate-200 focus:border-blue-500"
      : "bg-gray-100 border-gray-200 text-gray-700 focus:border-blue-500",
    btnBg: dark
      ? "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
      : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700 shadow-sm",
    legendText: dark ? "text-slate-500" : "text-gray-400",
    tableBorder: dark ? "bg-slate-900 border-slate-800" : "bg-white",
    theadBg: dark ? "bg-slate-800/60 border-b border-slate-700" : "bg-gray-50/80 border-b border-gray-200",
    theadText: dark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700",
    rowAltA: dark ? "bg-slate-900" : "bg-white",
    rowAltB: dark ? "bg-slate-900/60" : "bg-gray-50/50",
    rowHover: dark ? "hover:bg-slate-800/80" : "hover:bg-blue-50/40",
    rowBorder: dark ? "border-b border-slate-800/60" : "border-b border-gray-100",
    dtgText: dark ? "text-slate-400" : "text-gray-500",
    sourceText: dark ? "text-slate-100" : "text-gray-800",
    headlineText: dark ? "text-slate-100 hover:text-blue-300" : "text-gray-900 hover:text-blue-600",
    summaryText: dark ? "text-slate-400" : "text-gray-500",
    tierText: dark ? "text-slate-500" : "text-gray-400",
    imgPlaceholder: dark ? "bg-slate-800 rounded-lg" : "bg-gray-100 rounded-lg",
    loadingText: dark ? "text-slate-400" : "text-gray-500",
    loadingSub: dark ? "text-slate-600" : "text-gray-400",
    cardBg: dark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-100 shadow-sm",
    cardBorder: dark ? "border-slate-800" : "border-gray-100",
    tabActive: dark ? "text-blue-400 border-b-2 border-blue-400" : "text-blue-600 border-b-2 border-blue-600",
    tabInactive: dark ? "text-slate-500 hover:text-slate-300 border-b-2 border-transparent" : "text-gray-400 hover:text-gray-600 border-b-2 border-transparent",
  };
}
