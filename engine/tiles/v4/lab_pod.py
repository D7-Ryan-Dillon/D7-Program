"""Calibration lab: how big is the room a vertical pod (a line source from the floor up) really makes? One pod in the middle of a tile with a ground slab and a
slab at z = 10..11, sweeping the radius the pod is built for and the dose multiplier; prints the radius it actually clears at the floor, mid-height and under the ceiling, and the
volume. Run with Rhino's Python (see build.py).   python lab_pod.py [R ...]
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "headless"))
from kit4 import *  # noqa: F401,F403,E402
from tile_report import decode  # noqa: E402
from run_headless import run_engine  # noqa: E402
import json  # noqa: E402


def pod(cx, cy, z0, z1, R, k=1.0, plate_mode="pool"):
    spread = R / 0.85
    return src_line([(cx, cy, z0), (cx, cy, z1)], int(round(k * math.pi * R * R * (z1 - z0 + 1.3 * R))), spread, plate_mode, False)


def run(R, k, gravity=0.5, foam=None):
    plates = [plate_group("slabs", [rect_slab(0, 0, 20, 20, D0), rect_slab(0, 0, 20, 20, D1)], thickness=1.0, resistance=3.0, auto_support=False)]
    rec = recipe4("lab_pod", box_container((20, 20, 20)), plates, [pod(10, 10, D0 + 0.5, 9.5, R, k)], steps=170, gravity=gravity, seed=1, foam_seed=1)
    out = run_engine(recipe=json.dumps(rec))
    v, cell = decode(out)
    return v, cell


def radius_at(v, cell, z):
    k = int(z / cell)
    sl = v[:, :, k]
    return math.sqrt(float(sl.sum()) * cell * cell / math.pi)


if __name__ == "__main__":
    Rs = [float(a) for a in sys.argv[1:]] or [2.5, 3.5, 4.5]
    print("R_built  k   | r(z=1.5)  r(z=5)  r(z=9)  | volume ft3 | top z")
    for R in Rs:
        for k in (0.6, 0.9, 1.2):
            v, cell = run(R, k)
            zs = np.where(v.any(axis=(0, 1)))[0]
            print("%5.1f  %.1f  |  %5.1f   %5.1f   %5.1f  |  %7.0f  | %.1f" % (R, k, radius_at(v, cell, 1.5), radius_at(v, cell, 5.0), radius_at(v, cell, 9.0), float(v.sum()) * cell ** 3, (zs.max() + 1) * cell))
