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
   folder, or a `.zip`), see it in 3D, read its metrics. Show 1, 2 or 4
   viewports at once, optionally with matched cameras. Each viewport is
   labelled with its file and has a strip of small buttons under it -- view,
   rendered/ghosted, visibility with opacity, its own clipping plane, rotation
   and export -- plus "Sync all" to copy one viewport's settings onto the rest.
   With several viewports the right panel shows one aligned specs table.
   Each viewport can show the tile in **3D, as a Plan or as a Section**: the
   plans and sections draw themselves from the tile (foam and floor plates cut
   solid, void open, a floor tinted below the cut, rooms labelled, a 10 ft
   ruler) and export as SVG or PNG at a chosen scale. The **Layers** button
   colours the floor plates and support branches apart from the foam and tints
   the void room by room or floor by floor; the right panel reads the tile as
   architecture (floors, rooms, light, route, floor plates) and checks whether
   it will print (one piece, wall thickness against a 0.4 mm nozzle, overhang,
   contact with the bed). **Print (STL)** writes a print-ready STL at a chosen
   scale (1 in = 10 ft by default) of the foam, the void, the plates or the
   branches.
2. **Builder** (formerly "Sections") -- build a tile a different way: pick (or upload) face
   photos, assign one to each face of a cube or hexagonal prism, and
   generate a tile entirely in the browser, no Grasshopper needed. The
   builder shows a thumbnail on every face, turns any face's tile in 90 degree
   steps, and fills the faces with a sensibly matched, new set on every
   Auto-fill (neighbouring faces' edges are compared; lock a face to keep it),
   swaps which side is foam and
   which is void, cleans up floating specks and thin branches, and keeps
   every piece you generate under the project code (the "Saved objects"
   list), whether or not you add it to the tile bank. A tile built here is
   measured by the same code that reads a Grasshopper export (levels, rooms,
   routes, light, structure, floor plates), "Export _analysis" writes the same
   folder the engine does (including drawings and STL), and **Print STL** has
   parts and scale. **Floor plates**
   (optional): flat slabs at set heights, made of foam or void (its own
   switch, independent of Swap), with footprints (full / pulled in / L / T /
   plus), openings, and erosion that makes a plate recede wherever a void
   shaft runs through it so vertical connections stay open.
3. **Analysis** -- score any tile against the 12 studio descriptors
   (carved, stepped, porous, continuous, resistant, threaded, graduated,
   non-hierarchical circulation, force-driven, light-filled, monumental,
   spatial density), beside a slowly turning axo view of the tile. Each
   descriptor shows its score, a **quantitative** headline with the measures
   behind it, a **qualitative** reading on a named scale, and a sentence about
   *this* tile's spaces ("the tallest space is the middle shaft, 18 ft clear
   over 7 ft across..."), with what lifts it and what holds it back; the
   **Evidence** button lights what the sentence is about in the 3D view or on
   a plan or section. A **Results** panel gives every tile against the carried
   criteria as a table (CSV or image) and an annotated diagram per descriptor.
   Compare
   2 tiles (3 on wide screens) side by side with the biggest differences
   marked. The **criteria carried forward** panel picks the 6-12 strongest
   descriptors for the tiles in the project (editable, with a written reason
   for each, and always-on / always-off pins); the Boards descriptor page
   lists only those.
4. **Arrange** -- compose the tiles into ONE connected, walkable building.
   Place, drag, turn and group pieces freely (smart snapping to faces, openings
   and floors; any floor can meet any floor), or generate an arrangement from a
   shape, priorities and program rules (which kinds of tile may touch, how many
   of each); every joint is scored in four readable parts, the whole is read as
   architecture (levels, longest route, daylight, print checks, the 12
   descriptors), a smoothing pass bridges near-misses and lists floating
   fragments for you to approve, and each arrangement is saved with the project
   and can be added back as a tile. Compare before / after, find nice views,
   export a walk-through MP4 or GIF, PNGs, STL, drawings, a report, or a mass for
   a second pass in Rhino. Details: `docs/ARRANGE.md`.
   A shortcut bar at the bottom of every tab always shows the keys that work
   right now (`?` lists them all).
5. **Boards** -- lay out a presentation board from the tiles on the bank
   (adaptive grid, axo/perspective renders, auto-fit labels) and export it
   as two print-resolution PNGs -- the board itself, and a second page of
   each tile's scored descriptors. Click a tile for a popup editor: locked
   axonometric corners or free perspective, clipping plane, per-tile
   colours, outlines and facet lines (all line weights in points).
   Optional **3x5 catalogue layout** (gathering / office / lobby rows,
   typology columns, editable labels), a name tag whose size, line count and
   text are settable (short / typology / full / custom template), an optional
   top-N descriptor highlight, board presets, auto-sort, "copy settings to
   other tiles", and per-group reset. Everything saves with the project.
   **Tile views** show every tile (or one, from the tile list) as a plan or a
   section instead of the 3D render, on the board's own background.
   The optional **caption box** is per page (page 1 and page 2 each have their own
   switch and text), and the descriptor page can print each measured value under
   its bar (off by default, because it does not always fit).
   **Animated export** turns the board into a seamlessly looping GIF (or
   MP4): every tile makes one full 360-degree turn from the view it is set
   to, all in sync. Pick which pages to export (board / descriptors), the
   spin time and frame rate (10 / 20 / 30), the output width (up to 5000 px), and the GIF's colour (auto,
   or a custom palette size and dither). It lives in a collapsible section
   so it stays out of the way while you build the board.

Clipping planes (X/Y/Z, reversible, optional cut-face highlight) are in the
Viewer, the Sections builder and the Boards popup. The layout works from a
phone up to a desktop; on a phone or half-screen laptop the viewport (or the
board) stays pinned to the top of the tab while you scroll the controls.
The loaded tiles sit in the top bar on Viewer and Analysis, so they stay on
screen; filter chips beside them (All, Gathering, Workspace, Lobby, Cube builder)
show only one kind at a time. The whole app is black with pink, orange and gray only; new viewports
and boards start in the same look (ghosted foam, magenta void, peach floor
plates, orange branches).

Every viewport (Viewer, Analysis, Arrange, the cube builder) has an
**Export** button: current view as a high-resolution PNG (pixels or print size
+ DPI, transparent or coloured background), or a looping turntable GIF / MP4
(starting corner with a first-frame preview, spin time, fps, width, auto or
custom GIF colour), and an auto-rotate switch with a speed slider. Your last
board, viewer, analysis, arrange and builder settings, presets, and the tab you
were on are saved with the project code, so reopening it picks up where you
left off.

The long side panels (Board settings, the cube builder's Faces / Floor plates /
Cleanup / Saved objects, Arrange's Bank / Joints / pieces, the Viewer's specs,
Analysis' descriptor list and criteria, the export dialogs) are split into
**collapsible sections**: click a heading to fold or open it. Which ones are open
is remembered per project, and Board settings has Expand all / Collapse all.

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
npm run check:parity   # lib/tiles agrees with the Grasshopper engine's own analysis on the 15 typology tiles
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
  arrange/                Bank, generate, program, whole, joints, sequence, selection, viewport, exports
  boards/                 Tile picker, board settings, live preview canvas, per-tile popup editor
lib/
  types.ts                Typed shapes for a tile (ParsedTile) and its faces/sections
  ingest.ts               Turns a dropped Grasshopper folder/.zip into a ParsedTile
  tiles/                  How a tile is read from its voxels (levels, rooms, routes, light, structure, plates): the ONE shared pipeline
  drawing/                Plan and section drawings (canvas + SVG), used by the Viewer, Boards, Analysis and the exports
  scoring/                The 12-descriptor scoring (measures, drivers, sentences, results exports)
  arrange/                Placement, snapping, joints, layout (the connected rule), generator, composite model, smoothing, views (Arrange tab)
  sections/               Photo -> trace -> lofted volume -> ParsedTile (Sections tab)
  boards/                 Grid layout, frame shape, text fitting, canvas export, GIF/MP4 turntable export (Boards tab)
  exporters/              CSG fuse, OBJ export, recipe manifest
  persistence.ts          Save/load a project (tiles + saved cube-builder pieces) by code, via Supabase
  ui/select.tsx (components) The app's dark dropdown, a drop-in for a native <select>
  shared/Section.tsx (components) A collapsible group of settings; open state saved per project
  workspaceUi.ts          Saved workspace state (tab, open/closed sections) + useSectionOpen
  clipping.ts             Shared clipping-plane system (plane, outline, stencil cut-face caps)
  viewportCapture.ts      Offscreen high-res PNG / turntable frames from any live viewport
  useCriteria.ts          The project's carried-forward criteria (uses scoring/selection.ts)
  presets.ts              Saved presets (boards / viewer / compare), per project
  renderTile.ts           Headless tile renderer + Boards line decorations (outlines, facet lines)
  supabase/               Supabase client setup (browser + server-only)
engine/                    Grasshopper erosion engine 7 (floor plates, any-geometry input, loop), recipes, headless tests -- see engine/README.md
supabase/setup.sql         Run once in the Supabase SQL Editor for a fresh project
docs/DATA_FORMAT.md        Exact Grasshopper export data contract
HANDOFF.md                 Full project context for a new AI session or contributor
```

## Related repos

See [HANDOFF.md section 2](HANDOFF.md#2-where-this-code-lives-four-repos-one-live-reference-site)
for the full picture -- the earlier prototype, the Sections tab's source
asset repo, and the original standalone tool its lofting algorithm was
ported from (plus a live reference site for that last one).
