# Grasshopper erosion engine

Rhino 8 GhPython script-components (`# r: numpy, scipy, scikit-image` on the first line) — paste each one into a script component in Grasshopper, they don't run standalone outside Rhino (but see `headless/`).

**Current set (engine 7):**

- `erosion_source.py` — one acetone application per component instance (inject/pour/spray/line), now with `plate_mode` (pool / stop / around / through) and `cut` (may it dissolve floor plates). Copy the component for each application, wire every copy's `src` output into the engine's `sources` input.
- `erosion_foam.py` — seeded foam density variation (noise, grain, webs, optional layers). Wire its `foam` output into the engine's `foam` input. (Floor plates follow these fields.)
- `erosion_plates.py` — **Floor Plates**: closed flat curves (a curve is the top of a slab, extruded down by `thickness`, any tilt) and/or closed geometry (used as modelled), with resistance, anchor foam, and support-branch settings. One component per group; wire every `plates` output into the engine's `plates` input.
- `erosion_engine_7.py` — the engine: 5f plus plates, any geometry as the foam (`geo`), a loop (`mass` out → `mass_in`), self-contained recipes, plates/branches/mask in the export. In a plain cube with no plates it gives exactly the same tile as 5f.

**Read next:** [`ENGINE_7_GUIDE.md`](ENGINE_7_GUIDE.md) (every input, what it does, how to wire it), [`RECIPES.md`](RECIPES.md) (recipe format; how a session can write recipes and preview them), [`examples/`](examples/) (eight hand-written recipes: three behaviour tests and three intentional spaces, each with a preview picture, plus the first two examples).

**Tiles:** [`tiles/`](tiles/) holds the 15 typology tiles (recipes, previews, measurements) and the scripts that build and check them.

**Older:** `erosion_engine_5f.py` (the previous engine, the reference the engine 7 golden tests compare against) is in git history (`git show HEAD:engine/erosion_engine_5f.py`).

**`headless/`** runs the engine outside Rhino (with Rhino's bundled Python and a stand-in for `Rhino.Geometry`), for testing and for previewing recipes: see the header of `headless/run_headless.py`. `headless/view_sections.py` draws colour-coded sections (foam / void / plates / branches) from an export folder.

These are actively edited alongside the web app itself, by both project members — not a frozen, separate artifact. The web app never executes these scripts; it only reads the `_analysis` export format they produce, documented in full in [`../docs/DATA_FORMAT.md`](../docs/DATA_FORMAT.md) (section 12 covers engine 7). When the export format changes, update that doc to match.
