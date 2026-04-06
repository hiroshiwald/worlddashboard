# World Dashboard — Handoff Document for New Session

## Project Overview
A live intelligence dashboard deployed at **https://worlddashboard.vercel.app/** that fetches RSS/Atom feeds from 147 global data sources and displays them in a "Situation Room" aesthetic. Includes an INTEL tab with named entity extraction.

**Repo**: `hiroshiwald/worlddashboard`
**Branch**: `claude/live-dashboard-sources-feed-PShQI`
**PR**: #1 (open)
**Deploy**: Vercel auto-deploys from the branch

---

## Architecture

**Stack**: Next.js 14 App Router, TypeScript, Tailwind CSS, Vercel (free tier)
**Font**: Consolas/Menlo monospace globally (`font-mono` on body)
**Theme**: Dark/light toggle, persisted to localStorage

### Key Files

| File | Purpose |
|------|---------|
| `src/components/DashboardTable.tsx` | Main component: state management, filtering/sorting, tab routing, feeds table/cards |
| `src/components/HeaderBar.tsx` | Header bar: branding, search (desktop+mobile unified), tabs, category filter, theme toggle, refresh |
| `src/components/FeedItemImage.tsx` | Shared image component with fallback logic for desktop and mobile |
| `src/components/IntelTab.tsx` | INTEL tab: entity table (desktop) + entity cards (mobile), sorting, type filter, urgency bars, co-occurrence links |
| `src/components/SignalsTab.tsx` | SIGNALS tab: anomaly detection, cascade visualization, entity velocity grid |
| `src/components/NetworkTab.tsx` | Force-directed entity co-occurrence graph |
| `src/components/MapTab.tsx` | Leaflet geospatial markers |
| `src/lib/feed-fetcher.ts` | Server-side RSS/Atom fetcher: parallel fetch with 3-phase fallback, caching, request dedup |
| `src/lib/ad-filter.ts` | Ad/spam content detection: 50+ title patterns, 14 URL patterns, 28 financial ad patterns |
| `src/lib/xml-helpers.ts` | HTML stripping, XML tag extraction, attribute extraction |
| `src/lib/image-extractor.ts` | 6-method image URL extraction hierarchy from RSS/Atom blocks |
| `src/lib/entity-extractor.ts` | Client-side NER: dictionary matching (countries/orgs/regions) + person name heuristic, co-occurrence computation, trend velocity |
| `src/lib/entity-dictionaries.ts` | 120+ countries with aliases, 50+ orgs, 30 regions, person-name stopwords |
| `src/lib/signal-detector.ts` | Anomaly detection: surge, sentiment deterioration, cross-category, novel emergence, escalation |
| `src/lib/signal-storage.ts` | Signal muting and entity snapshot localStorage persistence |
| `src/lib/cascade-graph.ts` | Second/third-order impact chain modeling |
| `src/lib/urgency.ts` | Maps categories to urgency levels, returns dark/light theme row and badge classes |
| `src/lib/theme.ts` | Dark/light theme class definitions (`getThemeClasses()`) |
| `src/lib/date-utils.ts` | `timeAgo()` and `formatDate()` utilities |
| `src/lib/types.ts` | FeedItem, SourceMeta, SortConfig, UrgencyLevel, EntityType, ExtractedEntity, Signal |
| `src/lib/geo-coordinates.ts` | Country/region lat/lng lookup table |
| `src/lib/sources-data.json` | Pre-generated JSON from CSV (147 sources). Must regenerate if CSV changes. |
| `Dashboard Sources.csv` | Master source list: 147 entries with name, category, tier, URL, type |
| `src/hooks/useSources.ts` | `useFeed()` hook: fetches `/api/sources`, returns items/loading/error/stats/refresh |
| `src/app/api/sources/route.ts` | API route: reads sources-data.json, calls fetchAllFeeds(), returns JSON. `force-dynamic`, `maxDuration=30` |
| `src/app/layout.tsx` | Root layout with `font-mono` body class |
| `src/app/globals.css` | Tailwind directives, dark scrollbar, row transitions |
| `src/lib/__tests__/` | 124 unit tests across 8 files (Vitest) |

### Data Flow
1. User loads page → `useFeed()` calls `/api/sources`
2. API route reads `sources-data.json` (147 sources), filters to RSS/Atom types
3. `fetchAllFeeds()` fetches all feeds in parallel (8s timeout each), parses XML, filters ads, extracts images, caps at 15 items/feed
4. Returns sorted items (newest first) to client
5. Client renders in table (desktop) or cards (mobile)
6. INTEL tab runs `extractEntities()` client-side on all items (memoized)

### Ad Filtering (3 tiers)
1. **URL patterns**: 14 patterns matching ad domains/paths
2. **Title regex**: 50+ patterns for ad headlines
3. **Financial ad filter**: 28 patterns for CNN-style dateless financial product ads
4. **feedHasDates heuristic**: Only drops dateless items from feeds that normally have dates

### Urgency Color Coding
- **Critical** (red): conflict, cyber, military, radiation, space weather
- **Warning** (amber): natural disaster, health, displacement
- **Advisory** (yellow): government, sanctions, aviation
- **Monitoring** (sky): economic, supply chain, prediction, trade, humanitarian
- **System** (slate): infrastructure, ai/ml, caching, compute, proxy, imagery
- **Neutral** (no color): everything else

---

## Current State (as of last commit cca8a0f)

### What's Working
- 147 RSS/Atom sources fetched in parallel
- FEEDS tab: sortable table (desktop) + card layout (mobile)
- INTEL tab: entity extraction with frequency, urgency breakdown, 1H trend, co-occurrence
- Search bar filters headlines, sources, summaries, categories
- Category dropdown filter
- Light/dark mode toggle (persisted)
- Responsive header bar (stacks on mobile)
- Urgency color-coded rows with left border
- Thumbnail images inline with headlines
- Ad filtering (CNN financial ads specifically)
- NHK English feed (was Japanese)
- Deployed and live on Vercel

### What Was NOT Requested Yet / Potential Next Steps
- No automated refresh interval (manual refresh only)
- No data persistence/caching between page loads
- No export functionality (CSV/PDF of current view)
- No notification system for critical alerts
- No historical trend data (entity mentions over time beyond 1H snapshot)
- INTEL tab person detection is heuristic-only (2-3 capitalized words) — could have false positives
- Entity dictionary could be expanded
- Summary column sometimes shows raw HTML fragments from poorly-formatted feeds

### PARKING LOT — Feed Reliability

**Current state**: ~31/65 RSS feeds succeed. The rest are blocked by news sites
that reject requests from Vercel/AWS IP ranges.

**Deployed fix**: Railway relay server (`relay/` directory) provides a GCP-based
fallback IP. Feed fetcher tries direct first, falls back to relay.

**Future improvement — Caching Relay (high impact)**:
Instead of fetching all 65 feeds on every user request, the relay should:
1. Run a cron job every 15 minutes that fetches each feed and caches the result
2. Serve cached responses instantly when the dashboard requests them
3. Build IP reputation over time (same IP, regular interval = trusted crawler)
4. Implement `If-Modified-Since` / `ETag` headers to reduce bandwidth
5. Eventually register as a known feed reader (like Feedly/Feedbin do)

This converts the relay from a pass-through proxy into a proper feed aggregation
cache — the same architecture Feedly, Feedbin, and NewsAPI use. Expected result:
60+/65 feeds working reliably with sub-second response times.

---

## Regenerating sources-data.json from CSV

If the CSV is modified, run this inline script to regenerate the JSON:
```bash
node -e "
const fs = require('fs');
const csv = fs.readFileSync('Dashboard Sources.csv', 'utf-8');
const lines = csv.split('\n');
const headers = lines[0].split(',').map(h => h.trim().replace(/^\"|\"$/g, ''));
const data = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const vals = [];
  let inQuote = false, current = '';
  for (const ch of line) {
    if (ch === '\"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { vals.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  vals.push(current.trim());
  const obj = {};
  headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
  data.push(obj);
}
fs.writeFileSync('src/lib/sources-data.json', JSON.stringify(data, null, 2));
console.log('Generated', data.length, 'sources');
"
```

---

## Git History (recent commits on branch)
1. `cca8a0f` — Mobile-responsive card layout for FEEDS and INTEL tabs
2. `5120289` — Add INTEL tab with named entity extraction
3. `0967a5a` — Add light/dark mode toggle, merge photo into headline column
4. `12559e1` — Situation Room redesign: monospace, uniform sizing, dark theme
5. `0c5a1dc` — Hybrid UI redesign with search: dark header + light table
6. `8f4c43f` — Fix NHK feed to use English version instead of Japanese
7. Earlier commits: initial build, feed fetching, ad filtering, 147 sources, Vercel deployment fixes
