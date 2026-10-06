"""Helpers for the V6 tile set: the same family contract as V4 (20 ft lattice, floors at 1 / 11 / 21 ft, frameless doorways at the shared datums, the shared walking
rules) but NOTHING reads as built: the outline of the tile is eroded, every wall is foam left between voids, there are no frames, piers, slabs-as-walls or straight cuts, and the
floors that remain are flat on top with irregular, lobed edges.

What is new, and why:
  * `envelope`: the container is a voxel MASK (the engine's `mask` container) made from a rounded, noise-eroded solid: vertical edges and the crown are rounded, bays (a bite taken
    out of a corner, full height or only above/below some height) and the whole surface wander by a few feet. Next to every doorway the surface is held FLAT for a pad about 9 ft
    across, so two tiles still touch face to face where they have to; everywhere else the skin is free. Because cells outside the container belong to nobody, a bay is where a
    neighbour's rounded corner may sit (Arrange's cell-level collision policy): the shapes are made to interlock.
  * `terrain`: a flat-topped or sloped floor as a height grid with an irregular outline (the engine's `field` shape), the only hard element that survives: it reads as a shelf of
    ground, not a slab.
  * `lobed`: a room as a cluster of overlapping, leaning pods of different radii (a barrel, not a cylinder); `soft_door` a tunnel that bends a little: no frame, no sill, no lintel.
All dimensions are feet, Z up, the tile's low corner at (0, 0, 0).
"""
import base64
import math
import os
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(HERE, "..", "v4"))
sys.path.insert(0, os.path.join(HERE, ".."))
from kit4 import *  # noqa: F401,F403,E402
import kit4 as _k4  # noqa: E402
import kit as _kit  # noqa: E402

SOFT5 = dict(noise=float(os.environ.get("V6_NOISE", 0.9)), scale=float(os.environ.get("V6_SCALE", 2.8)), grain=float(os.environ.get("V6_GRAIN", 0.35)))      # rougher foam than V4's 0.55 / 3.6 / 0.22: the walls are visibly worked
CELL = 0.5


# ---- smooth noise, vectorised ----------------------------------------------------------------------------------------------------------------
def noise3(seed, wavelength=7.0, octaves=2):
    """A smooth deterministic random function of (x, y, z) over numpy arrays, about -1..1 (a sum of plane waves in random directions)."""
    rs = np.random.RandomState(seed)
    waves = []
    for o in range(octaves):
        for _ in range(5):
            d = rs.normal(size=3)
            d /= np.linalg.norm(d)
            k = 2 * math.pi / (wavelength / (1.8 ** o)) * rs.uniform(0.8, 1.25)
            waves.append((k * d, rs.uniform(0, 2 * math.pi), 1.0 / (1.6 ** o)))
    norm = sum(w[2] for w in waves) / 1.5

    def f(x, y, z):
        s = 0.0
        for kv, ph, a in waves:
            s = s + a * np.sin(kv[0] * x + kv[1] * y + kv[2] * z + ph)
        return s / norm
    return f


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _smax(a, b, k):
    """Smooth maximum (a rounded intersection): the polynomial blend, k = how far from the crease it starts to round."""
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


def _rounded_rect_sdf(px, py, cx, cy, hx, hy, r):
    qx = np.abs(px - cx) - (hx - r)
    qy = np.abs(py - cy) - (hy - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def pack_bits(b):
    return base64.b64encode(zlib.compress(np.packbits(np.asarray(b, dtype=bool).ravel()).tobytes(), 6)).decode("ascii")


# ---- the envelope ------------------------------------------------------------------------------------------------------------------------------
def bay(corner, bx, by, fillet=3.0, z0=None, z1=None):
    """A bite out of a vertical corner: bx x by ft in plan at `corner` (ne, nw, se, sw), its inner corner rounded by `fillet`, over the heights z0..z1 (None = to the ends)."""
    return dict(corner=corner, bx=bx, by=by, fillet=fillet, z0=z0, z1=z1)


def envelope(size=(20.0, 20.0, 20.0), seed=1, amp=0.9, wave=7.0, round_v=3.0, round_top=3.5, bays=(), pads=(), sag=1.2, cell=CELL, foot=0.0, roof=2.0):
    """The container: a mask of an eroded block. `pads` are doorway places (axis, plane, u, zc) where the skin is held flat (about 9 ft across); everything else wanders by
    +- `amp` ft (wavelength `wave`). Returns (container dict for the recipe, boolean mask array (nx, ny, nz), (nx, ny, nz))."""
    W, D, H = size
    nx, ny, nz = int(round(W / cell)), int(round(D / cell)), int(round(H / cell))
    xs = (np.arange(nx) + 0.5) * cell
    ys = (np.arange(ny) + 0.5) * cell
    zs = (np.arange(nz) + 0.5) * cell
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    cx, cy = W / 2.0, D / 2.0
    d_lat = _rounded_rect_sdf(X, Y, cx, cy, W / 2.0, D / 2.0, round_v)
    # the crown is not a plane: it slumps and lumps by up to `roof` ft (a low, wide undulation) before the rounding
    nr = noise3(seed + 202, 11.0, 1)(X, Y, Z * 0.0)
    # ... except for a flat landing at the crown (about 6 ft across, level with the top of the block) where the next tile up rests on this one
    rf = _sstep(3.0, 7.0, np.hypot(X - cx, Y - cy))
    d = _smax(d_lat, Z - (H - roof * (0.5 - 0.5 * nr) * rf), round_top)
    # bays
    for b in bays:
        sx = 1 if "e" in b["corner"] else -1
        sy = 1 if "n" in b["corner"] else -1
        x_in = W - b["bx"] if sx > 0 else b["bx"]
        y_in = D - b["by"] if sy > 0 else b["by"]
        # a rounded rectangle reaching beyond the tile from its inner corner
        reach = 30.0
        bw = (abs((W if sx > 0 else 0.0) + sx * reach - x_in)) / 2.0
        bh = (abs((D if sy > 0 else 0.0) + sy * reach - y_in)) / 2.0
        bcx = x_in + sx * bw
        bcy = y_in + sy * bh
        d_bay = _rounded_rect_sdf(X, Y, bcx, bcy, bw, bh, min(b["fillet"], bw, bh))
        if b["z0"] is not None or b["z1"] is not None:
            lo = -1e3 if b["z0"] is None else (b["z0"] - Z)
            hi = -1e3 if b["z1"] is None else (Z - b["z1"])
            d_bay = _smax(d_bay, np.maximum(lo, hi), 1.0)
        d = _smax(d, -d_bay, 1.2)
    # the surface wanders; near a doorway it does not
    n1 = noise3(seed, wave, 2)
    n2 = noise3(seed + 101, wave * 2.2, 1)
    # erosion only ever takes material away: the skin recedes from the ideal block by 0 to amp + sag ft and never bulges past it, so a neighbour that nests into a bay always has room
    wob = amp * (0.5 + 0.5 * n1(X, Y, Z)) + sag * (0.5 + 0.5 * n2(X, Y, Z))
    free = np.ones_like(d)
    for axis, plane, u, zc in pads:
        if axis == "x":
            dist = np.sqrt((X - plane) ** 2 * 0.25 + (Y - u) ** 2 + (Z - zc) ** 2 * 0.8)
        else:
            dist = np.sqrt((X - u) ** 2 + (Y - plane) ** 2 * 0.25 + (Z - zc) ** 2 * 0.8)
        free = np.minimum(free, _sstep(4.5, 9.0, dist))
    # the floor stays level: the wobble fades to nothing at the bottom edge (the ground slab is the foot of every tile)
    free = free * _sstep(0.0, 2.5 + foot, Z)
    free = free * (1.0 - (1.0 - rf) * _sstep(H - 4.0, H - 1.0, Z))      # the crown landing is not worn either
    d0 = d.copy()                                         # the ideal block with its rounding and its bays, before the skin is worn
    d = d + wob * free
    inside = d < 0.0
    inside[:, :, 0:2] |= (d0[:, :, 0:2] < 0.0)             # a solid ground slab under everything (but never in a bay: the bays are where the neighbours go)
    # one body, no holes
    from scipy import ndimage
    lab, n = ndimage.label(inside)
    if n > 1:
        sizes = np.bincount(lab.ravel())[1:]
        inside = lab == (1 + int(np.argmax(sizes)))
    inside = ndimage.binary_fill_holes(inside)
    cont = {"kind": "mask", "origin": [0.0, 0.0, 0.0], "cell": cell, "shape": [nx, ny, nz], "mask": pack_bits(inside)}
    return cont, inside, (nx, ny, nz)


# ---- floors -------------------------------------------------------------------------------------------------------------------------------------
def terrain(fn, inside=None, n=40, zbot=0.0, size=20.0, x0=0.0, y0=0.0):
    """A floor (or a slope) as a height grid: the top is z = fn(x, y), solid from `zbot` up to it; `inside(x, y)` says where it exists (an irregular outline)."""
    step = size / n
    xs = [x0 + step * i for i in range(n + 1)]
    ys = [y0 + step * j for j in range(n + 1)]
    out = {"type": "field", "x0": x0, "y0": y0, "step": step, "nx": n, "ny": n,
           "top": [(lambda v: int(v) if v == int(v) else v)(round(float(fn(x, y)), 2)) for x in xs for y in ys], "zbot": zbot}
    if inside is not None:
        bits = []
        for i in range(n):
            for j in range(n):
                bits.append("1" if inside(x0 + step * (i + 0.5), y0 + step * (j + 0.5)) else "0")
        out["mask"] = "".join(bits)
    return out


def lobe_fn(cx, cy, rx, ry, seed=1, wobble=0.25, lobes=5):
    """An irregular outline (a blob with `lobes` swells): True inside. The edge of a floor that reads as eroded, not cut."""
    rs = np.random.RandomState(seed)
    ph = rs.uniform(0, 2 * math.pi, 3)
    am = [wobble, wobble * 0.6, wobble * 0.4]
    fr = [lobes, lobes * 2 + 1, 3]

    def f(x, y):
        a = math.atan2((y - cy) / ry, (x - cx) / rx)
        r = 1.0 + sum(am[i] * math.sin(fr[i] * a + ph[i]) for i in range(3)) * 0.5
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= r * r
    return f


def ground(top=D0, zbot=0.0):
    """The ground slab: the whole footprint (the envelope trims it), flat on top."""
    return terrain(lambda x, y: top, None, n=20, zbot=zbot, size=24.0, x0=-2.0, y0=-2.0)


def floor_group(name, shapes, resistance=3.0):
    return plate_group(name, shapes, thickness=1.0, resistance=resistance, auto_support=False)


# ---- rooms and doorways ------------------------------------------------------------------------------------------------------------------------
def lobed(cx, cy, z0, z1, r, seed=1, n=3, spread=0.75, lean=0.12, k=1.8, plate_mode="pool"):
    """A room as a cluster of `n` overlapping, leaning pods (radius r overall): a barrel with lobes, never one cylinder. Returns a list of sources."""
    rs = np.random.RandomState(seed)
    out = []
    k = k * float(os.environ.get("V6_K", 1.0))
    for i in range(n):
        a = rs.uniform(0, 2 * math.pi)
        off = r * spread * (0.0 if i == 0 else rs.uniform(0.5, 1.0))
        px, py = cx + off * math.cos(a), cy + off * math.sin(a)
        ri = r * (0.78 if i else 1.0) * rs.uniform(0.85, 1.05)
        h = z1 - z0
        za, zb = z0 + rs.uniform(0.0, 0.1) * h, z1 - rs.uniform(0.0, 0.2) * h
        la = rs.uniform(0, 2 * math.pi)
        lx, ly = lean * h * math.cos(la), lean * h * math.sin(la)
        R = ri / 1.15
        spreadw = R / 0.85
        out.append(src_line([(px, py, za + 0.4), (px + lx, py + ly, zb - 0.4)], int(round(k * math.pi * R * R * (zb - za + 1.3 * R))), spreadw, plate_mode, False))
    return out


def soft_door(axis, plane, u, floor, inward, spread=4.5, depth=8.0, k=0.8, bend=0.7, seed=1, slope=0.0, plate_mode="pool"):
    """A doorway through any plane (a face or the wall of a bay): a tunnel that bends a little on its way in, no frame. `slope` tilts it up with a ramp."""
    rs = np.random.RandomState(seed)
    k = k * float(os.environ.get("V6_DK", 1.0))
    zc = floor + 0.85 * spread + 0.05
    pts = []
    for t in (-1.2, depth * 0.45, depth):
        along = plane + inward * t
        lat = u + (bend * rs.uniform(-1, 1) if 0 < t < depth else 0.0)
        z = zc + slope * max(t, 0.0)
        pts.append((along, lat, z) if axis == "x" else (lat, along, z))
    pts = pts[::-1]
    return src_line(pts, dose_for(spread, depth + 1.2, k), spread, plate_mode, False)


class SoftPorts:
    """The doorways of a V6 tile: `add(axis, plane, u, floor, inward, ...)` like V4's Ports, but only the tunnel (no frame, no sill). `pads()` tells the envelope where to
    keep the skin flat."""

    def __init__(self):
        self.items = []

    def add(self, axis, plane, u, floor, inward, **kw):
        self.items.append(dict(axis=axis, plane=plane, u=u, floor=floor, inward=inward, kw=kw))
        return self

    def face(self, name, u, floor, size=20.0, **kw):
        axis = "x" if name[1] == "x" else "y"
        plane = 0.0 if name[0] == "-" else size
        return self.add(axis, plane, u, floor, 1 if name[0] == "-" else -1, **kw)

    def pads(self):
        return [(p["axis"], p["plane"], p["u"], p["floor"] + 4.0) for p in self.items]

    def sources(self, foyer=True):
        """Per port: a tunnel that bends a little (the way through the skin) and, centred on the face itself, a vertical half-barrel (the foyer: the container ends at the face, so a pod centred on
        it carves a round alcove, about 6.6 ft wide and 8 ft high, that gives the opening a floor and a height wherever the rooms behind it erode)."""
        out = []
        for i, p in enumerate(self.items):
            kw = dict(p["kw"])
            slope = kw.get("slope", 0.0)
            out.append(soft_door(p["axis"], p["plane"], p["u"], p["floor"], p["inward"], seed=3 + i, **kw))
            if foyer:
                cx = p["plane"] + p["inward"] * 0.4
                pt = (cx, p["u"]) if p["axis"] == "x" else (p["u"], cx)
                f = p["floor"] + slope * 1.5
                out.append(pod(pt[0], pt[1], f - 0.2, f + 8.6, 2.8, k=1.2))
        return out


def recipe5(name, container, plates, sources, steps=170, gravity=0.5, seed=1, foam_seed=1, **kw):
    kw = {**SOFT5, **kw}
    gravity = float(os.environ.get("V6_GRAVITY", gravity))
    r = _kit.recipe(name, plates, sources, size=(20.0, 20.0, 20.0), steps=steps, gravity=gravity, seed=seed, foam_seed=foam_seed, cell=0.5, smooth=1.0,
                    min_void=6.0, min_foam=30.0, weld="", web=0.0, **kw)
    r["container"] = container
    r["meta"] = _k4.tile_meta4(name)
    return r


# ==== V6: a cubic envelope, stepped tops, wide openings =========================================================================================================
def box_cut(x0, x1, y0, y1, z0, z1):
    """A box (feet) taken out of the container."""
    return (x0, x1, y0, y1, z0, z1)


def step_top(side, depth, drop, size=(20.0, 20.0, 20.0)):
    """A STEPPED TOP: a strip `depth` ft deep along one side (x-, x+, y-, y+) is cut off the top, `drop` ft down. The tile is no longer a cube, but a cube shifted by (depth, 0, drop) of the lattice
    (for depth and drop of 10 ft: the 10 ft shifted lattice) fills exactly what this tile leaves behind, and the floors at 1 / 11 / 21 ft meet."""
    W, D, H = size
    if side == "x-":
        return box_cut(0, depth, 0, D, H - drop, H)
    if side == "x+":
        return box_cut(W - depth, W, 0, D, H - drop, H)
    if side == "y-":
        return box_cut(0, W, 0, depth, H - drop, H)
    return box_cut(0, W, D - depth, D, H - drop, H)


def step_bottom(side, depth, rise, size=(20.0, 20.0, 20.0)):
    """A STEPPED BOTTOM: the same cut from the underside (a neighbour shifted down fills it). The ground slab under the cut is gone, so the floors of this tile on that side are at the upper datum."""
    W, D, H = size
    if side == "x-":
        return box_cut(0, depth, 0, D, 0, rise)
    if side == "x+":
        return box_cut(W - depth, W, 0, D, 0, rise)
    if side == "y-":
        return box_cut(0, W, 0, depth, 0, rise)
    return box_cut(0, W, D - depth, D, 0, rise)


def cube_env(size=(20.0, 20.0, 20.0), steps=(), cell=CELL):
    """The container of a V6 tile: the whole cubic block (flat faces, sharp edges) less any stepped tops or bottoms. Returns (container dict, boolean mask, shape)."""
    W, D, H = size
    nx, ny, nz = int(round(W / cell)), int(round(D / cell)), int(round(H / cell))
    xs = (np.arange(nx) + 0.5) * cell
    ys = (np.arange(ny) + 0.5) * cell
    zs = (np.arange(nz) + 0.5) * cell
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    inside = np.ones((nx, ny, nz), dtype=bool)
    for (x0, x1, y0, y1, z0, z1) in steps:
        inside &= ~((X >= x0) & (X < x1) & (Y >= y0) & (Y < y1) & (Z >= z0) & (Z < z1))
    cont = {"kind": "mask", "origin": [0.0, 0.0, 0.0], "cell": cell, "shape": [nx, ny, nz], "mask": pack_bits(inside)}
    return cont, inside, (nx, ny, nz)


class WidePorts(SoftPorts):
    """Openings of a V6 tile: wide and tall (about 11 ft by 9 ft), frameless, an arched barrel at the face with a short tunnel behind it, at the shared floor datums. `wide` is the tunnel spread."""

    def __init__(self, wide=5.6, foyer_r=3.7, foyer_h=9.4, plate_mode="pool", door_k=0.8, foyer_k=1.2):
        super().__init__()
        self.wide, self.foyer_r, self.foyer_h, self.plate_mode, self.door_k, self.foyer_k = wide, foyer_r, foyer_h, plate_mode, door_k, foyer_k

    def add(self, axis, plane, u, floor, inward, **kw):
        kw.setdefault("spread", self.wide)
        return super().add(axis, plane, u, floor, inward, **kw)

    def sources(self, foyer=True):
        out = []
        for i, p in enumerate(self.items):
            kw = dict(p["kw"])
            slope = kw.get("slope", 0.0)
            kw.setdefault("plate_mode", self.plate_mode)
            kw.setdefault("k", self.door_k)
            out.append(soft_door(p["axis"], p["plane"], p["u"], p["floor"], p["inward"], seed=3 + i, **kw))
            if foyer:
                cx = p["plane"] + p["inward"] * 0.4
                pt = (cx, p["u"]) if p["axis"] == "x" else (p["u"], cx)
                f = p["floor"] + slope * 1.5
                out.append(pod(pt[0], pt[1], f - 0.2, f + self.foyer_h, self.foyer_r, k=self.foyer_k, plate_mode=kw["plate_mode"]))
        return out


def meta6(name):
    """Category, typology, slot and variant of a V6 tile; a cubic backup (`..._v6c`) is the same tile with variant V6C."""
    import re
    base = re.sub(r"_v6c$", "_v6", name)
    m = _k4.tile_meta4(base)
    m["variant"] = "V6C" if name.endswith("_v6c") else "V6"
    return m


def recipe6(name, container, plates, sources, steps=170, gravity=0.5, seed=1, foam_seed=1, **kw):
    r = recipe5(name, container, plates, sources, steps=steps, gravity=gravity, seed=seed, foam_seed=foam_seed, **kw)
    r["meta"] = meta6(name)
    return r
