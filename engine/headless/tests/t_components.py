import json, sys, os, base64, tempfile
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
import fake_rhino
rg = fake_rhino.install()
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")
PLATES = os.path.join(REPO, "engine", "erosion_plates.py")
SOURCE = os.path.join(REPO, "engine", "erosion_source.py")


def curve(pts):
    return rg.PolylineCurve([rg.Point3d(*p) for p in pts + [pts[0]]])


def void_of(out):
    d = json.loads(out["tile_data"])
    n = int(np.prod(d["grid"]))
    return np.unpackbits(np.frombuffer(base64.b64decode(d["void_bits"]), dtype=np.uint8))[:n].reshape(d["grid"]).astype(bool)


def ok(label, cond, extra=""):
    print("%-70s %s %s" % (label, "PASS" if cond else "FAIL", extra))
    return cond


allok = True
# ---- the Source component ----
S = run_engine(SOURCE, geo=rg.Point3d(10, 10, 15), mode="inject", dose=1500, spread=4, plate_mode="through", cut=True)
spec = json.loads(S["src"])
allok &= ok("Source: plate_mode and cut are written", spec["plate_mode"] == "through" and spec["cut"] is True)
S0 = run_engine(SOURCE, geo=rg.Point3d(10, 10, 15))
allok &= ok("Source: defaults are pool / no cut", json.loads(S0["src"])["plate_mode"] == "pool" and json.loads(S0["src"])["cut"] is False)
S1 = run_engine(SOURCE, geo=rg.Point3d(10, 10, 15), plate_mode=2)
allok &= ok("Source: plate_mode 2 = around", json.loads(S1["src"])["plate_mode"] == "around")
try:
    run_engine(SOURCE, geo=rg.Point3d(10, 10, 15), plate_mode="sideways")
    allok &= ok("Source: a bad plate_mode is refused", False)
except ValueError as e:
    allok &= ok("Source: a bad plate_mode is refused", "plate_mode" in str(e))

# ---- the Floor Plates component ----
outer = curve([(3, 3, 10), (17, 3, 10), (17, 17, 10), (3, 17, 10)])
inner = curve([(7, 7, 10), (13, 7, 10), (13, 13, 10), (7, 13, 10)])
upper = curve([(4, 4, 15), (16, 4, 15), (16, 16, 15), (4, 16, 15)])
P = run_engine(PLATES, shapes=[outer, inner, upper], thickness=1.0, resistance=1.5, min_support=5.0, strut_size=1.0, name="two floors")
ps = json.loads(P["plates"])
allok &= ok("Plates: 3 curves stored as points, settings stored", len(ps["shapes"]) == 3 and ps["resistance"] == 1.5 and ps["strut_size"] == 1.0 and ps["name"] == "two floors")
allok &= ok("Plates: defaults (anchor 1.5, strength 3, auto support on, top branching off)", ps["anchor_ft"] == 1.5 and ps["anchor_strength"] == 3.0 and ps["auto_support"] is True and ps["branch_from_top"] is False)
solid = fake_rhino.box_mesh_obj((2.0, 2.0, 5.0), (8.0, 8.0, 6.5))
PG = run_engine(PLATES, shapes=[solid, outer], thickness=2.0)
pg = json.loads(PG["plates"])
allok &= ok("Plates: geometry is stored as triangles, curve as points (mixed list)", [s["type"] for s in pg["shapes"]] == ["mesh", "poly"] and len(pg["shapes"][0]["f"]) == 12)
try:
    run_engine(PLATES, shapes=[rg.PolylineCurve([rg.Point3d(0, 0, 0), rg.Point3d(5, 0, 0), rg.Point3d(5, 5, 0)])])
    allok &= ok("Plates: an open curve is refused", False)
except ValueError as e:
    allok &= ok("Plates: an open curve is refused", "not closed" in str(e))

# ---- module output straight into the engine ----
common = dict(tile_w=20.0, tile_h=20.0, cell=0.5, steps=60, gravity=0.6, n_frames=3, seed=2, smooth=0.8, tile_name="mod",
              foam=json.dumps({"v": 1, "noise": 0.6, "scale": 4, "grain": 0.4, "seed": 9, "web": 0.3}))
src = json.dumps({"v": 1, "mode": "inject", "kind": "pt", "pt": [10, 10, 12.5], "dose": 1800, "spread": 5, "start": 0, "duration": 0, "dir": None, "plate_mode": "through", "cut": False})
E = run_engine(E7, sources=[src], plates=[P["plates"], PG["plates"]], **common)
lines = [l for l in E["log"].splitlines() if l.strip().startswith(("PLATE", "PLATES"))]
for l in lines:
    print("   ", l.strip()[:170])
allok &= ok("Engine: module outputs wire straight in (curves, solids, groups)", len(lines) >= 4)

# nested curves: the inner ring is an opening, not a second plate
tmp = tempfile.mkdtemp()
E2 = run_engine(E7, sources=[src], plates=[run_engine(PLATES, shapes=[outer, inner], thickness=1.0)["plates"]], export=True, export_dir=tmp, **common)
ana = [x for x in os.listdir(tmp) if x.endswith("_analysis")][0]
rep = json.load(open(os.path.join(tmp, ana, "data", "plates.json")))
pl = rep["plates"]
allok &= ok("Nested curves: one plate with a designed opening (not two plates)", len(pl) == 1 and pl[0]["openings"]["count"] >= 1 and any(o["designed"] for o in pl[0]["openings"]["list"]),
            "(plate area %.0f of %.0f ft2)" % (pl[0]["area_ft2"], pl[0]["original_area_ft2"]))
allok &= ok("Plate area = 14*14 - 6*6 = 160 ft2 before erosion", abs(pl[0]["original_area_ft2"] - 160.0) < 6.0, "(%.1f)" % pl[0]["original_area_ft2"])

# negative thickness: plate sits ABOVE the curve
for sign, label in ((1.0, "positive: slab below the curve"), (-1.0, "negative: slab above the curve")):
    o = run_engine(E7, sources=[src], plates=[run_engine(PLATES, shapes=[outer], thickness=sign * 2.0)["plates"]], **common)
    line = [l for l in o["log"].splitlines() if l.strip().startswith("PLATE 1")][0]
    print("   ", label, "->", line.strip()[:90])
print("COMPONENTS", "ALL PASS" if allok else "SOME FAILED")
