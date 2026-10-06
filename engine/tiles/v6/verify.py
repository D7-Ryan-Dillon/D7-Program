"""Rebuild every stored V6 recipe from the recipe file ALONE (as a person pasting it into the engine would) and check the engine says RECIPE CHECK: OK, i.e. the tile id it
produces is the one in the recipe's expect block. Also checks the limits that matter for pasting: at most 24 sources, under about 32,000 characters, the right metadata.

  python verify.py            all fifteen (about a minute each)
  python verify.py G1 O3      only these

Run with Rhino's bundled Python 3.9 (see build.py).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "headless"))
from tile_report import run_recipe  # noqa: E402
import defs  # noqa: E402

REC = os.path.join(HERE, "recipes")
NAMES = {k: f().get("name") for k, f in defs.TILES.items()}


def main():
    keys = [a for a in sys.argv[1:] if not a.startswith("--")] or list(defs.TILES)
    bad = 0
    for k in keys:
        name = NAMES[k]
        path = os.path.join(REC, name + ".recipe.json")
        txt = open(path, encoding="utf-8").read()
        rec = json.loads(txt)
        problems = []
        if len(rec["sources"]) > 24:
            problems.append("%d sources" % len(rec["sources"]))
        if len(txt) > 32000:
            problems.append("%d characters" % len(txt))
        m = re.match(r"^(gathering|office|lobby)_(\d+)_(.+)_v6c?$", name)
        meta = rec.get("meta", {})
        if not m or meta.get("category") != m.group(1) or meta.get("slot") != int(m.group(2)) or meta.get("typology") != m.group(3).replace("_", " ") or meta.get("variant") != ("V6C" if name.endswith("c") else "V6"):
            problems.append("metadata %r does not match the name" % meta)
        out = run_recipe(path, export=False)
        log = out["log"]
        check = [l.strip() for l in log.splitlines() if "RECIPE CHECK" in l]
        ok = any("RECIPE CHECK: OK" in l for l in check)
        if not ok:
            problems.append("RECIPE CHECK: %s" % (check or "no check line"))
        print("%-46s %s  (%d sources, %d characters)%s" % (name, "OK " if not problems else "BAD", len(rec["sources"]), len(txt), "" if not problems else "   " + "; ".join(problems)))
        bad += bool(problems)
    print("\n%s" % ("all %d recipes rebuild their tile id" % len(keys) if not bad else "%d recipe(s) failed" % bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
