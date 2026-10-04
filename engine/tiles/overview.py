"""One picture of the tiles: for each, the elevation along Y at y = 6.5 (x across), along X at x = 13.5, and plans at z = 6 and z = 16 (off the centre line, which
the standard ports cut straight through) (pink foam, dark void, blue plates). Needs the exports in C:/tmp/tiles (run build_tiles.py first).

  python overview.py                       all fifteen, 3 columns, small  -> recipes/overview.png
  python overview.py 4 2 gathering_3 office_1     bigger (scale 4), 2 columns, only tiles whose name starts with these -> C:/tmp/tiles/_review.png"""
import glob
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "headless"))
import view_sections  # noqa: E402

TMP = "C:/tmp/tiles"
args = sys.argv[1:]
SCALE = int(args[0]) if args else 3
COLS = int(args[1]) if len(args) > 1 else 3
only = args[2:]
order = {"g": 0, "o": 1, "l": 2}
names = sorted([os.path.basename(p).replace(".recipe.json", "") for p in glob.glob(os.path.join(HERE, "recipes", "*.recipe.json"))], key=lambda n: (order[n[0]], n))
if only:
    names = [n for n in names if any(n.startswith(o) for o in only)]
cells = []
for n in names:
    ana = glob.glob(os.path.join(TMP, n, "*_analysis"))[0]
    row = []
    for ax, at in (("y", "6.5"), ("x", "13.5"), ("z", "6"), ("z", "16")):
        p = os.path.join(TMP, "_ov_%s.png" % ax)
        view_sections.render(ana, p, axis=ax, n=1, scale=SCALE, at=[at])
        im = Image.open(p)
        row.append(im.crop((6, 24, 6 + 40 * SCALE, im.height - 6)))
    W = sum(i.width for i in row) + 4 * (len(row) - 1)
    H = max(i.height for i in row)
    c = Image.new("RGB", (W, H + 14), (70, 70, 70))
    x = 0
    for i in row:
        c.paste(i, (x, 14))
        x += i.width + 4
    ImageDraw.Draw(c).text((2, 1), n[:50], fill=(255, 255, 255))
    cells.append(c)
cw, ch = max(c.width for c in cells), max(c.height for c in cells)
rows = (len(cells) + COLS - 1) // COLS
per_col = rows
sheet = Image.new("RGB", (COLS * (cw + 8) + 8, rows * (ch + 8) + 8), (40, 40, 40))
for i, c in enumerate(cells):
    if only:
        sheet.paste(c, (8 + (i % COLS) * (cw + 8), 8 + (i // COLS) * (ch + 8)))
    else:
        sheet.paste(c, (8 + (i // 5) * (cw + 8), 8 + (i % 5) * (ch + 8)))
out = os.path.join(TMP, "_review.png") if only else os.path.join(HERE, "recipes", "overview.png")
sheet.save(out)
print("wrote", out, sheet.size)
