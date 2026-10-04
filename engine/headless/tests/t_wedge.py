import json, sys, os
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
import fake_rhino
fake_rhino.install()
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")
# wedge: x 3..17, y 3..17, top z = 8 + 0.25x, thickness 1.5 (vertical)
V = []
for z_off in (-1.5, 0.0):
    for (x, y) in ((3, 3), (17, 3), (17, 17), (3, 17)):
        V.append([x, y, 8 + 0.25 * x + z_off])
F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
spec = json.dumps({"v": 1, "kind": "plates", "name": "wedge", "shapes": [{"type": "mesh", "v": V, "f": F}]})
src = json.dumps({"v": 1, "mode": "inject", "kind": "pt", "pt": [10, 10, 14], "dose": 2200, "spread": 5, "start": 0, "duration": 0, "dir": None, "plate_mode": "around", "cut": False})
out = run_engine(E7, tile_w=20.0, tile_h=20.0, cell=0.5, steps=100, gravity=0.7, n_frames=3, seed=5, smooth=0.8, sources=[src], plates=[spec], tile_name="w",
                 foam=json.dumps({"v": 1, "noise": 0.6, "scale": 4, "grain": 0.5, "seed": 2, "web": 0.3}))
Vm = np.array([[v.X, v.Y, v.Z] for v in out["plates_mesh"].Vertices.items])
z0 = 8 + 0.25 * Vm[:, 0]
band = (Vm[:, 2] > z0 - 0.45) & (Vm[:, 2] < z0 + 0.45) & (Vm[:, 0] > 4) & (Vm[:, 0] < 16) & (Vm[:, 1] > 4) & (Vm[:, 1] < 16)
print("wedge solid used as a plate: top-skin vertices %d, max deviation from the exact sloped plane %.5f ft" % (band.sum(), np.abs(Vm[band, 2] - z0[band]).max()))
print([l.strip()[:160] for l in out["log"].splitlines() if l.strip().startswith("PLATE 1")])
assert np.abs(Vm[band, 2] - z0[band]).max() < 1e-3, "wedge top is not an exact plane"
# a plate hanging outside the block is clipped with a note
big = json.dumps({"v": 1, "kind": "plates", "name": "wide", "thickness": 1.0, "shapes": [{"type": "poly", "pts": [[-5, 2, 9], [30, 2, 9], [30, 18, 9], [-5, 18, 9]]}]})
o2 = run_engine(E7, tile_w=20.0, tile_h=20.0, cell=1.0, steps=20, sources=[src], plates=[big], tile_name="w2")
print("oversize plate:", [l.strip()[:110] for l in o2["log"].splitlines() if l.strip().startswith("PLATE 1")])
