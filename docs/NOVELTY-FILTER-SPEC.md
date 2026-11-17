# Entity map novelty filters: spec (approved 2026-11-17)

Goal: help the operator find new and unusual entities and the links between them.

## Data
- `/api/graph`: known entities and links. Window grows from 14 to 30 days (`WINDOW_DAYS` in `graph.ts`). Each link has `firstSeenAt`, `lastSeenAt` and `articleCount`. `role === "famous"` is the Wikidata fame verdict.
- `/api/emerging?days=N` (N up to 30): new names. A `kind: "candidate"` item (key `cand:<norm>`) has `anchors` with ids of known entities. The map adds each candidate as a node, linked to the anchors that are in the graph. Example: Lionfish UUV links to U.S. Navy (243).
- `followed` marks entities the operator tracks.

## Module `src/components/entitymap/novelty.ts` (pure, tested)
- `mergeNewNames(nodes, edges, items)`: adds candidate items as nodes (`status: "candidate"`, `role: "satellite"`, `state: "New"`, `mentions14d: item.mentions`, `ratio: 0`, `clusterIds: []`, `mergedInto: null`, `followed: false`) and one link per anchor in the graph (`articleCount` from the anchor, `weight: 0`, `firstSeenAt` and `lastSeenAt` = item `firstSeenAt`). Items of kind `entity` are already in the graph; skip them.
- `windowEdges(edges, days, asOf)`: links with `firstSeenAt <= asOf` and `lastSeenAt >= asOf - days`.
- `linkSurprise(edge attrs, sameCommunity, days, asOf)`: newness (first seen in the window: 1, else 0.2) x log2(1 + lift) x evidence (2 or more articles: 1, else 0.5) x bridge (different communities: 1.5, else 1).
- `nodeScores(graph, communities, days, asOf)`: sum of the node's top 3 link scores, +1 when the node is a new name, +0.5 when its role is not `famous`.
- `hopsFromFollowed(graph, hops)`: ids within 1 or 2 hops of followed nodes (followed nodes included).
- `selectNovel(graph, scores, opts)`: apply hide-famous and hops filters, then keep the top N by score. Always keep the anchors of kept new names, even when famous, so a new name never floats alone. Return the kept ids.
- `reasons(graph, communities, labels, days, asOf)`: one plain line per node, for example "New name, first seen 16 Nov, linked to U.S. Navy", "New link to Nvidia (3 articles)", "Links the 'Google, OpenAI, Samsung' and 'CNN, The Atlantic' groups".
- `firstSeen(graph)`: per node, the earliest `firstSeenAt` of its links (new names: their own). Replay hides nodes and links not yet seen on the replay day.
- `noveltyView(data, items, opts, now)`: the full pipeline. Merge, window, `buildGraph` (from `graph-metrics.ts`), communities, scores, select, subgraph. Returns `{ graph, communities, reasons, firstSeen, followedCount }`.
- Options: `{ days: 7 | 14 | 30, topN: number | null (null = novelty off), hideFamous: boolean, hops: 0 | 1 | 2, hideHubs: boolean }`.

## View
- Toolbar: Novelty on/off (default on) with a slider for top N (25 to 300, default 100). Window 7/14/30 days (default 14). Hide famous (default off). Near my tracked: Off / 1 hop / 2 hops; when no entity is followed, show "Track entities to use this filter". Show hubs (existing).
- Replay: a button steps the replay day from (now - days) to now, one day per 800 ms, and shows the date. Replay hides items by `firstSeen` in the sigma reducers, so the layout does not move. Stop resets to now.
- New names: ring or outline so they read as new. Clicking one opens its NameCard (existing `cand:` select path).
- Detail panel: the "why" line for the selected node.
- `useEmerging(days)` fetches `/api/emerging?days=<window>`.
