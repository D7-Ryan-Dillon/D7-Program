import json, sys, os, base64
import numpy as np
REPO = sys.argv[1]
sys.path.insert(0, os.path.join(REPO, "engine", "headless"))
from run_headless import run_engine
import fake_rhino
E7 = os.path.join(REPO, "engine", "erosion_engine_7.py")
fake_rhino.install()
def void_of(out):
    d = json.loads(out["tile_data"]); n = int(np.prod(d["grid"]))
    return np.unpackbits(np.frombuffer(base64.b64decode(d["void_bits"]), dtype=np.uint8))[:n].reshape(d["grid"]).astype(bool)
def src(pt): return json.dumps({"v":1,"mode":"inject","kind":"pt","pt":pt,"dose":1500,"spread":4,"start":0,"duration":0,"dir":None})
foam = json.dumps({"v":1,"noise":0.5,"scale":4,"grain":0.4,"seed":11,"web":0.3})
A = run_engine(E7, tile_w=20.0, tile_h=20.0, cell=0.5, steps=90, gravity=0.6, n_frames=3, seed=7, smooth=0.8, sources=[src([10,10,12])], foam=foam, tile_name="a")
B = run_engine(E7, mass_in=A["mass"], sources=[], steps=1, n_frames=1, smooth=0.8, tile_name="b")
a, b = void_of(A), void_of(B)
print("void cells A %d, B %d, differing %d" % (a.sum(), b.sum(), (a ^ b).sum()))
