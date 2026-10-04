# Writing recipes by hand (for Claude sessions and for you)

A recipe (`schema: "erosion-recipe/2"`) is the complete description of a tile. Paste its text into a Panel wired to the engine's `recipe` input (or type the path of the file, or of an `_analysis` / `_reference` folder) and the engine builds exactly that, ignoring its own sliders for everything the recipe defines. **A Claude session can therefore design spaces by writing recipes**: write the JSON, preview it headless (below), hand it over.

Engine 5f recipes (`erosion-recipe/1`) load too. Every key is optional except `sim` and `sources` (with no `container`, `plates` or `start` you get the plain cube of 5f).

## Preview a recipe without Rhino

```
set PYTHONPATH=C:\Users\<you>\.rhinocode\py39-rh8\site-envs\<default-xxxx>        (the folder containing numpy, scipy, skimage)
C:\Users\<you>\.rhinocode\py39-rh8\python.exe engine\headless\run_headless.py engine\examples\two_floor_atrium.recipe.json --export C:\tmp\demo
```
Keep the export path short (Windows 260-character limit). The log prints void %, each plate's state and the support report; the `_analysis/images/sections/contact_sheet_*.png` images show the result (pink foam, dark void). The `.3dm` is skipped headless. In Python: `from run_headless import run_engine; out = run_engine(recipe=text)`; `out['log']`, `out['recipe_text']`, `out['mass']`, `out['tile_data']`.

## Schema

```json
{
  "schema": "erosion-recipe/2",
  "name": "my_space",
  "engine_version": "7.0",
  "meta":    {"category": "gathering", "typology": "stepped amphitheater", "slot": 1},
  "sim":     {"tile_w": 20, "tile_h": 20, "cell": 0.5, "steps": 140, "gravity": 0.6, "drain": false, "n_frames": 8, "smooth": 0.8, "seed": 4},
  "cleanup": {"min_void_ft3": 6, "min_foam_ft3": 8, "weld": ""},
  "foam":    { ... same keys as the Foam Source output ... },
  "container": { ... optional, see below ... },
  "plates":  [ { ... one Floor Plates group ... }, ... ],
  "sources": [ { ... one Erosion Source application ... }, ... ],
  "start":   { ... optional: a mass (an earlier pass's finished result) ... },
  "frame": null,
  "expect":  {"tile_id": "optional, gives RECIPE CHECK"}
}
```

- **`meta`** (optional): `category` (gathering / office / lobby), `typology`, `slot`, `variant`. Written to `tile.json`; the app uses it for labels and the catalogue. Does not change the tile id.
- **`sim`**: `tile_w`/`tile_h` give a cube `tile_w x tile_w x tile_h` (ignored when `container` or `start` is present). `cell` is the cell size (0.5 = 6 in; use <= half the thinnest plate). `steps` 100-200 typical. `gravity` 0-1 (0 = solvent spreads evenly; 0.6 gives flat floors and pooling; plate modes pool/around need gravity > 0). `drain` true lets solvent fall out of the bottom. `smooth` 0.8-1.5 (mesh smoothing, in cells). `seed` varies the spray droplets.
- **`cleanup`**: `min_void_ft3` fills sealed pockets smaller than this, `min_foam_ft3` removes floating foam bits smaller than this (anything touching a tile face, the geometry's outer skin or a plate is kept); `weld` is letters x/y/z to make opposite faces identical so copies repeat exactly (plates on a welded face stay as drawn).
- **`foam`**: `noise` 0-1.5 (0 = perfectly even, 0.4-0.7 organic), `scale` ft (lobe size, 3-6), `grain`, `seed`, `web` 0-1.5 and `web_open`, `web_thickness` (membranes that create branching networks), optional `layers` (see `erosion_foam.py`). Plates follow these fields, so the same foam gives plates the same character.
- **`sources`**: each `{"v":1, "mode":"inject|pour|spray|line", "kind":"pt"|"crv", "pt":[x,y,z] or "pts":[[x,y,z],...], "dose": ft3, "spread": ft, "start": step, "duration": steps, "dir": [x,y,z] or null, "plate_mode":"pool|stop|around|through", "cut": true|false}`. `kind` is `pt` for inject/pour/spray and `crv` (with `pts`) for line. `dose` is how much foam the application could dissolve (1000-2000 is a room-sized void in a 20 ft cube); `spread` is a width in feet (1-12). Pour sits on the nearest face; spray needs a `dir` for an outside nozzle, or hits the nearest face. Coordinates are WORLD coordinates (they match `container.min`).
- **`plates`**: each `{"v":1, "kind":"plates", "name":..., "thickness":1.0, "resistance":1.0, "anchor_ft":1.5, "anchor_strength":3.0, "auto_support":true, "min_support":6.0, "max_span":12.0, "strut_size":1.5, "verticality":0.3, "branch_from_top":false, "support_pts":[[x,y,z],...], "shapes":[...]}`. Shapes:
  - `{"type":"poly","pts":[[x,y,z],...]}` a closed flat curve (corners in order, no repeated end point). It is the TOP of the slab, extruded down by `thickness`. The points define the plane, so a tilted polygon is a ramp. A polygon inside a bigger coplanar polygon is an opening.
  - `{"type":"box","min":[x,y,z],"max":[x,y,z]}` an axis-aligned solid (hand-written recipes only).
  - `{"type":"mesh","v":[[x,y,z],...],"f":[[a,b,c],...]}` any closed triangle mesh, used as modelled (this is what the Floor Plates component writes for geometry).
  - `{"type":"field","x0":0,"y0":0,"step":1,"nx":20,"ny":20,"top":[...],"thick":1.7,"mask":"0110..."}` a warped slab as a height grid: `top` is the height of the top face at the (nx+1)*(ny+1) grid points (x-major), the bottom is `thick` below it (or a constant `"zbot"` for solid ground), `mask` (optional, nx*ny characters, x-major) says which cells it covers. A few hundred numbers instead of thousands of triangles, so a recipe stays short enough to paste (a Grasshopper panel cuts text at about 32,000 characters). The tile set uses this.
- **`container`** (the block of foam when it is not a cube):
  - `{"kind":"box","min":[x,y,z],"size":[w,d,h]}` an axis-aligned box anywhere (hand-written).
  - `{"kind":"mesh","v":[...],"f":[...]}` closed triangles of your geometry (what the engine records for `geo`, up to 30,000 triangles).
  - `{"kind":"mask","origin":[...],"cell":0.5,"shape":[nx,ny,nz],"mask":"<packed>"}` the exact voxels (recorded for very large geometry).
  The grid is the container's bounding box at `sim.cell`; cells outside the container hold nothing.
- **`start`**: a mass object (schema `erosion-mass/1`) copied from an earlier engine's `mass` output / `mass.json`. It carries its own container, material, plates and foam, so `container` is not needed with it. The recipe of a second pass records it automatically.

## Design vocabulary (what produces what)

- **Flat floors**: a plate plus a `pool` source above it. The pooled acetone spreads over the plate and cuts a wide flat room above it; the plate's top is a true plane.
- **Rooms stacked on either side of a floor**: plates at the floor heights, sources above and below, `pool`.
- **A vertical connection through a floor**: an opening (inner polygon) in the plate; or a `through` source (flows through the plate without eroding it) which lets a shaft continue; or a `cut` source to eat a hole with organic edges.
- **Ramps and sloped floors**: a tilted `poly`; remember it is only a ramp where erosion has freed it, so put void above (and below).
- **Mezzanine / overlook**: a partial plate (`box` or small `poly`) with `branch_from_top: true` so branches can hold it from the ceiling foam.
- **A bridge across a void**: a long narrow plate; set `max_span` to what you believe the span can be and let branches add supports where it is exceeded.
- **Leave plates alone vs eat them**: only `cut: true` sources dissolve plates; give `resistance` > 1 to make a cut slow and ragged.
- **Several passes**: run once, take `mass`, run again with a different foam and new sources; in a recipe put the first pass's mass in `start`.

## Rules of thumb

- Keep plates 1-1.5 ft thick at `cell` 0.5, at least 2 cells for crisp edges.
- Keep sources and plates inside the block (a source outside is moved to the nearest edge; a plate reaching outside is clipped with a note).
- A source in the middle of a plate that it cannot enter (`pool`/`stop`/`around`, no `cut`) puts no solvent there; put it above or below.
- If a plate is eroded away completely or is not "HELD UP" the log says so (NOTE lines); lower `max_span` / raise `min_support`, or move the acetone.
- Always preview and read the section images before handing a recipe over. State plainly what was and was not verified.

## Examples

All in `examples/`; each run headless in 1-3 seconds, each carries `expect.tile_id` so the engine prints `RECIPE CHECK: OK` when it reproduces the recorded tile, and `examples/previews/<name>.png` shows what it should look like (pink foam, dark void, blue plates, orange branches).

**Tests** (small, built to show one behaviour clearly):
- `test_plate_modes`: one big floor, four identical acetone doses above it, one per `plate_mode`. Pool = wide flat room, stop = small, around = slides off toward the plate edge, through = ignores the floor and carves below it.
- `test_cut_resistance`: four plates with `resistance` 0.5 / 1 / 2 / 4, each under a `pool + cut` source. Softer plates are eaten more. (2 and 4 come out close: the pooled acetone is a fixed amount and runs out of dose, so raise the dose to separate them more.)
- `test_support_branches`: two plates floating inside carved cavities (a `through` source), one with `branch_from_top` off (branches go to the sides / below) and one on (a short branch up to the ceiling foam).

**Spaces** (intentional layouts, not final variations):
- `space_stacked_atrium`: 20 x 20 x 26 ft cube. An L-shaped first floor with a stair-well opening, a mezzanine above held from the ceiling, a room on each side of each floor, and a `through` source that links the levels.
- `space_hall_ramp_bridge`: 40 x 16 x 20 ft box. A long hall with a mezzanine at one end, a 25 degree ramp up to it (a line source carves the walkable tunnel above the ramp), a bridge across the hall and an east landing.
- `space_tower_from_geometry`: a tapered 16-sided tower as a mesh container, placed at (60, -25, 4) to prove world coordinates, with two round floors with stair wells (drawn larger than the wall so they are trimmed to it).
- `two_floor_atrium`, `long_gallery_ramp`: the two earlier hand-written examples.

Lessons from writing these: put acetone where the void should be (a ramp needs its own source above it or it stays buried in foam); a plate can only be eroded by `cut` sources; put `through` sources where you want a shaft to ignore a floor; look at the colour sections (`headless/view_sections.py`, with `at=` to cut through a plate) rather than the default contact sheets, which paint plates the same colour as foam.
