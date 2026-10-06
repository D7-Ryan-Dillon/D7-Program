# V6: the fourth set of fifteen tiles, a cubic set made stronger

Fifteen engine-7 recipes, one per typology (Gathering, Workspace, Lobby; five each), named `<category>_<n>_<typology>_v6`, plus a matching **cubic backup** (suffix `v6c`) of every tile whose top is notched (G1, G5, O2, L4, L5). V3 was the set that assembled best (the cube is the cleanest way to interlock); V4 and V5 chased other things. V6 goes back to the 20 ft cube and fixes what V3 lacked: floors you can walk, rooms of human scale, wide openings, and interlock that is more than six faces butted together.

| What V6 does | How |
|---|---|
| a cubic envelope, eroded inside | `kit6.cube_env`: a 20 x 20 x 20 ft mask container (L1: 20 x 20 x 40, O3: 20 x 20 x 10), a thin worn skin held flat round every opening so two tiles meet face to face |
| 8 ft clear in main spaces, 7 ft under shelves and ledges | rooms are `lobed` pods; the app's rule is 6.5 ft, the margin absorbs erosion noise (`paths6.tame` keeps them off the skin) |
| openings are wide, mixed per typology | `kit6.WidePorts`: a tunnel plus a foyer pod, 4.8 to 5.6 ft wide and 8.4 to 9.4 ft high, at the shared datums 1 / 11 / 21 ft; small only where the concept calls for it (G4's inner room, L2's slots) |
| interlock by stepped tops | `kit6.box_cut` / `step_top` cut a 10 ft notch from the top (G1, O2, L4: the front 10 ft down; G5, L5: the north-east quarter) that a cube **shifted 10 ft in x or y and 10 ft up** fills (the 10 ft lattice, datums 1 / 11 / 21 ft) |
| a walkable nest | G5 puts its landing and a door on the notch wall, so the cube that fills the notch has its ground floor level with G5's upper floor |
| the cubic backup | the same recipe with the notch left out (`defs_*.py` take `cubic=True`) |
| the one walking model | the app's rules (`lib/walking.ts`) decide every floor, step and headroom |

| File | What it is |
|---|---|
| `kit6.py`, `paths6.py` | the kit: `cube_env`, `box_cut`, `step_top`, `step_bottom`, `WidePorts`, `lobed`, `terrain`, `street`, `recipe6`, `tame` |
| `defs.py`, `defs_g.py`, `defs_o.py`, `defs_l.py` | one function per tile (the docstring is the concept); `STEPPED` lists the notched tiles and `TILES` includes their backups |
| `build.py [G1 O3 G5c ...]` | writes the recipe, runs the real engine headless, exports to `C:/tmp/tiles6/<name>/`, draws the section sheet |
| `verify.py` | rebuilds each recipe from the file alone: `RECIPE CHECK: OK`, at most 24 sources, 32,000 characters, metadata (accepts `_v6c`) |
| `view4.py`, `iso.py`, `overview.py [--exterior]`, `render_assemblies.py` | walking sheet, isometric views, the 3 x 5 overviews, assembly pictures |
| `package.py` | one import-ready `_analysis` zip per tile (20), the `_reference` zips, the whole set in one zip (`package/`, git-ignored) |
| `lab_door6.py` | calibration: what a wide door cuts in a cube |
| `recipes/`, `assemblies/`, `EVALUATION.md` | the 20 recipes with previews, the output of `npm run check:v6`, the app's own table (`TILESET=v6 npx tsx scripts/v4/table.ts`) |

```
python engine/tiles/v6/build.py            all twenty; or  build.py G5 G5c
python engine/tiles/v6/verify.py
python engine/tiles/make_fixtures.py C:/tmp/tiles6 lib/tiles/fixtures-v6     then  npm run check:parity
npm run check:v6                           every way Arrange can assemble them (writes engine/tiles/v6/assemblies/)
```

(Use Rhino's bundled Python 3.9 for the first three: the engine imports Rhino, so it only runs in Rhino's interpreter.) The engine script itself is not changed; V6 is recipes only.

Design brief and the one-by-one description of the tiles: `docs/TILE_SET_V6.md`.
