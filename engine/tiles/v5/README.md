# V5: the third set of fifteen tiles, eroded all the way through

Fifteen engine-7 recipes, one per typology (Gathering, Workspace, Lobby; five each), named `<category>_<n>_<typology>_v5`. V4 (`../v4`) was coordinated but read as built: a perfect box, framed doorways, piers, lintels, diaphragm walls and slab plates. V5 keeps the family contract (20 x 20 ft lattice, floors at 1 / 11 / 21 ft, doorways at the shared datums, the shared walking rules) and removes everything that reads as built. The concept, the design matrix, the pictures, the evidence and the comparison with V4 are in **`docs/TILE_SET_V5.md`**.

| What changed from V4 | How |
|---|---|
| the outline is a block that has been worn, not a box | `kit5.envelope`: the container is a voxel **mask** (the engine's `mask` container): rounded vertical edges and crown, a skin that only ever recedes (0 to about 3 ft), a lumpy crown with a flat 6 ft landing, **bays** (a bite out of a corner, full height or only above some height) |
| faces still touch where they must | the skin is held flat for about 9 ft round every doorway and at the crown, so neighbours meet face to face there; everywhere else it is free |
| tiles nest into each other | the bays have fillets (2.5 ft) tighter than the convex corners (3 to 5 ft), and the skin never bulges past the ideal block, so a rounded corner always fits a bay (Arrange's cell-level collision policy) |
| no piers, frames, lintels, diaphragm walls, poche | rooms are clusters of overlapping, leaning pods (`kit5.lobed`); every wall, pier and arch is the foam the erosion left between them |
| the only hard things are floors | `kit5.terrain` / `paths5.shelf`: flat-topped height grids with lobed outlines (a shelf of ground, not a slab); ramps and ledges follow a path (`organic.street`, `paths5.ribbon2`) |
| doorways have no frame | `kit5.SoftPorts`: a tunnel that bends a little plus a half-barrel foyer centred on the face; the opening is irregular (about 9 ft wide and 10 ft high on average, 3.5 to 15 ft wide), with a floor at the datum |
| the walls keep their skin | `paths5.tame` shrinks any room that would come closer than 1.3 ft to the outside (the roof included) |

| File | What it is |
|---|---|
| `kit5.py`, `paths5.py` | the kit (see the table above) |
| `defs_g.py`, `defs_o.py`, `defs_l.py`, `defs.py` | one function per tile (the docstring is the concept) and `TILES` |
| `build.py [G1 O3 ...]` | writes the recipe, runs the real engine headless, exports to `C:/tmp/tiles5/<name>/`, draws the section sheet |
| `verify.py` | rebuilds each recipe from the file alone: `RECIPE CHECK: OK`, at most 24 sources, 32,000 characters, metadata |
| `view4.py`, `iso.py`, `overview.py [--exterior]`, `render_assemblies.py` | walking sheet, isometric views, the 3 x 5 overviews, assembly pictures |
| `package.py` | one import-ready `_analysis` zip per tile, the `_reference` zips, the whole set in one zip (`package/`, git-ignored) |
| `lab_door5.py` | calibration: what a soft door cuts in an eroded envelope |
| `recipes/`, `assemblies/`, `EVALUATION.md` | the fifteen recipes with previews, the output of `npm run check:v5`, the app's own table (`TILESET=v5 npx tsx scripts/v4/table.ts`) |

```
python engine/tiles/v5/build.py            all fifteen (seconds each: the mask container makes them fast); or  build.py G5 O4
python engine/tiles/v5/verify.py
python engine/tiles/make_fixtures.py C:/tmp/tiles5 lib/tiles/fixtures-v5     then  npm run check:parity
npm run check:v5 ; npm run boxiness        the assembly evidence; V4 against V5
python engine/tiles/v5/iso.py --all ; python engine/tiles/v5/overview.py ; python engine/tiles/v5/overview.py --exterior
python engine/tiles/v5/package.py
```

Run with Rhino's bundled Python 3.9 and its site-envs on `PYTHONPATH` (see `engine/headless/run_headless.py`). V4 and V5 share the datums (1, 11, 21 ft); the first set uses 2 and 12.
