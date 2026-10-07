"""The labelled 3 x 5 overview of the V7 set: gathering, office and lobby in rows, typologies 1 to 5 in columns, every tile drawn at the same scale (so a 40 ft lobby is twice as
tall as a 20 ft tile) as an isometric cutaway (iso.py). Reads C:/tmp/tiles7, writes engine/tiles/v7/recipes/previews/V7_overview_3x5.png.

  python overview.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import iso  # noqa: E402

ROWS = [("GATHERING", "gathering"), ("WORKSPACE", "office"), ("LOBBY", "lobby")]
TYPOLOGIES = {
    "gathering": ["Stepped amphitheater", "Void-field gathering", "Inserted horizontal plate", "Contained room-within-volume", "Linear edge gallery"],
    "office": ["Open hall workspace", "Cascaded / terraced plates", "Flat deep-plan plate", "Void-edge workspace", "Folded / undulating surface"],
    "lobby": ["Vertical void lobby", "Compressed sequential lobby", "Continuous hall lobby", "Topographic / ground-field lobby", "Linear gallery lobby"],
}
NAMES = {
    "gathering": ["gathering_1_stepped_amphitheater_v7", "gathering_2_void_field_gathering_v7", "gathering_3_inserted_horizontal_plate_v7", "gathering_4_contained_room_within_volume_v7", "gathering_5_linear_edge_gallery_v7"],
    "office": ["office_1_open_hall_workspace_v7", "office_2_cascaded_terraced_plates_v7", "office_3_flat_deep_plan_plate_v7", "office_4_void_edge_workspace_v7", "office_5_folded_undulating_work_surface_v7"],
    "lobby": ["lobby_1_vertical_void_lobby_v7", "lobby_2_compressed_sequential_lobby_v7", "lobby_3_continuous_hall_lobby_v7", "lobby_4_topographic_ground_field_lobby_v7", "lobby_5_linear_gallery_lobby_v7"],
}
BG = (24, 24, 24)
INK = (235, 235, 235)
DIM = (150, 150, 150)
ACCENT = (196, 51, 131)


def font(size, bold=False):
    for f in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    exterior = "--exterior" in sys.argv
    scale = 5.2
    cells = {}
    for cat, _ in ROWS:
        pass
    for _, cat in ROWS:
        for n in NAMES[cat]:
            img = iso.render(n, scale=scale, cut_ft=0 if exterior else 10, view="sw", label=False)
            cells[n] = img
    colw = max(i.width for i in cells.values()) + 20
    rowh = {cat: max(cells[n].height for n in NAMES[cat]) + 78 for _, cat in ROWS}
    margin_l, head = 120, 70
    W = margin_l + colw * 5 + 20
    H = head + sum(rowh.values()) + 20
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((20, 18), "V7 TILE SET   15 tiles, one per typology   isometric views at one scale (" + ("outside" if exterior else "south-west corner removed") + ")", fill=INK, font=font(18, True))
    d.text((20, 44), "foam pink   floor plates blue   20 ft footprint, floors at 1 / 11 / 21 ft", fill=DIM, font=font(13))
    y = head
    for r, (label, cat) in enumerate(ROWS):
        d.line([(10, y), (W - 10, y)], fill=(60, 60, 60), width=1)
        d.text((16, y + 14), label, fill=ACCENT, font=font(15, True))
        for c, n in enumerate(NAMES[cat]):
            img = cells[n]
            x0 = margin_l + c * colw
            sheet.paste(img, (x0 + (colw - img.width) // 2, y + rowh[cat] - 70 - img.height))
            d.text((x0 + 10, y + rowh[cat] - 62), "%s%d" % (cat[0].upper(), c + 1), fill=ACCENT, font=font(15, True))
            d.text((x0 + 44, y + rowh[cat] - 62), TYPOLOGIES[cat][c], fill=INK, font=font(14))
        y += rowh[cat]
    p = os.path.join(iso.OUT, "V7_overview_exterior_3x5.png" if exterior else "V7_overview_3x5.png")
    sheet.save(p)
    print("wrote", p, sheet.size)


if __name__ == "__main__":
    main()
