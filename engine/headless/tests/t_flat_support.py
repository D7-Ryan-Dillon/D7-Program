import json, sys, os, base64
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")


def src(pt, mode="inject", dose=1500, spread=4, plate_mode="pool", cut=False, dur=0):
    return json.dumps({"v": 1, "mode": mode, "kind": "pt", "pt": pt, "dose": dose, "spread": spread, "start": 0, "duration": dur,
                       "dir": None, "plate_mode": plate_mode, "cut": cut})


def verts(mesh):
    return np.array([[v.X, v.Y, v.Z] for v in mesh.Vertices.items])


def go(sources, plates, **kw):
    base = dict(tile_w=20.0, tile_h=20.0, cell=0.5, steps=100, gravity=0.8, n_frames=4, seed=3, smooth=0.8, sources=sources, plates=plates, tile_name="t")
    base.update(kw)
    return run_engine(E7, **base)


# ---- flat and sloped tops ----
flat = json.dumps({"v": 1, "kind": "plates", "name": "flat", "thickness": 1.5,
                   "shapes": [{"type": "poly", "pts": [[3, 3, 11.3], [17, 3, 11.3], [17, 17, 11.3], [3, 17, 11.3]]}]})
slope = json.dumps({"v": 1, "kind": "plates", "name": "ramp", "thickness": 1.5,
                    "shapes": [{"type": "poly", "pts": [[3, 3, 8.75], [17, 3, 12.25], [17, 17, 12.25], [3, 17, 8.75]]}]})
for label, spec, plane in (("flat top at z=11.3", flat, lambda x, y: 11.3 + 0 * x), ("ramp, top z = 8 + 0.25 x", slope, lambda x, y: 8 + 0.25 * x)):
    out = go([src([10, 10, 17], plate_mode="pool", dose=2500, spread=5), src([10, 10, 5], plate_mode="pool", dose=1500, spread=4)], [spec],
             noise=0) if False else go([src([10, 10, 17], dose=2500, spread=5), src([10, 10, 5], dose=1500)], [spec],
                                      foam=json.dumps({"v": 1, "noise": 0.7, "scale": 4, "grain": 1, "seed": 5, "web": 0.4}))
    V = verts(out["plates_mesh"])
    z0 = plane(V[:, 0], V[:, 1])
    band = (V[:, 2] > z0 - 0.45) & (V[:, 2] < z0 + 0.45)      # the top skin
    inner = band & (V[:, 0] > 4) & (V[:, 0] < 16) & (V[:, 1] > 4) & (V[:, 1] < 16)
    dev = np.abs(V[inner, 2] - z0[inner])
    print("%-26s plate mesh: %d vertices, top-skin vertices (interior) %d, max deviation from the exact plane %.5f ft" % (label, len(V), inner.sum(), dev.max() if inner.any() else -1))
    print("   ", [l.strip()[:150] for l in out["log"].splitlines() if l.strip().startswith("PLATE ")])
    assert dev.max() < 1e-3, "plate top is not an exact plane"

# ---- plate floating in a void: branches must hold it ----
mid = json.dumps({"v": 1, "kind": "plates", "name": "island", "thickness": 1.0, "min_support": 8.0, "max_span": 6.0, "strut_size": 1.2, "verticality": 0.0,
                  "shapes": [{"type": "poly", "pts": [[7, 7, 10], [13, 7, 10], [13, 13, 10], [7, 13, 10]]}]})
big = [src([10, 10, 10], plate_mode="through", dose=5200, spread=13)]
for label, kw in (("auto_support on ", {}), ("auto_support OFF", {"auto_support": False}), ("verticality 1.0  ", {"verticality": 1.0}), ("branch_from_top  ", {"branch_from_top": True})):
    spec = json.loads(mid)
    spec.update(kw)
    out = go(big, [json.dumps(spec)], steps=140)
    line = [l.strip() for l in out["log"].splitlines() if l.strip().startswith("PLATE ")]
    print(label, "|", line[0][:200] if line else "plate gone")
    if label.startswith("auto_support on") or label.startswith("branch"):
        pj = None
        # read the branch list from the exported report
        import tempfile
        d = tempfile.mkdtemp()
        out2 = go(big, [json.dumps(spec)], steps=140, export=True, export_dir=d)
        pdir = [x for x in os.listdir(d) if x.endswith("_analysis")][0]
        rep = json.load(open(os.path.join(d, pdir, "data", "plates.json")))
        st = rep["plates"][0]["support"]["struts"]
        ang = []
        for s in st:
            v = np.array(s["end"]) - np.array(s["start"])
            ang.append(round(float(np.degrees(np.arcsin(abs(v[2]) / np.linalg.norm(v)))), 1))
        print("    branches:", len(st), "angle above horizontal (deg):", ang, "| sides:", sorted(set(s["side"] for s in st)))
