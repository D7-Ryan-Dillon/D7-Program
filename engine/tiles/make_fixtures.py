"""Copy the voxels and the engine's own analysis of the 15 tiles into the web app's parity fixtures.

  python make_fixtures.py [exports_folder=C:/tmp/tiles] [out=../../lib/tiles/fixtures]
  python make_fixtures.py C:/tmp/tiles4 ../../lib/tiles/fixtures-v4          (the V4 set: also writes mask.u8.gz, the container of the L and single-storey tiles)

Run build_tiles.py first (it exports every tile to C:/tmp/tiles/<name>/<name>_analysis). For each tile this writes
  <out>/<name>/void.u8.gz, plates.u8.gz, struts.u8.gz   the voxel grids (gzip: they are mostly zeros)
  <out>/<name>/mask.u8.gz                               the container (only when the tile is not a full box)
  <out>/<name>/meta.json                                name, grid, cell_ft, meta (category, typology, slot, variant), config (sources, gravity, drain, plates)
  <out>/<name>/spaces.json, structure.json              what the ENGINE measured (data/spaces.json, data/structure.json)
`npm run check:parity` then runs lib/tiles/analyze.ts on the same voxels and compares. Regenerate these whenever the
analysis in erosion_engine_7.py (or the engine's tiles) changes, together with lib/tiles/analyze.ts.
"""
import glob
import gzip
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else "C:/tmp/tiles"
out = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.abspath(os.path.join(HERE, "..", "..", "lib", "tiles", "fixtures"))
shutil.rmtree(out, ignore_errors=True)  # a silent failure here leaves stale fixtures: check the folder
n = 0
for tile_dir in sorted(glob.glob(os.path.join(src, "*_*_*"))):
    ana = glob.glob(os.path.join(tile_dir, "*_analysis"))
    if not ana:
        continue
    ana = ana[0]
    name = os.path.basename(tile_dir)
    dst = os.path.join(out, name)
    os.makedirs(dst, exist_ok=True)
    tile = json.load(open(os.path.join(ana, "tile.json")))
    for fname in ("void.u8", "plates.u8", "struts.u8", "mask.u8"):
        p = os.path.join(ana, "voxels", fname)
        if os.path.exists(p):
            with open(p, "rb") as f, gzip.open(os.path.join(dst, fname + ".gz"), "wb", 9) as g:
                g.write(f.read())
    cfg = tile.get("config", {})
    # the recipe's own inputs (what the Force-driven descriptor reads), as the app reads them from tile.json
    config = {"gravity": cfg.get("gravity"), "drain": cfg.get("drain"), "sources": cfg.get("sources", []),
              "plates": [{"name": p.get("name"), "resistance": p.get("resistance")} for p in cfg.get("plates", []) if isinstance(p, dict)]}
    json.dump({"name": name, "grid": tile["grid"], "cell_ft": tile["cell_ft"], "meta": tile.get("meta", {}), "config": config}, open(os.path.join(dst, "meta.json"), "w"))
    for fname in ("spaces.json", "structure.json"):
        shutil.copy(os.path.join(ana, "data", fname), os.path.join(dst, fname))
    n += 1
print("wrote %d fixtures to %s" % (n, out))
