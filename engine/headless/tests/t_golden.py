import json, sys, os, time
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine

E5 = os.path.join(REPO, "engine", "erosion_engine_5f.py")
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")

srcs = [
    json.dumps({"v": 1, "mode": "pour", "kind": "pt", "pt": [6, 8, 20], "dose": 1000, "spread": 2, "start": 0, "duration": 60, "dir": None}),
    json.dumps({"v": 1, "mode": "spray", "kind": "pt", "pt": [10, 16, 20], "dose": 1200, "spread": 8, "start": 0, "duration": 10, "dir": None}),
    json.dumps({"v": 1, "mode": "inject", "kind": "pt", "pt": [12, 8, 12], "dose": 1200, "spread": 3, "start": 0, "duration": 0, "dir": None}),
    json.dumps({"v": 1, "mode": "line", "kind": "crv", "pts": [[2, 2, 5], [18, 4, 6], [18, 18, 7]], "dose": 900, "spread": 2, "start": 0, "duration": 0, "dir": None}),
]
foam = json.dumps({"v": 1, "noise": 0.7, "scale": 6, "grain": 3, "seed": 667650, "web": 1.0, "web_open": 0.3, "web_thickness": 0.515,
                   "layers": True, "layer_count": 2, "layer_axis": 0, "layer_thickness": 0.515, "layer_strength": 1.0})


def go(path, **extra):
    kw = dict(tile_w=20.0, tile_h=20.0, cell=1.0, steps=60, gravity=1.0, n_frames=6, seed=452404, smooth=1.5,
              sources=srcs, foam=foam, tile_name="golden")
    kw.update(extra)
    t = time.time()
    out = run_engine(path, **kw)
    return out, time.time() - t


ok = True
for label, extra in (("plain", {}), ("cleanup+weld", dict(min_void=6.0, min_foam=8.0, weld="x")), ("drain", dict(drain=True, gravity=0.5)),
                     ("cell 0.5 frame 3", dict(cell=0.5, frame=3, steps=40))):
    a, ta = go(E5, **extra)
    b, tb = go(E7, **extra)
    same_data = a["tile_data"] == b["tile_data"]
    ra, rb = json.loads(a["recipe_text"]), json.loads(b["recipe_text"])
    same_id = ra["expect"]["tile_id"] == rb["expect"]["tile_id"]
    same_log = [l for l in a["log"].splitlines() if l.startswith(("VOID", "FOAM LEFT", "CLEANUP", "SOLVENT"))] == \
               [l for l in b["log"].splitlines() if l.startswith(("VOID", "FOAM LEFT", "CLEANUP", "SOLVENT"))]
    print("%-20s tile_data identical: %s | tile id identical: %s (%s) | key log lines identical: %s | 5f %.1fs, 7 %.1fs" % (
        label, same_data, same_id, rb["expect"]["tile_id"], same_log, ta, tb))
    ok &= same_data and same_id and same_log
print("GOLDEN", "PASS" if ok else "FAIL")
