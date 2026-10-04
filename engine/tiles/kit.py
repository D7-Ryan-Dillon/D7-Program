"""Helpers for writing engine 7 recipes by hand (used by build_tiles.py).

Everything is in feet, Z up, tile low corner at (0, 0, 0). A recipe is a plain dict that is written as JSON.

Plate shapes (all of them become flat-topped, protected foam in the engine):
  box(min, max)                    an axis-aligned solid (walls, columns, slabs)
  slab(pts)                        a closed flat curve = TOP of a slab, extruded down by the group's thickness
  prism_xz(profile, y0, y1)        a closed mesh: a profile drawn in (x, z), extruded along y   (tiers, stair slabs, folded floors)
  prism_yz(profile, x0, x1)        the same, profile in (y, z), extruded along x
"""
import json

import numpy as np

# ---- the shared kit (every tile uses these datums) -------------------------------------------------------
FLOOR1 = 2.0          # top of the ground slab
FLOOR2 = 12.0         # top of the mid slab
SLAB = 2.0            # slab thickness
STOREY = 8.0          # clear height above a floor
SIZE = 20.0


def box(lo, hi):
    return {"type": "box", "min": [float(a) for a in lo], "max": [float(a) for a in hi]}


def slab(pts):
    return {"type": "poly", "pts": [[float(a) for a in p] for p in pts]}


def rect_slab(x0, y0, x1, y1, z):
    return slab([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]])


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def triangulate(poly):
    """Ear clipping for a simple polygon given as [(u, v), ...] in either winding. Returns index triples."""
    pts = [tuple(map(float, p)) for p in poly]
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    idx = list(range(len(pts)))
    if area < 0:
        idx.reverse()
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if _cross(a, b, c) <= 1e-12:
                continue
            inside = False
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                p = pts[j]
                if _cross(a, b, p) >= -1e-12 and _cross(b, c, p) >= -1e-12 and _cross(c, a, p) >= -1e-12:
                    inside = True
                    break
            if inside:
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            raise ValueError("triangulate: polygon is not simple")
    tris.append((idx[0], idx[1], idx[2]))
    return tris


def _prism(profile, lo, hi, axes):
    """profile in (a, z); extruded between lo and hi along the third axis. axes = index of the profile's first axis (0 or 1)."""
    n = len(profile)
    V = []
    for third in (lo, hi):
        for a, z in profile:
            p = [0.0, 0.0, float(z)]
            p[axes] = float(a)
            p[1 - axes] = float(third)
            V.append(p)
    F = []
    for i in range(n):
        j = (i + 1) % n
        F += [[i, j, n + j], [i, n + j, n + i]]
    for t in triangulate(profile):
        F.append([t[0], t[2], t[1]])
        F.append([n + t[0], n + t[1], n + t[2]])
    return {"type": "mesh", "v": [[round(c, 4) for c in p] for p in V], "f": F}


def prism_xz(profile, y0, y1):
    return _prism(profile, y0, y1, 0)


def prism_yz(profile, x0, x1):
    return _prism(profile, x0, x1, 1)


def tiers(n, x_from, rise0, riser, tread, thick, direction=1):
    """Profile (a, z) of a stepped slab: n treads going in +a (direction=1) or -a, first tread top at rise0, each next one `riser`
    higher and `tread` further. The underside is a parallel saw-tooth `thick` below each tread top, so it is a thin folded slab,
    not a solid wedge. Returns a closed polygon."""
    poly = []
    for i in range(n):
        a0 = x_from + direction * tread * i
        a1 = a0 + direction * tread
        zt = rise0 + riser * i
        poly += [(a0, zt), (a1, zt)]
    # underside returns right->left
    under = []
    for i in range(n - 1, -1, -1):
        a0 = x_from + direction * tread * i
        a1 = a0 + direction * tread
        zt = rise0 + riser * i
        under.append((a1, zt - thick))
        under.append((a0, zt - thick))
    return poly + under


def plate_group(name, shapes, thickness=2.0, resistance=1.0, anchor_ft=1.5, anchor_strength=3.0, auto_support=False,
                min_support=8.0, max_span=10.0, strut_size=1.5, verticality=0.3, branch_from_top=False, support_pts=None):
    auto_support = False if auto_support is True else auto_support
    return {"v": 1, "kind": "plates", "name": name, "thickness": thickness, "resistance": resistance, "anchor_ft": anchor_ft,
            "anchor_strength": anchor_strength, "auto_support": auto_support, "min_support": min_support, "max_span": max_span,
            "strut_size": strut_size, "verticality": verticality, "branch_from_top": branch_from_top,
            "support_pts": support_pts or [], "shapes": shapes}


def src_inject(pt, dose, spread, plate_mode="pool", cut=False, mode="inject", start=0, duration=0):
    return {"v": 1, "mode": mode, "kind": "pt", "pt": [round(float(a), 3) for a in pt], "dose": dose, "spread": spread, "start": start,
            "duration": duration, "dir": None, "plate_mode": plate_mode, "cut": cut}


def src_line(pts, dose, spread, plate_mode="pool", cut=False, start=0, duration=0):
    return {"v": 1, "mode": "line", "kind": "crv", "pts": [[round(float(a), 3) for a in p] for p in pts], "dose": dose, "spread": spread,
            "start": start, "duration": duration, "dir": None, "plate_mode": plate_mode, "cut": cut}


def tile_meta(name):
    """category / typology / variant from a name like gathering_1_stepped_amphitheater (the app reads this instead of guessing from the file name)."""
    import re
    m = re.match(r"^(gathering|office|lobby)_(\d+)_(.+?)(?:_v(\d+))?$", name, re.I)
    if not m:
        return {}
    out = {"category": m.group(1).lower(), "typology": m.group(3).replace("_", " "), "slot": int(m.group(2))}
    if m.group(4):
        out["variant"] = "V" + m.group(4)
    return out


def recipe(name, plates, sources, size=(20.0, 20.0, 20.0), steps=160, gravity=0.6, seed=1, noise=0.3, scale=4.0, grain=0.15,
           web=0.0, foam_seed=1, weld="xy", cell=0.5, smooth=0.8, min_void=6.0, min_foam=8.0, layers=None):
    """layers = None, or (count, axis, thickness, strength): evenly spaced sheets of denser (strength > 0, solvent pools on them and leaves
    ledges) or weaker (strength < 0, solvent runs along them) foam, stacked along axis 0/1/2."""
    r = {"schema": "erosion-recipe/2", "name": name, "engine_version": "7.0", "meta": tile_meta(name),
         "sim": {"tile_w": size[0], "tile_h": size[2], "cell": cell, "steps": steps, "gravity": gravity, "drain": False, "n_frames": 8,
                 "smooth": smooth, "seed": seed},
         "cleanup": {"min_void_ft3": min_void, "min_foam_ft3": min_foam, "weld": weld},
         "foam": {"v": 1, "noise": noise, "scale": scale, "grain": grain, "seed": foam_seed, "web": web, "web_open": 0.3,
                  "web_thickness": 0.5, "layers": layers is not None, "layer_count": layers[0] if layers else 3,
                  "layer_axis": layers[1] if layers else 2, "layer_thickness": layers[2] if layers else 0.75,
                  "layer_strength": layers[3] if layers else 0.85}}
    if size[0] != size[1]:                  # a square footprint of any height is just tile_w x tile_w x tile_h
        r["container"] = {"kind": "box", "min": [0, 0, 0], "size": [size[0], size[1], size[2]]}
    r["plates"] = plates
    r["sources"] = sources
    r["frame"] = None
    return r


def dumps_recipe(rec):
    def d(o):
        return json.dumps(o, separators=(", ", ": "))
    lines = []
    for k, val in rec.items():
        if isinstance(val, list) and val and isinstance(val[0], dict):
            if k == "plates":
                parts = []
                for g in val:
                    head = {kk: vv for kk, vv in g.items() if kk != "shapes"}
                    shp = ",\n       ".join(json.dumps(s, separators=(",", ":")) if s.get("type") in ("mesh", "field") else d(s) for s in g["shapes"])
                    parts.append(d(head)[:-1] + ',\n     "shapes": [\n       ' + shp + "\n     ]}")
                lines.append('  "plates": [\n    ' + ",\n    ".join(parts) + "\n  ]")
            else:
                lines.append('  %s: [\n    %s\n  ]' % (json.dumps(k), ",\n    ".join(d(x) for x in val)))
        else:
            lines.append('  %s: %s' % (json.dumps(k), d(val)))
    return "{\n" + ",\n".join(lines) + "\n}\n"


# ---- more helpers -----------------------------------------------------------------------------------------
import math  # noqa: E402


def circle_pts(cx, cy, r, z, n=24):
    return [[round(cx + r * math.cos(2 * math.pi * i / n), 3), round(cy + r * math.sin(2 * math.pi * i / n), 3), z] for i in range(n)]


def dose_for(spread, length, k=0.8):
    """Dose that roughly fills a tunnel of this spread over this length (cross-section pi*(0.85*spread)^2)."""
    return int(round(k * math.pi * (0.85 * spread) ** 2 * length))


def xlines(ys, z, spread, mode="pool", dose=None, x0=0.0, x1=20.0):
    zs = z if isinstance(z, (list, tuple)) else [z] * len(ys)
    return [src_line([(x0, y, zz), (x1, y, zz)], dose or dose_for(spread, x1 - x0), spread, mode) for y, zz in zip(ys, zs)]


def ylines(xs, z, spread, mode="pool", dose=None, y0=0.0, y1=20.0):
    zs = z if isinstance(z, (list, tuple)) else [z] * len(xs)
    return [src_line([(x, y0, zz), (x, y1, zz)], dose or dose_for(spread, y1 - y0), spread, mode) for x, zz in zip(xs, zs)]


def zline(x, y, z0, z1, spread, mode="pool", dose=None):
    return src_line([(x, y, z0), (x, y, z1)], dose or dose_for(spread, z1 - z0), spread, mode)


def corner_columns(z0, z1, size=1.5, S=20.0):
    s = size
    return [box((0, 0, z0), (s, s, z1)), box((S - s, 0, z0), (S, s, z1)), box((0, S - s, z0), (s, S, z1)), box((S - s, S - s, z0), (S, S, z1))]


def heightfield(fn, nx=20, ny=20, x1=20.0, y1=20.0, zbot=0.0):
    """Closed mesh: solid under the surface z = fn(x, y), from zbot, over [0, x1] x [0, y1] on an nx x ny grid."""
    V = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x, y = x1 * i / nx, y1 * j / ny
            V.append([round(x, 4), round(y, 4), round(float(fn(x, y)), 4)])
    n_top = len(V)
    for j in range(ny + 1):
        for i in range(nx + 1):
            V.append([round(x1 * i / nx, 4), round(y1 * j / ny, 4), zbot])

    def t(i, j):
        return j * (nx + 1) + i

    def b(i, j):
        return n_top + j * (nx + 1) + i
    F = []
    for j in range(ny):
        for i in range(nx):
            F += [[t(i, j), t(i + 1, j), t(i + 1, j + 1)], [t(i, j), t(i + 1, j + 1), t(i, j + 1)]]
            F += [[b(i, j), b(i + 1, j + 1), b(i + 1, j)], [b(i, j), b(i, j + 1), b(i + 1, j + 1)]]
    for i in range(nx):          # y = 0 and y = y1 sides
        F += [[t(i, 0), b(i, 0), b(i + 1, 0)], [t(i, 0), b(i + 1, 0), t(i + 1, 0)]]
        F += [[t(i, ny), t(i + 1, ny), b(i + 1, ny)], [t(i, ny), b(i + 1, ny), b(i, ny)]]
    for j in range(ny):          # x = 0 and x = x1 sides
        F += [[t(0, j), t(0, j + 1), b(0, j + 1)], [t(0, j), b(0, j + 1), b(0, j)]]
        F += [[t(nx, j), b(nx, j), b(nx, j + 1)], [t(nx, j), b(nx, j + 1), t(nx, j + 1)]]
    return {"type": "mesh", "v": V, "f": F}


def flood(zc, spread, ys=(2.5, 7.5, 12.5, 17.5), x0=0.0, x1=20.0, mode="pool", k=1.0):
    """A row of parallel tunnels along X at height zc that together clear a whole storey between its floor and ceiling plates."""
    return [src_line([(x0, y, zc), (x1, y, zc)], dose_for(spread, x1 - x0, k), spread, mode) for y in ys]


def flood_y(zc, spread, xs=(2.5, 7.5, 12.5, 17.5), y0=0.0, y1=20.0, mode="pool", k=1.0):
    return [src_line([(x, y0, zc), (x, y1, zc)], dose_for(spread, y1 - y0, k), spread, mode) for x in xs]
