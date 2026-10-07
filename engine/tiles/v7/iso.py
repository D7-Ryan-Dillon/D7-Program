"""An isometric cutaway of an exported V7 tile: the corner nearest the camera (south-west) is cut away above the ground slab so the rooms, ramps, floors and doorways
show; foam pink, floor plates blue, branches orange; outside the container nothing is drawn (the notch of an L stays empty).

  python iso.py <name>            reads C:/tmp/tiles7/<name>/<name>_analysis, writes engine/tiles/v7/recipes/previews/<name>_iso.png
  python iso.py --all             every tile in C:/tmp/tiles7
  options: --scale 6   --cut 10 (feet, the size of the cut-away corner; 0 = none)   --view sw|se|ne|nw
           --root C:/tmp/tiles7_asm --out <folder>   draw ASSEMBLIES written by scripts/check-tiles.ts (a voxel box with an owner.i16 per cell: each piece gets its own colour)

A plain painter's algorithm over the voxel grid (no GPU, no three.js), so it runs anywhere Python and Pillow do.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = "C:/tmp/tiles7"
OUT = os.path.join(HERE, "recipes", "previews")
FOAM, PLATE, STRUT = (236, 170, 205), (70, 128, 224), (240, 150, 40)
BG = (24, 24, 24)


def load(name, root=None):
    base = os.path.join(root or TMP, name)
    ana = os.path.join(base, [d for d in os.listdir(base) if d.endswith("_analysis")][0])
    tile = json.load(open(os.path.join(ana, "tile.json"), encoding="utf-8"))
    shape = tuple(tile["grid"])

    def rd(n, dflt):
        p = os.path.join(ana, "voxels", n)
        return np.fromfile(p, dtype=np.uint8).reshape(shape) > 0 if os.path.exists(p) else dflt
    z = np.zeros(shape, bool)
    void = rd("void.u8", z)
    plates = rd("plates.u8", z)
    struts = rd("struts.u8", z)
    mask = rd("mask.u8", np.ones(shape, bool))
    op = os.path.join(ana, "voxels", "owner.i16")
    owner = np.fromfile(op, dtype=np.int16).reshape(shape) if os.path.exists(op) else None
    return tile, void, plates, struts, mask, owner


def shade(c, k):
    return tuple(min(255, int(v * k)) for v in c)


PIECE = [(236, 170, 205), (219, 150, 80), (150, 190, 215), (170, 205, 130), (200, 160, 220), (240, 200, 120), (130, 200, 190), (225, 130, 150)]


def render(name, scale=6, cut_ft=10.0, view="sw", label=True, root=None):
    tile, void, plates, struts, mask, owner = load(name, root)
    cell = float(tile["cell_ft"])
    nx, ny, nz = void.shape
    foam = mask & ~void
    kind = np.zeros(void.shape, np.uint8)       # 0 empty, 1 foam, 2 plate, 3 strut
    kind[foam] = 1
    # a floor plate is drawn as a floor only where it meets a room (its top, its free edge); buried in foam it is foam: the plates are retained foam, not a different material
    from scipy import ndimage
    near_void = ndimage.binary_dilation(void & mask, iterations=1)
    kind[plates & mask & near_void] = 2
    kind[struts & mask] = 3
    # turn the grid so the camera is always at the south-west of what is drawn
    turns = {"sw": 0, "se": 1, "ne": 2, "nw": 3}[view]
    kind = np.rot90(kind, turns, axes=(0, 1))
    own = np.rot90(owner, turns, axes=(0, 1)) if owner is not None else None
    nx, ny, nz = kind.shape
    c = int(round(cut_ft / cell))
    if c > 0:
        kind[:c, :c, 2:] = 0
        if own is not None:
            own = own.copy()
    solid = kind > 0
    pad = np.zeros((nx + 2, ny + 2, nz + 2), bool)
    pad[1:-1, 1:-1, 1:-1] = solid
    top = solid & ~pad[1:-1, 1:-1, 2:]          # nothing above
    west = solid & ~pad[:-2, 1:-1, 1:-1]        # nothing at x-1 (faces -x)
    south = solid & ~pad[1:-1, :-2, 1:-1]       # nothing at y-1 (faces -y)
    s = float(scale)
    cx, cy = 0.866 * s, 0.5 * s
    W = int((nx + ny) * cx + 30)
    H = int(((nx + ny) * cy + nz * s) + 50 + (24 if label else 0))
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    ox = ny * cx + 15
    oy = H - 20

    def P(i, j, k):
        return (ox + (i - j) * cx, oy - (k * s + (i + j) * cy))
    idx = np.argwhere(top | west | south)
    # back to front: far (large i + j), then low
    order = np.lexsort((idx[:, 2], -(idx[:, 0] + idx[:, 1])))
    for n in order:
        i, j, k = (int(v) for v in idx[n])
        kk = int(kind[i, j, k])
        col = PLATE if kk == 2 else STRUT if kk == 3 else (PIECE[int(own[i, j, k]) % len(PIECE)] if own is not None and own[i, j, k] >= 0 else FOAM)
        if west[i, j, k]:
            d.polygon([P(i, j, k), P(i, j + 1, k), P(i, j + 1, k + 1), P(i, j, k + 1)], fill=shade(col, 0.78))
        if south[i, j, k]:
            d.polygon([P(i, j, k), P(i + 1, j, k), P(i + 1, j, k + 1), P(i, j, k + 1)], fill=shade(col, 0.60))
        if top[i, j, k]:
            d.polygon([P(i, j, k + 1), P(i + 1, j, k + 1), P(i + 1, j + 1, k + 1), P(i, j + 1, k + 1)], fill=shade(col, 1.0))
    if label:
        try:
            f = ImageFont.truetype("arial.ttf", 13)
        except OSError:
            f = ImageFont.load_default()
        d.text((8, 6), name, fill=(235, 235, 235), font=f)
    return img


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {a.split("=")[0]: a.split("=")[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
    root = opts.get("--root") or TMP
    out = opts.get("--out") or OUT
    names = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)) and not d.startswith("_")) if "--all" in sys.argv else args
    os.makedirs(out, exist_ok=True)
    for n in names:
        img = render(n, scale=float(opts.get("--scale", 6)), cut_ft=float(opts.get("--cut", 10)), view=opts.get("--view", "sw"), root=root)
        p = os.path.join(out, n + ("_iso.png" if not opts.get("--root") else ".png"))
        img.save(p)
        print("wrote", p)


if __name__ == "__main__":
    main()
