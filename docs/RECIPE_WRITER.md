# The AI recipe writer: how the tiles are written

The fifteen tiles of this project were not modelled by hand. Each one is a **recipe**: a short JSON text that says where solvent is poured into a block of foam and which floors are protected from it. The engine (the Grasshopper component, or the same code run headless in Rhino's Python) erodes the block from the recipe, and the app reads what comes out. An AI (Claude) is the recipe writer: it designs a space by writing numbers, previews the result, reads the pictures and the measurements, and edits the numbers until the space is right. This document explains how that works, what the writer has to know, and how to check its work. It is the brief to give an AI session that has to write or change a tile.

The engine script is **frozen**. Everything below is done with recipes alone.

## 1. The pipeline, step by step

```
describe the space  ->  write / edit the recipe  ->  build it with the real engine (about 7 s)
      ->  read the app's own analysis  ->  look at the pictures  ->  edit again  ->  verify  ->  fixtures  ->  the app
```

All commands use Rhino's bundled Python 3.9 (it has numpy, scipy and scikit-image). Keep export paths short (Windows stops at 260 characters).

| Step | Command | What it does |
|---|---|---|
| write | edit `engine/tiles/v7/defs7.py` | one function per tile (`G1()` ... `L5()`) returns a recipe |
| build | `python engine/tiles/v7/build.py G3` | runs the real engine on one tile (or `build.py` for all 15) and exports to `C:/tmp/tiles7/<name>/<name>_analysis` |
| read | `npx tsx scripts/eval-tile.ts <name>` (with `V4_EXPORTS=C:/tmp/tiles7`) | the app's own code: where a person can stand and walk, which floors join, which openings have a floor behind them, usable space |
| look | `engine/tiles/v7/view4.py`, `iso.py` | walking sheets and isometric cut-aways of the smooth surface (the surface the app shows and prints) |
| verify | `python engine/tiles/v7/verify.py` | rebuilds every tile from its recipe file alone: `RECIPE CHECK: OK` (same tile id), at most 24 sources, under 32,000 characters |
| fixtures | `python engine/tiles/make_fixtures.py C:/tmp/tiles7 lib/tiles/fixtures` | copies voxels and the engine's own measurements into the repository |
| parity | `npm run check:parity` | the app's analysis agrees with the engine's on every tile |
| assemble | `npm run check:tiles` | every pair, repeat / mirror / shift in 2, 4, 8, Auto Generate |
| package | `python engine/tiles/v7/package.py` | one import-ready `_analysis` zip per tile, plus the whole set |

A recipe pasted into the Grasshopper `recipe` panel reproduces the tile exactly (`RECIPE CHECK: OK`); a panel cuts text at about 32,000 characters, which is why warped plates are stored as height grids.

## 2. What a recipe contains

`schema: "erosion-recipe/2"`: `sim` (cell size, steps, gravity, seed), `foam` (the noise that makes walls read as eroded), `plates` (protected foam), `sources` (where solvent goes). Full schema: `engine/RECIPES.md`. The writer works through helpers (`engine/tiles/kit.py`, `engine/tiles/organic.py`, and the V7 additions in `defs7.py`):

| Helper | What it makes |
|---|---|
| `chamber(point, spread)` | a round room (a source at one point). Walkable floors need the centre about 5 ft above the slab and a spread of 4.1 or more (6.5 ft headroom) |
| `vein(points, spreads)` | a passage that swells and pinches along a curve |
| `passage`, `through_shaft` | a straight-ish throat; a shaft that ignores floors it passes |
| `port(face, "L" / "U")`, `lport(face, ...)` | the standard opening on a side face at the lower (z 6) or upper (z 16) storey; `lport` is a low one whose floor reaches the ground slab |
| `plate_group`, `shell`, `slab`, `blob`, `box`, `column`, `street` | protected foam: floors, terraces, seating, pillars, a ribbon that follows a path (ramp, stair) |
| `piers(points)` | retained columns from the ground slab to inside the roof, so nothing hangs on a thin neck |
| `spine(path, widths)` | a solid wall under a ramp or stair from the ground to the underside of the ribbon, so it is carried all the way down |
| `plate_mode` (`pool`, `stop`, `around`, `through`), `cut=True` | what a source does when it meets a plate; only `cut` sources eat plates |

## 3. The rules the tiles must meet

**What Arrange needs (the contract).** Each tile is a 20 ft cube on a 0.5 ft grid, a ground slab with its top at 2 ft, a mid datum at 12 ft, ports at about 6 and 16 ft on the side faces. Arrange places any tile in 8 orientations and finds the fits itself; you do not describe positions. Three kinds of cell: outside the container, material (foam, plates, branches), carved space. Carved space is never shared between tiles: continuity comes from openings that meet at the surface (floor meets floor, void meets void).

**Walking** (the one model, `lib/walking.ts`, shared by Arrange and Analysis): a place to stand needs a floor, 6.5 ft headroom and a clear disc 2.5 ft wide; neighbouring floors are one surface when they differ by at most one step (0.5 ft); a floor under 12 sq ft is a pocket. **A jump is never a route**: a change of height bigger than a step is crossed only by real geometry (a stair, a ramp, a stepped floor). A slope steeper than about 0.5 reads as "blocked overhead" (the disc rule), so ramps are 0.45 or gentler and long. A joint across a horizontal plane (a tile stacked on another) never carries a route.

**Printing**: every tile must be one piece. Nothing floats (checked on the smooth field, `void_smooth < 128`, for pieces not touching z = 0), nothing hangs on a neck under 1 ft, the base slab is whole, the roof is at least about 1 ft thick, no hole through seating or floors that is not meant.

**Limits**: at most 24 sources, under about 32,000 characters (field plates cost about 1,600 values at step 0.5, so use step 1.0), cell 0.5 ft.

## 4. What the writer learned (read this before editing a tile)

These come from building the set; each is a behaviour of the engine, not a preference.

- **Chambers and veins are round.** A walkable floor needs the void centre about 5 ft up with a spread of 4.1 or more, and large enough to reach the slab. Thin foam features left over from the dose running out are fragile: make structure from protected plates (`column`, `shell`) instead.
- **A cut can eat the ground slab.** A `cut=True` source, or a `through` source with `cut`, will go through the base. Give the slab a higher resistance (`_ground(res=5.0)`), start shafts above the ground storey, and use a lower dose. Check the base with the slab test.
- **A flat landing must be part of the path.** A flat blob added to a sloped stair is a 0.8 ft step and splits the walking zones. Make landings flat stretches of the stair's own path.
- **A second floor at 12 ft needs a ceiling of 18.5 ft or more**, which leaves a roof of about 1 ft. A protected roof plate (`box((0,0,19),(20,20,20))`, resistance 5) keeps it sealed and exactly thick enough.
- **A spine or a deck must not stand in a door's path.** A full spine under L1's stair blocked the +X door; a solid block under L4's overlook blocked the +Y face.
- **Pier tops must end inside the roof** (z 19.2), not at z 20, or they surface as discs on the roof.
- **Joins**: every side face should have an opening with a floor behind it (`lport` makes a low one). Test that ports on all four faces still join after each edit.
- **Always render the smooth surface** (`void_smooth`, marching cubes), never the voxels: voxels look blocky and give the wrong impression of the tile.

## 5. Checking a change (what "done" means)

1. `verify.py`: the recipe rebuilds its own tile id and is under the limits.
2. Walking: the main floor is one piece; every opening that should join has a floor and clearance (`eval-tile.ts`).
3. Printing: no floating pieces, no necks under 1 ft, base slab whole, roof at least 1 ft, no unwanted holes.
4. Joins: re-run the pair matrix (`npm run check:tiles`). The set should keep its measured joins (198 of 225 ordered pairs, 117 of 120 either way round).
5. `npm run check:parity`, then regenerate the fixtures and the evaluation table (`npx tsx scripts/tiles/table.ts`).
6. State plainly what was and was not verified.

## 6. Asking an AI to write or change a tile

Give it: the typology and what the space should feel like; the tile's current function in `defs7.py`; the rules in section 3; this document. Tell it to: build and read the analysis before and after, look at the smooth render from four sides, change numbers in small steps, keep the recipe under the limits, and report the walking and printing results honestly. Do not ask it to change `engine/erosion_engine_7.py` or `erosion_foam.py`, `erosion_plates.py`, `erosion_source.py`: the engine is frozen.

The tile set and its measured results are in `docs/TILE_SET_V7.md`; the engine's own schema and examples are in `engine/RECIPES.md` and `engine/ENGINE_7_GUIDE.md`.
