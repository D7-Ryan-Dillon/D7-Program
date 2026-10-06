"""Calibration lab: what doorway does a soft door tunnel (no frame) really cut in the eroded envelope? One central room, one door through -x; prints the opening's width, height and area.
   python lab_door6.py"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "headless"))
from kit6 import *  # noqa: F401,F403,E402
from paths6 import *  # noqa: F401,F403,E402
from tile_report import decode  # noqa: E402
from run_headless import run_engine  # noqa: E402
from scipy import ndimage  # noqa: E402


def run(spread, k, depth, gravity, roomr=3.6, room_k=1.0):
    P = SoftPorts().add("x", 0.0, 10.0, D0, 1, spread=spread, k=k, depth=depth)
    cont, mask, _ = envelope((20, 20, 20), seed=5, pads=P.pads())
    s = lobed(10, 10, D0, 12.0, roomr, seed=2, n=2, k=room_k)
    rec = recipe5("lab_door6", cont, [floor_group("ground", [ground()])], tame(s, mask) + P.sources(), steps=170, gravity=gravity, seed=1, foam_seed=1)
    out = run_engine(recipe=json.dumps(rec))
    v, cell = decode(out)
    return v, mask, cell


def measure(v, mask, cell):
    face = v[0, :, :] & mask[0, :, :]
    lab, n = ndimage.label(face)
    if not n:
        return "no opening"
    sizes = ndimage.sum(face, lab, range(1, n + 1))
    i = 1 + int(np.argmax(sizes))
    ys, zs = np.where(lab == i)
    return "width %4.1f  z %.1f-%.1f  area %3.0f ft2   void %.0f%%" % ((ys.max() - ys.min() + 1) * cell, zs.min() * cell, (zs.max() + 1) * cell, sizes[i - 1] * cell * cell, 100.0 * v[mask].mean())


if __name__ == "__main__":
    print("spread    k depth grav | opening on the -x face")
    for spread in (3.6, 4.4):
        for k in (0.6, 1.0, 1.5):
            for grav in (0.5, 0.25):
                v, mask, cell = run(spread, k, 8.0, grav)
                print("%5.1f  %.1f  %4.1f  %.2f | %s" % (spread, k, 8.0, grav, measure(v, mask, cell)))
