"""Draw the assemblies that scripts/check-v4.ts wrote to C:/tmp/tiles6_asm: an isometric view of the outside and a cutaway (south-west corner removed), one colour per piece,
into engine/tiles/v4/assemblies/<name>.png and <name>_cut.png.   python render_assemblies.py [--root C:/tmp/tiles6_asm]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import iso  # noqa: E402

ROOT = "C:/tmp/tiles6_asm"
OUT = os.path.join(HERE, "assemblies")


def main():
    root = ROOT
    if "--root" in sys.argv:
        root = sys.argv[sys.argv.index("--root") + 1]
    os.makedirs(OUT, exist_ok=True)
    names = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    for n in names:
        import json
        tile = json.load(open(os.path.join(root, n, n + "_analysis", "tile.json")))
        cells = max(tile["grid"])
        scale = 5.0 if cells <= 80 else 3.6 if cells <= 140 else 2.6
        iso.render(n, scale=scale, cut_ft=0, view="sw", label=True, root=root).save(os.path.join(OUT, n + ".png"))
        iso.render(n, scale=scale, cut_ft=10, view="sw", label=True, root=root).save(os.path.join(OUT, n + "_cut.png"))
        print("wrote", n)


if __name__ == "__main__":
    main()
