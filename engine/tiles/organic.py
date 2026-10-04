"""The organic toolkit for the tile set: sinuous passages that swell and pinch, chambers, and plates that are strata (warped,
curved-edged, partly eaten) instead of boxes. Everything is in feet, Z up, tile low corner at (0, 0, 0). Builds on kit.py.

Voids (acetone sources):
  passage(pts, spread)            one soft passage along a smooth curve through the points (a spline, not a polyline)
  vein(pts, spreads)              a passage whose width changes along it: spreads are the widths at evenly spaced stations (one source
                                  per stretch; the engine takes at most 24 sources per tile)
  chamber(pt, spread)             a rounded room (a dome that settles on whatever floor is below it)
  through_shaft(x, y, z0, z1, r0, r1)   a vertical shaft that flares from radius r0 (at z0) to r1 (at z1)

Plates (protected foam, flat tops):
  shell(top, thick, inside=None)  a warped slab: top(x, y) is the height of its top face, thick the thickness below it; `inside(x, y)` clips
                                  it to an outline (curved edges), so the slab can be a tongue, a crescent, a terrace, a ribbon
  ribbon(path, widths, thick)     a slab swept along a 3D path (a ramp or street that bends in plan and climbs)
  blob(cx, cy, rx, ry, z, seed)   the outline of an irregular island, as a flat curve (top of a slab)
  field(seed, wavelength)         a smooth random function f(x, y) in about -1..1, for warping outlines and surfaces
"""
import math

import numpy as np

from kit import *  # noqa: F401,F403


# ---------------------------------------------------------------------------------------------------- smooth functions
def field(seed, wavelength=8.0, octaves=3):
    """A deterministic smooth random function of (x, y) with values in about -1..1 (a sum of a few waves)."""
    rs = np.random.RandomState(seed)
    waves = []
    for o in range(octaves):
        for _ in range(3):
            a = rs.uniform(0, 2 * math.pi)
            k = 2 * math.pi / (wavelength / (1.7 ** o)) * rs.uniform(0.8, 1.2)
            waves.append((k * math.cos(a), k * math.sin(a), rs.uniform(0, 2 * math.pi), 1.0 / (1.5 ** o)))
    norm = sum(w[3] for w in waves) / 1.6

    def f(x, y):
        return sum(w[3] * math.sin(w[0] * x + w[1] * y + w[2]) for w in waves) / norm
    return f


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------- curves
def spline(pts, step=1.5):
    """Catmull-Rom curve through the points (any dimension), sampled about every `step` ft. Ends are kept."""
    P = [np.array(p, dtype=float) for p in pts]
    if len(P) < 3:
        return [tuple(p) for p in P]
    Q = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        n = max(2, int(math.ceil(float(np.linalg.norm(p2 - p1)) / step)))
        for s in range(n):
            t = s / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return [tuple(float(c) for c in p) for p in out]


def closed_spline(pts, per=6):
    """A smooth closed curve through the points (for outlines)."""
    P = [np.array(p, dtype=float) for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return [tuple(float(c) for c in p) for p in out]


def blob(cx, cy, rx, ry, z, seed=1, wobble=0.22, n=40):
    """Outline of an irregular island (flat curve, z = the top of the slab)."""
    rs = np.random.RandomState(seed)
    ph = rs.uniform(0, 2 * math.pi, 4)
    am = rs.uniform(0.4, 1.0, 4)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        r = 1.0 + wobble * sum(am[k] * math.sin((k + 2) * t + ph[k]) for k in range(4)) / 2.0
        pts.append([round(cx + rx * r * math.cos(t), 3), round(cy + ry * r * math.sin(t), 3), z])
    return pts


# ---------------------------------------------------------------------------------------------------- voids
def passage(pts, spread, dose=None, plate_mode="pool", cut=False, k=0.8, step=1.5):
    dense = spline(pts, step)
    length = sum(math.dist(dense[i], dense[i + 1]) for i in range(len(dense) - 1))
    return src_line(dense, dose or dose_for(spread, length, k), spread, plate_mode, cut)


def vein(pts, spreads, plate_mode="pool", cut=False, k=0.9):
    """A passage whose width follows `spreads` (one width per station, stations evenly spaced along the curve): it swells into rooms and
    pinches into throats. One source per stretch between stations (the engine takes at most 24 sources per tile), each with its own width."""
    dense = spline(pts, 1.0)
    L = [0.0]
    for i in range(len(dense) - 1):
        L.append(L[-1] + math.dist(dense[i], dense[i + 1]))
    n = len(spreads)
    cuts = [int(np.searchsorted(L, L[-1] * i / (n - 1))) for i in range(n)]
    cuts[-1] = len(dense) - 1
    out = []
    for i in range(n - 1):
        a, b = cuts[i], max(cuts[i + 1], cuts[i] + 1)
        seg = dense[a:b + 1]
        s = (spreads[i] + spreads[i + 1]) / 2.0
        length = sum(math.dist(seg[j], seg[j + 1]) for j in range(len(seg) - 1))
        out.append(src_line(seg, dose_for(s, length + s, k), s, plate_mode, cut))
    return out


def chamber(pt, spread, k=1.5, plate_mode="pool", cut=False):
    return src_inject(pt, int(round(k * 0.8 * 4.0 / 3.0 * math.pi * (0.85 * spread) ** 3)), spread, plate_mode, cut)


def through_shaft(x, y, z0, z1, r0, r1, plate_mode="through", cut=False, n=5, drift=(0.0, 0.0), k=1.0):
    """A vertical shaft that changes radius from r0 at z0 to r1 at z1 (a funnel), as a stack of short pieces; `drift` leans it by (dx, dy) over its height."""
    out = []
    for i in range(n):
        a, b = z0 + (z1 - z0) * i / n, z0 + (z1 - z0) * (i + 1) / n
        r = r0 + (r1 - r0) * (i + 0.5) / n
        da, db = i / n, (i + 1) / n
        out.append(src_line([(x + drift[0] * da, y + drift[1] * da, a), (x + drift[0] * db, y + drift[1] * db, b)],
                            dose_for(r, (b - a) * 1.3, 0.8 * k), r, plate_mode, cut))
    return out


# ---------------------------------------------------------------------------------------------------- plates
def shell(top, thick, inside=None, x0=0.0, y0=0.0, x1=20.0, y1=20.0, step=1.0):
    """A warped slab, stored as a height grid (the engine reads the shape type "field"): top(x, y) = height of the top face, the bottom is
    `thick` below it; inside(x, y) clips it to an outline. The outline follows the grid (about `step` ft), which reads as a bitten edge.
    A grid is a few hundred numbers where the same slab as a triangle mesh is thousands, and a recipe has to be short enough to paste."""
    nx, ny = int(round((x1 - x0) / step)), int(round((y1 - y0) / step))
    xs = [x0 + (x1 - x0) * i / nx for i in range(nx + 1)]
    ys = [y0 + (y1 - y0) * j / ny for j in range(ny + 1)]
    heights = [round(float(top(x, y)), 2) for x in xs for y in ys]
    mask = ""
    for i in range(nx):
        for j in range(ny):
            mask += "1" if (inside is None or inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)) else "0"
    if "1" not in mask:
        raise ValueError("shell: the outline holds no area")
    out = {"type": "field", "x0": x0, "y0": y0, "step": (x1 - x0) / nx, "nx": nx, "ny": ny, "top": heights, "thick": thick}
    if inside is not None:
        out["mask"] = mask
    return out


def ground_field(fn, n=20, zbot=0.0, size=20.0):
    """Solid ground under the surface z = fn(x, y), from zbot, as a height grid (n x n cells over the tile)."""
    xs = [size * i / n for i in range(n + 1)]
    return {"type": "field", "x0": 0.0, "y0": 0.0, "step": size / n, "nx": n, "ny": n,
            "top": [round(float(fn(x, y)), 2) for x in xs for y in xs], "zbot": zbot}


def ribbon(path, widths, thick, samples=None):
    """A slab swept along a 3D path [(x, y, z), ...] (the TOP surface follows the path and is level across): its width in plan changes
    along it (`widths` = values at evenly spaced stations). Closed mesh; the path must not fold back over itself in plan."""
    dense = spline(path, 1.0)
    P = np.array(dense)
    n = len(P)
    seg = np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1)
    s = np.concatenate(([0.0], np.cumsum(seg)))
    w = np.interp(s / s[-1], np.linspace(0, 1, len(widths)), widths) / 2.0
    T = np.gradient(P[:, :2], axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = np.stack([-T[:, 1], T[:, 0]], axis=1)
    V = []
    for side in (1, -1):
        for i in range(n):
            V.append([round(P[i, 0] + side * N[i, 0] * w[i], 4), round(P[i, 1] + side * N[i, 1] * w[i], 4), round(P[i, 2], 4)])
    top_l, top_r = 0, n
    for side in (1, -1):
        for i in range(n):
            V.append([V[(0 if side == 1 else n) + i][0], V[(0 if side == 1 else n) + i][1], round(P[i, 2] - thick, 4)])
    bl, br = 2 * n, 3 * n
    F = []
    for i in range(n - 1):
        F += [[top_l + i, top_r + i, top_r + i + 1], [top_l + i, top_r + i + 1, top_l + i + 1]]
        F += [[bl + i, br + i + 1, br + i], [bl + i, bl + i + 1, br + i + 1]]
        F += [[top_l + i, top_l + i + 1, bl + i + 1], [top_l + i, bl + i + 1, bl + i]]
        F += [[top_r + i, br + i + 1, top_r + i + 1], [top_r + i, br + i, br + i + 1]]
    F += [[top_l, bl, br], [top_l, br, top_r]]
    F += [[top_l + n - 1, top_r + n - 1, br + n - 1], [top_l + n - 1, br + n - 1, bl + n - 1]]
    return {"type": "mesh", "v": V, "f": F}


def column(cx, cy, profile, seed=1, wobble=0.12, n=18):
    """A pillar turned from a profile [(z, radius), ...] (bottom to top), with an irregular edge so it reads as a remnant, not a post.
    Closed mesh; stands between its first and last z."""
    rs = np.random.RandomState(seed)
    ph = rs.uniform(0, 2 * math.pi, (len(profile), 2))
    V = []
    for k, (z, r) in enumerate(profile):
        for j in range(n):
            t = 2 * math.pi * j / n
            rr = r * (1.0 + wobble * (math.sin(2 * t + ph[k, 0]) + 0.6 * math.sin(3 * t + ph[k, 1])) / 1.6)
            V.append([round(cx + rr * math.cos(t), 4), round(cy + rr * math.sin(t), 4), round(float(z), 4)])
    bot, top = len(V), len(V) + 1
    V.append([round(cx, 4), round(cy, 4), round(float(profile[0][0]), 4)])
    V.append([round(cx, 4), round(cy, 4), round(float(profile[-1][0]), 4)])
    F = []
    for k in range(len(profile) - 1):
        for j in range(n):
            a, b = k * n + j, k * n + (j + 1) % n
            c, d = (k + 1) * n + j, (k + 1) * n + (j + 1) % n
            F += [[a, b, d], [a, d, c]]
    for j in range(n):
        F.append([bot, (j + 1) % n, j])
        F.append([top, (len(profile) - 1) * n + j, (len(profile) - 1) * n + (j + 1) % n])
    return {"type": "mesh", "v": V, "f": F}


# ---------------------------------------------------------------------------------------------------- ports (the interlock standard)
PORT_Z = {"L": 6.0, "U": 16.0}          # lower and upper storey: the heights at which every tile meets the next one


def port(face, which="LU", s=4.4, k=1.5, u=10.0):
    """The standard opening on a side face: a half-chamber centred on the face at u (default the middle) and at the lower (L, z 6)
    and/or upper (U, z 16) storey. Every tile carries it on at least two faces, so tiles meet each other across joints whatever is
    behind them. face is '-x', '+x', '-y' or '+y'."""
    at = {"-x": (0.0, u), "+x": (20.0, u), "-y": (u, 0.0), "+y": (u, 20.0)}[face]
    return [chamber((at[0], at[1], PORT_Z[w]), s, k=k) for w in which]


def street(path, widths, thick, step=0.5):
    """A ribbon of floor that follows a 3D path (x, y, z) and changes width along it, as a shell clipped to a band around the path in plan:
    the top is level across the band and takes the height of the nearest point of the path. Its edges follow the grid, so they read as
    eroded rather than drawn. One closed mesh with a single layer per column, so it never overlaps itself on a bend."""
    P = np.array(spline(path, 0.5))
    seg = np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1)
    t = np.concatenate(([0.0], np.cumsum(seg)))
    t = t / t[-1]
    half = np.interp(t, np.linspace(0, 1, len(widths)), widths) / 2.0

    def nearest(x, y):
        d = np.hypot(P[:, 0] - x, P[:, 1] - y)
        i = int(np.argmin(d))
        return i, float(d[i])

    def top(x, y):
        return float(P[nearest(x, y)[0], 2])

    def inside(x, y):
        i, d = nearest(x, y)
        return d <= half[i]
    return shell(top, thick, inside=inside, step=step)
