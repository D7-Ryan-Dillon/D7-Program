# Plan: engine 7 (floor plates, rooms, the typology tiles) fully into the web app

Status: BUILT 2026-10-03 (steps A to J). This file is the plan as approved; where the build differs, it is listed here and the docs describe what exists:
- Plates and branches are a second GLB (`<name>_parts.glb`), not nodes of the main GLB: Arrange, Boards and the OBJ exports render every node of the main file, and Arrange could not be touched.
- Rooms use a marker watershed with a 2 ft prominence (`ROOM_H_FT`), not a 3 ft neck threshold; light is "within 6 ft of open sky or an open side face"; the engine's `levels` live in `spaces.json` (a summary in `tile.json`).
- The old Carved calibration and the "what changed" note were dropped at the owner's word (new projects only).
- Boards: a tile can show a plan or section (board-wide default, per-tile override in the tile list); the descriptor page shows each headline quantity. The separate annotated-diagram and results-table board pages were not built: the Analysis tab's Results panel exports the table (CSV / image) and the diagrams as images to place on a board.
- The 15 tiles were remade afterwards (see `engine/tiles/README.md`): no V3 label, eroded rather than literal forms, a shared standard port so they still interlock.
- Arrange untouched; `lib/tiles/facts.ts` is the groundwork. Not verified by me: anything that only runs inside Rhino (reading curves and geometry, `.3dm`), and the app was exercised in the browser pane, not on Vercel.

**Scope of this round:** everything in the app that already works (Viewer, Builder, Analysis, Boards, persistence) learns the new data. **Arrange is not touched** (the owner is overhauling it next); it only gets groundwork (section 7) and a parking lot of ideas (section 8). The tiles are proto-geometries: no doors, stairs, ports or other literal-building features are modelled; the app reads **spaces, voids, levels, structure and printability**.

**Standing rule to add to README / HANDOFF:** how a tile is processed lives in ONE shared module. The engine export, the Builder's "Add tile" and the Builder's "Export _analysis" must all go through it, so they can never drift apart.

## 1. What the code review found

| Finding | Where | Consequence |
|---|---|---|
| Scoring assumes a **carved solid cube**: "Carved" peaks at 27% void and is zero above 55%. The first tile set was 55 to 75% void. | `lib/scoring/descriptors.ts` | The 12 descriptors need recalibrating and better measurement. |
| Floors are guessed from voxels. Stepped, Light-filled, Monumental, Threaded, Non-hierarchical are bounding-box or opening-count proxies (two are flagged `approximate`). | `lib/scoring/primitives.ts` | Plates, rooms and a void connectivity graph make these measurable. |
| The engine's GLB has only `foam` and `void`. Plates, branches and the container exist as voxel arrays and `plates.json` only. | engine `export_bundle`, `ThreeViewport.tsx` | The viewer cannot show or toggle plates. |
| `ingest.ts` ignores everything new in schema 4 (`plates.json`, `plates.u8`, `struts.u8`, `mask.u8`, `origin_ft`, `container`); category and typology are guessed from the file name. | `lib/ingest.ts`, `lib/types.ts` | Needs a tolerant schema-4 reader and a real `meta` block. |
| Persistence uploads four voxel arrays by a fixed key list. | `lib/persistence.ts` (`VOXEL_KEYS`) | Plates and branches would be lost on reload. |
| **The Builder builds its tile in memory with its own metrics** (`lib/sections/metrics.ts`, `faceData.ts`, `sectionsData.ts`) and **writes a 5f-style zip** (`lib/sections/exportAnalysis.ts`) with no schema-4 plate data. Its plates (`lib/sections/plates.ts`) are a separate system. | `lib/sections/*`, `CubeHexBuilder.tsx` | This is the drift the owner wants to prevent: one shared pipeline (section 3). |
| The tiles are 20 ft cubes with the usual `void.u8` (plates count as foam there), so they already load and run in Arrange as ordinary tiles. | `lib/arrange/*` | Nothing in Arrange has to change for them to work. |

## 2. Engine export: make the Grasshopper export carry everything the app needs

Added to `export_bundle` (all additive, schema 4 stays valid, old readers ignore them):
1. **GLB nodes** `plates` and `struts` next to `foam` and `void` (foam stays the whole solid; the two are coloured subsets).
2. **`data/spaces.json`**: the void split into **rooms** (watershed on the distance transform; a neck narrower than 3 ft separates rooms). Per room: volume, floor area, clear height (min / mean / max), level, footprint, bounding box, sky exposure, which faces it opens onto, a **kind** from its proportions (shaft, hall, gallery, low room, cave, terrace) and a readable **name** ("upper hall, 8 ft clear, 20 by 20 ft"); plus the main **route** through the rooms (length, bends, rooms passed) and the **cross-section profile along it**. Plus **connections** between rooms (neck width and height) and graph metrics (components, longest route, loops, dead ends). No doors or stairs are modelled; a connection is just an opening between two voids.
3. **`data/levels`** (in `tile.json`): the floor levels from plate tops and from flat void floors (replaces the voxel guess), with area per level.
4. **`data/structure.json`**: per plate span, thickness over span, support; foam load path to the ground slab / faces; **printability**: thinnest wall (EDT) and thin-foam share, foam pieces, mass, downward-facing overhang area, unsupported islands.
5. **`tile.json` `meta`**: `category`, `typology`, `variant` (from the recipe, so the app no longer guesses from the name); recipes get a `meta` block (recipes updated).
6. **`faces.json`**: add `foam_mask_rows` and `plate_mask_rows` beside the void mask, and the envelope `mask` for non-cube tiles (groundwork for Arrange).
7. **Drawings in the export**: plan SVGs per level and section SVGs (poché: foam solid, plates solid, void white) in `vector/`, so the Grasshopper export alone gives the drawings, and the app can show the same.
8. **Print files**: optional input `print_scale` (default 1/120, that is 1 in = 10 ft): writes `print/<name>_foam.stl` and `print/<name>_void.stl` (binary, millimetres, Z up).
Docs: `engine/ENGINE_7_GUIDE.md`, `docs/DATA_FORMAT.md` (section 13), `engine/tiles/README.md`. The paste-kit artifact is republished with the changed engine.

## 3. The shared tile pipeline (the Builder stays in step)

New module `lib/tiles/` (TypeScript), the single place that turns **voxel arrays + cell size** (`void`, optional `plates`, `struts`, `mask`) into everything the app reads:
`analyze()` returns `metrics`, `faces` (void, foam, plate layers), `sections`, `levels`, `plates.json`-shaped data (derived from the plate cells: id, area, top z, slope by plane fit, thickness, clear above and below, openings), `spaces`, `structure` (printability and support), and the drawing data.
- **Engine tiles:** the app reads the engine's own JSON when present (exact: the engine knows the plates analytically) and falls back to `analyze()` only for what is missing.
- **Builder:** `buildTile.ts` calls `analyze()` instead of its own metrics; `applyPlates` also returns the **plate cell mask** so Builder tiles have real `plates.u8` and `plates.json`; its **Add tile** and **Export _analysis** both go through `analyze()` and write the same schema-4 folder the engine writes (including `meta`, `recipe.json`, plates, spaces, structure, drawings, STL). The Builder's lofting math (`volumeField.ts`) is not touched.
- **Parity test:** a script runs `analyze()` on the 15 tile voxel exports (kept as small fixtures: JSON plus voxel arrays) and compares with the engine's numbers within tolerance, so any later change that makes the two disagree is caught. Run with `npm run check:parity`.
- **Re-measure:** a "Re-analyse tiles" action in the project recomputes derived data for every tile already in the bank (old exports, Builder tiles) with the current pipeline.
Also: `lib/tiles/facts.ts` (section 7).

## 4. Viewer

- **Layers**: Foam, Plates, Branches, Void, Rooms (void tinted per room or per level) with visibility, colour, opacity each (`MeshVisibility` / `PaneState` extended, old saves normalised). Preset "Architecture".
- **Automatic plan and section drawings** (new Viewer view next to 3D): no setup, drawn as soon as a tile loads.
  - **Plan** per level (level buttons from the tile's levels, or any height): foam and plates as poché, void white, a clear-height tint, room labels with area and clear height, 10 ft grid, scale bar, north arrow.
  - **Section** along X or Y at any position: poché, plates marked, level lines with heights, dimension ticks.
  - Export PNG and SVG at a chosen scale (default 1 in = 10 ft); same drawing code feeds the Boards.
- **Plate inspector**: list from `plates.json` (area, slope, top z, thickness, clear above and below, openings, held up); click highlights it in 3D.
- **Metrics panel** new groups: Spaces (levels, rooms, largest room, clear heights), Structure (plates, spans, load path), Print (mass, thinnest wall, pieces, overhang).
- **Checks** (traffic lights, click to locate): printable as one piece, thinnest wall against the 0.4 mm nozzle at the chosen scale, floating parts, unsupported plate spans, thin-foam share.
- **Print-ready STL** (Export dialog, also in the Builder): choose **parts** (Foam, Void, Plates, Branches, any combination, one file each or merged), choose **scale** (default 1 in = 10 ft, custom ratio or a target size in mm), see the printed size, volume, estimated filament, triangle count and warnings (open edges, minimum feature smaller than 2 nozzle widths). Binary STL, millimetres, Z up, watertight meshes (the engine meshes are capped flat on the faces). Foam is the default; Void gives the negative for casting or study models.

## 5. Analysis: the 12 descriptors from Assignment 1, measured on the real thing and explained as spaces

The 12 descriptors stay exactly as they are (the assignment forbids a new list). What changes is that **every descriptor, for every tile, shows four things**, and the explanation is written about the tile as a set of spaces.

### 5.1 What each descriptor card shows
1. **Score** (0 to 100, bar), as now.
2. **Quantitative**: one headline value with units, then 2 to 4 supporting values, each with the way it was measured (for example "tallest room 17 ft, 14 ft across, 3,300 ft3"). Numbers only, exportable.
3. **Qualitative**: a reading on a named scale, in experiential words, plus the scale's neighbours so you can see where it sits (for example "Hall-like, between *room* and *shaft*").
4. **In this tile** (the sentence): one or two sentences that explain *this* score from *this* tile's spaces: what raised it, what held it back, in words an architect would use (rooms, levels, floors, ceilings, halls, shafts, galleries, openings, clear heights). Generated from the measured data, never canned text.
Plus an **Evidence** button: highlights what the sentence talks about (the rooms, the levels, the route, the openings) in the 3D view and on the plan or section, and feeds the annotated diagram page.
In **Compare** view each descriptor adds a sentence about the difference ("T2 is stepped across three floors, T1 stays on one level").

### 5.2 How the sentence is made (so it is smart, and honest)
- Every descriptor returns **drivers**: its components with value, weight and direction (for example light-filled: sky openings, side openings, floor area lit, depth of the darkest floor). The sentence names the **top driver that raised the score** and the **top driver that held it back**, with their numbers.
- Wording comes from **space vocabulary derived from the data**: every room gets a `kind` from its proportions (shaft: much taller than wide; hall: wide with 14 ft or more clear; gallery: long and narrow; low room: under 9 ft clear; cave: no sky and open below; terrace: floor with open sky above) and a name such as "upper hall, 8 ft clear, 20 by 20 ft". Levels are named by height ("the 12 ft floor").
- **Phrasing varies with the situation** (a few templates per descriptor, chosen by which driver dominates), never invents a fact, always carries at least two numbers from the tile, and degrades gracefully: if a tile lacks room data (an old export) it says "estimated from the voxels" and uses what it has.
- Deterministic (the same tile always gives the same sentence), plain language, no jargon from the code.
- The carry-forward reason text on the criteria panel reuses the same facts across the project ("separates the tiles: from 20 on the single-floor hall to 80 on the three-terrace tile"); hand-edited reasons still win.
Example wording (illustrative, the real numbers come from each tile):
- *Stepped, 72:* "Three floors at 2, 7 and 12 ft, joined by two 5 ft rises; the largest floor is 140 ft2, so the tile reads as a cascade of platforms rather than one level."
- *Monumental, 81:* "The tallest room is a shaft 17 ft high and 14 ft across (height to width 1.2); it holds 41% of the tile's volume, so it reads as one vertical hall."
- *Light-filled, 38:* "46% of the floor has open sky within 10 ft, but the lower hall is lit only from its two side faces, so its middle stays dim."
- *Threaded, 55:* "The void is one route of 3 rooms, 52 ft long with 2 bends; walking from one open face to the opposite takes 1.6 times the straight distance."
- *Spatial density, 66:* "Along its main route the cross-section narrows from 310 ft2 to 90 ft2 and then releases: a 3.4 to 1 squeeze at the midpoint."
- *Carved, 44:* "74% of the block is removed as one connected volume, leaving slabs and columns; against this project's range of 55 to 80% it reads as a frame rather than a carved mass."

### 5.3 The 12, with what is measured and how it is read
| Descriptor | Quantitative (headline, then supporting) | Qualitative scale | Drivers the sentence draws on |
|---|---|---|---|
| Carved | % of block removed; void pieces; largest void ft3; foam pieces; project target range | lightly cut, carved, frame-like, skeletal | void share against the project range, one-piece continuity, surface smoothness, seams from layers or webs |
| Stepped | number of levels and their heights; area per level; total rise; tallest single step | single level, split level, stepped, cascade | level count, spread of areas, rise per step |
| Porous | % of the void's skin that is open; openings per face and per level; faces reached | sealed, perforated, porous, open frame | open area share, opening count, distribution over faces and levels |
| Continuous | % of void in the largest connected piece; rooms; connections | fragmented, linked, continuous, one space | piece split, connectedness of the room graph, narrowest neck |
| Resistant | % of foam that is protected (plates, walls, columns); plate thickness and resistance; thin-foam share | soft, layered, braced, rigid frame | protected share, plate resistance, load path to the ground |
| Threaded | longest route (ft); rooms on it; bends; route length over straight distance | compact, linear, threaded, labyrinthine | route length, sinuosity, rooms passed |
| Graduated | change of clear height and of cross-section along the route; height range per level | abrupt, stepwise, graded, smoothly graded | smoothness of the profile, gradient of levels and heights |
| Non-hierarchical circulation | access points; route alternatives; loops; evenness of connection sizes | single spine, branched, networked, fully non-hierarchical | degree spread of the room graph, loops, size evenness |
| Force-driven | gravity and drain; dose in the dominant source; plate modes and cut used | undirected, directed, strongly driven | gravity, dose concentration, plate behaviour |
| Light-filled | % of floor area with open sky within 10 ft; top open area; side open area per level; darkest floor | enclosed, side-lit, top-lit, flooded with light | sky exposure, side openings, depth from nearest opening |
| Monumental | tallest room (ft) and its width; largest room ft3 and its share of the tile; height to width | intimate, generous, grand, monumental | clear height, proportion, volume |
| Spatial density | cross-section area along the main route (narrowest, widest, ratio); count of squeeze and release moments | uniform, gently varied, rhythmic, sharply compressed | compression ratio, how long the tight and open moments last |

Both the quantitative block and the qualitative scale are exported with the **results table** (all tiles by the carried criteria, CSV and image) and the **annotated diagram per descriptor** (the plan or section with the measure drawn on it), which the Boards can print. `selection.ts` (carry-forward) is unchanged; it reads whatever `scoreTile` returns. A short "what changed" note shows old and new scores side by side for one release.

## 6. Boards

- **Drawing views**: a tile slot can show **Axo / Perspective (as now), Plan, or Section** (board-wide default plus per-slot override, in the existing per-slot editor); the drawing code is the Viewer's, rendered to the print canvas at board DPI, vector-crisp, with optional level and area labels.
- Plates coloured in the 3D renders (layer toggles in the tile view editor).
- Descriptor page (page 2) lists the new quantitative values; an optional **annotated diagram page** and the **results table** page.
- Catalogue 3 x 5 layout already parses the names (`category_N_typology`, with an optional `_Vk`); with `meta` it no longer depends on the name.

## 7. Arrange: groundwork only (no change to Arrange)

- Ingest keeps `voxels.void` exactly as is, so every current Arrange behaviour with these tiles is unchanged.
- `lib/tiles/facts.ts`: for any tile and any transform, the per-face **void, foam and plate layers**, the envelope mask and the levels, ready for whatever the overhaul decides. Not imported by Arrange yet.
- `ParsedTile` carries `plates`, `spaces`, `structure`, `levels`, `meta`, plus the new voxel arrays, persisted with the project, so Arrange can use them tomorrow without another data change.
- The **interlock proof renders** (2, 4, 8 copies by repeat, mirror, shift, rotate; the PDF's section 6.1) reuse the drawing and 3D code; the data is ready, the feature itself waits for the Arrange discussion.

## 8. Parked (not in this round)

**Arrange ideas for the conversation tomorrow** (nothing here is planned):
- Joint score that also checks floor continuity (plate edges meeting at the same height) and foam-on-foam contact, not only void on void.
- Move rules for architectural tiles: tilt and Z-mirror turn floors into walls, scale breaks the 8 ft storeys; half-lattice (10 ft) horizontal shifts for the PDF's "shift" test.
- Whole-assembly analysis: the same rooms, levels, routes and descriptors computed on the union of the placed tiles; floating-foam check across tiles.
- A variations gallery: generate many assemblies, score them (circulation continuity, level continuity, category mix), keep the best as saved variants.
- The assembly looped back into the engine (as a `mass` or `geo`) so Rhino can add passages where joints dead-end, then back into the app.
- Non-cubic tiles (L, T, plus) through the mask; taller lobby tiles (2 to 3 increments) stacking.
- Smooth and seal (`csgFuse.ts`) keeping plate tops flat; saving the assembly to Supabase.

**Engine ideas**: a *room* source (wire any closed Brep and the engine clears exactly that volume), a stair and ramp component, plates counted as support for each other, taller tiles and non-cube envelopes.

**Tile families**: see the owner's question. A family is one typology written as a function with a few dials (for example the amphitheater with 6 to 10 tiers and a wider or narrower stage), so V1, V2, V3 variants of the same typology are produced by changing the dials instead of redrawing. Useful once Arrange wants many variants; not needed for the 15.

**Recipe Lab**: running the engine in the browser (Pyodide) so recipes appear in the app without Rhino; needs a short feasibility spike first.

## 9. Order and size

| Step | Size | Depends on |
|---|---|---|
| A. Engine export additions (section 2) + republish paste kit | M | none |
| B. Types, ingest, persistence, `lib/tiles` pipeline, parity fixtures and test | M-L | A |
| C. Builder through the shared pipeline (Add tile, Export _analysis, plates mask) | M | B |
| D. Viewer: layers, plate inspector, metrics, checks | M | B |
| E. Drawings (Viewer plan and section, SVG / PNG) | M | B |
| F. STL export with parts and scale (Viewer + Builder) | S-M | A, B |
| G. Analysis: new measurements, calibration, results table, annotated diagrams | M | B, E |
| H. Boards: drawing views, plates in renders, extra pages | M | E, G |
| I. Groundwork for Arrange (`facts.ts`, persisted fields) | S | B |
| J. Docs: README, HANDOFF (standing rule), DATA_FORMAT 13, engine guide | S | all |

## 10. Defaults I will use unless you say otherwise
- Print scale 1 in = 10 ft; STL parts default Foam, with Void, Plates, Branches selectable.
- Drawing scale default 1 in = 10 ft for exports, labels on.
- "Carved" calibrated to a project target range (default for mostly-eroded tiles), old calibration selectable.
- Room separation neck threshold 3 ft; a connection is any neck of at least 2 ft by 4 ft.
- Plate and parity fixtures: 15 tiles, voxel arrays and JSON only (small).

## 11. Risks
- Descriptor scores change meaning: the "what changed" note and selectable calibration cover it.
- TypeScript and Python must agree: the parity test is the guard.
- Old projects: every new field optional; `mergeDefaults` fills UI state; persistence keeps old keys.
- Rhino-only paths (curve reading, `.3dm`) are still unverified by me; the app side is tested on headless exports of the 15 tiles (same engine code).
- No debug scaffolds; `npm run lint` and `npx tsc --noEmit` clean at each step; README / HANDOFF / DATA_FORMAT updated before any push; push only when asked.
