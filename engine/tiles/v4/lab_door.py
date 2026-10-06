"""Calibration lab: what doorway does a door tunnel really cut? A tile with a ground slab and a hall inside (so the door has somewhere to go), and one door through the -x face;
prints the opening's width, height, the height of the floor at the face and how far in the floor is clear, for a range of spreads, doses and depths.   python lab_door.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "headless"))
from kit4 import *  # noqa: F401,F403,E402
from tile_report import decode  # noqa: E402
from run_headless import run_engine  # noqa: E402


def run(spread, k, depth, past):
    plates = [plate_group("ground", [rect_slab(0, 0, 20, 20, D0)], thickness=1.0, resistance=3.0, auto_support=False)]
    zc = D0 + 0.85 * spread + 0.05
    hall = [pod(10.0, 10.0, D0, 10.0, 3.6)]
    door = src_line([(depth, 10.0, zc), (-past, 10.0, zc)], dose_for(spread, depth + past, k), spread, "pool", False)
    rec = recipe4("lab_door", box_container((20, 20, 20)), plates, hall + [door], steps=170, gravity=0.5, seed=1, foam_seed=1)
    out = run_engine(recipe=json.dumps(rec))
    v, cell = decode(out)
    return v, cell


def measure(v, cell):
    face = v[0, :, :]                       # x = 0 plane: [y][z]
    cols = np.where(face[:, int(1.5 / cell):int(5 / cell)].any(axis=1))[0]
    if not len(cols):
        return "no opening"
    w = (cols.max() - cols.min() + 1) * cell
    zs = np.where(face.any(axis=0))[0]
    floor_at_face = zs.min() * cell
    # how far in is the floor row (z = 1.0..1.5) clear along the centre line
    row = v[:, int(10 / cell), int(1.0 / cell)]
    clear = int(np.argmax(~row)) if (~row).any() else len(row)
    return "width %4.1f  z %.1f-%.1f  floor at face %.1f  floor row clear for %.1f ft" % (w, zs.min() * cell, (zs.max() + 1) * cell, floor_at_face, clear * cell)


if __name__ == "__main__":
    print("spread   k  depth past | opening")
    for spread in (3.8, 4.2, 4.6):
        for k in (1.0, 1.6, 2.4):
            for depth, past in ((6.0, 0.8), (7.0, 2.0)):
                v, cell = run(spread, k, depth, past)
                print("%5.1f  %.1f  %4.1f  %4.1f | %s" % (spread, k, depth, past, measure(v, cell)))
