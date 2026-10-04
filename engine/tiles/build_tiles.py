"""Build the tile recipes, run them headless and report.

  python build_tiles.py                 all tiles that are defined
  python build_tiles.py G1 O3 ...       only these
  options: --no-run (write recipes only)

Writes engine/tiles/recipes/<name>.recipe.json (with expect.tile_id once run) and recipes/previews/<name>.png
(foam pink, void dark, plates blue, support branches orange). Run with Rhino's bundled Python (see headless/run_headless.py).
"""
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "headless"))
from kit import *  # noqa: F401,F403,E402
import kit as L  # noqa: E402
import tile_defs  # noqa: E402
from tile_report import run_recipe, summarize  # noqa: E402
import view_sections  # noqa: E402
from PIL import Image  # noqa: E402

OUT = os.path.join(HERE, "recipes")
TMP = "C:/tmp/tiles"


def preview(analysis, png, tile_ft):
    parts = []
    for axis, at in (("y", None), ("x", None), ("z", "4,8,13,17")):
        p = os.path.join(TMP, "_%s.png" % axis)
        kw = dict(axis=axis, n=4, scale=7)
        if at:
            kw["at"] = at.split(",")
        view_sections.render(analysis, p, **kw)
        parts.append(Image.open(p))
    W = max(i.width for i in parts)
    H = sum(i.height for i in parts)
    sheet = Image.new("RGB", (W, H), (70, 70, 70))
    y = 0
    for i in parts:
        sheet.paste(i, (0, y))
        y += i.height
    sheet.save(png)


def build(key, run=True):
    spec = tile_defs.TILES[key]
    rec = spec()
    name = rec["name"]
    if len(rec["sources"]) > 24:
        print("!! %s has %d sources; the engine uses only the first 24" % (name, len(rec["sources"])))
    os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)
    path = os.path.join(OUT, name + ".recipe.json")
    txt = L.dumps_recipe(rec)
    open(path, "w", encoding="utf-8").write(txt)
    if len(txt) > 28000:
        print("!! %s is %d characters: a Grasshopper panel cuts a pasted recipe at about 32,000. Use field plates (shell, ground_field), not meshes." % (name, len(txt)))
    if not run:
        return name, None
    shutil.rmtree(os.path.join(TMP, name), ignore_errors=True)
    out = run_recipe(path, export=True, export_dir=os.path.join(TMP, name))
    txt2 = re.sub(r',\s*"expect":\s*\{[^}]*\}', "", txt.rstrip().rstrip("}")).rstrip() + "\n}\n"
    tid = json.loads(out["recipe_text"])["expect"]["tile_id"]
    txt2 = re.sub(r'("frame":\s*null)', r'\1,\n  "expect": {"tile_id": "%s"}' % tid, txt2, count=1)
    open(path, "w", encoding="utf-8").write(txt2)
    ana = [d for d in os.listdir(os.path.join(TMP, name)) if d.endswith("_analysis")][0]
    ana = os.path.join(TMP, name, ana)
    preview(ana, os.path.join(OUT, "previews", name + ".png"), rec["sim"]["tile_w"])
    report, m, ps = summarize(name, out, "  tile id %s" % tid)
    return name, (report, m, ps)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run = "--no-run" not in sys.argv
    keys = args or list(tile_defs.TILES)
    os.makedirs(TMP, exist_ok=True)
    for k in keys:
        if os.path.isdir(os.path.join(TMP, "x")):
            pass
        n, res = build(k, run)
        if res:
            print(res[0])
            print()
