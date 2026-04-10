interface EntityFilterBannerProps {
  entityFilter: string;
  dark: boolean;
  filteredItemCount: number;
  onClear: () => void;
}

export default function EntityFilterBanner({ entityFilter, dark, filteredItemCount, onClear }: EntityFilterBannerProps) {
  return (
    <div className={`${dark ? "bg-blue-950/50 border-b border-blue-900" : "bg-blue-50 border-b border-blue-100"}`}>
      <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between">
        <span className={`text-sm ${dark ? "text-blue-200" : "text-blue-800"}`}>
          Showing results for <strong>&ldquo;{entityFilter}&rdquo;</strong>
          <span className={`ml-2 ${dark ? "text-blue-400" : "text-blue-500"}`}>
            ({filteredItemCount} {filteredItemCount === 1 ? "item" : "items"})
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className={`text-sm font-medium px-3 py-1 rounded-lg transition-colors ${
              dark
                ? "text-blue-200 hover:bg-blue-900 hover:text-white"
                : "text-blue-700 hover:bg-blue-100 hover:text-blue-900"
            }`}
          >
            Show All
          </button>
          <button
            onClick={onClear}
            className={`p-1 rounded-lg transition-colors ${
              dark ? "text-blue-400 hover:text-white" : "text-blue-500 hover:text-blue-900"
            }`}
            title="Clear filter"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
