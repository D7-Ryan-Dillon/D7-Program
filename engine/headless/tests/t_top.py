import json, sys, os
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")
g = run_engine(E7, tile_w=20.0, tile_h=20.0, cell=1.0, steps=1, tile_name="x")      # just to load the functions
shape = (20, 20, 20)
cell = 1.0
mask = np.ones(shape, bool)
M = np.zeros(shape, np.float32)
M[:, :, 16:] = 1.0                       # ceiling foam, z 16..20
M[:, :, :2] = 1.0                        # floor foam, z 0..2
pid = np.zeros(shape, np.int32)
top = np.full((20, 20), np.nan, np.float32)
bot = np.full((20, 20), np.nan, np.float32)
top[7:13, 7:13], bot[7:13, 7:13] = 10.0, 9.0
pid[7:13, 7:13, 9] = 1
M[7:13, 7:13, 9] = 1.0
plate = dict(id=1, group=0, kind="poly", name="p", top=top, bot=bot, normal=[0, 0, 1], thickness=1.0)
for label, bft in (("branch_from_top False", False), ("branch_from_top True ", True)):
    grp = [dict(name="p", min_support=6.0, max_span=8.0, strut_size=1.5, verticality=0.0, branch_from_top=bft, auto_support=True, support_pts=[], resistance=1.0)]
    w = []
    M2, st, rep = g["support_pass"](M.copy(), mask, pid, [plate], grp, cell, np.random.default_rng(1), w, None)
    r = rep[0]
    print(label, "| branches %d | contact %.1f ft2 | supported %s | sides %s | notes %s" % (r["struts"], r["contact_ft2"], r["supported"], [s["side"] for s in r["strut_list"]], r["notes"]))
    assert r["supported"] and r["struts"] > 0
    assert [s["side"] for s in r["strut_list"]] == (["top", "top"] if bft else ["under", "under"])
    for s in r["strut_list"]:
        print("     from", s["start"], "to", s["end"], "length %.1f" % s["length_ft"])
