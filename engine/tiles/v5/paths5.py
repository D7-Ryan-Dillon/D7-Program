"""Path helpers for the V5 tiles (ramps and ledges that follow a curve, and the small functions the tile definitions share)."""
import math

import numpy as np

from kit5 import *  # noqa: F401,F403


def path_pods(path, r=2.8, height=8.6, spacing=4.0, k=1.7, skip=0.0, stop=0.0, plate_mode="pool"):
    """The room over a ramp or ledge that follows `path` [(x, y, z), ...]: a row of vertical pods that START at the walking surface (so the solvent pools on it and the floor of the
    void is the ramp) and stand `height` ft above it, one every `spacing` ft; the first `skip` and the last `stop` ft are left alone (the skin at a face stays)."""
    P = spline(path, 0.5)
    s = [0.0]
    for i in range(len(P) - 1):
        s.append(s[-1] + math.dist(P[i], P[i + 1]))
    total = s[-1]
    n = max(1, int(round((total - skip - stop) / spacing)))
    kk = k * min(1.0, spacing / (1.8 * r))
    out = []
    for j in range(n + 1):
        d = skip + (total - skip - stop) * j / n
        i = min(int(np.searchsorted(s, d)), len(P) - 1)
        x, y, z = P[i]
        out.append(pod(float(x), float(y), float(z) - 0.2, float(z) + height, r, k=kk, plate_mode=plate_mode))
    return out


def smooth_noise2(seed, wave=8.0):
    f = field(seed, wave, 2)
    return lambda x, y: f(x, y)


def clamp01(t):
    return max(0.0, min(1.0, t))


def sstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def skin_field(mask, cell=CELL):
    """Distance (ft) from every cell of the container to the nearest cell outside it (the grid edge counts as outside): how much foam a void at that spot has to the outside."""
    from scipy import ndimage
    pad = np.pad(np.asarray(mask, dtype=bool), 1, constant_values=False)
    pad[:, :, 0] = True                                  # the ground under the tile is not an outside: a floor is not a skin
    d = ndimage.distance_transform_edt(pad, sampling=cell)
    return d[1:-1, 1:-1, 1:-1]


def tame(sources, mask, skin=1.3, min_spread=1.7, ratio=0.98, cell=CELL):
    """Keep the skin: shrink any source (a room, a throat) that would come closer than `skin` ft to the outside of the eroded envelope (the roof included), by shrinking its spread and
    its dose (dose follows the square of the spread). The doors are not passed through here, so they still breach the skin. Returns new sources."""
    D = skin_field(mask, cell)
    nx, ny, nz = D.shape
    out = []
    for s in sources:
        pts = s.get("pts") or [s.get("pt")]
        dense = []
        for a, b in zip(pts[:-1], pts[1:]) if len(pts) > 1 else [(pts[0], pts[0])]:
            n = max(1, int(math.dist(a, b) / 0.5))
            dense += [tuple(a[q] + (b[q] - a[q]) * i / n for q in range(3)) for i in range(n + 1)]
        dmin = 1e9
        for x, y, z in dense:
            i, j, k = int(x / cell), int(y / cell), int(z / cell)
            if 0 <= i < nx and 0 <= j < ny and 0 <= k < nz:
                dmin = min(dmin, float(D[i, j, k]))
            else:
                dmin = 0.0
        reff = ratio * s["spread"]
        allowed = dmin - skin
        t = dict(s)
        if allowed < reff:
            new = max(min_spread, allowed / ratio)
            f = (new / s["spread"]) ** 2
            t["spread"] = round(new, 3)
            t["dose"] = int(round(s["dose"] * f))
        out.append(t)
    return out


def ribbon2(path, widths, thick, step=1.7, nd=2):
    """organic.ribbon with a coarser sampling and shorter numbers (a long spiral would otherwise not fit in a pasted recipe)."""
    dense = spline(path, step)
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
            V.append([round(float(P[i, 0] + side * N[i, 0] * w[i]), nd), round(float(P[i, 1] + side * N[i, 1] * w[i]), nd), round(float(P[i, 2]), nd)])
    top_l, top_r = 0, n
    for side in (1, -1):
        for i in range(n):
            j = (0 if side == 1 else n) + i
            V.append([V[j][0], V[j][1], round(float(P[i, 2] - thick), nd)])
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


def shelf(fn, inside, box, step=0.5, zbot=0.0):
    """terrain() over a rectangle `box` = (x0, y0, x1, y1) only (a shelf does not need a 20 x 20 ft grid of numbers): the recipe stays short. Integer heights are written as integers."""
    x0, y0, x1, y1 = box
    nx, ny = int(round((x1 - x0) / step)), int(round((y1 - y0) / step))
    top = []
    for i in range(nx + 1):
        for j in range(ny + 1):
            v = round(float(fn(x0 + step * i, y0 + step * j)), 2)
            top.append(int(v) if v == int(v) else v)
    out = {"type": "field", "x0": x0, "y0": y0, "step": step, "nx": nx, "ny": ny, "top": top, "zbot": zbot}
    if inside is not None:
        out["mask"] = "".join("1" if inside(x0 + step * (i + 0.5), y0 + step * (j + 0.5)) else "0" for i in range(nx) for j in range(ny))
    return out
