"""Package the V4 set from the engine exports in C:/tmp/tiles4 (written by build.py): one import-ready zip per tile, the reference outputs, the whole set, the recipes and the pictures.

  python package.py                 writes engine/tiles/v4/package/   (git-ignored: about 100 MB)

package/
  analysis/<name>_analysis.zip      ONE tile, import-ready: drop it on the Viewer (Choose .zip), or pick the folders below
  reference/<name>_reference.zip    the engine's reference outputs for the tile (recipe, mass, print STLs, timelapse, log)
  erosion_tiles_v4_full_set.zip     everything above + recipes + previews + the 3 x 5 overview + SET.json + README.txt

To load all fifteen at once, pick the engine export folder (C:/tmp/tiles4, or wherever build.py exported) with "Choose folder": every tile.json under it becomes one tile.
(The folder tree is not copied here: the Windows 260 character path limit stops the deepest files of a copy under this repository.)
  SET.json                          the table of the set: ids, metadata, sizes, source counts, recipe lengths
"""
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = "C:/tmp/tiles4"
PKG = os.path.join(HERE, "package")
REC = os.path.join(HERE, "recipes")
ORDER = [
    "gathering_1_stepped_amphitheater_v4", "gathering_2_void_field_gathering_v4", "gathering_3_inserted_horizontal_plate_v4", "gathering_4_contained_room_within_volume_v4", "gathering_5_linear_edge_gallery_v4",
    "office_1_open_hall_workspace_v4", "office_2_cascaded_terraced_plates_v4", "office_3_flat_deep_plan_plate_v4", "office_4_void_edge_workspace_v4", "office_5_folded_undulating_work_surface_v4",
    "lobby_1_vertical_void_lobby_v4", "lobby_2_compressed_sequential_lobby_v4", "lobby_3_continuous_hall_lobby_v4", "lobby_4_topographic_ground_field_lobby_v4", "lobby_5_linear_gallery_lobby_v4",
]


def zip_folder(src, dst, arc_root=None):
    arc_root = arc_root or os.path.basename(src)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for base, _, files in os.walk(src):
            for f in files:
                p = os.path.join(base, f)
                z.write(p, os.path.join(arc_root, os.path.relpath(p, src)).replace("\\", "/"))


def main():
    shutil.rmtree(PKG, ignore_errors=True)
    for d in ("analysis", "reference"):
        os.makedirs(os.path.join(PKG, d))
    rows = []
    for name in ORDER:
        base = os.path.join(TMP, name)
        if not os.path.isdir(base):
            print("missing export:", name)
            sys.exit(1)
        ana = os.path.join(base, name + "_analysis")
        ref = os.path.join(base, name + "_reference")
        tile = json.load(open(os.path.join(ana, "tile.json"), encoding="utf-8"))
        rec_path = os.path.join(REC, name + ".recipe.json")
        rec_txt = open(rec_path, encoding="utf-8").read()
        rec = json.loads(rec_txt)
        # the recipe must carry the id the engine produced: the rebuild check
        expect = (rec.get("expect") or {}).get("tile_id")
        assert expect == tile["id"], "%s: recipe expects %s but the export is %s" % (name, expect, tile["id"])
        zip_folder(ana, os.path.join(PKG, "analysis", name + "_analysis.zip"))
        zip_folder(ref, os.path.join(PKG, "reference", name + "_reference.zip"))
        m = tile.get("meta", {})
        rows.append({
            "name": name, "tile_id": tile["id"], "category": m.get("category"), "slot": m.get("slot"), "typology": m.get("typology"), "variant": m.get("variant"),
            "tile_ft": tile["tile_ft"], "cell_ft": tile["cell_ft"], "grid": tile["grid"], "sources": len(rec.get("sources", [])), "recipe_chars": len(rec_txt),
            "engine_version": tile.get("engine_version"), "seed": tile["config"].get("seed"), "steps": tile["config"].get("steps"),
        })
        print("packaged", name, tile["id"])
    json.dump({"set": "V4", "tiles": rows}, open(os.path.join(PKG, "SET.json"), "w"), indent=1)
    readme = """EROSION TILES, V4 (fifteen tiles, one per typology)

analysis/    one _analysis zip per tile: drop it on the Viewer ("Choose .zip"); several at once: drop them together or pick the folder they came from
reference/   the engine's reference outputs per tile (recipe, mass, print STLs, build-up frames, log)
recipes/     the fifteen recipes (erosion-recipe/2): paste one into the engine's recipe panel in Grasshopper and it builds exactly that tile,
             ending with RECIPE CHECK: OK (expect.tile_id is the id in SET.json)
previews/    per tile: sections, a walking sheet (green = the floors a person can walk), an isometric cutaway; and the 3 x 5 overview
SET.json     ids, metadata, sizes, source counts

The set is coordinated: a 20 x 20 ft lattice, floors at 1 / 11 / 21 / 31 ft, standard 6 x 8 ft doorways on 5 ft lines. See docs/TILE_SET_V4.md in the repository.
"""
    open(os.path.join(PKG, "README.txt"), "w").write(readme)
    full = os.path.join(PKG, "erosion_tiles_v4_full_set.zip")
    with zipfile.ZipFile(full, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for d in ("analysis", "reference"):
            for f in sorted(os.listdir(os.path.join(PKG, d))):
                z.write(os.path.join(PKG, d, f), "%s/%s" % (d, f))
        for f in sorted(os.listdir(REC)):
            if f.endswith(".recipe.json"):
                z.write(os.path.join(REC, f), "recipes/" + f)
        pv = os.path.join(REC, "previews")
        for f in sorted(os.listdir(pv)):
            z.write(os.path.join(pv, f), "previews/" + f)
        z.write(os.path.join(PKG, "SET.json"), "SET.json")
        z.write(os.path.join(PKG, "README.txt"), "README.txt")
    mb = os.path.getsize(full) / 1e6
    print("wrote", full, "%.0f MB" % mb)


if __name__ == "__main__":
    main()
