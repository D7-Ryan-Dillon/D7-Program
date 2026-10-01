# erosion-workspace

A Next.js app for an FAU architecture studio project (Design 7, Assignment
2, "Proto-Architectural Spaces"). The studio erodes foam blocks into
"tiles" -- either in Rhino/Grasshopper or, in this app, directly from a few
photos -- then scores each tile against the studio's 12 descriptors,
auto-generates connected/interlocking arrangements of them, and exports
presentation boards.

**Picking this project up in a new session (human or AI)?** Start with
[HANDOFF.md](HANDOFF.md) -- full project context, repo links, current
state, and what's intentionally off-limits right now.
[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) has the exact data format the
Viewer/Analysis/Arrange tabs read from a Grasshopper export specifically.

## What it does

Five tabs, in order:

1. **Viewer** -- load a tile from a Grasshopper export (drag-and-drop a
   folder, or a `.zip`), see it in 3D, read its metrics.
2. **Sections** -- build a tile a different way: pick (or upload) six face
   photos, assign one to each face of a cube or hexagonal prism, and
   generate a tile entirely in the browser, no Grasshopper needed.
3. **Analysis** -- score any tile against the 12 studio descriptors
   (carved, stepped, porous, continuous, resistant, threaded, graduated,
   non-hierarchical circulation, force-driven, light-filled, monumental,
   spatial density).
4. **Arrange** -- auto-generate a connected, interlocking arrangement of
   the tiles on the bank; inspect and edit joints and instances; export.
5. **Boards** -- lay out a presentation board from the tiles on the bank
   (adaptive grid, axo/perspective renders, auto-fit labels) and export it
   as two print-resolution PNGs -- the board itself, and a second page of
   each tile's scored descriptors.

## First time using it

1. `npm install && npm run dev`, then open the app.
2. Enter any project code on the gate screen -- a new code starts an empty
   project; typing in an existing one loads everything saved under it (you
   can reopen that same code on any device later).
3. Get at least one tile onto the bank: either drop a Grasshopper
   `_analysis` folder/`.zip` on the Viewer tab, or build one from photos on
   the Sections tab.
4. Try the other tabs -- Analysis to score it, Arrange to auto-generate a
   composition, Boards to export a presentation plate.

Everything auto-saves (once Supabase is configured below) under your
project code, with a save-status indicator in the header.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in real values -- see HANDOFF.md section 6
npm run dev
```

Without a real `.env.local` the app still runs, it just can't save/load by
project code.

```bash
npm run lint       # eslint
npx tsc --noEmit   # typecheck
npm run build      # production build
```

## Layout

```
app/                     Next.js App Router pages
components/
  shared/                Header, tab nav, logo, project-code gate, upload buttons
  viewer/                 3D viewport, upload zone, metrics legend
  sections/               Tile bank, correction editor, cube/hex builder
  analysis/               Descriptor scoring UI
  arrange/                Bank, settings, joints, viewport, per-piece editing
  boards/                 Tile picker, board settings, live preview canvas
lib/
  types.ts                Typed shapes for a tile (ParsedTile) and its faces/sections
  ingest.ts               Turns a dropped Grasshopper folder/.zip into a ParsedTile
  scoring/                The 12-descriptor scoring engine (Analysis tab)
  arrange/                Auto-generate, matching, joints, regrowth (Arrange tab)
  sections/               Photo -> trace -> lofted volume -> ParsedTile (Sections tab)
  boards/                 Grid layout, frame shape, text fitting, canvas export (Boards tab)
  exporters/              CSG fuse, OBJ export, recipe manifest
  persistence.ts          Save/load a project by code, via Supabase
  supabase/               Supabase client setup (browser + server-only)
supabase/setup.sql         Run once in the Supabase SQL Editor for a fresh project
docs/DATA_FORMAT.md        Exact Grasshopper export data contract
HANDOFF.md                 Full project context for a new AI session or contributor
```

## Related repos

See [HANDOFF.md section 2](HANDOFF.md#2-where-this-code-lives-four-repos-one-live-reference-site)
for the full picture -- the earlier prototype, the Sections tab's source
asset repo, and the original standalone tool its lofting algorithm was
ported from (plus a live reference site for that last one).
