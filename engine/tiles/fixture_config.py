"""Add the recipe's own inputs (sources with their doses, gravity, drain, plate groups) to each fixture's meta.json, so the app's scripts can read the
Force-driven descriptor the way the app reads a real export (tile.json `config`).

  python fixture_config.py <fixtures folder> <recipes folder>
  python fixture_config.py ../../lib/tiles/fixtures recipes
  python fixture_config.py ../../lib/tiles/fixtures-v4 v4/recipes
  python fixture_config.py ../../lib/tiles/fixtures-v5 v5/recipes

make_fixtures.py writes the same `config` block when it runs from engine exports, so this is only for fixtures that already exist. Idempotent.
"""
import glob
import json
import os
import sys

fix, rec = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
n = 0
for d in sorted(glob.glob(os.path.join(fix, "*_*_*"))):
    name = os.path.basename(d)
    rp = os.path.join(rec, name + ".recipe.json")
    mp = os.path.join(d, "meta.json")
    if not (os.path.exists(rp) and os.path.exists(mp)):
        continue
    r = json.load(open(rp))
    sim = r.get("sim", {})
    meta = json.load(open(mp))
    meta["config"] = {
        "gravity": sim.get("gravity"),
        "drain": sim.get("drain"),
        "sources": [json.dumps(s, separators=(",", ":")) for s in r.get("sources", [])],
        "plates": [{"name": p.get("name"), "resistance": p.get("resistance")} for p in (r.get("plates") or []) if isinstance(p, dict)],
    }
    json.dump(meta, open(mp, "w"))
    n += 1
print("added the recipe inputs to %d fixtures in %s" % (n, fix))
