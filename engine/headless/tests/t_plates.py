import json, sys, os, base64
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")


def void_of(out):
    d = json.loads(out["tile_data"])
    n = int(np.prod(d["grid"]))
    bits = np.unpackbits(np.frombuffer(base64.b64decode(d["void_bits"]), dtype=np.uint8))[:n]
    return bits.reshape(d["grid"]).astype(bool)


def plate_spec(z=11.0, t=2.0, lo=3.0, hi=17.0, **kw):
    s = {"v": 1, "kind": "plates", "name": "floor", "thickness": t,
         "shapes": [{"type": "poly", "pts": [[lo, lo, z], [hi, lo, z], [hi, hi, z], [lo, hi, z]]}]}
    s.update(kw)
    return json.dumps(s)


def src(pt, mode="inject", dose=1500, spread=4, plate_mode="pool", cut=False, dur=0):
    return json.dumps({"v": 1, "mode": mode, "kind": "pt", "pt": pt, "dose": dose, "spread": spread, "start": 0, "duration": dur,
                       "dir": None, "plate_mode": plate_mode, "cut": cut})


def go(sources, plates, **kw):
    base = dict(tile_w=20.0, tile_h=20.0, cell=1.0, steps=80, gravity=0.8, n_frames=4, seed=3, smooth=0.8, sources=sources, plates=plates,
                tile_name="t")
    base.update(kw)
    return run_engine(E7, **base)


def report(label, out):
    v = void_of(out)
    pj = json.loads(out["recipe_text"]) if False else None
    above = int(v[:, :, 12:].sum())
    below = int(v[:, :, :9].sum())
    # plate area kept from the log
    pl = [l for l in out["log"].splitlines() if l.strip().startswith("PLATE ")]
    print("%-28s void above plate %4d | below plate %4d | %s" % (label, above, below, pl[0].strip()[:110] if pl else "no plate line"))
    return above, below


print("--- behaviours: acetone injected ABOVE a 14x14x2 ft plate (top at z=11), cell 1 ft ---")
res = {}
for mode in ("pool", "stop", "around", "through"):
    res[mode] = report("plate_mode=" + mode, go([src([10, 10, 16], plate_mode=mode)], [plate_spec()]))
res["pool+cut"] = report("pool + cut", go([src([10, 10, 16], plate_mode="pool", cut=True, dose=4000, dur=0)], [plate_spec()]))
res["through+cut"] = report("through + cut", go([src([10, 10, 16], plate_mode="through", cut=True, dose=4000)], [plate_spec()]))
res["none"] = report("no plate at all", go([src([10, 10, 16])], []))

assert res["pool"][1] == 0 and res["stop"][1] == 0, "pool/stop must not reach below the plate"
assert res["stop"][0] < res["pool"][0], "stop erodes less above than pool"
assert res["around"][1] > 0 and res["through"][1] > 300, "around slides off, through passes"
assert res["pool+cut"][1] > 300, "cut opens the plate"
print("--- two acetones, two modes, one plate ---")
out = go([src([6, 10, 16], plate_mode="pool"), src([14, 10, 16], plate_mode="through")], [plate_spec()])
v = void_of(out)
print("left (pool) void below plate:", int(v[:10, :, :9].sum()), "| right (through) void below plate:", int(v[10:, :, :9].sum()))
print("solvents line:", [l for l in out["log"].splitlines() if l.startswith("PLATES")])
