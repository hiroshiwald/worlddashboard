## Modules

| Name | Purpose | Key Exports |
|------|---------|-------------|
| `src/app/api/sources/route.ts` | API endpoint that orchestrates feed fetching and returns aggregated items | `GET` handler |
| `src/app/page.tsx` | Home page — renders the main dashboard | `Home` component |
| `src/app/layout.tsx` | Root HTML layout with metadata and font loading | `RootLayout` component |
| `src/app/globals.css` | Tailwind directives and dark-scrollbar styles | — |
| `src/components/DashboardTable.tsx` | Main orchestrator: tabs, filtering, sorting, theming, responsive layout | `DashboardTable` |
| `src/components/HeaderBar.tsx` | Top navigation with search, category filter, theme toggle, tab switcher | `HeaderBar` |
| `src/components/IntelTab.tsx` | Entity extraction and situation clustering view | `IntelTab` |
| `src/components/SignalsTab.tsx` | Anomaly detection UI with signal cards and cascade chains | `SignalsTab` |
| `src/components/NetworkTab.tsx` | Force-directed graph of entity co-occurrences | `NetworkTab` |
| `src/components/MapTab.tsx` | Leaflet geospatial map with entity markers | `MapTab` |
| `src/components/DiscoveryTab.tsx` | 2D scatter plot for novelty discovery | `DiscoveryTab` |
| `src/components/FeedItemImage.tsx` | Image component with Google favicon and text-initial fallbacks | `FeedItemImage` |
| `src/hooks/useSources.ts` | React hook for fetching feed data from `/api/sources` | `useFeed` |
| `src/lib/types.ts` | All shared TypeScript interfaces | `FeedItem`, `SourceMeta`, `ExtractedEntity`, `EnrichedEntity`, `Signal`, `Situation`, `UrgencyLevel`, `SortConfig`, etc. |
| `src/lib/feed-fetcher.ts` | RSS/Atom fetching with 3-phase fallback (direct → relay → altUrl), parsing, and in-memory cache | `fetchAllFeeds`, `parseFeedXml`, `parseRssItems`, `parseAtomEntries` |
| `src/lib/entity-extractor.ts` | Dictionary-based NER from feed text with sentiment via compromise.js | `extractEntities` |
| `src/lib/entity-dictionaries.ts` | Country, org, region dictionaries and person stopwords | `COUNTRY_DICT`, `ORG_DICT`, `REGION_DICT`, `PERSON_STOPWORDS` |
| `src/lib/signal-detector.ts` | Six-type anomaly detection (surge, sentiment, cross-category, novel co-occurrence, escalation, emergence) | `detectSignals` |
| `src/lib/novelty-scorer.ts` | Five-dimension novelty scoring (0–100) and known-situation detection | `enrichEntities`, `isKnownSituation` |
| `src/lib/situation-builder.ts` | Greedy clustering of entity pairs sharing articles into situations | `buildSituations` |
| `src/lib/cascade-graph.ts` | Static causal graph across 12 impact domains with BFS chain builder | `buildCascadeChain`, `CascadeChain`, `CascadeDomain` |
| `src/lib/ad-filter.ts` | Ad and sponsored content detection with 50+ title patterns and URL/description filters | `isAdContent`, `isFinancialAd` |
| `src/lib/image-extractor.ts` | Six-method image URL extraction from RSS/Atom XML | `extractImageUrl`, `getSourceImageUrl`, `getDomainFromUrl` |
| `src/lib/xml-helpers.ts` | HTML stripping, XML tag/attribute extraction | `stripHtml`, `extractTag`, `extractAttr` |
| `src/lib/signal-storage.ts` | localStorage persistence for muted signals, edge history, entity snapshots, baselines | `loadMutedEntities`, `saveMutedEntities`, `loadEdgeHistory`, `saveEdgeHistory`, `loadEntityBaselines`, `updateEntityBaselines` |
| `src/lib/geo-coordinates.ts` | Lookup map of 100+ countries/regions to [lat, lng] centroids | `getCoordinates` |
| `src/lib/date-utils.ts` | Relative and absolute date formatting | `timeAgo`, `formatDate` |
| `src/lib/urgency.ts` | Deterministic category-to-urgency mapping and Tailwind styling | `getUrgencyLevel`, `getRowClasses`, `getUrgencyBadgeClasses` |
| `src/lib/theme.ts` | Dark/light theme class generation | `getThemeClasses`, `ThemeClasses` |
| `src/lib/sources-data.json` | Static list of ~147 RSS/Atom feed sources with name, category, tier, url, type | — |
| `src/lib/__tests__/ad-filter.test.ts` | Tests for ad/sponsored content detection | — |
| `src/lib/__tests__/xml-helpers.test.ts` | Tests for HTML stripping and XML extraction | — |
| `src/lib/__tests__/image-extractor.test.ts` | Tests for image URL extraction from XML | — |
| `src/lib/__tests__/urgency.test.ts` | Tests for category-to-urgency mapping and styling | — |
| `src/lib/__tests__/date-utils.test.ts` | Tests for timeAgo and formatDate | — |
| `src/lib/__tests__/feed-parser.test.ts` | Tests for RSS 2.0 and Atom parsing | — |
| `src/lib/__tests__/entity-extractor.test.ts` | Tests for entity extraction, co-occurrence, sentiment | — |
| `src/lib/__tests__/signal-detector.test.ts` | Tests for anomaly signal detection algorithms | — |

## Invariants

- **7-day item window**: Feed items older than 7 days are discarded at fetch time. No stale data enters the pipeline.
- **15 items per source**: Each feed is capped to prevent any single source from dominating.
- **Deterministic urgency**: Urgency level is a pure function of source category — no mutable state, no runtime overrides.
- **Canonical entity names**: Dictionary-based extraction resolves aliases to canonical forms (e.g., "USA" → "United States"). Case-insensitive, word-boundary matching, longest-match-first.
- **Bidirectional co-occurrences**: Entity pairs are stored as sorted tuples — no duplicates, order-independent.
- **Signal confidence cap**: Entities appearing in >15% of all items receive a 0.5× dominance penalty to avoid noise.
- **Novelty score range**: Composite score is 0–100 across five dimensions; no single dimension can exceed its cap (spread: 30, diversity: 15, edges: 25, surprise: 20, emergence: 10).
- **Situation clustering threshold**: Entity pairs must share ≥2 articles to form a cluster; clusters merge only at >50% article overlap.
- **No backend database**: The application is fully stateless on the server. All persistence (muted signals, edge history, entity snapshots, baselines, theme) lives in browser localStorage.
- **Muted signal expiry**: 24-hour duration, enforced by wall-clock comparison on load.
- **Edge history retention**: 30-day window; entries older than 30 days are pruned on save.
- **Entity snapshot window**: 2-hour retention for emergence detection.
- **Fetch timeout**: 5 seconds per phase. Direct phase allows 1 retry on 5xx. Total worst-case per source: ~20s across all phases.
- **Cache layers**: In-memory feed cache (5min fresh / 30min stale) → CDN (60s fresh / 300s stale-while-revalidate) → browser (no-store). Next.js Data Cache is force-disabled.
- **Ad filtering order**: URL patterns → title regex (50+ patterns) → financial ad regex (dateless feeds only). Applied before items enter the pipeline.

## Boundaries

**Browser → Server**
- `useFeed` hook fetches `GET /api/sources` with `cache: 'no-store'`
- Response includes `items[]`, feed diagnostics, and metadata

**Server → External Feeds**
- `fetchAllFeeds` hits ~147 RSS/Atom sources in parallel
- 3-phase fallback per source: direct fetch → `RELAY_URL` proxy → `altUrl`
- Optional `RELAY_SECRET` header for relay authentication
- All fetches use `cache: 'no-store'` to bypass Next.js Data Cache

**Server → CDN**
- Vercel Edge caches API responses (`s-maxage=60, stale-while-revalidate=300`)

**Client → External Services**
- Google Favicons API (`google.com/s2/favicons`) for fallback article images
- CARTO tile CDN (`basemaps.cartocdn.com`) for Leaflet map layers
- Google Fonts CDN for Inter typeface

**Client → localStorage**
- `signal-storage.ts` reads/writes: muted entities, edge history, entity snapshots, entity baselines
- Theme preference stored as `wd-theme`

**Internal Module Dependencies**
- `DashboardTable` → all tab components + `useFeed` + `theme`
- All analysis tabs → `entity-extractor` → `entity-dictionaries` + `urgency` + `compromise`
- `SignalsTab` → `signal-detector` + `novelty-scorer` + `situation-builder` + `cascade-graph` + `signal-storage`
- `MapTab` → `geo-coordinates` + `react-leaflet`
- `NetworkTab` → `react-force-graph-2d`
- `feed-fetcher` → `ad-filter` + `xml-helpers` + `image-extractor`
