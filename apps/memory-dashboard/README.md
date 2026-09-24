# otto memory dashboard

"What Otto remembers": a standalone explorer for Otto's shared memory
(`memory.sqlite`) with a live feed of what Otto remembers and uses. It is not
part of the Otto web app: it is a small Vite + React bundle served statically by
the memory dashboard Hono server.

## Stack

- React 19, Vite, TypeScript, plain CSS (dark theme, no Tailwind)
- `d3-force` for the force-directed layout; rendering is a hand-rolled `<canvas>`
- No router, no query client: one page, fetch + SSE

## Development

```bash
# Terminal 1: the API (real server, or the contract mock below)
bun run dev:mock            # MOCK_SEED=0 empty, MOCK_SEED=2 sparse, MOCK_LIVE=0 static

# Terminal 2: Vite on http://localhost:5180, proxying /api to the API port
bun run dev
```

The Vite dev proxy targets `http://127.0.0.1:${OTTO_MEMORY_DASHBOARD_PORT ?? 9200}`
(`MEMORY_DASHBOARD_PORT` is also honoured).

`bun run build` emits `dist/` (relative asset paths, so the Hono server can mount
it at `/` or under a prefix). `bun run typecheck` and `bun lint` (from the repo
root) cover the app.

## API contract consumed

| Endpoint | Used for |
| --- | --- |
| `GET /api/graph?projectId=&includeSuperseded=true&limit=500` | graph nodes/edges (client filters scope/status/edge type locally) |
| `GET /api/memories/:id` | detail panel: content, source, lineage (oldest to newest), neighbors |
| `GET /api/activity?sinceId=&limit=` | initial history and polling fallback |
| `GET /api/events` (SSE, event name `memory`) | live feed |
| `GET /api/scopes` | project selector and global count |
| `GET /api/search?q=&projectId=` | highlights matching nodes on the canvas |

Assumptions: `/api/graph` with `projectId` still returns global memories and
entity nodes; `MemoryEvent.id` is monotonic so `sinceId` returns strictly newer
events; `lineage` includes the requested memory itself.

## UI

Plain language throughout: global = "About you", project = the project folder
name (full path on hover), session = "One chat only"; explicit = "You told
Otto", inferred = "Otto noticed". Ranking modes and internal agent names are not
shown; other agents appear as "via Codex".

- **List (default for small stores).** Cards grouped into "About you" and one
  section per project, with topic tags, link counts and relative times. The
  empty store gets a friendly explanation instead of an empty canvas.
- **Map.** The d3-force canvas becomes the default once there are more than 8
  memories, or at least 3 that are linked to each other; the List/Map switch
  overrides this. Colour = scope, hollow core = Otto noticed, dashed = replaced.
  Only memory-to-memory links are drawn. The legend shows only the link types
  present and toggles them ("Replaced by newer", "Adds detail", "Conflicts",
  "Related"). Topic tags are off by default ("Show topics"). Source/provenance
  entities (`derived_from`) are never drawn; they appear as "Source" in details.
  Labels skip overlaps; hover shows the full text. Use "Fit" or double-click to
  fit the view.
- **Details.** A short title derived from the first sentence, the full text
  once, then where it applies, how Otto learned it, the source, and when.
  "How this changed" appears only for a replacement chain, with word-level
  changes. Related memories are listed with their relation ("Conflicts with",
  "Replaces", ...). Copy the text with "Copy text".
- **Recent activity.** Grouped into Just now / Today / Earlier and phrased as
  sentences ("Used 1 memory for ...", "Updated ... replaced an older version").
  Lookups that found nothing, and the link rows that duplicate an update, are
  hidden behind "Show all". Click a row to highlight its memories.
- **Toolbar.** Project selector (Everything / About you / projects), List/Map,
  search (`/`), and "More" > "Show older versions". `Esc` closes details.
- The header dot shows Live / Reconnecting (SSE dropped, polling every 3s and
  retrying SSE every 15s) / Offline.
- Memory content is untrusted text: it is rendered as text only and common
  credential shapes are masked before display.
