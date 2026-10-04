"""Cross-tile interlock matrix for the tile set: for every pair of tiles, the best joint score over all pairs of side faces, both
u-directions (a tile may be rotated by quarter turns or mirrored), using the app's joint rule (docs/DATA_FORMAT.md section 5).

  python compat_matrix.py            runs every recipe in recipes/ (cached in C:/tmp/tiles/cache) and prints the matrix
  python compat_matrix.py --fresh    ignore the cache

Only openings on the joint count (void on both sides = matched, void on one side only = dead). The score is None-like (shown as '.')
when neither tile has a usable opening there.
"""
import glob
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "headless"))
from tile_report import run_recipe, decode, compat, faces  # noqa: E402

CACHE = "C:/tmp/tiles/cache"


def load_all(fresh=False):
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    for p in sorted(glob.glob(os.path.join(HERE, "recipes", "*.recipe.json"))):
        name = os.path.basename(p).replace(".recipe.json", "")
        c = os.path.join(CACHE, name + ".npy")
        if not fresh and os.path.exists(c) and os.path.getmtime(c) > os.path.getmtime(p):
            out[name] = np.load(c)
        else:
            v, cell = decode(run_recipe(p))
            np.save(c, v)
            out[name] = v
    return out


def short(n):
    parts = n.split("_")
    return parts[0][0].upper() + parts[1]


if __name__ == "__main__":
    tiles = load_all("--fresh" in sys.argv)
    names = list(tiles)
    order = {"g": 0, "o": 1, "l": 2}
    names.sort(key=lambda n: (order[n[0]], n))
    labels = [short(n) for n in names]
    print("      " + " ".join("%4s" % l for l in labels))
    totals = []
    for a in names:
        row = []
        for b in names:
            va, vb = tiles[a], tiles[b]
            if va.shape != vb.shape:
                row.append(None)
                continue
            s, det = compat(va, vb)
            row.append(s)
        totals.append(row)
        print("%5s " % short(a) + " ".join("%4s" % ("." if s is None else int(round(s))) for s in row))
    arr = np.array([[(-1 if s is None else s) for s in r] for r in totals])
    n = len(names)
    off = ~np.eye(n, dtype=bool)
    print()
    print("pairs (ordered, different tiles) with score >= 90: %d of %d; >= 60: %d; >= 30: %d" % (
        int(((arr >= 90) & off).sum()), n * (n - 1), int(((arr >= 60) & off).sum()), int(((arr >= 30) & off).sum())))
    print()
    for a, row in zip(names, arr):
        others = [(labels[j], int(round(row[j]))) for j in range(n) if j != names.index(a)]
        best = sorted(others, key=lambda t: -t[1])[:4]
        print("%-46s partners >=60: %2d   best: %s" % (a, sum(1 for l, s in others if s >= 60), ", ".join("%s %d" % t for t in best)))
