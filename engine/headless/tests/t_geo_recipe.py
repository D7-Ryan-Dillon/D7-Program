import json, sys, os, base64, tempfile
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
import fake_rhino
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")


def src(pt, mode="inject", dose=1200, spread=4, plate_mode="pool", cut=False, dur=0):
    return json.dumps({"v": 1, "mode": mode, "kind": "pt", "pt": pt, "dose": dose, "spread": spread, "start": 0, "duration": dur,
                       "dir": None, "plate_mode": plate_mode, "cut": cut})


def void_of(out):
    d = json.loads(out["tile_data"])
    n = int(np.prod(d["grid"]))
    bits = np.unpackbits(np.frombuffer(base64.b64decode(d["void_bits"]), dtype=np.uint8))[:n]
    return bits.reshape(d["grid"]).astype(bool)


def check(label, ok, extra=""):
    print("%-62s %s %s" % (label, "PASS" if ok else "FAIL", extra))
    return ok


allok = True
fake_rhino.install()
box = fake_rhino.box_mesh_obj((100.0, 200.0, 5.0), (120.0, 215.0, 23.0))     # 20 x 15 x 18 ft, far from the origin
plate = json.dumps({"v": 1, "kind": "plates", "name": "mezz", "thickness": 1.0, "resistance": 2.0, "min_support": 6.0,
                    "shapes": [{"type": "poly", "pts": [[104, 202, 12], [116, 202, 12], [116, 212, 12], [104, 212, 12]]}]})
common = dict(cell=0.5, steps=90, gravity=0.6, n_frames=3, seed=7, smooth=0.8, tile_name="geo1",
              foam=json.dumps({"v": 1, "noise": 0.5, "scale": 4, "grain": 0.4, "seed": 11, "web": 0.3}))

# ---- 1. geometry container, world coordinates, plates ----
A = run_engine(E7, geo=box, sources=[src([110, 207, 17], plate_mode="through", dose=1500), src([110, 207, 9], dose=1000)], plates=[plate], **common)
log = A["log"]
print([l for l in log.splitlines() if l.startswith(("GRID", "TILE", "PLATES"))])
allok &= check("grid is the geometry's bounding box (40 x 30 x 36 cells)", "GRID: 40 x 30 x 36" in log)
allok &= check("origin is the geometry's low corner (100, 200, 5)", "origin (100.00, 200.00, 5.00)" in log)
v = void_of(A)
allok &= check("some void formed, none at the far corners", v.sum() > 200 and not v[0, 0, :].any())
rec = json.loads(A["recipe_text"])
allok &= check("recipe holds the container as triangles", rec.get("container", {}).get("kind") == "mesh" and len(rec["container"]["f"]) == 12)
allok &= check("recipe holds the plates (points) and schema 2", rec["schema"] == "erosion-recipe/2" and rec["plates"][0]["shapes"][0]["pts"][0] == [104, 202, 12])

# ---- 2. rebuild from the recipe alone ----
B = run_engine(E7, recipe=A["recipe_text"])
allok &= check("recipe alone rebuilds the same tile (RECIPE CHECK: OK)", "RECIPE CHECK: OK" in B["log"], "(" + json.loads(B["recipe_text"])["expect"]["tile_id"] + ")")
allok &= check("... and the same voxels", np.array_equal(void_of(A), void_of(B)))
# stray live inputs must not leak into a recipe run
B2 = run_engine(E7, recipe=A["recipe_text"], geo=fake_rhino.box_mesh_obj((0, 0, 0), (5, 5, 5)), plates=[], sources=["junk"], tile_w=99.0)
allok &= check("a wired recipe ignores stray geo / plates / sources / tile_w", "RECIPE CHECK: OK" in B2["log"])

# ---- 3. a union of two boxes (L shape) ----
box2 = fake_rhino.box_mesh_obj((120.0, 200.0, 5.0), (130.0, 208.0, 15.0))
L = run_engine(E7, geo=[box, box2], sources=[src([110, 207, 14])], **{**common, "steps": 10})
nz_cells = [l for l in L["log"].splitlines() if l.startswith("TILE")][0]
print("   ", nz_cells)
allok &= check("two geometries are united (block = 20*15*18 + 10*8*10 = 6200 ft3)", "foam block 6200 ft3" in nz_cells)

# ---- 4. mass chain: pass 2 starts from pass 1 ----
P1 = run_engine(E7, geo=box, sources=[src([110, 207, 17], plate_mode="through", dose=1500)], plates=[plate], **common)
P2 = run_engine(E7, mass_in=P1["mass"], sources=[src([110, 207, 7], dose=1000)], **{**common, "foam": None})
v1, v2 = void_of(P1), void_of(P2)
allok &= check("pass 2 keeps everything pass 1 opened", bool((v1 & ~v2).sum() <= 0.02 * v1.sum()), "(lost %d of %d cells to smoothing)" % ((v1 & ~v2).sum(), v1.sum()))
allok &= check("pass 2 opened more", v2.sum() > v1.sum(), "(%d -> %d cells)" % (v1.sum(), v2.sum()))
allok &= check("pass 2 still has the plate (inherited)", "PLATE 1" in P2["log"] and P2["plates_mesh"] is not None)
allok &= check("new_void_mesh exists", P2["new_void_mesh"] is not None)
R2 = run_engine(E7, recipe=P2["recipe_text"])
allok &= check("pass-2 recipe alone rebuilds pass 2 (starting mass is inside it)", "RECIPE CHECK: OK" in R2["log"] and np.array_equal(v2, void_of(R2)))
r2 = json.loads(P2["recipe_text"])
allok &= check("pass-2 recipe has a start block", "start" in r2 and r2["start"]["schema"] == "erosion-mass/1")

# ---- 5. export folders ----
d = tempfile.mkdtemp()
X = run_engine(E7, geo=box, sources=[src([110, 207, 17], plate_mode="through", dose=1500)], plates=[plate], export=True, export_dir=d, **common)
print(X["export_log"].splitlines()[0])
ana = [x for x in os.listdir(d) if x.endswith("_analysis")][0]
refd = [x for x in os.listdir(d) if x.endswith("_reference")][0]
A_, R_ = os.path.join(d, ana), os.path.join(d, refd)
tj = json.load(open(os.path.join(A_, "tile.json")))
allok &= check("analysis: tile.json schema 4, origin, container, plates", tj["schema"] == "erosion-tile/4" and tj["origin_ft"] == [100.0, 200.0, 5.0] and tj["container"]["kind"] == "geometry" and tj["plates"][0]["name"] == "mezz")
allok &= check("analysis: plates.json, mask.u8, plates.u8, recipe.json present",
               all(os.path.exists(os.path.join(A_, *p)) for p in (("data", "plates.json"), ("voxels", "mask.u8"), ("voxels", "plates.u8"), ("recipe.json",))))
allok &= check("analysis: mask.u8 has one byte per cell", os.path.getsize(os.path.join(A_, "voxels", "mask.u8")) == 40 * 30 * 36)
mf = json.load(open(os.path.join(A_, "manifest.json")))
roles = {f["role"] for f in mf["files"]}
allok &= check("manifest lists the new files", {"data.plates", "voxels.mask", "voxels.plates", "recipe"} <= roles)
allok &= check("analysis recipe.json == recipe_text", open(os.path.join(A_, "recipe.json")).read() == X["recipe_text"])
allok &= check("reference: recipe.json, mass.json, log.txt, README", all(os.path.exists(os.path.join(R_, f)) for f in ("recipe.json", "mass.json", "log.txt", "README.txt")))
Y = run_engine(E7, recipe=R_)                                    # the folder path works as a recipe
allok &= check("the _reference folder path rebuilds the tile", "RECIPE CHECK: OK" in Y["log"])
Z = run_engine(E7, recipe=A_)                                    # and so does the _analysis folder
allok &= check("the _analysis folder path rebuilds the tile too", "RECIPE CHECK: OK" in Z["log"])
M2 = run_engine(E7, mass_in=open(os.path.join(R_, "mass.json")).read(), sources=[], **{**common, "steps": 1, "foam": None})
allok &= check("mass.json from the reference folder starts another engine", np.array_equal(void_of(M2), void_of(X)) or (void_of(M2) & ~void_of(X)).sum() < 30)

# ---- 6. a hand-written recipe (how I will author spaces) ----
hand = {"schema": "erosion-recipe/2", "name": "hand", "sim": {"tile_w": 20, "tile_h": 20, "cell": 0.5, "steps": 100, "gravity": 0.5, "drain": False, "n_frames": 4, "smooth": 0.8, "seed": 2},
        "cleanup": {"min_void_ft3": 4, "min_foam_ft3": 6, "weld": ""}, "foam": {"noise": 0.4, "scale": 4, "grain": 0.3, "seed": 3, "web": 0.2},
        "container": {"kind": "box", "min": [0, 0, 0], "size": [24, 16, 20]},
        "plates": [{"v": 1, "kind": "plates", "name": "slab", "thickness": 1.0, "shapes": [{"type": "box", "min": [2, 2, 9], "max": [22, 14, 10]}]}],
        "sources": [{"v": 1, "mode": "inject", "kind": "pt", "pt": [12, 8, 14], "dose": 1400, "spread": 4, "start": 0, "duration": 0, "dir": None, "plate_mode": "through", "cut": False}]}
H = run_engine(E7, recipe=json.dumps(hand))
print([l for l in H["log"].splitlines() if l.startswith(("GRID", "PLATES", "  PLATE"))])
allok &= check("hand-written recipe: 24 x 16 x 20 box, one box plate, runs", "GRID: 48 x 32 x 40" in H["log"] and "PLATE 1 'slab'" in H["log"])
print("GEO/RECIPE", "ALL PASS" if allok else "SOME FAILED")
