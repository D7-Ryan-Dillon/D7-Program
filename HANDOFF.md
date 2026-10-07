# HANDOFF: continuing erosion-workspace

Written for a fresh AI session (Claude Code, Codex, or otherwise) or a new
human contributor to pick this project up with no prior context. Read this
whole file before changing code. For the exact Grasshopper tile data format,
see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) -- that one's a narrower,
mostly-frozen reference; this file is the one that stays current.

## 1. The project in one paragraph

FAU School of Architecture, studio ARC4327 "Design 7", Assignment 2
("Proto-Architectural Spaces"). The studio built a Grasshopper/Rhino tool
that erodes a 20x20x20 ft foam block into a "tile" -- fifteen of these tiles
(three categories x five typologies: Gathering, Office, Lobby) need to be
scored against 12 studio descriptors and composed into connected,
interlocking, 3D-printable arrangements, then presented on boards.
**This repo, erosion-workspace, is the web app that does all of that**: load
or build tiles, score them, auto-generate arrangements, and export
presentation-plate PNGs.

## 2. Where this code lives: four repos, one live reference site

All under the `D7-Ryan-Dillon` GitHub org:

- **[D7-Program](https://github.com/D7-Ryan-Dillon/D7-Program)** -- **this
  repo**, erosion-workspace. The one you're working in; push to `master`
  (see section 8 for the project owner's standing instruction on that).
- **[D7-Program-9-29-Dillon](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Dillon)**
  -- the earlier prototype, `section-viewer`. Not developed further, but its
  README is still the best plain description of the *intended* behavior of
  the Viewer/Analysis/Arrange tabs -- erosion-workspace's own engines for
  those three tabs were ported and reworked from it. Key difference:
  section-viewer is 100% client-side with zero persistence; erosion-workspace
  adds the Supabase backend described in section 6.
- **[D7-Program-9-29-Ryan](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Ryan)**
  -- a data-only repo: the 48 raw face photos plus `tile-vectors.json` and
  `correction-proposals.json`. This is the source of the assets baked into
  `public/section-field/` for the **Sections** tab's tile bank.
- **[D7-Program-9-29-Ryan-pt-2](https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Ryan-pt-2)**
  -- `Section-Field-main`, the **original standalone app** (a separate
  Next.js project, not a prototype of this one) that the Sections tab's
  cube/hex builder and correction editor were ported from. Its
  `lib/volume-study.ts` is the direct source of this repo's
  `lib/sections/volumeField.ts` (confirmed line-for-line equivalent as of
  this handoff, just retyped to this repo's own trace/face types -- see
  section 7 for why this matters right now). It's also live at
  **https://section-field-som.ryanjburgess1.chatgpt.site/** -- genuinely
  useful to open side-by-side with this app's Sections tab when comparing
  behavior, since it's the real original tool, not just source code.

The Grasshopper/Python tool chain that *produces* the tiles the Viewer tab
reads now lives in this repo too, under [`engine/`](engine/)
(`erosion_engine_5f.py`, `erosion_foam.py`, `erosion_source.py`) -- added
2026-10-01 so both project members can see and edit it alongside the web
app. **Engine 7 (2026-10-03)** rebuilt it from 5f: floor plates
(`erosion_plates.py`: closed flat curves or geometry, any tilt, true flat tops,
per-source `plate_mode` and `cut`, anchor foam and support branches), any
closed geometry as the foam (`geo`), a bake-and-feed-back loop (`mass` out ->
`mass_in`), self-contained recipes (`erosion-recipe/2`) and an export that adds
`recipe.json`, `data/plates.json` and `voxels/mask|plates|struts.u8`
(`erosion-tile/4`). It is **uncommitted/untested in real Rhino** at the time of
writing: the numeric core is covered by `engine/headless/tests` (run
`run_all.py` with Rhino's bundled Python), the Rhino-only calls (reading
curves/geometry, `.3dm`) are not. Read `engine/ENGINE_7_GUIDE.md` (controls and
wiring) and `engine/RECIPES.md` (how to write and preview recipes -- a session
can design spaces by writing a recipe). The web app does not read plates yet:
`docs/DATA_FORMAT.md` section 12 is the contract; wiring plates into Viewer /
Analysis is the next app step once the engine is confirmed in Rhino. The fifteen **typology tile recipes** (engine 7: eroded forms, soft passages and warped strata, meeting at a shared standard port) are in `engine/tiles/recipes/` with previews, a report and the scripts
that build and check them (`engine/tiles/README.md`); the older V1/V2 sets and the `.gh` file are still local-only (binary
Rhino file, not meaningfully diffable). Both the Grasshopper scripts and
this app are actively worked on by both project members, not split by
person. The app itself never executes these scripts -- what it needs from
them is purely the data-format contract in
[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md), which `engine/README.md` points
back to.

## 3. Stack

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4, shadcn/ui
components, three.js / `@react-three/fiber` / `@react-three/drei` for the 3D
viewports, Paper.js for the Sections tab's correction editor, canvas 2D for
the Boards tab's print-resolution composition.

## 4. The five tabs

`components/shared/TabNav.tsx` is the source of truth for tab order:
**Viewer -> Sections -> Analysis -> Arrange -> Boards**.

### Viewer (`components/viewer/`)
Each viewport can show 3D, a Plan or a Section (`PaneState.draw`, `components/viewer/DrawingView.tsx`), has a Layers popup (foam, void, floor
plates, branches, tint by room or level, quick looks "Architecture" / "Rooms"), and the right panel has Spaces, Floor plates, Structure, Print checks
(`SpacesPanel.tsx`) and a Print (STL) section (`PrintPanel.tsx`).
Drop, upload, or `.zip` a Grasshopper `_analysis` folder (via the header's
always-present "Add folder" / "Add .zip" buttons, `components/shared/
AddTilesButtons.tsx`); see it in 3D; read its metrics. `lib/ingest.ts` turns
a folder/zip into a `ParsedTile` (`lib/types.ts`), the one shape every tab
downstream works with regardless of which tab created it.

### The shared tile pipeline (`lib/tiles/`, `lib/drawing/`) -- read before touching how a tile is processed
**Standing rule: how a tile is processed lives in `lib/tiles`, in one place.** The Grasshopper engine's export, the Sections builder's "Add tile"
(`lib/sections/buildTile.ts`) and "Export _analysis" (`lib/sections/exportAnalysis.ts`) must all produce the same data, so none of them may carry
a private copy of a measurement. `lib/tiles/measure.ts` (metrics, faces, sections), `analyze.ts` (levels, rooms, connections, routes, profile,
daylight, openings, structure; the TypeScript twin of `analyze_tile()` in `engine/erosion_engine_7.py`), `plates.ts` (plate facts from plate
cells), `pipeline.ts` (`ensureAnalysis`: fills in what a loaded or built tile lacks; called by ingest, the builder and project load),
`tint.ts`, `checks.ts` (print checks), (Arrange reads voxels directly through `lib/arrange/orient.ts`). Spec: `docs/DATA_FORMAT.md`
section 13. **`npm run check:parity`** compares `analyze.ts` with the engine's own `spaces.json` / `structure.json` on the 15 typology tiles
(`lib/tiles/fixtures`, regenerate with `engine/tiles/make_fixtures.py`); change the Python and the TypeScript together and keep it green.
`ParsedTile` carries `spaces`, `structure`, `plates`, `meta`, `partsUrl` and extra voxel arrays (`plates`, `struts`, `mask`, `rooms`), all persisted.
The main GLB (`glbUrl`) must stay foam + void only (Arrange, Boards and the OBJ exports render every node); plates and branches are a second
file (`partsUrl`, only the Viewer loads it).
`lib/drawing/` makes the automatic plan and section drawings (`build.ts` -> `Drawing`, `render.ts` canvas / SVG / PNG on the app's dark palette or
paper, `state.ts` the per-viewport / per-board-slot setting). `lib/exporters/stl.ts` writes print STL (parts, scale).

### Sections (`components/sections/`, `lib/sections/`)
A second, independent way to make a tile -- entirely in-browser, no
Grasshopper export needed. **This is where the project owner is doing
active work themselves; read section 7 before touching its core algorithm.**

- **`TileBank.tsx`** -- the bank of 48 baked-in face photos
  (`public/section-field/`) plus any new ones added, each with its best
  available 2D trace: a saved correction if the user drew one, otherwise the
  auto-trace proposal (`lib/sections/autoTrace.ts`). Corrections live in
  `localStorage` (`lib/sections/tileLibrary.ts`), not Supabase -- deliberate
  for now, see that file's own header comment.
- **`CorrectionEditor.tsx`** (`lib/sections/correctionGeometry.ts`) -- the
  Paper.js-based editor for manually fixing a trace.
- **`CubeHexBuilder.tsx`** -- assign one trace to each face of a cube or
  hexagonal prism (`FaceTilePicker.tsx`: a thumbnail per face, pick from the
  checked tiles or the whole bank -- the builder opens even with nothing
  checked), pick a seed and "seam fit tolerance", and generate a tile.
  Under the hood: `lib/sections/volumeField.ts` lofts the 2D traces into one
  continuous 3D scalar field (positive = lofted shape, negative = the rest);
  `lib/sections/cleanup.ts` post-processes that field (delete floating
  pieces, shave thin branches, fill sealed void pockets -- mirrors the
  engine's `min_foam`/`min_void`, anything touching a tile face is exempt)
  and can **swap** foam and void (`swapFoamVoid`, just a sign flip);
  `lib/sections/voxelize.ts` samples that field onto the same 40x40x40 grid
  Grasshopper tiles use; `lib/sections/mesh.ts` makes the meshes (see
  below) for the GLB; `lib/sections/faceData.ts` / `sectionsData.ts` build the
  Analysis-scoring-ready face/section data; `lib/sections/buildTile.ts`
  assembles all of it into a `ParsedTile`, identical in shape to one the
  Viewer tab would ingest from a real Grasshopper export (minus a few
  image-only fields that nothing in this app's scoring reads -- see that
  file's header comment for exactly which).

**Foam/void convention in the builder (owner's definition, 2026-10-02):**
foam = the lofted shape, flush to the 20 ft cube (or hex prism); void = the
whole cube/hex **minus** the foam, a closed solid with flat outer faces. This
is the *reverse* of a Grasshopper GLB (there the foam is the block and the
void is the carved space), so with both visible a builder tile's void hides
its foam -- the builder starts with the void hidden, and
`renderTileThumbnail` skips the void on builder tiles. `lib/sections/mesh.ts`
gets both meshes from ONE marching-cubes grid whose nodes straddle the tile
boundary, with every node outside the boundary set to the odd mirror
`-|f|` of its inside neighbour -- so the surface crosses zero exactly on the
boundary plane (watertight, planar faces; no mesh booleans). The lofted
field's tile span is nodes 2..n-3, and `voxelize.ts` remaps its sampling to
match (the original code was off by one node, a 2.4% squash). Builder GLBs
carry `userData.tileShape` ("cube" | "hex-prism") as a node extra.

**Floor plates** (`lib/sections/plates.ts`; pipeline is loft -> swap -> plates
-> cleanup, so a plate's foam/void side always means the FINAL foam/void and has
its own switch, independent of Swap). A plate is a slab (top surface at an
elevation, thickness below) times a plan footprint (full / inset / L / T / plus,
all signed distances in ft), unioned into the field with `max` (or cut out, on
the void side), scaled by the loft's own per-cell field slope so marching cubes
interpolates sensibly. A plate that reaches a wall runs one cell past it so the
slab meets the tile face exactly. Erosion: per column, the clear void run above
AND below the plate is measured on the pre-plate field; where both exceed a
threshold (set by "recede from surroundings") the plate recedes (soft edge);
plus an explicit staggered opening, value-noise holes, and "keep a vertical
connection" (guarantees one opening per plate, placed where the most void runs
through). Anything within 1.5 ft of a wall is never eroded. `suggestPlatesFromTraces`
reads the horizontal layers already in the wall traces. Min thickness 1 ft (the
grid is ~0.5 ft/cell). Settings live in `SavedCube.plates` and
`sectionRecipe.plates`; the same `PlateSettings` shape is meant to be what the
Grasshopper rework can emit.

**Saved objects:** every Generate in the builder auto-saves a `SavedCube`
(`lib/sections/savedCubes.ts`: recipe + the actual traces + cleanup + swap +
a thumbnail) into the project's `state.cubes` jsonb (see section 6), updated
as cleanup/swap/name change, deduped per recipe, deletable from the list. No
GLB is stored -- opening one re-lofts from the stored traces.

### Cross-cutting: saved UI state, presets, shared viewports (added 2026-10-02)
- **Round 2 polish (same day).** The Sections tab is now labelled **Builder**
  (the internal key is still `sections`, so saved state is unaffected).
  Viewport controls moved OUT of the canvas: `TilePane` has a header (number
  badge + tile picker) above and a strip of `PaneMenu` icon buttons below, each
  opening a base-ui popover for one setting (View, Display, Visibility+opacity,
  Clip, Rotate; Export is its own dialog). `PaneState` now carries `displayMode`,
  `visibility`, `colors`, `opacity`, `clip` per viewport (`normalizePane` fills
  older saves). `SyncAllMenu` copies chosen groups from one viewport to the rest;
  each popup also has "Apply to all viewports". `MetricsTable` is the multi-tile
  specs table. All native `<select>`s are `components/ui/select.tsx` (base-ui
  Select behind a `<select>`-shaped API: same `value`/`onChange(e.target.value)`/
  `<option>` children), and `app/globals.css` styles the generic controls (range,
  colour, checkbox, details, scrollbars).
- **Palette and top bar.** Black background, grayscale surfaces, and only three accents: magenta `#c43383`, orange `#db7228`, soft pink `#e8a6c8` (Tailwind `bg-pink` / `text-pink`, the "fine / lifts it" mark where other apps use green); errors are hot pink (`--destructive`); floor plates are peach `#f2b878`, branches orange. No blue, green or teal anywhere (the animated backdrop is only on the project-code screen). New viewports start in the board look (`defaultPane` in `components/shared/TilePane.tsx`: ghosted white foam, magenta void), and the Viewer's drawing export defaults to the black ground. `TileSwitcher` lives in the `Header` (top bar) on Viewer and Analysis so it stays on screen; it has filter chips (All / Gathering / Workspace / Lobby / Cube builder / Other, only for groups that have tiles; a tile's group is `sectionRecipe` -> builder, else `guessed.category`). `fitText` (`lib/boards/textFit.ts`) now also requires every wrapped line to fit the width, and the descriptor page uses one label size for all rows.
- **Collapsible sections.** Long side panels are made of `components/shared/Section.tsx`:
  chevron + title (optional `summary` shown while shut, optional `action` slot for a
  switch / Reset), body folds away. `variant="panel"` pads it directly inside a
  `GlowPanel`; `"inline"` is a hairline-separated group inside a longer panel;
  `bodyClassName` overrides the body spacing. Open/closed state lives in the project's
  `ui.workspace.sections` (`lib/workspaceUi.ts`: `WorkspaceUi`, `useSectionOpen(id,
  defaultOpen)`, `useSectionGroup(ids)` for Expand/Collapse all), so give every
  Section a unique `id` (`boards.*`, `builder.*`, `arrange.*`, `viewer.*`,
  `analysis.*`, `tileedit.*`, `export.*`). Anything holding a live ref that must exist
  while shut (the export dialog's first-frame preview canvas, the Boards animated-export
  panel that keeps an export running) is deliberately NOT a Section / stays mounted.
  When adding a long panel, use a Section rather than another always-open block.
- **Wide-screen layout rule.** Tabs with side panels (Viewer, Builder, Arrange,
  Boards) are height-bounded on `lg+` (`flex flex-col lg:h-full lg:min-h-0` root,
  columns `lg:overflow-y-auto`) so the viewport/board stays put and only the menus
  scroll. Analysis is the exception: it page-scrolls and its viewport(s) are
  `sticky`, so its root must NOT have `lg:h-full` (that bounds the sticky
  containing block and the viewport unpins after one screen).
- **Builder changes.** The loft seed and seam-fit tolerance are no longer
  user settings (fixed 1 / 50; saved pieces keep the values they were made
  with); "suggest plates from wall sections" was removed. Faces can be turned in
  quarter turns: `lib/sections/rotateTrace.ts` rotates the trace BEFORE it reaches
  `buildVolumeField` (SVG path rewrite; `volumeField.ts` untouched), the turns are
  saved as `SavedCube.rotations` / `sectionRecipe.rotations` (the stored traces are
  already turned). `lib/sections/autoFill.ts`: edges shared by faces are found from
  the face mapping inverted at depth 0 (`faceLinks`; 12 edges for a cube, 6
  side-to-side for a hex, none to top/bottom), each candidate (tile x 4 turns) is
  scored by solid/void agreement with already-placed neighbours minus a tile-reuse
  penalty, then picked by weighted random so every press is a new plausible set;
  locked faces (`BuilderUi.locks`) are kept.
- **WebGL context gotcha (was the "viewport crashed" bug).** Browsers cap live
  WebGL contexts; `renderer.dispose()` does not release one. Every headless
  `WebGLRenderer` must also call `forceContextLoss()` (`lib/renderTile.ts`,
  `lib/viewportCapture.ts`, `createBoardAnimation` do). The builder's saved-object
  thumbnail waits 1.8 s for edits to settle for the same reason.
- **Saved UI state.** `projects.state` is now `{ tiles, cubes, ui }`. `ui` is
  a bag of per-feature JSON blobs (keys: `workspace` (active tab), `boards`,
  `viewer`, `analysis`, `arrange`, `builder`, `criteria`, `presets`,
  `viewportExport`). Read/write with `useProjectUi(key, defaults)` in
  `lib/project-store.tsx` (`defaults` must be a stable module-level function;
  saved copies are filled in from it by `lib/mergeDefaults.ts`, so older
  projects open cleanly). `lib/useUiField.ts` turns one field of such an object
  into a `useState`-style pair (used by the cube builder and Arrange).
  `lib/persistence.ts` skips re-uploading a tile's GLB/voxels once uploaded in a
  session (`uploadedTiles`), so frequent settings autosaves are one small upsert.
- **Presets** (`lib/presets.ts`, `components/shared/PresetBar.tsx`): named,
  per-project snapshots of Boards settings, Viewer viewport layout, and Analysis
  compare layout.
- **Shared viewports.** `components/shared/TilePane.tsx` = `ThreeViewport` +
  a toolbar (tile picker, view, reset, auto-rotate + speed, Export);
  `ViewportTools.tsx` is the same without the tile/view parts, for Arrange and
  the builder. `ThreeViewport` takes `autoRotate`, a `handleRef` and a camera
  `link` (`lib/cameraLink.ts`: "match cameras" -- the pane being orbited, or the
  leader while auto-rotating, publishes its camera relative to its own model
  centre; the others copy it each frame). `CameraRig` frames the whole model for
  the pane's own aspect (narrow multi-viewer panes were cropping before).
- **Exports from any viewport.** `CaptureBridge` (inside a `<Canvas>`) exposes
  scene/camera/target/centre through a `handleRef`; `lib/viewportCapture.ts`
  re-renders that same scene with a second offscreen `WebGLRenderer` from a
  copy of the camera (the live canvas is never resized; `scene.environment` is
  nulled for the instant of each draw because it belongs to the live GL
  context). `ViewportExport.tsx` is the Export dialog (PNG or turntable, then
  that choice's settings). Turntables reuse the Boards encoders: the single
  viewport is wrapped as a `BoardAnimation` (`createViewportAnimation`), then
  `encodeGif` / `encodeMp4`. The turntable rotates the camera rig about the
  vertical (Y) axis through the model, from "Current camera" or a chosen axo
  corner. PNGs get a `pHYs` chunk when a DPI is set.
- **Sticky viewports.** Below `lg` the viewport column (or the board preview) is
  `max-lg:sticky max-lg:top-0` inside the tab's scroll container, with heights
  capped around 30-38vh; from `lg` up nothing changes.

### Analysis (`components/analysis/`, `lib/scoring/`) -- rebuilt against the matrix 2026-10
The authority is Assignment 1 Part 3's matrix, word for word (`lib/scoring/matrix.ts`); **`docs/ANALYSIS.md`** is the full description. In short: `matrixEval.ts` `evaluateTile` reads a tile or assembly against the twelve descriptors automatically and honestly (value with unit, a status of measured / inferred / proxy / assumed / not assessable, the method, what it cannot establish, a generated reading, evidence); `voxelFacts.ts` reads the container's cells (a shaped container's notch is air, never in a denominator) and finds floor-supported routes; `spatialDensity.ts` (the twelfth descriptor, Spatial density: the ratio of the narrowest to the widest passage width along a walkable route; the earlier cross-section-area formula is kept as a legacy measurement); `usable.ts` reachable against carved space (the one shared walking model, `lib/walking.ts`, the same as Arrange's); `profile.ts` + `lib/useEvaluation.ts` the shared evaluation profile (criteria suggested automatically with no minimum, adopted at once, a changed suggestion shown and adopted with one click, optional restorable overrides saved in the project row `evaluation`; the old `criteria` row is migrated, not converted); `compareSet.ts` variants of a typology and a pick only where the evidence supports one. Spatial density is no longer a descriptor (the twelfth is Compressed-then-released); it is a supplemental reading, and the app's older 0-100 index is a small labelled "presence index". The Analysis tab, the Boards descriptor page (`BoardConfig.descriptorText`), the **Analysis sheets** (`lib/boards/analysisSheets.ts`, 22 × 11 in landscape on black, Boards → Export), the results table / diagrams (`exportResults.ts`) and the arrangement report read the same results. `npm run check:analysis` is the test; `scripts/render-analysis.ts` draws the exports in node.

### Arrange (`components/arrange/`, `lib/arrange/`) -- rebuilt 2026-10-05
One connected, walkable building composed from the tiles, judged as
architecture, saved with the project and added back as a tile. The full
description, the rules, the keys, what was verified and what was not are in
**`docs/ARRANGE.md`**. In short: a piece is a tile + a position (multiples of
0.5 ft) + an orientation (mirror in X, quarter turns, optional scale); contacts
become joints with four scored parts (`lib/arrange/joints.ts`); `layout.ts` is
where the connected rule lives (biggest touching group = main set; islands;
walkable reachability from the entrance); `ops.ts` holds the edits and the
re-attach repair; `generate.ts` plans a shape (`patterns.ts`) and searches for tiles that meet the floor rules (`pairs.ts` remembers how tiles fit), `candidates.ts` powers
`suggest.ts`; `composite.ts` pastes the pieces into one voxel model that
`bundle.ts` reads (in a worker, `analysis.worker.ts`) and `smooth.ts` cleans;
`useArrange.tsx` is the controller every panel reads (document with undo, derived
layout / joints / warnings / whole, all actions, the shortcut list). The tab's
saved state is `ui.arrange` (`ArrangeUi`: current arrangement, saved list,
rules, priorities, site, smoothing). `npm run check:arrange` is its regression
check (no browser).
**Interlocking tiles (2026-10)**: a piece occupies cells, not its box: `occupancy.ts` (OUT / SOLID / VOID per cell from `mask.u8` and `void.u8`, openings on any container surface, each tile's own walkable floor zones), `collision.ts` (boxes may overlap where the cells fit; the policy is conservative), `geometry.ts` (contacts on any surface, several patches per pair), `joints.ts` (one joint per pair with patches and a contact / void / walkable breakdown), `walk.ts` (a route needs a floor, 2.5 ft clearance, 6.5 ft headroom and a step of no more than one riser: **a jump is never a route**; floors close but further apart than a step are "needs a connector", reported and never counted; shafts are views). `npm run check:interlock` is its test; see docs/ARRANGE.md and docs/RECIPE_WRITER.md (the brief for whoever writes tiles).
Exports live in one window (`ExportDialog.tsx`); the drone tour is `lib/arrange/drone.ts`. Project settings (every tab's remembered state) are saved in a small row `<code>~ui`, separate from the tiles (`lib/persistence.ts`), so an edit saves a few KB instead of every tile; the multi-block print export with labels sunk into the underside is `components/viewer/PrintBatchDialog.tsx` + `lib/exporters/printLabels.ts` (`docs/PLAN_PRINT_EXPORT.md`). Long jobs show `components/shared/LoadingCover.tsx` instead of a half-built result. **Mesh quality**: the engine meshes (cut from a 40-cell field) stay in the live viewports; pictures, films, turntables, board exports, OBJ and STL swap in smooth meshes rebuilt from the voxels (`lib/fineGeometry.ts` for scenes, `lib/exporters/printMesh.ts` for the mesher; cached, capped at 32 meshes; a quality choice in each export window). `components/shared/SizeFields.tsx` is the shared width / height control for exports. Text drawn on any canvas export goes through `lib/textBlock.ts` (fit, never squeeze); report / drawing board / drawing colours come from `lib/boardPalette.ts`.

### Boards (`components/boards/`, `lib/boards/`)
Composes a presentation-plate layout -- an adaptive grid of tile renders
(fixed axo/perspective snapshots, `lib/boards/renderTile.ts`) with an
exact PDF-traced module frame (`lib/boards/frameShape.ts`), auto-fit text
everywhere (`lib/boards/textFit.ts`), live preview and full-resolution PNG
export sharing one drawing function (`lib/boards/exportBoard.ts`) so they
can never drift apart. Per-tile line decorations live in `lib/renderTile.ts`
(shared with the popup editor): **foam outline** = the tile's outer cube /
hex edges (screen-space fat lines), **void outline** = a back-face hull
pushed along welded normals, **facet lines** = foam edges only. All three
have a weight in points (0.01-8, typeable), converted with `pxPerPt = dpi/72`.
Clicking a tile opens `TileViewEditor.tsx` (live R3F view, 8 locked axo
corners or free perspective, clipping, colour/opacity, the three line
settings; per-slot overrides shadow the board-wide masters). Exports two PNGs: the board itself, and a second
page listing each tile's scored descriptors (the carried criteria) with an
optional top-N highlight (`config.highlight`). The caption box is one per page (`config.textBox` = page 1, `config.textBox2` = page 2); one caption cell is held on both pages when either is on, so the tiles never move between them. `config.descriptorHeadlines` (default off) prints each descriptor's measured value under its bar.

**Name tag + labels.** The tag's width and height are fractions of the module
(`config.nameTag`; `TagGeometry` in `frameShape.ts`, `moduleOutline()`), the
text wraps to a line limit then shrinks (`fitText`), and what it says comes from
`lib/boards/tileLabel.ts` (parses `category_N_typology_Vk` from the tile name;
a per-slot `tag` / `labelOverride` beats the parse). **Catalogue layout**
(`config.catalogue`, `lib/boards/catalogue.ts`, `computeGeometry`): rows =
gathering / office / lobby, columns = typology 1-5; same-typology tiles stack
into extra rows, unparsed tiles get rows of their own; `PageGeometry` now has
`slotCellIndex` / `placeholders` / `labels` / `tag` (always map a slot to its
cell through `slotCellIndex`, never by array position). The board config, the
active page and the animation panel's open state are saved with the project.

**Animated export (looping GIF / MP4).** `AnimatedExportPanel.tsx` (settings
live in `BoardConfig.animation`, `lib/boards/types.ts`). One revolution is
rendered -- N = round(spin seconds x fps) frames at 360 * i / N degrees,
i = 0..N-1; frame N would equal frame 0, so the loop is seamless and the
GIF's NETSCAPE loop count is 0 (forever). The pieces:
- `lib/renderTile.ts`: `createTileRig(renderer, opts)` clones the scene and
  builds materials / clipping / line decorations ONCE; `rig.renderAt(deg)` only
  moves the camera. The camera, its look target, its up vector and the lights
  all turn rigidly about the vertical axis through the model's centre, so it
  works from any starting view (preset or the popup's free camera) and a
  top-down view just spins in place. `renderTileToDataUrl` is now a thin
  wrapper over the same rig (`orbitDeg` option, default 0), so stills and
  frames share one code path.
- `lib/boards/exportBoard.ts`: `createBoardAnimation` draws the static
  layers once (below the tile images: background/title/caption/footer; above
  them: frames, name tags, page-2 descriptor lists) and per frame composites
  them around every tile's render from ONE shared WebGL renderer (all cells are
  the same size). The tile option building, image painting and "chrome"
  drawing are shared with the PNG export (`tileRenderOptions`,
  `paintModuleImage`, `drawModuleChrome`). Output size is even-rounded
  (video codecs need it); `dpi = widthPx / widthIn` so pt line weights scale.
- `lib/boards/gifExport.ts` (gifenc, no worker -- it yields to the UI every
  frame): ONE global palette from 8 sample frames (not per-frame, which would
  shimmer), every frame mapped onto it with a 6-6-6-bit nearest cache (gifenc's
  own 5-6-5 lookup bands smooth shading), and only pixels that changed since
  the previous frame are written (the rest are a reserved transparent index,
  dispose = 1). "Auto" picks the smallest of 32/64/128/256 colours whose average
  error on non-flat pixels is under ~2, and turns on ordered dither only if
  even 256 is off by more than 2.5. Ordered dither is position-based so it
  doesn't fight the delta frames; error diffusion does shimmer. GIF delays are
  whole centiseconds, so the per-frame delay is the difference of rounded
  running times (30fps alternates 30/30/40ms and stays on speed). FPS options
  are 10 / 20 / 30; width goes up to 5000 px.
- `lib/boards/mp4Export.ts`: WebCodecs `VideoEncoder` (H.264) + `mp4-muxer`;
  the button is hidden when WebCodecs is missing. An MP4 has no loop flag.
- `types/gifenc.d.ts`: gifenc ships no typings.
The panel is a collapsible section in `BoardsTab.tsx` (closed by default); it stays
mounted when closed so a running export isn't lost, and the header shows
"running…". Gotchas: export runs on the main thread and wants the tab visible (background
tabs throttle timers); tile renders use the same shared-renderer limit as
everything else (the animation owns exactly one extra WebGL context).

State for all five tabs lives in `lib/project-store.tsx` (React context),
gated behind a "project code" (`components/shared/ProjectGate.tsx`) --
there's no real user auth; a project is just whatever's saved under that
code string.

## 5. First-time use (for a human opening the app, or an AI describing it)

1. Enter any project code on the gate screen -- a new code starts an empty
   project, an existing one loads everything saved under it.
2. Get at least one tile onto the bank, either:
   - **Viewer tab**: drop/upload a Grasshopper `_analysis` folder or `.zip`
     (header buttons work from any tab), or
   - **Sections tab**: pick six face photos from the bank (or upload new
     ones), assign them to a cube/hex's faces in Cube/Hex Builder, and
     "Save as tile".
3. **Analysis tab**: pick a tile, check the descriptors to score (6 minimum
   per the assignment, up to all 12), read the scores.
4. **Arrange tab**: build or generate one connected building from the tiles
   on the bank (rules, priorities, shapes), edit it freely, judge it, save it,
   add it back as a tile, export it (`docs/ARRANGE.md`).
5. **Boards tab**: pick tiles, lay out a presentation board, export the two
   PNGs.

Saving is automatic (debounced) once Supabase is configured (section 6); the
header shows a save-status indicator.

## 6. Backend: Supabase + Vercel

Provisioned 2026-09-30. Supabase project ref `rpzmpuyhudvdhxuehqit`.

- **Database**: one table, `projects` (`code text unique`, `state jsonb`) --
  see `supabase/setup.sql` for the schema and RLS policies. No real auth:
  RLS is intentionally wide open (anyone with the project code can
  read/write it), matching the "shared by code, not accounts" design.
- **Storage**: one bucket, `tile-assets` (private, RLS-gated the same way)
  -- holds each tile's `.glb` model and voxel `.u8` arrays, since those
  can't go in JSONB. Paths are `{projectCode}/{tileId}/model.glb` and
  `{projectCode}/{tileId}/voxels/{name}.bin`.
- **Client wiring**: `lib/supabase/client.ts` (browser, publishable key) and
  `lib/supabase/server.ts` (server-only, secret key -- **intentionally not
  used by anything yet**; all persistence currently happens client-side
  through RLS. Don't delete it as "unused" -- it's there for whenever a real
  API route needs privileged access).
- **Save/load**: `lib/persistence.ts` (`saveProject` / `loadProject`), wired
  into `lib/project-store.tsx` -- entering a project code loads it, editing
  the tile bank (or the Sections builder's saved cubes) auto-saves
  (debounced 1.2s). The row's `state` is `{ tiles, cubes }`; `cubes` is the
  Sections builder's `SavedCube[]` (inline jsonb, no storage objects).
- **UI state** (`state.ui`, see the cross-cutting section above): Boards
  config, Viewer/Analysis layouts, Arrange bank + settings, builder settings,
  criteria and presets now save with the project.
- **Arrangements save with the project**: the current one and every saved one
  (pieces, names, ratings, rules, priorities, site, smoothing, a small JPEG
  thumbnail) live in `ui.arrange`; an arrangement added as a tile is a normal
  tile (its GLBs and voxels go to Storage like any other).

**Env vars** (`.env.local`, gitignored -- this is a public repo, never
commit real values): see `.env.example` for the three key names. Get actual
values from the project owner, or from the Vercel project's Environment
Variables (already set there since deploy is working). Supabase URL is
`https://rpzmpuyhudvdhxuehqit.supabase.co`; the two keys should be asked
for, not guessed.

The secret key can't be used from a browser -- Supabase blocks it with a
401 if you try. It's only ever meant to be imported in `lib/supabase/
server.ts` or another server-only file.

**Deploy**: Vercel, connected to this GitHub repo, auto-deploys on push to
`master`.

## 7. Off-limits for now: the Sections lofting algorithm

**The project owner is working on the Sections lofting algorithm themselves,
with a higher-effort model, because the changes needed are architecturally
significant.** Don't attempt deep fixes to it unless they explicitly ask --
small, clearly-scoped asks (a UI tweak, a slider range, a display label) are
fine; it's the underlying algorithm that is off-limits by default. Arrange was
rebuilt on the owner's explicit go (2026-10-05, `docs/ARRANGE.md`); the old CSG
fuse (`lib/exporters/csgFuse.ts`) and `lib/sections/volumeField.ts` blend maths
were not edited and stay as they are (the CSG fuse survives as "Legacy smooth" in
the Arrange export panel).

### Sections tab's cube/hex lofting algorithm
`lib/sections/volumeField.ts` is a faithful, line-for-line port of
`Section-Field-main/lib/volume-study.ts` (confirmed during a comparison for
this handoff -- same math, same `fitTolerance`/`seed` parameters, same
signed-distance-field approach, only the trace/face types differ). Despite
that fidelity, **the project owner has found the geometry it produces
doesn't fill the void the way the original tool did** on real face-photo
combinations -- some cube/hex regions are left emptier than expected. This
was also independently observed earlier in this project's own history: the
algorithm's "looks fully filled" quality depends on having six genuinely
distinct, mutually compatible face traces; duplicated or incompatible faces
leave gaps. Since the port is already verified faithful to the original,
this isn't a porting bug to patch -- it's either an inherent limitation of
the blending approach that needs real redesign, or a difference in how the
*original* site's own inputs/corrections were prepared that this app hasn't
reproduced. Compare directly against
`Section-Field-main/components/volume-study.tsx` and the live site
(section 2) with the *same* face photos before changing anything here.

## 8. Standing workflow instructions from the project owner

- **Push straight to `master`.** The owner is the only one working on this
  repo right now and wants to see/test every change immediately -- no
  feature branches, no PRs, unless they say otherwise.
- Keep `npm run lint` and `npx tsc --noEmit` clean at all times, and `npm run check:parity` green when `lib/tiles/analyze.ts` or the engine's analysis changes.
- Tile processing lives in `lib/tiles` only (see "The shared tile pipeline" above); never give the builder, the exporters or the Analysis a private copy of a measurement.
- A two-step scaffold sometimes shows up and gets deleted repeatedly during
  Viewer-tab development: a `__devIngestFromPublic()` function in
  `lib/ingest.ts` and a matching "dev: ..." button in `UploadZone.tsx`, used
  to load a tile from `public/` without the browser's real file picker
  (which automation tools can't drive). If you add these back for testing,
  **remove them again before committing** -- temp test data got committed
  once before and had to be cleaned up.

## 9. Running it

```bash
git clone https://github.com/D7-Ryan-Dillon/D7-Program.git
cd D7-Program
npm install
cp .env.example .env.local   # then fill in real values -- ask the owner
npm run dev
```

Open http://localhost:3000 (or whatever port it picks). Without a real
`.env.local` the app still runs, it just can't save/load by project code.

`npm run lint` and `npx tsc --noEmit` should both be clean. `npm run build`
should succeed.

To get real tile data to test the Viewer tab with: the project owner has
real exports at `3d Exports/` next to this project folder (not in git) --
ask them to drag-and-drop a `<name>_analysis` folder onto the Viewer tab's
drop zone, or to share a zip of one if you're in a cloud session with no
access to their filesystem. The Sections tab needs no external data at all
-- its 48 starter photos are baked into the repo.

### Gotchas worth knowing (hit while building the above)
- **Stencil buffer:** `<Canvas>` needs `gl={{ stencil: true }}` for the
  clipping cut-face caps (`lib/clipping.ts`); without it they fill the whole
  plane. Every cap pass is also `transparent: true` so foam/void caps stay
  in one draw list in renderOrder (translucent caps used to merge).
- **Coincident surfaces:** foam and void share their interface, so materials
  use `polygonOffset` (void behind foam, both behind lines) to avoid z-fights.
- **The Sections lofting math (`volumeField.ts`) is untouched**; only its
  consumers (mesh, voxelizer, cleanup) changed.
- Corrections and newly uploaded face photos are still `localStorage`-only;
  saved cubes carry their traces so they reopen anywhere, but a cube whose
  source photo was only uploaded on another device shows no thumbnail tile
  for that face in the picker.

## 10. Suggested next steps (outside the off-limits areas in section 7)

**Where the project stands (2026-10-07).** The app is feature-complete for Assignment 2 and the tiles are final unless the owner asks for more:

- **The tile set** (`engine/tiles/v7`, `lib/tiles/fixtures`, `docs/TILE_SET_V7.md`): fifteen smooth carved 20 ft cubes, each written as a recipe (`defs7.py`), every one a single printable piece (piers and spines carry roofs, ramps and stairs), 198 of 225 ordered pairs and 117 of 120 unordered pairs join on foot. **`docs/RECIPE_WRITER.md` is the explanation of the AI recipe writer** (pipeline, helpers, rules, checks): read it before changing a tile. The engine script is frozen: tiles change by recipe only. Loop: `python engine/tiles/v7/build.py G5`, `python engine/tiles/make_fixtures.py C:/tmp/tiles7 lib/tiles/fixtures`, `npm run check:parity`, `npm run check:tiles`, `npm run tiles:table`.
- **The generator** (`lib/arrange/generate.ts`, `patterns.ts`, `pairs.ts`; `docs/ARRANGE.md`): eight shape plans on a 20 ft by 10 ft lattice (the tall ones are spiral climbs: Tower, Compact, Village, Bridge), a look-ahead over the whole plan (`planReach`) and a search that keeps floors meeting floors, no dead-end stair and no stranded floor plate, four sliders that move the plan (Tall, Compact, Varied, Program fit), a branching switch, no time limit (progress and Stop), a report of what was asked and what came out. `npm run check:generate` is its test. The one-piece helpers (suggest, fill the gap, auto replace) are `candidates.ts`.
- **Print labels**: the Viewer's 3D print window sinks a label (and an optional smaller second line) into each block's underside (`lib/exporters/printLabels.ts`, `docs/PLAN_PRINT_EXPORT.md`).
- **Boards**: Assignment 2 sheets (`lib/boards/assignmentSheets.ts`, `docs/ASSIGNMENT2.md`), the descriptor page with the matrix bars, 15 tiles per page, animated export.
0. Arrange follow-ups (see the end of `docs/ARRANGE.md`): a mesh cap on level cuts, a gallery that ranks several arrangements, browser tests of the GIF export and the Boards round trip, the engine's plate objects in the mass sent back to Rhino, per-tab shortcut sets beyond the first lists.
1. Non-cubic tile sets: the current set is fifteen 20 ft cubes; recipes with `container` boxes of 20 x 40 x 20, L plans or stepped tops are possible (the kit takes any size and Arrange places any box of whole cells) but are not made. The one-piece helpers handle them; the whole-building generator builds on the lattice of the most common cube size and leaves other sizes out.
2. Persist Sections-tab corrections (currently `localStorage`-only) to
   Supabase if cross-device correction editing turns out to matter.
3. (done) Arrange now has level cuts and a saved-arrangements list.
4. Animated export ideas not built: a live in-app turntable preview, a worker
   for the GIF encode, per-tile spin offsets or counter-rotation, and
   transparent-background GIFs.
5. Ask the project owner what's still open before assuming the above is the
   full list -- priorities shift session to session.
