# Feed Source Tracker

Tracks all possible RSS/news feeds — what we use, what we could add, and their status.

**Legend:**
- **Status**: `active` = in sources-data.json as RSS | `available` = known working, not yet added | `blocked` = 403/paywalled | `dead` = 404/removed
- **Method**: `direct` = native RSS URL | `google` = Google News RSS proxy | `rsshub` = RSSHub mirror | `relay` = needs relay

## Currently Active Feeds (sources-data.json)

| Source | Category | Method | Status | Notes |
|--------|----------|--------|--------|-------|
| Defense News | Defense | direct | active | |
| Naval News | Defense | direct | active | |
| The War Zone | Defense | direct | active | |
| Foreign Affairs | Geopolitics | direct | active | |
| Foreign Policy | Geopolitics | direct | active | |
| The Diplomat | Geopolitics | direct | active | |
| UK FCDO Travel Advice | Gov Advisory | direct | active | Atom feed |
| WHO Africa Emergencies | Health | direct | active | |
| WHO News | Health | direct | active | |
| GDACS | Disaster | direct | active | |
| RT (Russia Today) | News | direct | active | State-affiliated |
| Associated Press | News | direct | active | via feedx.net |
| Al Jazeera | News | direct | active | |
| BBC News - World | News | direct | active | |
| DW News | News | direct | active | |
| France 24 | News | direct | active | |
| NHK World-Japan | News | direct | active | |
| NPR - World | News | direct | active | |
| New York Times - World | News | direct | active | |
| Sky News - World | News | direct | active | |
| The Guardian - World | News | direct | active | |
| Washington Post - World | News | direct | active | |
| The Intercept | News | direct | active | |
| Zero Hedge | News | direct | active | |
| Bellingcat | OSINT | direct | active | |
| CISA Cybersecurity | Cyber | direct | active | |
| Relief Web | Humanitarian | relay | active | |
| TASS | News | relay | active | State-affiliated |
| Times of Israel | News | relay | active | |
| South China Morning Post | News | direct | active | |
| Yonhap News Agency | News | direct | active | |
| Anadolu Agency | News | direct | active | |
| The Moscow Times | News | direct | active | |
| International Crisis Group | Think Tank | direct | active | |
| Atlantic Council | Think Tank | direct | active | |
| IAEA News | Nuclear | direct | active | |
| Reuters - World News | News | google | active | Switched to Google News RSS |
| CNN - World | News | google | active | Switched to Google News RSS |

## Newly Added — 2026-04-22 Tier 1 Batch (ids 183–215)

| Source | Category | Method | Status | Notes |
|--------|----------|--------|--------|-------|
| ABC News - World | News | google | active | US broadcast |
| CBS News - World | News | google | active | US broadcast |
| NBC News - World | News | google | active | US broadcast |
| MSNBC | News | google | active | US cable |
| Politico Europe | News | google | active | EU politics |
| The Atlantic | News | google | active | Long-form US |
| Vox | News | google | active | Explainer journalism |
| BBC Mundo | News | google | active | Spanish BBC (Latin America) |
| Die Zeit | News | google | active | German weekly |
| Bild | News | google | active | German tabloid |
| Corriere della Sera | News | google | active | Italian press |
| La Repubblica | News | google | active | Italian press |
| NOS Nieuws | News | google | active | Dutch public broadcasting |
| SVT Nyheter | News | google | active | Swedish public broadcasting |
| TVN24 | News | google | active | Polish news |
| Kathimerini English | News | google | active | Greek press |
| BBC Turkish | News | google | active | BBC Turkish service |
| Oman Observer | News | google | active | Gulf press |
| Island Times | News | google | active | Pacific islands |
| ZDNet | Tech | google | active | Enterprise tech |
| Engadget | Tech | google | active | Consumer tech |
| Fast Company | Tech | google | active | Tech/business |
| Ransomware.live | Cyber | google | active | Active ransomware tracking |
| AWS Status | Tech | direct | active | Cloud outages |
| Azure Status | Tech | direct | active | Cloud outages |
| The Block | Crypto | google | active | Crypto news |
| Decrypt | Crypto | google | active | Crypto news |
| Blockworks | Crypto | google | active | Crypto/markets |
| Investing.com | Finance | google | active | Financial markets |
| MarketWatch | Finance | google | active | Financial markets |
| Mining.com | Commodities | google | active | Mining industry |
| Rigzone | Commodities | google | active | Oil & gas |
| UK MOD | Defense | direct | active | Atom feed (gov.uk) |

## Newly Added — Google News RSS (Test Batch)

| Source | Category | Method | Status | Notes |
|--------|----------|--------|--------|-------|
| PBS NewsHour | News | google | active | US public broadcasting |
| Wall Street Journal | News | google | active | US business/world |
| Politico | News | google | active | US politics |
| The Hill | News | google | active | US politics |
| Axios | News | google | active | US politics/tech |
| Fox News World | News | google | active | US cable news |
| Tagesschau | News | google | active | German public broadcasting |
| El Pais English | News | google | active | Spanish press |
| ANSA English | News | google | active | Italian wire service |
| Meduza | News | google | active | Russian independent media |
| Krebs on Security | Cyber | google | active | Security journalism |
| The Hacker News | Cyber | google | active | Cybersecurity news |
| Military Times | Defense | google | active | US military |
| CNA Singapore | News | google | active | Channel News Asia |
| Bangkok Post | News | google | active | Thai English press |
| Chosun Ilbo English | News | google | active | South Korean press |
| FAO News | Food Security | google | active | UN food agency |
| Task and Purpose | Defense | google | active | US military culture |
| TechCrunch | Tech | google | active | Tech/startup news |
| CoinDesk | Crypto | google | active | Crypto news |

## Available — Not Yet Added

_All entries in this section have been promoted to active as of 2026-04-22. Remaining "available" candidates (if any) should be listed below as they are discovered. Pre-existing tracker entries that were already in `sources-data.json` but still listed as "available" (ProPublica, Der Spiegel English, Hurriyet Daily News, Novaya Gazeta Europe, VnExpress International, Rudaw, Asharq Al-Awsat, Dark Reading, Schneier on Security, CoinTelegraph, Seeking Alpha, Kitco News, OilPrice.com, Oryx OSINT, gCaptain) were tracker-only stale rows and have been removed._

## Removed From RSS Pool (not fetchable from cloud)

| Source | Category | Reason | Notes |
|--------|----------|--------|-------|
| Liveuamap | Conflict | Web/JS only | No RSS feed |
| Jane's / Janes | Defense | Paywalled | No public RSS |
| AFP | News | Paywalled | Subscriber only |
| Breaking Defense | Defense | 403 blocked | Could try Google News |
| Xinhua | News | 403 blocked | RSSHub also blocked |
| Nikkei Asia | News | 403 blocked | |
| Chatham House | Think Tank | 403 blocked | |
| Brookings | Think Tank | 403 blocked | |
| Army Recognition | Defense | 404 | RSS removed |
| Defense One | Defense | 404 | RSS removed |
| Australia DFAT | Gov Advisory | 404 | API discontinued |
| ECDC | Health | 404 | RSS removed |
| NRC | Radiation | 404 | RSS removed |
| Kyiv Independent | News | 404 | Feed removed |
| SIPRI | Think Tank | 404 | Site redesigned |
| NZ MFAT | Gov Advisory | Web/SPA | Feed removed |
| IEA | Economic | No RSS | API only |
| ACAPS | Humanitarian | No RSS | SPA redesign |
| US State Dept | Gov Advisory | Empty | Items too old |
| CDC Travel | Health | Empty | API changed |
| IRNA | News | Empty | Returns HTML |
| CSIS | Think Tank | Empty | RSS broken |
| RAND | Think Tank | Empty | RSS removed |
| Carnegie Endowment | Think Tank | Empty | Solr endpoint dead |
