# V7: the first set (V3), kept, with small changes so it walks and joins

Fifteen engine-7 recipes, one per typology, named `<category>_<n>_<typology>_v7`. Each is the V3 recipe (`../tile_defs.py`) with the same seeds, edited by a few numbers in `defs7.py` (what each tile changed: `docs/TILE_SET_V7.md`). O1 is unchanged and has V3's tile id.

| File | What it is |
|---|---|
| `defs7.py`, `defs.py` | one function per tile (the docstring says what V7 changed) and `TILES`; `lport` is a low port that reaches the ground floor |
| `build.py [G1 O3 ...]` | writes the recipe, runs the real engine headless, exports to `C:/tmp/tiles7/<name>/`, draws the section sheet |
| `verify.py` | rebuilds each recipe from the file alone: `RECIPE CHECK: OK`, at most 24 sources, metadata |
| `view4.py`, `iso.py`, `overview.py [--exterior]`, `render_assemblies.py` | walking sheet, isometric views, the 3 x 5 overviews, assembly pictures |
| `package.py` | one import-ready `_analysis` zip per tile (15), reference zips, the whole set in one zip (`package/`, git-ignored) |
| `recipes/`, `assemblies/`, `EVALUATION.md` | the recipes with previews, the output of `npm run check:v7`, the app's own table (`TILESET=v7 npx tsx scripts/v4/table.ts`) |

```
python engine/tiles/v7/build.py            all fifteen; or  build.py G5 O2
python engine/tiles/v7/verify.py
python engine/tiles/make_fixtures.py C:/tmp/tiles7 lib/tiles/fixtures-v7     then  npm run check:parity
npm run check:v7
```
(Rhino's bundled Python 3.9 for the first three; the engine script itself is not changed.)
