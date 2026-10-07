# The tile set: recipes, build, verify, pictures, packages

Fifteen engine-7 recipes, one per typology, named `<category>_<n>_<typology>_v7`, written in `defs7.py` (the docstring of each function says what the tile is). What each tile is and what was measured: `docs/TILE_SET_V7.md`. How the recipes are written and checked: `docs/RECIPE_WRITER.md`.

| File | What it is |
|---|---|
| `defs7.py`, `defs.py` | one function per tile and `TILES`; helpers `lport` (a low port that reaches the ground floor), `piers` (retained columns from the ground slab to inside the roof) and `spine` (a solid wall under a ramp or stair) |
| `build.py [G1 O3 ...]` | writes the recipe, runs the real engine headless, exports to `C:/tmp/tiles7/<name>/`, draws the section sheet |
| `verify.py` | rebuilds each recipe from the file alone: `RECIPE CHECK: OK`, at most 24 sources, under 32,000 characters, metadata |
| `view4.py`, `iso.py`, `overview.py [--exterior]`, `render_assemblies.py` | walking sheet, isometric views, the 3 x 5 overviews, assembly pictures |
| `package.py` | one import-ready `_analysis` zip per tile (15), reference zips, the whole set in one zip (`package/`, git-ignored) |
| `recipes/`, `assemblies/`, `EVALUATION.md` | the recipes with previews, the output of `npm run check:tiles`, the app's own table (`npm run tiles:table`) |

```
python engine/tiles/v7/build.py            all fifteen; or  build.py G5 O2
python engine/tiles/v7/verify.py
python engine/tiles/make_fixtures.py C:/tmp/tiles7 lib/tiles/fixtures     then  npm run check:parity
npm run check:tiles
```
(Rhino's bundled Python 3.9 for the first three; the engine script itself is not changed.)
