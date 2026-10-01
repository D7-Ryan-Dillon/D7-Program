# Grasshopper erosion engine

Rhino 8 GhPython script-components (`# r: numpy, scipy, scikit-image` on the first line) — paste each one into a GhPython component in Grasshopper, they don't run standalone outside Rhino.

- `erosion_source.py` — one acetone application per component instance (inject/pour/spray/line). Copy the component for each application, wire every copy's `src` output into the engine's `sources` input.
- `erosion_foam.py` — seeded foam density variation (noise, grain, webs, optional layers). Wire its `foam` output into the engine's `foam` input.
- `erosion_engine_5f.py` — the engine itself: voxel continuous-state cellular automaton, 0.5 ft cells, 40×40×40 grid, marching-cubes meshing, recipes, cleanup, weld, and the one-click `_analysis`/`_reference` export.

These are actively edited alongside the web app itself, by both project members — not a frozen, separate artifact. The web app never executes these scripts; it only reads the `_analysis` export format they produce, documented in full in [`../docs/DATA_FORMAT.md`](../docs/DATA_FORMAT.md). When the export format changes, update that doc to match.
