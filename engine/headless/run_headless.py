"""Run the erosion engine outside Rhino, for testing and for previewing recipes.

Needs Python 3.9+ with numpy, scipy and scikit-image. Rhino 8 ships one with all three:
  set PYTHONPATH=%USERPROFILE%\\.rhinocode\\py39-rh8\\site-envs\\default-XXXX   (the folder that holds numpy/scipy/skimage)
  %USERPROFILE%\\.rhinocode\\py39-rh8\\python.exe engine\\headless\\run_headless.py recipe.json [--export DIR] [--frame N]

What it does: executes erosion_engine_7.py exactly as Grasshopper would (the script's inputs are plain variables), with a
tiny stand-in for Rhino.Geometry (fake_rhino.py). Prints the engine's log. With --export it writes the same two folders
(<name>_analysis, <name>_reference) as the Export button (the .3dm is skipped: there is no real Rhino).

From Python:  from run_headless import run_engine;  out = run_engine(recipe=open('recipe.json').read())
`out` holds every output of the component (log, recipe_text, mass, tile_data, ...); out['void_bool'] style data can be read
from out['tile_data'] (void_bits, faces)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fake_rhino  # noqa: E402

ENGINE = os.path.join(HERE, "..", "erosion_engine_7.py")


def run_engine(engine_path=ENGINE, **inputs):
    fake_rhino.install()
    src = open(engine_path, encoding="utf-8").read()
    g = {"__name__": "__grasshopper__"}
    g.update(inputs)
    exec(compile(src, engine_path, "exec"), g)
    return g


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("recipe", help="path of a recipe.json")
    ap.add_argument("--export", default=None, help="folder to export into")
    ap.add_argument("--frame", type=int, default=None)
    ap.add_argument("--name", default=None)
    a = ap.parse_args()
    kw = dict(recipe=a.recipe)
    if a.frame is not None:
        kw["frame"] = a.frame
    if a.export:
        kw.update(export=True, export_dir=a.export)
    if a.name:
        kw["tile_name"] = a.name
    out = run_engine(**kw)
    print(out["log"])
    print(out["export_log"])
