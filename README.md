# World Dashboard

A live intelligence dashboard that aggregates RSS/Atom feeds from 147+ global data sources and displays them in a situation-room aesthetic with entity extraction, anomaly detection, network graph visualization, and geospatial mapping.

**Live**: [worlddashboard.vercel.app](https://worlddashboard.vercel.app/)

## Features

- **Feed Aggregation** — Fetches 147+ RSS/Atom feeds in parallel with 3-phase fallback (direct, relay, alt URL)
- **FEEDS Tab** — Sortable table (desktop) with responsive card layout (mobile), urgency color-coded rows
- **INTEL Tab** — Named entity extraction (countries, organizations, regions, persons) with frequency, urgency breakdown, trend velocity, co-occurrence links, and sentiment analysis
- **SIGNALS Tab** — Anomaly detection: surge detection, sentiment deterioration, cross-category alerts, novel entity emergence, escalation tracking, cascading effects modeling
- **NETWORK Tab** — Force-directed graph of entity co-occurrences
- **MAP Tab** — Geospatial markers with Leaflet, color-coded by urgency
- **Ad Filtering** — 3-tier system: URL patterns, title regex (50+ patterns), and financial ad detection
- **Light/Dark Mode** — Persisted to localStorage
- **Search & Filter** — Full-text search across titles, sources, summaries, and categories

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **Maps**: Leaflet + react-leaflet
- **Graphs**: react-force-graph-2d
- **Testing**: Vitest
- **Deployment**: Vercel (free tier, auto-deploys from main)
- **Relay**: Railway (GCP IP, bypasses AWS blocks)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/hiroshiwald/worlddashboard.git
cd worlddashboard

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RELAY_URL` | No | URL of the Railway relay server for bypassing IP blocks |
| `RELAY_SECRET` | No | Optional auth key for relay requests |

## Project Structure

```
src/
├── app/
│   ├── api/sources/route.ts    # API endpoint: fetches feeds, returns JSON
│   ├── layout.tsx              # Root layout with metadata
│   ├── page.tsx                # Home page (renders DashboardTable)
│   └── globals.css             # Tailwind directives, dark scrollbar
├── components/
│   ├── DashboardTable.tsx      # Main component: state, filtering, tab routing
│   ├── HeaderBar.tsx           # Header bar: branding, search, tabs, controls
│   ├── FeedItemImage.tsx       # Shared image component with fallback
│   ├── IntelTab.tsx            # Entity table with urgency and sentiment
│   ├── SignalsTab.tsx          # Anomaly detection and cascade visualization
│   ├── NetworkTab.tsx          # Force-directed entity graph
│   └── MapTab.tsx              # Leaflet geospatial markers
├── hooks/
│   └── useSources.ts           # React hook: fetch /api/sources
└── lib/
    ├── types.ts                # TypeScript interfaces
    ├── feed-fetcher.ts         # Feed fetching with caching and fallback
    ├── ad-filter.ts            # Ad/spam content detection
    ├── xml-helpers.ts          # HTML stripping, XML tag/attribute extraction
    ├── image-extractor.ts      # Image URL extraction from RSS/Atom blocks
    ├── entity-extractor.ts     # Named entity recognition (NER)
    ├── entity-dictionaries.ts  # Country, org, region dictionaries
    ├── signal-detector.ts      # Anomaly detection algorithms
    ├── signal-storage.ts       # Signal muting and entity snapshot persistence
    ├── cascade-graph.ts        # Second/third-order impact chain modeling
    ├── urgency.ts              # Category-to-urgency mapping and styling
    ├── theme.ts                # Dark/light theme class definitions
    ├── date-utils.ts           # Time formatting utilities
    ├── geo-coordinates.ts      # Country/region lat/lng lookup
    ├── sources-data.json       # Pre-generated source list from CSV
    └── __tests__/              # Unit tests (124 tests, 8 files)
        ├── ad-filter.test.ts
        ├── xml-helpers.test.ts
        ├── image-extractor.test.ts
        ├── urgency.test.ts
        ├── date-utils.test.ts
        ├── feed-parser.test.ts
        ├── entity-extractor.test.ts
        └── signal-detector.test.ts
```

## Architecture

```
User → page.tsx → DashboardTable → useFeed() → GET /api/sources
                                                      ↓
                                              sources-data.json
                                                      ↓
                                              fetchAllFeeds()
                                           ┌──────────┼──────────┐
                                      Direct fetch  Relay   Alt URL
                                           └──────────┼──────────┘
                                                      ↓
                                              parseFeedXml()
                                              ad-filter + images
                                                      ↓
                                              FeedItem[] → Client
                                           ┌──────┬──────┬──────┐
                                        Feeds  Intel  Signals  Map/Network
```

## Urgency Levels

| Level | Color | Categories |
|-------|-------|------------|
| Critical | Red | Conflict, Cyber, Military, Radiation, Space Weather |
| Warning | Amber | Natural Disaster, Health, Displacement |
| Advisory | Yellow | Government, Sanctions, Aviation |
| Monitoring | Sky | Economic, Supply Chain, Prediction, Trade, Humanitarian |
| System | Slate | Infrastructure, AI/ML, Compute, Proxy |
| Neutral | Gray | Everything else |

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

124 unit tests covering: ad filtering, XML parsing, image extraction, urgency mapping, date formatting, feed parsing, entity extraction, and signal detection.

## Deployment

The app auto-deploys to Vercel from the main branch. The relay server is deployed separately on Railway.

## Regenerating sources-data.json

If `Dashboard Sources.csv` is modified:

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
