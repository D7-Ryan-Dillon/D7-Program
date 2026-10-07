# The 15 typology tiles as engine 7 recipes

> **The third set, V5, is in `v5/`** (`<category>_<n>_<typology>_v5`: the same family contract as V4 but eroded all the way through: a worn, bayed mask container, flat floors with lobed edges as the only hard things, frameless doorways; see `v5/README.md` and `docs/TILE_SET_V5.md`).
> **The fourth set, V6, is in `v6/`** (`<category>_<n>_<typology>_v6`, with a `v6c` cubic backup of every notched tile: cubic blocks eroded inside, wide openings at the shared datums, 8 ft clear in main spaces, stepped tops that a shifted cube nests into; see `v6/README.md` and `docs/TILE_SET_V6.md`).
> **The fifth set, V7, is in `v7/`** (`<category>_<n>_<typology>_v7`: the first set (V3) kept, same seeds, with small recipe edits so the floors walk and the faces join; see `v7/README.md` and `docs/TILE_SET_V7.md`).
>
> **The second set, V4, is in `v4/`** (`<category>_<n>_<typology>_v4`: coordinated 20 ft lattice, floors at 1 / 11 / 21 / 31 ft, standard 6 x 8 ft doorways, real stairs and ramps, L-plan / single-storey / 40 ft tiles; see `v4/` and `docs/TILE_SET_V4.md`). This folder is the first set (V3 labels dropped), unchanged: ground slab top at z = 2 ft, mid datum at z = 12 ft. The two sets keep distinct names and tile ids and can sit in one project; typology keys are shared, so the Analysis tab compares them as variants of one typology.

`recipes/` holds the fifteen recipes (three categories x five typologies from `Assignemnt_02_ProtoArchitecturalSpaces.pdf`, named `<category>_<n>_<typology>`, no version label). Each is a self-contained `erosion-recipe/2` with a `meta` block (category, typology, slot): paste it into the engine's `recipe` panel in Grasshopper (or type the file path) and the engine builds exactly that tile, ending with `RECIPE CHECK: OK`. No Rhino geometry is needed. The foam is the printed module, the voids are the spaces.

- `recipes/overview.png` all fifteen at a glance (an elevation at y = 6.5, one at x = 13.5, plans at z = 6 and z = 16: pink foam, dark void, blue plates).
- `recipes/previews/<name>.png` per tile: four elevations along Y and X and four plans.
- `recipes/REPORT.md` per tile: concept, void share, foam pieces, thin-foam share, interlock scores, openings on every face, tile id.

## What these are (and are not)
They are spatial prototypes, not floor plans: each reads as its typology from the **section and the sequence of spaces**, and each reads as an **eroded form** (a mass that acetone has worked on), not as a built object.
- **Voids** are soft passages that swell and pinch (`vein`) and overlapping chambers, never straight prismatic tunnels. A chamber or passage of spread s clears a radius of about 0.85 s.
- **Plates** are strata: warped, curved-edged floors and remnants (`shell`, `street`, `column`, `blob`; warped plates are stored as compact height grids, the recipe shape type `field`), cantilevered out of the walls, often bitten by `cut` sources. Structure is at least ~1.25 ft thick (1 ft = 2.5 mm at 1 in = 10 ft).
- **The typology** is carried by the idea, for example: a bowl whose terraces are contour lines that wander (amphitheater), a field of separate voids (void field), a tongue of rock ending in a bitten edge (inserted plate), a foam kernel with a room in it inside a ring cavern (room within volume), a gallery that pinches along an edge (edge gallery), a grotto hall on a few bone-shaped pillars (open hall), floors cantilevered from alternating walls (cascade), two broad floors with funnel light wells (deep plan), floors that wrap a funnel void (void edge), a rippled floor (folded surface), a chimney with landings (vertical void), compress-release-compress (sequence), a nave with ribs and aisles (continuous hall), a landscape floor under a counter-landscape ceiling (topographic), a street of rock that climbs and bends (linear gallery).

## How they interlock
A 20 ft lattice cell: ground slab top z = 2, mid datum z = 12, two storeys of about 8 ft; the top face is open (the next tile's ground slab is its roof). Every tile carries the **standard port** (`organic.port`) on at least two side faces: a half-chamber centred on the face at the lower storey (z 6) and/or the upper storey (z 16). Because that opening is the same everywhere, any two tiles meet across a joint whatever is behind it (196 of the 210 ordered pairs score 60 or more under the app's joint rule; see `REPORT.md`). Tiles that repeat along an axis are welded on it (`weld`, so opposite faces are identical); a mirror join is exact for every tile.

## How the tiles are made (so they can be changed)
- `tile_defs.py`: one function per tile; the docstring is the concept. `kit.py`: the recipe format and plain helpers (`box`, `slab`, `prism_*`, `tiers`, `heightfield`, `plate_group`, sources, `recipe`; `recipe(... layers=(count, axis, thickness, strength))` turns on layered foam, left off here because it makes pancake voids). `organic.py`: the language the tiles are written in (`vein`, `chamber`, `passage`, `through_shaft`, `shell`, `street`, `column`, `blob`; warped plates are stored as compact height grids, the recipe shape type `field`, `field`, `port`).
- A pasted recipe must stay under about 32,000 characters: a Grasshopper panel cuts longer text, which shows up as `recipe is not valid JSON`. That is why warped plates are `field` shapes (a few hundred numbers) and not triangle meshes; `build_tiles.py` warns above 28,000.
- The engine uses at most 24 sources per recipe; `build_tiles.py` warns when a tile has more. Foam is `noise 0.55, scale 3.6, grain 0.22` so walls read as eroded.
- Plates are protected, flat-topped foam read column by column (a mesh may have several layers in a column). Auto-support is off in these groups; the report checks that the foam is one connected piece (specks of a few ft3 on the faces are kept by the engine because they touch a face).

## Rebuild and check
```
set PYTHONPATH=<the site-envs folder with numpy, scipy, skimage>
<Rhino 8 python 3.9>\python.exe engine\tiles\build_tiles.py            all fifteen (or e.g.  G1 O3 L5)
<...>\python.exe engine\tiles\compat_matrix.py                          15 x 15 best joint score between different tiles
<...>\python.exe engine\tiles\report_all.py                             rewrites recipes/REPORT.md
<...>\python.exe engine\tiles\overview.py                               rewrites recipes/overview.png   (overview.py 4 2 office_1 lobby_3 : a bigger sheet of some tiles, in C:/tmp/tiles/_review.png)
<...>\python.exe engine\tiles\make_fixtures.py                         copies the voxels + the engine's own analysis into lib/tiles/fixtures (run after build_tiles.py; then `npm run check:parity`; check that no old fixture folders are left behind)
```
`build_tiles.py` writes the recipe with its tile id, runs the engine headless, exports to `C:/tmp/tiles` (a short path: the Windows 260 character limit) and draws the previews. See `../headless/` for the stand-in used instead of Rhino.

## What is and is not verified
Verified headless (Rhino's own Python, the same engine code): every recipe reproduces its tile id, foam is one piece (apart from specks of at most a few ft3 on the faces), the app's analysis (`lib/tiles`) agrees with the engine's on all fifteen (`npm run check:parity`), and the joint scores in `REPORT.md`. Not verified: running them in Rhino itself, the `.3dm` export, and 2/4/8-copy aggregations as images (the pair scores are the app's joint rule, not a rendered assembly).

Known limits: the envelope stays the 20 x 20 x 20 lattice cell. The analysis (room watershed, levels) was specified on the first, more regular set, so on these soft forms it finds fewer, larger rooms (mostly one or two) and the levels come from the plates and the ground; the circulation and light measures still work.
