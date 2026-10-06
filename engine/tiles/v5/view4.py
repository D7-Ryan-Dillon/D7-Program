"""Draw an exported V5 tile with the places a person can walk drawn over it (from scripts/eval-tile.ts, which writes <export>/eval/standing.u8 + zone.i32).

  python view4.py <name>              C:/tmp/tiles5/<name>/<name>_analysis  ->  engine/tiles/v4/recipes/previews/<name>_walk.png
  python view4.py <name> --scale 8

Pink foam, dark void, BLUE plates, ORANGE branches, grey outside the container. Walkable floors: GREEN = the tile's main floor (the biggest zone), CYAN = another
real floor, YELLOW = a pocket too small to count. The sheet: elevations (y = 4, 10, 16 and x = 4, 10, 16), then plans one foot above each floor datum
(1, 11, 21, 31 ft) so the standing places and the doorways read at a glance.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = "C:/tmp/tiles5"
FOAM, VOID, PLATE, STRUT, OUT = (236, 170, 205), (20, 20, 32), (60, 120, 220), (240, 150, 40), (150, 150, 150)
MAIN, REAL, POCKET = (60, 220, 110), (80, 220, 230), (240, 220, 60)


def load(name):
    base = os.path.join(TMP, name)
    ana = os.path.join(base, [d for d in os.listdir(base) if d.endswith("_analysis")][0])
    tile = json.load(open(os.path.join(ana, "tile.json"), encoding="utf-8"))
    shape = tuple(tile["grid"])
    cell = float(tile["cell_ft"])

    def rd(n, dflt=None):
        p = os.path.join(ana, "voxels", n)
        return np.fromfile(p, dtype=np.uint8).reshape(shape) if os.path.exists(p) else dflt
    d = dict(shape=shape, cell=cell, void=rd("void.u8") > 0, plates=rd("plates.u8", np.zeros(shape, np.uint8)) > 0,
             struts=rd("struts.u8", np.zeros(shape, np.uint8)) > 0, mask=rd("mask.u8", np.ones(shape, np.uint8)) > 0)
    ev = os.path.join(base, "eval")
    if os.path.exists(os.path.join(ev, "standing.u8")):
        d["stand"] = np.fromfile(os.path.join(ev, "standing.u8"), dtype=np.uint8).reshape(shape) > 0
        d["zone"] = np.fromfile(os.path.join(ev, "zone.i32"), dtype=np.int32).reshape(shape)
        z = json.load(open(os.path.join(ev, "zones.json")))
        d["main"] = z["main"]
        d["sig"] = {q["id"]: q["significant"] for q in z["zones"]}
    return d


def colour(d, sl):
    v, m, p, s = d["void"][sl], d["mask"][sl], d["plates"][sl], d["struts"][sl]
    img = np.zeros(v.shape + (3,), np.uint8)
    img[:] = FOAM
    img[v] = VOID
    img[p] = PLATE
    img[s & ~p] = STRUT
    img[~m] = OUT
    if "stand" in d:
        st, zn = d["stand"][sl], d["zone"][sl]
        for zid in np.unique(zn[st]):
            col = MAIN if zid == d["main"] else (REAL if d["sig"].get(int(zid), False) else POCKET)
            img[st & (zn == zid)] = col
    return img


def tile_img(d, axis, idx, scale, label):
    ax = "xyz".index(axis)
    sl = [slice(None)] * 3
    sl[ax] = int(idx)
    img = colour(d, tuple(sl))
    img = img.transpose(1, 0, 2)[::-1]
    im = Image.fromarray(img).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST)
    dr = ImageDraw.Draw(im)
    dr.text((4, 2), label, fill=(255, 255, 255))
    dr.rectangle([0, 0, im.width - 1, im.height - 1], outline=(60, 60, 60))
    return im


def sheet(name, scale=6):
    d = load(name)
    nx, ny, nz = d["shape"]
    c = d["cell"]
    sizes = (nx * c, ny * c, nz * c)

    def at(ft, n):
        return min(max(int(ft / c), 0), n - 1)
    rows = []
    rows.append([tile_img(d, "y", at(f * sizes[1], ny), scale, "y = %.1f ft" % (f * sizes[1])) for f in (0.2, 0.5, 0.8)])
    rows.append([tile_img(d, "x", at(f * sizes[0], nx), scale, "x = %.1f ft" % (f * sizes[0])) for f in (0.2, 0.5, 0.8)])
    plans = []
    for k in range(int(sizes[2] // 10)):
        z = 10 * k + 1.1
        plans.append(tile_img(d, "z", at(z, nz), scale, "plan z = %.1f ft (standing places on floor %d)" % (z, k)))
    for i in range(0, len(plans), 3):
        rows.append(plans[i:i + 3])
    W = max(sum(i.width + 6 for i in r) for r in rows) + 6
    H = sum(max(i.height for i in r) + 6 for r in rows) + 24
    out = Image.new("RGB", (W, H), (70, 70, 70))
    ImageDraw.Draw(out).text((6, 4), "%s | green = main walkable floor, cyan = another floor, yellow = pocket; blue plates, pink foam" % name, fill=(255, 255, 255))
    y = 22
    for r in rows:
        x = 6
        for i in r:
            out.paste(i, (x, y))
            x += i.width + 6
        y += max(i.height for i in r) + 6
    return out


if __name__ == "__main__":
    name = sys.argv[1]
    sc = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 6
    out = os.path.join(HERE, "recipes", "previews", name + "_walk.png")
    sheet(name, sc).save(out)
    print("wrote", out)
