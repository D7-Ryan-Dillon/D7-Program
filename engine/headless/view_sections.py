"""Draw colour-coded sections from an exported `_analysis` folder (no Rhino needed).

  python view_sections.py <analysis_folder> <out.png> [axis=y] [n=6] [scale=10] [at=9.5,11,14]

`n` evenly spaced slices, or `at=` explicit positions in feet from the tile's low corner along the looking axis
(use it to cut exactly through a floor plate: a plate with its top at z = 10 and thickness 1 sits at 9..10, so at=9.5).

Foam = pink, void = near black, floor plates = blue, support branches = orange, outside the container = grey.
`axis` is the direction you look along: y gives elevations (x across, z up), z gives plans, x gives side elevations.
Needs Pillow + numpy (Rhino 8's bundled Python has both)."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

FOAM, VOID, PLATE, STRUT, OUT = (236, 170, 205), (20, 20, 32), (60, 120, 220), (240, 150, 40), (150, 150, 150)


def _load(folder, name, shape, default=None):
    p = os.path.join(folder, "voxels", name)
    if not os.path.exists(p):
        return default
    return np.fromfile(p, dtype=np.uint8).reshape(shape)


def render(folder, out_png, axis="y", n=6, scale=10, at=None):
    tile = json.load(open(os.path.join(folder, "tile.json"), encoding="utf-8"))
    shape = tuple(tile["grid"])
    cell = float(tile["cell_ft"])
    void = _load(folder, "void.u8", shape) > 0
    mask = _load(folder, "mask.u8", shape, np.ones(shape, np.uint8)) > 0
    plates = _load(folder, "plates.u8", shape, np.zeros(shape, np.uint8)) > 0
    struts = _load(folder, "struts.u8", shape, np.zeros(shape, np.uint8)) > 0
    ax = "xyz".index(axis)
    if at:                                # explicit positions in tile feet (from the tile's low corner)
        picks = np.array([min(max(int(float(a) / cell), 0), shape[ax] - 1) for a in at])
    else:
        picks = np.linspace(0, shape[ax] - 1, n + 2)[1:-1].astype(int)
    tiles = []
    for idx in picks:
        sl = [slice(None)] * 3
        sl[ax] = int(idx)
        sl = tuple(sl)
        v, m, p, s = void[sl], mask[sl], plates[sl], struts[sl]
        img = np.zeros(v.shape + (3,), np.uint8)
        img[:] = FOAM
        img[v] = VOID
        img[p] = PLATE
        img[s & ~p] = STRUT
        img[~m] = OUT
        if ax == 2:                       # plan: x across, y up
            img = img.transpose(1, 0, 2)[::-1]
        else:                             # elevation: horizontal across, z up
            img = img.transpose(1, 0, 2)[::-1]
        im = Image.fromarray(img).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST)
        d = ImageDraw.Draw(im)
        d.text((4, 2), "%s = %.1f ft" % (axis, (idx + 0.5) * cell), fill=(255, 255, 255))
        d.rectangle([0, 0, im.width - 1, im.height - 1], outline=(60, 60, 60))
        tiles.append(im)
    cols = 2 if tiles[0].width > 400 else 3
    rows = (len(tiles) + cols - 1) // cols
    W, H = tiles[0].size
    sheet = Image.new("RGB", (cols * (W + 6) + 6, rows * (H + 6) + 6 + 18), (70, 70, 70))
    ImageDraw.Draw(sheet).text((6, 3), "%s  | pink foam, dark void, BLUE floor plates, ORANGE branches, grey outside" % tile.get("name", ""), fill=(255, 255, 255))
    for n_, im in enumerate(tiles):
        sheet.paste(im, (6 + (n_ % cols) * (W + 6), 24 + (n_ // cols) * (H + 6)))
    sheet.save(out_png)


if __name__ == "__main__":
    a = sys.argv[1:]
    kw = dict(p.split("=", 1) for p in a[2:])
    render(a[0], a[1], kw.get("axis", "y"), int(kw.get("n", 6)), int(kw.get("scale", 10)), kw["at"].split(",") if "at" in kw else None)
    print("wrote", a[1])
