"""Build the V4 tiles: write each recipe, run the real engine headless, export the `_analysis` / `_reference` folders, draw previews.

  python build.py                  every tile defined in defs.py
  python build.py G1 O3 ...        only these
  options: --no-run (write recipes only)   --fast (steps stay as written; the export and previews are still made)

Writes engine/tiles/v4/recipes/<name>.recipe.json (with expect.tile_id once run) and previews/<name>.png (foam pink, void dark, plates blue, branches orange,
outside the container grey). Run with Rhino's bundled Python 3.9 (see engine/headless/run_headless.py):
  set PYTHONPATH=C:\\Users\\<you>\\.rhinocode\\py39-rh8\\site-envs\\default-XXXX
  <Rhino python>\\python.exe engine\\tiles\\v4\\build.py G1
The export goes to a SHORT path (the Windows 260 character limit): C:/tmp/tiles4/<name>/.
"""
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "headless"))
import kit as L  # noqa: E402
import defs  # noqa: E402
from tile_report import run_recipe  # noqa: E402
import view_sections  # noqa: E402
from PIL import Image  # noqa: E402

OUT = os.path.join(HERE, "recipes")
TMP = "C:/tmp/tiles4"


def preview(analysis, png, levels=(1.0, 11.0, 21.0, 31.0)):
    parts = []
    tile = json.load(open(os.path.join(analysis, "tile.json")))
    sx, sy, sz = [g * tile["cell_ft"] for g in tile["grid"]]
    tall = sz > 21
    for axis, at in (("y", None), ("x", None)):
        p = os.path.join(TMP, "_%s.png" % axis)
        view_sections.render(analysis, p, axis=axis, n=4, scale=6 if not tall else 4)
        parts.append(Image.open(p))
    zs = ["%g" % (z + 4.0) for z in levels if z + 4.0 < sz]
    p = os.path.join(TMP, "_z.png")
    view_sections.render(analysis, p, axis="z", scale=6 if not tall else 4, at=zs)
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
    rec = defs.TILES[key]()
    name = rec["name"]
    if len(rec["sources"]) > 24:
        print("!! %s has %d sources; the engine uses only the first 24" % (name, len(rec["sources"])))
    os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)
    path = os.path.join(OUT, name + ".recipe.json")
    txt = L.dumps_recipe(rec)
    open(path, "w", encoding="utf-8").write(txt)
    if len(txt) > 28000:
        print("!! %s is %d characters: a Grasshopper panel cuts a pasted recipe at about 32,000." % (name, len(txt)))
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
    preview(ana, os.path.join(OUT, "previews", name + ".png"))
    log = out["log"]
    keep = [l for l in log.splitlines() if re.match(r"^(VOID|PLATE|NOTE|SOURCE|GRID|RECIPE)", l.strip())]
    return name, tid, "\n".join(keep[:40])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run = "--no-run" not in sys.argv
    keys = args or list(defs.TILES)
    os.makedirs(TMP, exist_ok=True)
    for k in keys:
        r = build(k, run)
        print(r[0], r[1] if len(r) > 1 else "")
        if len(r) > 2:
            print(r[2])
        print()
