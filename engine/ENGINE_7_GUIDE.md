# Engine 7: what you can control, and how to wire it

Engine 7 is engine 5f plus **floor plates**, **any geometry as the foam**, and a **bake-and-feed-back loop**. In a plain cube with no plates it gives exactly the same tile as 5f (checked voxel for voxel, same tile id), so every old recipe still works.

All scripts are Rhino 8 Python 3 script components. Units are feet, in Rhino world coordinates, Z up.

## The four scripts

| File | Component | One per |
|---|---|---|
| `erosion_source.py` | Erosion Source (updated: `plate_mode`, `cut`) | acetone application |
| `erosion_foam.py` | Foam Source (unchanged) | model |
| `erosion_plates.py` | **Floor Plates** (new) | group of plates sharing settings |
| `erosion_engine_7.py` | Erosion Engine (replaces 5f) | pass |

To update a component in your definition: double-click it, select all in the editor, paste the new script, click OK. Then add the new inputs/outputs listed below (zoom in on the component, click the `+` on its edge, rename the new parameter exactly as written; a misspelt name is silently ignored).

## How the pieces fit together (your current canvas, plus the new parts)

```
Erosion Source x N --(src, Merge)--------------------------> Engine  sources   (List Access)
Foam Source ----------------------(foam)-------------------> Engine  foam
Floor Plates x M --(plates, Merge)-------------------------> Engine  plates    (List Access)
(optional) a closed Brep/mesh/box ---------------------------> Engine  geo       (instead of tile_w/tile_h)
(optional) another engine's  mass --------------------------> Engine  mass_in   (carry on from that pass)
Button -> export, Panel -> tile_name / export_dir / recipe -> Engine (as before)
```

Engine outputs you already use: `log`, `section`, `outline`, `src_pt_out`, `void_mesh`, `foam_mesh`, `export_log`, `export_path`.
New outputs to add: `mass`, `plates_mesh`, `structure_mesh`, `new_void_mesh`, and (if you do not have it) `recipe_text`.

## Erosion Source (new settings)

New inputs, added next to the ones you have:

| Input | Type | Default | What it does |
|---|---|---|---|
| `plate_mode` | int 0-3 or text | `pool` (0) | What THIS acetone does when it meets a floor plate. **0 pool**: the plate blocks it; it gathers and spreads on top (wide flat cut; best with gravity above 0). **1 stop**: the plate blocks it and soaks it up, so erosion ends there. **2 around**: the plate blocks it; it slides off toward the plate edge (downhill on a sloped plate) and carries on past it. **3 through**: the plate is invisible to it; it flows straight through. |
| `cut` | bool | False | **True** = this acetone also dissolves floor plates (eats them like foam, scaled by each plate's own `resistance`). **False** = it can never erode a plate, whatever the mode. `cut` and `plate_mode` combine freely: pool+cut pools on a plate and eventually eats through it; through+cut flows through and eats; through without cut is a pure ghost. |

Wire a slider (0-3, whole numbers) or a Panel to `plate_mode`, a Boolean Toggle to `cut`. Everything else on the source is unchanged. Sources with different (mode, cut) combinations run as separate solvents (up to 8 combinations); the log lists them.

## Floor Plates (new component, one per group)

A group is every plate that should share the same settings. Make a second component for plates that need different settings (a stiff main floor and a soft mezzanine, say).

**`shapes`** (List Access, no type hint): reference or wire in any mix of
- **closed flat curves**: the curve is the **top surface** of the slab, extruded **down** by `thickness` (negative thickness extrudes up). A curve in a tilted plane makes a **sloped slab** whose top is exactly that plane (up to 60 degrees; steeper gives a warning, vertical is refused). A curve lying inside a bigger curve in the same plane is an **opening** in it.
- **closed geometry** (Brep, box, extrusion, closed mesh): used **exactly as modelled**; `thickness` is ignored for it.
- an open single flat surface is treated like its outline curve.

Nothing is moved: plates stay exactly where you drew or modelled them. There is no height input.

| Input | Default | Range | What it does |
|---|---|---|---|
| `thickness` | 1.0 | 0.5 - 6 ft | Slab thickness for curves (measured square to the plate, so a ramp keeps it). Use at least one cell (0.5 ft); thinner is raised to one cell. |
| `resistance` | 1.0 | 0.25 - 5 | How hard the plate is to dissolve compared with the foam around it. 1 = same as foam, 3 = three times harder, 0.5 = softer. The foam's noise, lobes and webs still apply to plates, so organic foam gives organic plate erosion and even foam gives regular erosion. Only matters for sources with `cut` on. |
| `anchor_ft` | 1.5 | 0 - 6 ft | Foam within this distance of the plate is made denser so the connection around the plate survives erosion instead of becoming a knife edge. 0 = off. |
| `anchor_strength` | 3.0 | 1 - 8 | How much denser that foam is right at the plate (fades to normal at `anchor_ft`). |
| `auto_support` | True | on/off | After erosion, any plate that is not held up well enough gets branches grown to the rest of the foam (below). Off = report only. |
| `min_support` | 6.0 | 0 - 60 ft2 | How much contact area a plate must share with the main foam body. Existing foam touching the plate anywhere (sides, underside, top) counts. |
| `max_span` | 12.0 | 3 - 30 ft | The longest stretch of plate allowed without support. Smaller = more branches. |
| `strut_size` | 1.5 | 0.5 - 5 ft | Diameter of the branches. |
| `verticality` | 0.3 | 0 - 1 | 0: a branch goes to the nearest foam at any angle. 1: branches prefer straight columns. |
| `branch_from_top` | False | on/off | Allow branches to grow from the plate's **top face** (up and out to foam above, leaving existing foam above in place). Off: branches leave from the underside and sides only. The top face stays flat either way. |
| `support_pts` | none | points | Optional. Each point forces a branch to leave the plate at the nearest spot, before the automatic ones. |
| `name` | auto | text | Label used in the log and plates.json. |

Outputs: `plates` (text, wire into the engine's `plates` list) and `marker` (preview: slabs for curves, your geometry, support points).

**How plates behave in the run.**
- A plate is a real, flat slab: its top and bottom are exact planes or slopes in the final mesh, never stair-stepped, never rounded by smoothing. Everything else is smoothed as before.
- Plates erode **like foam** (same noise fields) times their `resistance`, but only by sources with `cut` on. A plate column is then kept whole (full thickness, flat) or removed whole, so holes have organic outlines while floors stay flat.
- Existing foam above a plate stays unless it is eroded away; the engine never removes it to expose a plate.
- **Support branches** (after erosion, on the frame you are viewing): the main foam body = the largest foam piece plus anything touching the outer skin. For each plate the engine measures contact area and the longest unsupported span. While contact is under `min_support` or the span is over `max_span`, it grows a branch of `strut_size` from the worst spot to the nearest foam (or an earlier branch), so they form trees. Works wherever you put a plate: on a wall it needs nothing, floating in a void it gets branches. This is a plausibility check, not an engineering calculation. The log and `plates.json` report each plate's contact, span, branches and whether it is "HELD UP".

## Engine (new inputs and outputs)

New inputs: `plates` (List Access), `geo`, `mass_in`. Everything else keeps its 5f meaning.

| Input | What it does |
|---|---|
| `plates` | The Floor Plates outputs (merge several into one list). |
| `geo` | The foam to erode instead of a cube: any closed Brep / box / extrusion / closed mesh, or a list (united). The grid is the geometry's bounding box and cells outside the geometry hold nothing. `tile_w`, `tile_h` are ignored; `cell` still sets the cell size. Sources, plates, `slice_pos` are all in world coordinates, so you draw on the model and nothing needs converting. Open meshes give a warning. |
| `mass_in` | The `mass` output of another engine: starts this run from that pass's finished result (its foam, voids, plates, branches). Wins over `geo` and the cube settings. `foam` blank = keep the earlier pass's foam; wire a new Foam Source for different variation. |
| `recipe` | Replaces everything that defines the tile (container, starting mass, settings, foam, sources, plates). See below. |

New outputs: `mass` (text -> next engine's `mass_in`), `plates_mesh` (surviving plates), `structure_mesh` (support branches), `new_void_mesh` (only what THIS pass removed; an earlier pass's voids are not in it; colour it orange).

**Resolution.** Plates need a cell no bigger than half their thickness. Preview at `cell` 0.5 (about 1 s for a 20 ft cube here); a 0.25 cell took about 12 s on the same recipe (roughly 15x), so use it for the final pass. Building the grid from a large mesh takes a few seconds (it runs in Python).

### Two passes (the loop)

Engine A (as usual) -> `mass` -> Engine B `mass_in`, with its own Sources and Floor Plates. Or: bake A's `foam_mesh`, edit it in Rhino, reference it into `geo` of a fresh engine (loses the old plates unless you wire them again). `mass_in` is the lossless route: pass B with no new sources reproduces A exactly.

## Seeing everything: what to plug each output into

| Output | What it is | Wire it to |
|---|---|---|
| **`preview_mesh`** | **the one to look at.** The whole solid in one mesh with vertex colours: floor plates blue, support branches orange, cavity walls red, outer skin light grey. Nothing overlaps, so nothing hides or z-fights | a plain Mesh preview or a Custom Preview with **no Material wired** (a swatch overrides the colours). Add the input `cutaway` (integer slider -1 / 0 / 1): 1 removes everything beyond `slice_pos` on `slice_axis`, -1 everything before it, so you can look inside. Preview only, never changes the result |
| `foam_mesh` | the **whole solid**: foam, floor plates and branches together | Custom Preview, light grey / white |
| `void_mesh` | the carved space (the negative) | Custom Preview, red or glass (it fills the cavities, so turn `foam_mesh` preview off to see it alone) |
| `plates_mesh` | only the floor plates, with their true flat tops | Custom Preview, blue. It sits *inside* `foam_mesh`, so the two fight when both show: switch `foam_mesh` off (right-click the component, Preview) or make it transparent to inspect plates |
| `structure_mesh` | only the support branches that were grown | Custom Preview, orange. Same overlap rule as plates |
| `new_void_mesh` | only what THIS pass removed (identical to `void_mesh` on a first pass) | Custom Preview, orange; only worth looking at on a second pass with `mass_in` |
| `section`, `outline` | the slice mesh and its outline at `slice_axis` / `slice_pos` | a Preview / Curve Preview; move `slice_pos` (it is in world feet) through a room or a plate |
| `src_pt_out` | where each source sits | Point Preview (check they are inside the block and above/below plates as you meant) |
| `log` | the full report: grid, void %, one line per plate (kept area, slope, contact, span, branches, HELD UP), one per source | **a Panel, always**. Read the `PLATE` and `NOTE` lines first |
| `recipe_text` | the recipe of what you are looking at | a Panel; copy it out to save a recipe |
| `export_log`, `export_path` | what the Export button wrote | Panels |
| `mass` | the finished result as text, for a second pass | wire to the next engine's `mass_in`; do **not** preview it (very long) |

A good minimum set: `log` Panel, `foam_mesh` grey, `void_mesh` red at the same time as `foam_mesh` (the red lights up the cavities through the solid in a section), `plates_mesh` blue, `structure_mesh` orange, `src_pt_out`.

**Running a recipe.** Put the recipe text in a Panel (Multiline Data on) wired to `recipe`, or type the path of a `.recipe.json` file. The sliders for everything the recipe defines are then ignored: the log's `RECIPE:` line lists them. The recipe's own `name` is used for the export unless `tile_name` is wired. A recipe that carries `expect.tile_id` ends with `RECIPE CHECK: OK` when your machine builds exactly the recorded tile.

**Headless previews.** `headless/view_sections.py` draws colour-coded sections (foam, void, plates, branches) from an export folder with no Rhino; the pictures in `examples/previews/` were made with it.

## Recipes and the two folders

One click on `export` writes:

- **`<name>_analysis`** (for the program): everything it needs, as before, plus `recipe.json`, `data/plates.json` (each plate's position, slope, thickness, kept area, how it is held up, clear height above and below, openings through it), `voxels/mask.u8` (the container), `voxels/plates.u8` (surviving plates), `voxels/struts.u8` (branches). `tile.json` (schema `erosion-tile/4`) gains `origin_ft`, `container`, `plates`.
- **`<name>_reference`** (for you): the Rhino file (in WORLD coordinates, so it overlays your model; layers foam, void, new_erosion, floor_plates, support_branches, container, plate_curves, faces, sections), `recipe.json`, `mass.json`, `log.txt`, `timelapse/`.

**The recipe is self-contained.** The container (a cube, a box, the triangles of your geometry, or its exact voxel mask), the floor plates (curve points / triangles), any starting mass, the foam, the sources and every setting are inside it, so pasting it into the engine's `recipe` input (or giving the path of `recipe.json`, of the `_reference` folder or of the `_analysis` folder) rebuilds the exact tile with **no Rhino geometry**. The log says `RECIPE CHECK: OK` when the tile id matches. Hand-written recipes work too (see `RECIPES.md` and `examples/`).

## What the export carries now (nothing else is needed by the app)

New optional inputs on the engine (add them like the others; unwired they do nothing):

| Input | Default | What it does |
|---|---|---|
| `print_scale` | 120 | Ratio for the print files: 120 = 1 inch per 10 feet (1 ft = 2.54 mm). 0 turns them off. The export writes `print/<name>_foam_1to120.stl` and `_void_1to120.stl` (binary, millimetres, Z up) into the `_reference` folder, and says the printed size in `export_log`. |
| `category`, `typology`, `variant` | none | Text. Written into `tile.json` `meta` and the recipe (or put a `meta` block in the recipe). The app reads it instead of guessing from the file name. |

The `_analysis` folder now also holds (all explained in `docs/DATA_FORMAT.md`, section 13):

- `data/spaces.json`: the void read as spaces: **levels** (floors and ramps, with the space above each), **rooms** (kind, name, clear height, light), **connections**, the **shortest routes** between side faces, the cross-section along the main route, **daylight** and **openings** on each face. `voxels/rooms.u8` says which room each cell is in.
- `data/structure.json`: foam pieces, thin-wall shares, overhang, bed contact, plates joined to the grounded foam: what the app turns into print checks.
- `model/<name>_parts.glb` (with plates or branches): the floor plates and branches as their own meshes. The main GLB is unchanged (foam and void only).
- `vector/drawings/`: a poche plan of every level and sections along X and Y, as SVG, 1 inch = 10 feet. Open one in a browser or Illustrator.
- `data/faces.json`: foam and plate masks next to the void mask.

The web app computes exactly the same things from the voxels (that is how tiles built in the Sections tab get them), and `npm run check:parity` in the repo proves the two agree on the 15 typology tiles.

## Try it in this order

1. Replace the engine script with `erosion_engine_7.py`, no new inputs. Run your current definition: the tile should be identical to before.
2. Add the new inputs `plates`, `geo`, `mass_in` and outputs. Paste the Floor Plates script into a new component, reference one closed curve at the height you want, wire `plates`. Update the Source script and try each `plate_mode` with a Panel on one source.
3. Add `cut` on one source and watch it open the plate; vary `resistance`.
4. Try a curve in a tilted plane (a ramp) and a solid as a plate.
5. Try `geo` with a closed Brep, then a second engine with `mass_in`.
6. Export, open the `_reference` folder's `recipe.json`, paste it into the `recipe` panel of a fresh engine and look for `RECIPE CHECK: OK`.

## What is verified, and what is only proven in Rhino

Checked here by running the numeric core headless (Rhino's own Python, a stand-in for Rhino geometry): identical output to 5f for plain cubes (4 setups); every plate mode, `cut`, mixed sources on one plate; flat and 21-degree tops exact to 0.00000 ft (a drawn curve and a wedge solid); openings from nested curves; support branches (floating plate, top-face branching, auto-support off); geometry as the container (including a union and a far-from-origin box); two-pass `mass_in`, which reproduces exactly with no new sources; recipe rebuild from the recipe alone, from the `_reference` folder and from the `_analysis` folder; the export files; a hand-written recipe.

Only proven when you run it in Rhino: reading your curves and geometry (`erosion_plates.py`, `geo` in the engine: Brep meshing, `TryGetPolyline`, naked edges of open surfaces), the preview slabs, and writing the `.3dm`. If one of those errors, send me the message in the component's red balloon.

Run the engine headless yourself: `engine/headless/run_headless.py` (see its header).
