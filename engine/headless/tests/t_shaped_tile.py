"""A tile whose container is NOT a cube (an L: a 20 x 20 ft footprint with a 10 x 10 ft notch) must export the data Arrange needs to nest
it: voxels/mask.u8 (1 inside the container, 0 outside), void.u8, plates.u8 and struts.u8 on the same grid, with nothing placed outside the container.
Also writes the exported voxels to <out>/shaped_L/ (gzip) so the app's own check (scripts/check-engine-shaped.ts) can read the real engine output.
Usage: python t_shaped_tile.py <repo> [<out folder>]"""
import json, sys, os, gzip, base64, tempfile
import numpy as np
REPO = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, "lib", "tiles", "fixtures-engine")
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
import fake_rhino
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")


def src(pt, mode="inject", dose=1200, spread=4, plate_mode="pool", dur=0):
    return json.dumps({"v": 1, "mode": mode, "kind": "pt", "pt": pt, "dose": dose, "spread": spread, "start": 0, "duration": dur,
                       "dir": None, "plate_mode": plate_mode, "cut": False})


def check(label, ok, extra=""):
    print("%-72s %s %s" % (label, "PASS" if ok else "FAIL", extra))
    return ok


allok = True
fake_rhino.install()
armx = fake_rhino.box_mesh_obj((0.0, 0.0, 0.0), (20.0, 10.0, 10.0))
army = fake_rhino.box_mesh_obj((0.0, 10.0, 0.0), (10.0, 20.0, 10.0))
floor = json.dumps({"v": 1, "kind": "plates", "name": "floor", "thickness": 1.0, "resistance": 2.0, "min_support": 6.0,
                    "shapes": [{"type": "poly", "pts": [[0, 0, 1], [20, 0, 1], [20, 10, 1], [10, 10, 1], [10, 20, 1], [0, 20, 1]]}]})
sources = [src([14, 5, 4.5], dose=900), src([5, 14, 4.5], dose=900), src([5, 5, 4.5], dose=500)]
export_dir = tempfile.mkdtemp(prefix="shL")
out = run_engine(E7, geo=[armx, army], sources=sources, plates=[floor], cell=0.5, steps=110, gravity=0.6, n_frames=3, seed=5, smooth=0.8,
                 tile_name="shapedL", foam=json.dumps({"v": 1, "noise": 0.5, "scale": 4, "grain": 0.3, "seed": 3, "web": 0.0}),
                 export=True, export_dir=export_dir)
log = out["log"]
print([l for l in log.splitlines() if l.startswith(("GRID", "TILE", "PLATES"))])
allok &= check("the grid is the L's bounding box: 40 x 40 x 20 cells", "GRID: 40 x 40 x 20" in log)

root = None
for d, dirs, files in os.walk(export_dir):
    if "mask.u8" in files:
        root = d
allok &= check("voxels/mask.u8 is exported for a non-cube container", root is not None, root or "")
if root:
    rd = lambda f: np.fromfile(os.path.join(root, f), dtype=np.uint8) if os.path.exists(os.path.join(root, f)) else None
    mask, void, plates, struts = rd("mask.u8"), rd("void.u8"), rd("plates.u8"), rd("struts.u8")
    n = 40 * 40 * 20
    allok &= check("mask, void and plates share one grid", mask.size == n and void.size == n and (plates is None or plates.size == n))
    m = mask.reshape(40, 40, 20).astype(bool)
    notch = np.zeros((40, 40, 20), bool)
    notch[20:, 20:, :] = True
    allok &= check("mask is 1 inside the L and 0 in the notch", m[~notch].all() and not m[notch].any(), "inside cells %d (L = %d)" % (m.sum(), (~notch).sum()))
    v = void.reshape(40, 40, 20).astype(bool)
    allok &= check("no void or foam is placed in the notch (void = 0 there)", not v[notch].any(), "void cells in the notch: %d" % int(v[notch].sum()))
    allok &= check("void was carved inside the container", v.sum() > 500, "%d void cells" % int(v.sum()))
    if plates is not None:
        p = plates.reshape(40, 40, 20) > 0
        allok &= check("plates are foam in void.u8 and inside the container", not (p & v).any() and not (p & notch).any(), "%d plate cells" % int(p.sum()))
    if struts is not None:
        s = struts.reshape(40, 40, 20) > 0
        allok &= check("support branches lie inside the container, as foam", not (s & v).any() and not (s & notch).any())
    td = json.load(open(os.path.join(os.path.dirname(root), "tile.json"))) if os.path.exists(os.path.join(os.path.dirname(root), "tile.json")) else None
    if td:
        allok &= check("tile.json says where the mask is", (td.get("container") or {}).get("mask_file") == "voxels/mask.u8", str(td.get("container")))
    os.makedirs(os.path.join(OUT, "shaped_L"), exist_ok=True)
    for name, arr in (("void", void), ("mask", mask), ("plates", plates), ("struts", struts)):
        if arr is not None:
            with gzip.open(os.path.join(OUT, "shaped_L", name + ".u8.gz"), "wb") as f:
                f.write(arr.tobytes())
    json.dump({"grid": [40, 40, 20], "cell_ft": 0.5}, open(os.path.join(OUT, "shaped_L", "meta.json"), "w"))
    # the engine's own spaces analysis, for the tile record
    sp = os.path.join(os.path.dirname(root), "data", "spaces.json")
    if os.path.exists(sp):
        open(os.path.join(OUT, "shaped_L", "spaces.json"), "w").write(open(sp).read())

# rebuild from the recipe alone: the container survives as triangles, the mask comes out the same
B = run_engine(E7, recipe=out["recipe_text"])
allok &= check("the recipe alone rebuilds the shaped tile (RECIPE CHECK: OK)", "RECIPE CHECK: OK" in B["log"])
print("ALL PASS" if allok else "SOME FAILED")
sys.exit(0 if allok else 1)
