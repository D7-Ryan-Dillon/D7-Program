# r: numpy, scipy, scikit-image
# =====================================================================
# EROSION CA - ENGINE (Step 5f: two-folder export, recipes, cleanup, seam weld)
# Units: feet (decimal). 0.5 = 6 inches.
# Collects any number of acetone applications from Source components
# (wire every Source's `src` output into `sources`), runs the erosion,
# and gives you smooth meshes + a frame scrubber.
#
#   sources : LIST of texts from Source components (set this input to List Access)
#   drain   : 0/False = solvent POOLS on the floor (widens the base)
#             1/True  = solvent FALLS OUT through open floor cells
#   foam    : text from a Foam component: seeded density variation (lobes, necks,
#             fine pitting) and optional evenly spaced layers. Blank = perfectly even foam.
#   view    : 0 material, 1 solvent, 2 FOAM DENSITY (shows the noise and the layers)
# EXPORT (one Button wired to `export` writes TWO folders next to each other in export_dir):
#   <tile_name>_analysis   everything the program needs: one GLB 3D model, voxels, the six faces, sections, projections,
#                          SVG drawings, tile.json (settings and volumes), manifest.json.
#   <tile_name>_reference  for you: <tile_name>.3dm (Rhino), recipe.json, log.txt, timelapse/.
#   export_dir    : folder to export into, e.g. C:\Users\you\Documents\Erosion Exports  (blank = Documents\Erosion Exports)
#   tile_name     : name for this tile, e.g. gathering_1_stepped_amphitheater  (a second export never overwrites: both folders become _v2)
#   section_count : how many sections along each axis (default 9)
#   export_log, export_path (outputs) : what was written; export_path is a list: [analysis folder, reference folder]
# NEW in Step 5e
#   recipe        : (input, text) the text of a recipe.json (paste it into a Panel), or the path of a recipe.json or a _reference folder.
#                   It REPLACES tile_w, tile_h, cell, steps, gravity, drain, seed, n_frames, smooth, foam, sources, min_void, min_foam and weld
#                   so the exact tile is rebuilt. frame, view, slice_* and the export inputs stay yours. Blank = your own inputs are used.
#   min_void      : (input, ft3, default 0 = off) fill SEALED void pockets smaller than this. Voids touching a tile face are never touched.
#   min_foam      : (input, ft3, default 0 = off) dissolve FLOATING foam pieces smaller than this. Foam touching a tile face is never touched.
#   weld          : (input, text, default blank = off) letters x, y and/or z, e.g. xy. Makes the two opposite faces on each of those axes
#                   IDENTICAL (they are averaged, and the change fades out over 3 ft into the tile), so copies repeated along that axis meet
#                   exactly: void meets void, floor meets floor. Only the last 3 ft of the tile move. Mirrored copies always meet exactly.
#   recipe_text   : (output) the recipe for what is on screen right now (paste it into a Panel to keep it, or use the one in the _reference folder).
#   tile_data (output) : the finished tile as text, only needed for the Aggregate component.
# =====================================================================
import base64
import datetime
import hashlib
import heapq
import itertools
import json
import math
import os
import re
import struct
import time
import zlib
from collections import defaultdict, deque
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure

# ---------------------------------------------------------------------
# Fixed tuning constants (later steps turn these into inputs / presets)
# ---------------------------------------------------------------------
DIFF_SOLID = 0.02      # how easily solvent creeps through intact foam
DIFF_VOID = 0.12       # how easily solvent spreads through open void
GRAVITY_MAX = 0.8      # fraction of solvent that falls one cell per step at gravity = 1
DISSOLVE_K = 0.5       # how aggressively solvent eats foam
EVAPORATION = 0.004    # fraction of solvent lost to air each step
DRAIN_RATE = 0.6       # fraction of solvent in fully open floor cells that leaves per step (drain on)
VOID_LEVEL = 0.5       # material below this counts as void
REF_CELL = 0.5         # ft. Rates are tuned for 6" cells; other cell sizes are rescaled to match
MAX_FRAME_BYTES = 300e6   # cap on memory used by stored frames
MAX_SOURCES = 24
NOISE_LATTICE = 0.25      # ft. Foam noise is made on this fixed lattice, so the same seed gives the same
                          # foam at any cell size (preview at 6", finish at 3", same pattern)
GRAIN_SCALE = 0.6         # ft. size of the fine pitting
K_DENSITY = 1.1           # how strongly the noise setting swings the foam density (at noise = 1)
K_PERM = 0.8              # how strongly it changes how easily solvent creeps through foam
WEB_AMP = 8.0             # how much denser a membrane is than the foam inside the cells (at web = 1)

# source types
INJECT, POUR, SPRAY, LINE = 0, 1, 2, 3
MODE_NAMES = {"inject": INJECT, "injection": INJECT, "i": INJECT,
              "pour": POUR, "p": POUR,
              "spray": SPRAY, "s": SPRAY,
              "line": LINE, "curve": LINE, "l": LINE}
MODE_LABEL = {INJECT: "inject", POUR: "pour", SPRAY: "spray", LINE: "line"}
DEFAULT_DOSE = {INJECT: 1500.0, POUR: 500.0, SPRAY: 200.0, LINE: 1800.0}
DEFAULT_SPREAD = {INJECT: 3.0, POUR: 1.0, SPRAY: 6.0, LINE: 2.0}
DEFAULT_DURATION = {INJECT: 0.0, POUR: 60.0, SPRAY: 10.0, LINE: 0.0}

_LOCAL_CACHE = {}
_COUNTERS = {"sims": 0}   # how many times the simulation really ran (for testing)


_RECIPE = {}     # values imposed by a wired recipe (filled at the start of every run)


def _inp(name, default):
    """Read a Grasshopper input by name; a wired recipe wins over the input; fall back to a default if unwired."""
    if name in _RECIPE:
        return _RECIPE[name]
    v = globals().get(name)
    return default if v is None else v


def _as_list(v):
    """Whatever came in -> a flat python list (None -> empty list)."""
    if v is None:
        return []
    if isinstance(v, (str, bytes, dict)):
        return [v]
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            out.extend(_as_list(x))
        return out
    try:                                   # .NET lists / arrays
        if hasattr(v, "__iter__") and not hasattr(v, "X"):
            return _as_list(list(v))
    except Exception:
        pass
    return [v]


def _truthy(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on", "drain")
    return bool(v)


# ---------------------------------------------------------------------
# CONTAINER MASK - this is the cube / hexagon swap point.
# ---------------------------------------------------------------------
def container_mask(shape, kind="cube"):
    if kind == "cube":
        return np.ones(shape, dtype=bool)
    raise ValueError("Unknown container kind: " + str(kind))


# ---------------------------------------------------------------------
# SOURCE BUILDING
# A "blob" is an axis-aligned gaussian of solvent. Every source type is
# made of blobs: inject = 1 round blob, pour = 1 blob on a face, spray =
# many small random blobs on a face, line = a chain of blobs along a curve.
# ---------------------------------------------------------------------
def add_blob(W, mask, cell, center, sig, weight=1.0):
    """Add a gaussian blob with equal total mass (x weight) inside the block."""
    shape = W.shape
    lo, hi = [], []
    for a in range(3):
        r = 4.0 * sig[a]
        lo_a = max(0, int(math.floor((center[a] - r) / cell)))
        hi_a = min(shape[a], int(math.ceil((center[a] + r) / cell)) + 1)
        if hi_a <= lo_a:
            return
        lo.append(lo_a)
        hi.append(hi_a)
    g = []
    for a in range(3):
        c = (np.arange(lo[a], hi[a]) + 0.5) * cell - center[a]
        g.append(np.exp(-c * c / (2.0 * sig[a] ** 2)))
    blob = g[0][:, None, None] * g[1][None, :, None] * g[2][None, None, :]
    win = (slice(lo[0], hi[0]), slice(lo[1], hi[1]), slice(lo[2], hi[2]))
    blob = blob * mask[win]
    tot = blob.sum()
    if tot > 0:
        W[win] += (weight / tot) * blob


def nearest_face(p, dims):
    """Nearest of the 6 block faces to point p. Returns (axis, plane coordinate). Ties prefer the top."""
    cands = [(dims[2] - p[2], 2, dims[2]), (p[2], 2, 0.0),
             (p[0], 0, 0.0), (dims[0] - p[0], 0, dims[0]),
             (p[1], 1, 0.0), (dims[1] - p[1], 1, dims[1])]
    d, axis, plane = min(cands, key=lambda t: t[0])
    return axis, plane


def ray_box(p, d, dims):
    """Where a ray from p along d first meets the block. Returns (t, entry axis) or None (miss).
    t < 0 means p is already inside the block."""
    tmin, tmax, axis_in = -1e18, 1e18, 0
    for a in range(3):
        if abs(d[a]) < 1e-12:
            if p[a] < 0.0 or p[a] > dims[a]:
                return None
            continue
        t1, t2 = (0.0 - p[a]) / d[a], (dims[a] - p[a]) / d[a]
        tn, tf = min(t1, t2), max(t1, t2)
        if tn > tmin:
            tmin, axis_in = tn, a
        tmax = min(tmax, tf)
    if tmin > tmax or tmax < 0.0:
        return None
    return tmin, axis_in


def resample_polyline(pts, spacing):
    P = np.asarray(pts, dtype=float)
    if len(P) < 2:
        return [tuple(P[0])]
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    total = float(L[-1])
    if total <= 1e-9:
        return [tuple(P[0])]
    n = int(np.clip(math.ceil(total / max(spacing, 1e-6)), 1, 600)) + 1
    t = np.linspace(0.0, total, n)
    return list(zip(np.interp(t, L, P[:, 0]), np.interp(t, L, P[:, 1]), np.interp(t, L, P[:, 2])))


def build_source(shape, cell, mask, spec, dims, rng):
    """Returns (W, info_text, display_point). W sums to dose_cells (0 if nothing lands in the block)."""
    W = np.zeros(shape, dtype=np.float32)
    landed = 1.0                                   # fraction of the dose that actually reaches the block
    mode, spread = spec["mode"], spec["spread"]
    dose_cells = spec["dose"] / (cell ** 3)
    sig0 = max(spread / 2.0, 0.75 * cell)

    if spec["kind"] == "crv":
        pts = resample_polyline(spec["pts"], max(0.25 * cell, 0.3 * sig0))
        for p in pts:
            add_blob(W, mask, cell, p, (sig0, sig0, sig0))
        info = "line along curve (%d blobs, width %.1f ft)" % (len(pts), spread)
        disp = pts[0]
    else:
        p = tuple(spec["pt"])
        if mode == INJECT:
            add_blob(W, mask, cell, p, (sig0, sig0, sig0))
            info = "inject at (%.1f, %.1f, %.1f)" % p
            disp = p
        elif mode == POUR:
            axis, plane = nearest_face(p, dims)
            face_pt = list(p)
            face_pt[axis] = plane
            disp = tuple(face_pt)
            sig = [sig0, sig0, sig0]
            sig[axis] = max(0.75 * cell, spread / 4.0)              # soaks in a little
            add_blob(W, mask, cell, disp, tuple(sig))
            info = "pour on face %s%s at (%.1f, %.1f, %.1f)" % (("-" if plane == 0.0 else "+"), "XYZ"[axis], disp[0], disp[1], disp[2])
        else:  # SPRAY
            R = max(spread / 2.0, cell)
            dn = None
            if spec.get("dir") is not None:
                dn = np.array(spec["dir"], dtype=float)
                nrm = np.linalg.norm(dn)
                dn = dn / nrm if nrm > 1e-9 else None
            hit = ray_box(p, dn, dims) if dn is not None else None
            note = ""
            if dn is not None and hit is not None and hit[0] >= 0.0:
                # nozzle outside the block, spraying along dn: the footprint is a disc square-on to the
                # spray, projected onto the face it hits (so an angled spray makes an ellipse)
                t, axis = hit
                plane = 0.0 if dn[axis] > 0 else dims[axis]
                hp = np.array(p, dtype=float) + t * dn
                hp[axis] = plane
                up = np.array([0.0, 0.0, 1.0]) if abs(dn[2]) < 0.95 else np.array([1.0, 0.0, 0.0])
                u = np.cross(dn, up)
                u /= np.linalg.norm(u)
                v = np.cross(dn, u)
                head = "spray from (%.1f, %.1f, %.1f) along (%.2f, %.2f, %.2f) hits" % (p[0], p[1], p[2], dn[0], dn[1], dn[2])
            else:
                if dn is not None and hit is None:
                    note = " (aimed spray misses the block, so it sprays the nearest face instead)"
                elif dn is not None:
                    note = " (source is inside the block, so the aim is ignored)"
                axis, plane = nearest_face(p, dims)
                hp = np.array(p, dtype=float)
                hp[axis] = plane
                dn = np.zeros(3)
                dn[axis] = 1.0 if plane == 0.0 else -1.0             # straight into the face
                lat = [a for a in range(3) if a != axis]
                u = np.zeros(3)
                v = np.zeros(3)
                u[lat[0]] = 1.0
                v[lat[1]] = 1.0
                head = "spray on"
            n = int(np.clip(math.pi * R * R / (cell * cell) * 0.25, 6, 150))
            sig_d = max(0.6 * cell, 0.18 * R)
            dimsa = np.array(dims, dtype=float)
            w_all = w_land = 0.0
            for _ in range(n):
                r = R * math.sqrt(rng.random())
                th = 2.0 * math.pi * rng.random()
                q = hp + r * math.cos(th) * u + r * math.sin(th) * v
                wgt = float(rng.lognormal(0.0, 0.6))
                w_all += wgt
                t2 = (plane - q[axis]) / dn[axis]
                c = q + t2 * dn                                      # where this droplet meets the face
                if np.any(c < -0.5 * cell) or np.any(c > dimsa + 0.5 * cell):
                    continue                                         # droplet misses the block: wasted
                c = np.clip(c, 0.0, dimsa) + dn * (0.5 * cell)       # soaks in slightly along the spray
                sig = [sig_d, sig_d, sig_d]
                sig[axis] = 0.75 * cell                              # shallow
                add_blob(W, mask, cell, tuple(c), tuple(sig), weight=wgt)
                w_land += wgt
            landed = w_land / w_all if w_all > 0 else 0.0
            disp = tuple(float(x) for x in hp)
            info = "%s face %s%s at (%.1f, %.1f, %.1f), %d droplets, %.0f%% land on the block%s" % (
                head, ("-" if plane == 0.0 else "+"), "XYZ"[axis], disp[0], disp[1], disp[2], n, 100.0 * landed, note)
    tot = float(W.sum())
    if tot > 0:
        W *= (dose_cells * landed / tot)
    return W, info, disp


# ---------------------------------------------------------------------
# FOAM MODEL
# Two fields describe the foam, cell by cell:
#   rho = density. Dissolving foam uses up rho units of solvent per unit of foam,
#         so soft patches (rho < 1) get eaten deep and dense skins (rho > 1) survive as webs.
#   Pm  = how easily solvent creeps through it before it is dissolved
# Noise makes lobes / necks / webs (large scale) and pitting (fine scale).
# Layers are flat sheets, evenly spaced along one axis, that either
# RESIST (strength > 0: dense and hard to soak, so solvent perches on them -> flat floors)
# or are WEAK SEAMS (strength < 0: light and open, so solvent races along them -> flat slots).
# ---------------------------------------------------------------------
def _unit(a):
    a = a - a.mean()
    sd = a.std()
    return a / sd if sd > 1e-9 else a * 0.0


def default_foam():
    return dict(noise=0.0, scale=3.0, grain=0.4, seed=1, web=0.0, web_open=0.3, web_thickness=0.5,
                layers=False, layer_count=3, layer_axis=2, layer_thickness=0.75, layer_strength=0.85)


def parse_foam(item):
    """Text from a Foam component (or None) -> normalised dict."""
    f = default_foam()
    if item is None:
        return f
    try:
        d = item if isinstance(item, dict) else json.loads(str(item))
        f["noise"] = float(np.clip(float(d.get("noise", f["noise"])), 0.0, 1.5))
        f["scale"] = max(0.5, float(d.get("scale", f["scale"])))
        f["grain"] = float(np.clip(float(d.get("grain", f["grain"])), 0.0, 2.0))
        f["seed"] = int(d.get("seed", f["seed"]))
        f["web"] = float(np.clip(float(d.get("web", f["web"])), 0.0, 1.5))
        f["web_open"] = float(np.clip(float(d.get("web_open", f["web_open"])), 0.0, 1.0))
        f["web_thickness"] = max(0.05, float(d.get("web_thickness", f["web_thickness"])))
        f["layers"] = _truthy(d.get("layers", f["layers"]))
        f["layer_count"] = int(np.clip(int(d.get("layer_count", f["layer_count"])), 0, 40))
        f["layer_axis"] = int(np.clip(int(d.get("layer_axis", f["layer_axis"])), 0, 2))
        f["layer_thickness"] = max(0.05, float(d.get("layer_thickness", f["layer_thickness"])))
        f["layer_strength"] = float(np.clip(float(d.get("layer_strength", f["layer_strength"])), -1.0, 1.0))
    except Exception as e:
        raise ValueError("foam input is not valid Foam component output (%s). Wire the 'foam' output of a Foam component into 'foam'." % e)
    return f


def layer_positions(foam, dims):
    if not foam["layers"] or foam["layer_count"] <= 0:
        return []
    L = dims[foam["layer_axis"]]
    n = foam["layer_count"]
    return [(i + 1) * L / (n + 1.0) for i in range(n)]          # evenly spaced, none on the faces


def web_density(shape, cell, scale, seed, thick, open_frac, dims):
    """Foam as soft cells (about `scale` ft across) wrapped in thin dense membranes.
    A fraction `open_frac` of the membranes are weak/open: those are where erosion leaks
    from one cell into the next. Returns (ind, strength): membrane indicator 0..1 and per-wall strength."""
    rng = np.random.default_rng(seed + 7919)
    nb = [int(math.ceil(d / scale)) + 2 for d in dims]
    gi = np.stack(np.meshgrid(*[np.arange(n) for n in nb], indexing="ij"), -1).reshape(-1, 3).astype(np.float64)
    pts = (gi - 1.0 + 0.1 + 0.8 * rng.random(gi.shape)) * scale          # one jittered seed per cell, box extended by a cell
    tree = cKDTree(pts)
    G = np.stack(np.meshgrid(*[(np.arange(n) + 0.5) * cell for n in shape], indexing="ij"), -1).reshape(-1, 3)
    d, idx = tree.query(G, k=2)
    gap = d[:, 1] - d[:, 0]                                              # ~ 2 x distance to the nearest membrane
    half = max(thick / 2.0, 0.5 * cell)
    ind = np.exp(-((0.5 * gap) / half) ** 2)
    lo, hi = np.minimum(idx[:, 0], idx[:, 1]).astype(np.int64), np.maximum(idx[:, 0], idx[:, 1]).astype(np.int64)
    h = ((lo * 73856093) ^ (hi * 19349663) ^ (int(seed) * 83492791)) & 0xFFFF
    r = h / 65535.0
    strength = np.where(r < open_frac, 0.08, 0.55 + 0.45 * (r - open_frac) / max(1.0 - open_frac, 1e-6))
    return ind.reshape(shape).astype(np.float32), strength.reshape(shape).astype(np.float32)


def make_foam_fields(shape, cell, dims, mask, foam):
    """Returns (rho, Pm): float32 arrays shaped like the grid. All ones = perfectly even foam."""
    rho = np.ones(shape, np.float32)
    Pm = np.ones(shape, np.float32)
    if foam["noise"] > 0.0:
        h = NOISE_LATTICE
        while (dims[0] / h + 1) * (dims[1] / h + 1) * (dims[2] / h + 1) > 3.0e6:
            h *= 1.25
        lat = tuple(int(math.ceil(d / h)) + 1 for d in dims)
        rng = np.random.default_rng(foam["seed"])
        # draw every white-noise field up front, in a fixed order, so changing one
        # setting (say 'grain') never reshuffles the others
        w_big = rng.standard_normal(lat).astype(np.float32)
        w_fine = rng.standard_normal(lat).astype(np.float32)
        w_perm = rng.standard_normal(lat).astype(np.float32)
        n_big = _unit(ndimage.gaussian_filter(w_big, sigma=max(foam["scale"] / h, 0.5), mode="reflect"))
        n_fine = _unit(ndimage.gaussian_filter(w_fine, sigma=max(GRAIN_SCALE / h, 0.5), mode="reflect"))
        n_perm = _unit(ndimage.gaussian_filter(w_perm, sigma=max(1.3 * foam["scale"] / h, 0.5), mode="reflect"))
        n_soft = _unit(n_big + foam["grain"] * n_fine)                     # dissolve-rate field
        n_open = _unit(0.6 * n_soft + 0.8 * n_perm)                        # permeability field (partly independent)
        rho_lat = np.exp(K_DENSITY * foam["noise"] * n_soft)
        P_lat = np.exp(K_PERM * foam["noise"] * n_open)
        grid = np.meshgrid(*[(np.arange(n) + 0.5) * cell / h for n in shape], indexing="ij")
        rho = ndimage.map_coordinates(rho_lat, grid, order=1, mode="nearest").astype(np.float32)
        Pm = ndimage.map_coordinates(P_lat, grid, order=1, mode="nearest").astype(np.float32)
        rho /= max(float(rho[mask].mean()), 1e-6)                          # average density stays 1
        Pm /= max(float(Pm[mask].mean()), 1e-6)
        rho = np.clip(rho, 0.12, 8.0)
        Pm = np.clip(Pm, 0.15, 4.0)
    if foam["web"] > 0.0:
        ind, stg = web_density(shape, cell, foam["scale"], foam["seed"], foam["web_thickness"], foam["web_open"], dims)
        rho = rho * (1.0 + WEB_AMP * foam["web"] * stg * ind)
        rho /= max(float(rho[mask].mean()), 1e-6)
        rho = np.clip(rho, 0.05, 14.0)
        Pm = np.clip(Pm / (1.0 + 0.6 * WEB_AMP * foam["web"] * stg * ind), 0.05, 4.0)
    pos = layer_positions(foam, dims)
    if pos:
        ax = foam["layer_axis"]
        coord = (np.arange(shape[ax]) + 0.5) * cell
        w1 = np.zeros(shape[ax])
        for p_ in pos:
            w1 = np.maximum(w1, np.clip((foam["layer_thickness"] / 2.0 - np.abs(coord - p_)) / cell + 0.5, 0.0, 1.0))
        shp = [1, 1, 1]
        shp[ax] = -1
        w = w1.reshape(shp).astype(np.float32)
        k = foam["layer_strength"]
        base = 60.0 if k >= 0.0 else 20.0                                  # resistant sheet up to 60x denser, weak seam down to 1/20
        rho = np.clip(rho * base ** (k * w), 0.05, 80.0)
        Pm = np.clip(Pm * (25.0 if k >= 0.0 else 4.0) ** (-k * w), 0.03, 4.0)
    return rho, Pm


# ---------------------------------------------------------------------
# THE SIMULATION
# M = material integrity (1 solid foam ... 0 void)
# C = solvent concentration
# sources: list of (W, t_start, duration) with W in "dose cells"; times in ref steps
# drain:   solvent leaves through open floor cells instead of pooling
# ---------------------------------------------------------------------
def simulate(mask, sources, steps, gravity=0.0, density=None, perm_mult=None, cell=REF_CELL, n_frames=30, drain=False):
    _COUNTERS["sims"] += 1
    shape = mask.shape
    s = min(1.0, (cell / REF_CELL) ** 2)          # time-step size relative to reference
    n_int = max(0, int(round(int(steps) / s)))
    ds, dv = DIFF_SOLID, DIFF_VOID
    diss = DISSOLVE_K * s
    evap = 1.0 - (1.0 - EVAPORATION) ** s
    drain_frac = 1.0 - (1.0 - DRAIN_RATE) ** s
    maskf = mask.astype(np.float32)
    M = maskf.copy()
    C = np.zeros(shape, np.float32)
    rho = np.ones(shape, np.float32) if density is None else density.astype(np.float32)
    S = 1.0 / rho                                 # soft foam also dissolves faster
    Pm = np.ones(shape, np.float32) if perm_mult is None else perm_mult.astype(np.float32)
    ds_field = np.minimum(ds * Pm, 0.9 * dv)      # how easily solvent creeps through intact foam, cell by cell
    g = float(np.clip(gravity, 0.0, 1.0)) * GRAVITY_MAX * math.sqrt(s)

    instant_late, timed = [], []
    for W, t0, dur in sources:
        if dur <= 0.0:
            if t0 <= 0.0:
                C += W                                # applied before the clock starts
            else:
                instant_late.append((W, t0))
        else:
            timed.append((W, t0, t0 + dur))

    snap_steps = sorted(set(int(round(v)) for v in np.linspace(0, n_int, n_frames + 1)))
    snap_set = set(snap_steps)
    Ms = [M.copy()]
    Cs = [C.copy()]

    for it in range(1, n_int + 1):
        t_prev, t_cur = (it - 1) * s, it * s
        # 0. apply any solvent whose time has come
        for W, t0 in instant_late:
            if t_prev <= t0 < t_cur:
                C += W
        for W, t0, t1 in timed:
            ov = min(t_cur, t1) - max(t_prev, t0)
            if ov > 0.0:
                C += W * (ov / (t1 - t0))

        # 1. dissolve
        dM = np.minimum(M, diss * C * S)
        dM = np.minimum(dM, C / rho)              # dissolving one unit of foam costs rho units of solvent
        M -= dM
        C -= rho * dM

        # 2. spread
        D = (ds_field + (dv - ds_field) * (1.0 - M)) * maskf
        dC = np.zeros_like(C)
        for ax in range(3):
            lo = [slice(None)] * 3
            hi = [slice(None)] * 3
            lo[ax] = slice(0, -1)
            hi[ax] = slice(1, None)
            lo, hi = tuple(lo), tuple(hi)
            Df = np.minimum(D[lo], D[hi])
            flux = Df * (C[hi] - C[lo])
            dC[lo] += flux
            dC[hi] -= flux
        C += dC

        # 3. fall
        if g > 0.0:
            perm = maskf * (np.minimum(0.05 * Pm, 0.5) + 0.95 * (1.0 - M))
            f = g * C[:, :, 1:] * np.minimum(perm[:, :, 1:], perm[:, :, :-1])
            C[:, :, 1:] -= f
            C[:, :, :-1] += f

        # 3b. drain: solvent that reaches an OPEN floor cell falls out of the block
        if drain:
            C[:, :, 0] *= (1.0 - drain_frac * (1.0 - M[:, :, 0]) * maskf[:, :, 0])

        # 4. evaporate
        C *= (1.0 - evap)
        np.maximum(C, 0.0, out=C)

        if it in snap_set:
            Ms.append(M.copy())
            Cs.append(C.copy())

    return Ms, Cs


# ==== GRASSHOPPER SECTION ===============================================
import Rhino.Geometry as rg


def parse_source(item, idx, cell):
    """One entry of `sources` (text from a Source component) -> normalised spec dict."""
    try:
        d = item if isinstance(item, dict) else json.loads(str(item))
        kind = d["kind"]
        mode = MODE_NAMES[str(d["mode"]).lower()] if not isinstance(d["mode"], int) else int(d["mode"])
        spec = dict(kind=kind, mode=mode, pt=d.get("pt"), pts=d.get("pts"),
                    dose=float(d.get("dose", DEFAULT_DOSE[mode])),
                    spread=float(d.get("spread", DEFAULT_SPREAD[mode])),
                    start=float(d.get("start", 0.0)),
                    dur=float(d.get("duration", DEFAULT_DURATION[mode])),
                    dir=d.get("dir"))
        if kind == "pt" and (spec["pt"] is None or len(spec["pt"]) != 3):
            raise ValueError("missing point")
        if kind == "crv" and (spec["pts"] is None or len(spec["pts"]) < 2):
            raise ValueError("missing curve points")
        if kind not in ("pt", "crv"):
            raise ValueError("unknown kind")
    except Exception as e:
        raise ValueError("sources item %d is not a valid Source output (%s). "
                         "Wire the 'src' output of a Source component into 'sources'." % (idx, e))
    if spec["dur"] < 0:
        spec["dur"] = DEFAULT_DURATION[spec["mode"]]
    return spec


def _notify(message, warns):
    """Show a short status under the component and warnings on it (never crashes the script)."""
    try:
        import Grasshopper
        comp = ghenv.Component
        comp.Message = message
        for w in warns:
            comp.AddRuntimeMessage(Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning, w)
    except Exception:
        pass


def _get_sim(key, builder):
    """Return (result, was_cached). The simulation only re-runs when its inputs change,
    so dragging the frame / smooth / slice sliders is instant."""
    try:
        import scriptcontext as sc
        store = sc.sticky
    except Exception:
        store = _LOCAL_CACHE
    hit = store.get("erosion_engine_3b")
    if hit is not None and hit[0] == key:
        return hit[1], True
    res = builder()
    store["erosion_engine_3b"] = (key, res)
    return res, False


# ---------------------------------------------------------------------
# SMOOTH MESHING (marching cubes)
# ---------------------------------------------------------------------
def smooth_field(field, smooth):
    f = np.asarray(field, dtype=np.float32)
    if smooth > 0:
        f = ndimage.gaussian_filter(f, sigma=float(smooth), mode="nearest")
    return f


def field_to_arrays(field, cell, smooth, presmoothed=False):
    f = np.asarray(field, dtype=np.float32) if presmoothed else smooth_field(field, smooth)
    f = np.pad(f, 1, mode="constant", constant_values=0.0)
    if f.max() <= 0.5 or f.min() >= 0.5:
        return None, None, 0.0
    verts, faces, _, _ = measure.marching_cubes(f, level=0.5)
    verts = (verts - 1.0 + 0.5) * cell
    tri = verts[faces]
    vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6.0)
    if vol < 0:
        faces = faces[:, ::-1]
        vol = -vol
    return verts, faces, vol


FACE_NAMES = ("-X", "+X", "-Y", "+Y", "-Z", "+Z")


def make_tile_data(void_bool, cell, dims, frame, config):
    """The finished tile as one text. void_bits = the void/foam voxels (1 = void), C-order, bit-packed and
    base64 encoded. faces = the outermost layer of voxels on each of the six faces, as rows of 0/1 text:
    +/-X faces are [y][z], +/-Y faces are [x][z], +/-Z faces are [x][y]."""
    v = np.asarray(void_bool, dtype=bool)

    def rows(a):
        return ["".join("1" if x else "0" for x in r) for r in a]
    faces = {"-X": rows(v[0, :, :]), "+X": rows(v[-1, :, :]), "-Y": rows(v[:, 0, :]),
             "+Y": rows(v[:, -1, :]), "-Z": rows(v[:, :, 0]), "+Z": rows(v[:, :, -1])}
    bits = base64.b64encode(np.packbits(v.astype(np.uint8).ravel(order="C")).tobytes()).decode("ascii")
    return json.dumps({"v": 1, "kind": "erosion_tile", "tile_ft": [float(d) for d in dims], "cell_ft": float(cell),
                       "grid": [int(n) for n in v.shape], "frame": int(frame), "void_bits": bits, "faces": faces,
                       "config": config})


def arrays_to_mesh(verts, faces):
    if verts is None:
        return None
    mesh = rg.Mesh()
    for x, y, z in verts.tolist():
        mesh.Vertices.Add(x, y, z)
    for a, b, c in faces.tolist():
        mesh.Faces.AddFace(a, b, c)
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    return mesh


# ---------------------------------------------------------------------
# SLICE PREVIEW
# ---------------------------------------------------------------------
def _colors(plane, view, cmax):
    if view == 0:   # material: void = near-black, foam = pink
        void_c = np.array([20, 20, 34], dtype=np.float32)
        foam_c = np.array([240, 170, 205], dtype=np.float32)
        t = np.clip(plane, 0.0, 1.0)[..., None]
        return void_c + (foam_c - void_c) * t
    elif view == 2:  # foam density: dense / resistant = dark plum, soft = cream
        dense_c = np.array([70, 20, 70], dtype=np.float32)
        soft_c = np.array([255, 236, 205], dtype=np.float32)
        t = np.clip(np.log(np.maximum(plane, 1e-3)) / (2.0 * math.log(2.0)) + 0.5, 0.0, 1.0)[..., None]
        return dense_c + (soft_c - dense_c) * t
    else:           # solvent: black -> orange
        low = np.array([10, 10, 10], dtype=np.float32)
        high = np.array([255, 140, 0], dtype=np.float32)
        t = np.sqrt(np.clip(plane / max(cmax, 1e-9), 0.0, 1.0))[..., None]
        return low + (high - low) * t


def build_slice_mesh(A, axis, k, cell, view, cmax):
    plane = np.take(A, k, axis=axis)
    cols = _colors(plane, view, cmax).astype(int)
    a_ax, b_ax = [ax for ax in range(3) if ax != axis]
    na, nb = plane.shape
    pos = (k + 0.5) * cell
    mesh = rg.Mesh()
    for i in range(na):
        for j in range(nb):
            r, g, b = int(cols[i, j, 0]), int(cols[i, j, 1]), int(cols[i, j, 2])
            base = mesh.Vertices.Count
            for (ci, cj) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                p = [0.0, 0.0, 0.0]
                p[a_ax] = ci * cell
                p[b_ax] = cj * cell
                p[axis] = pos
                mesh.Vertices.Add(p[0], p[1], p[2])
                mesh.VertexColors.Add(r, g, b)
            mesh.Faces.AddFace(base, base + 1, base + 2, base + 3)
    mesh.Normals.ComputeNormals()
    return mesh


# =====================================================================
# EXPORT BUNDLE  (one click)
# Wire a Button to `export`. Everything below is written into
#   <export_dir>/<tile_name>/            (never overwrites: a second export becomes <tile_name>_v2)
# Units are FEET. Coordinates are Rhino's: X, Y horizontal, Z up. Origin = the tile's low corner.
# =====================================================================
FOAM_RGB = (240, 170, 205)      # foam = pink
VOID_RGB = (20, 20, 34)         # void = near black
PX_TARGET = 1000                # longest side of a full-size image, in pixels
VIEWS = ("-X", "+X", "-Y", "+Y", "-Z", "+Z")


def _safe_name(s):
    s = re.sub(r"[^A-Za-z0-9_.+-]+", "_", str(s).strip()).strip("._")
    return s or "tile"


# ------------------------------------------------------------------ images
def write_png(path, arr):
    """Minimal PNG writer (no imaging library needed). arr: HxW gray, HxWx3 RGB or HxWx4 RGBA, uint8."""
    a = np.ascontiguousarray(np.asarray(arr, dtype=np.uint8))
    h, w = a.shape[:2]
    ch = 1 if a.ndim == 2 else a.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    raw = b"".join(b"\x00" + a[i].tobytes() for i in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def orient(view, a):
    """A 2D slice of the voxel grid -> an image as seen from outside `view` (row 0 = top, column 0 = left).
    +X: right = +Y, up = +Z | -X: right = -Y, up = +Z | +Y: right = -X, up = +Z | -Y: right = +X, up = +Z
    +Z (plan, looking down): right = +X, up = +Y | -Z (looking up): right = -X, up = +Y."""
    t = np.asarray(a).T
    if view in ("+X", "-Y", "+Z"):
        return t[::-1, :]
    return t[::-1, ::-1]


def view_extent(view, dims):
    """(width, height) in feet of an oriented image."""
    if view in ("+X", "-X"):
        return dims[1], dims[2]
    if view in ("+Y", "-Y"):
        return dims[0], dims[2]
    return dims[0], dims[1]


def uv_to_world(view, c, u, v, dims):
    """Oriented-image coordinates (u to the right, v up, feet) -> world (x, y, z). c = the constant coordinate."""
    if view == "+X":
        return c, u, v
    if view == "-X":
        return c, dims[1] - u, v
    if view == "+Y":
        return dims[0] - u, c, v
    if view == "-Y":
        return u, c, v
    if view == "+Z":
        return u, v, c
    return dims[0] - u, v, c            # "-Z"


def upscale(img, cell, target=PX_TARGET):
    s = max(1, int(round(target / float(max(img.shape)))))
    s = min(s, 40)
    up = ndimage.zoom(np.asarray(img, dtype=np.float32), s, order=1, mode="nearest", grid_mode=True) if s > 1 else np.asarray(img, dtype=np.float32)
    return up, s


def color_image(img, target=PX_TARGET):
    up, _ = upscale(img, None, target)
    m = up > 0.5
    out = np.empty(m.shape + (3,), np.uint8)
    out[...] = FOAM_RGB
    out[m] = VOID_RGB
    return out


def mask_image(img, target=PX_TARGET):
    up, _ = upscale(img, None, target)
    return ((up > 0.5) * 255).astype(np.uint8)          # void = white, foam = black


def contours_uv(img, cell, width_ft, height_ft, tol=0.1):
    """Outlines of the void in an oriented image, as closed polylines in (u right, v up) feet, clipped to the tile."""
    pad = np.pad(np.asarray(img, dtype=np.float32), 1, mode="constant", constant_values=0.0)
    out = []
    for c in measure.find_contours(pad, 0.5):
        if tol > 0 and len(c) > 3:
            c = measure.approximate_polygon(c, tol)
        rows = (c[:, 0] - 1.0 + 0.5) * cell
        cols = (c[:, 1] - 1.0 + 0.5) * cell
        u = np.clip(cols, 0.0, width_ft)
        v = np.clip(height_ft - rows, 0.0, height_ft)
        if len(u) >= 3:
            out.append(np.column_stack([u, v]))
    return out


def write_svg(path, polys, width_ft, height_ft, title):
    """Vector drawing at 1 inch = 1 foot. Foam is pink, void is dark (even-odd fill, so foam islands inside a void work)."""
    d = []
    for p in polys:
        d.append("M " + " L ".join("%.3f %.3f" % (x, height_ft - y) for x, y in p) + " Z")
    svg = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<svg xmlns="http://www.w3.org/2000/svg" width="%.3fin" height="%.3fin" viewBox="0 0 %.3f %.3f">\n'
           '<title>%s</title>\n'
           '<rect x="0" y="0" width="%.3f" height="%.3f" fill="rgb(%d,%d,%d)"/>\n'
           '<path id="void" d="%s" fill="rgb(%d,%d,%d)" fill-rule="evenodd" stroke="rgb(255,255,255)" stroke-width="0.03"/>\n'
           '<rect x="0" y="0" width="%.3f" height="%.3f" fill="none" stroke="rgb(0,0,0)" stroke-width="0.05"/>\n'
           '</svg>\n') % (width_ft, height_ft, width_ft, height_ft, title, width_ft, height_ft,
                          FOAM_RGB[0], FOAM_RGB[1], FOAM_RGB[2], " ".join(d), VOID_RGB[0], VOID_RGB[1], VOID_RGB[2],
                          width_ft, height_ft)
    with open(path, "w") as f:
        f.write(svg)


def montage(images, cols, gap=6, bg=(48, 48, 48)):
    h = max(i.shape[0] for i in images)
    w = max(i.shape[1] for i in images)
    n = len(images)
    rows = int(math.ceil(n / float(cols)))
    canvas = np.empty((rows * h + (rows + 1) * gap, cols * w + (cols + 1) * gap, 3), np.uint8)
    canvas[...] = bg
    for k, im in enumerate(images):
        r, c = divmod(k, cols)
        y0, x0 = gap + r * (h + gap), gap + c * (w + gap)
        canvas[y0:y0 + im.shape[0], x0:x0 + im.shape[1]] = im
    return canvas


# ------------------------------------------------------------------ 3D files
def write_glb(path, parts, extras=None):
    """parts: [(name, verts_ft_zup, faces, (r,g,b))]. glTF is Y-up and in metres, so we convert (and say so in extras)."""
    chunks, views, accessors, meshes, nodes, materials = [], [], [], [], [], []
    off = [0]

    def add(b, target):
        pad = (-len(b)) % 4
        chunks.append(b + b"\x00" * pad)
        views.append({"buffer": 0, "byteOffset": off[0], "byteLength": len(b), "target": target})
        off[0] += len(b) + pad
        return len(views) - 1
    for name, V, F, rgb in parts:
        V2 = np.column_stack([V[:, 0], V[:, 2], -V[:, 1]]).astype(np.float64) * 0.3048
        tri = V2[F]
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        vn = np.zeros_like(V2)
        for k in range(3):
            np.add.at(vn, F[:, k], fn)
        vn = vn / (np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12)
        pv = add(V2.astype("<f4").tobytes(), 34962)
        nv = add(vn.astype("<f4").tobytes(), 34962)
        iv = add(F.astype("<u4").ravel().tobytes(), 34963)
        a0 = len(accessors)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(V2), "type": "VEC3",
                          "min": V2.min(0).tolist(), "max": V2.max(0).tolist()})
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(V2), "type": "VEC3"})
        accessors.append({"bufferView": iv, "componentType": 5125, "count": int(F.size), "type": "SCALAR"})
        materials.append({"name": name, "pbrMetallicRoughness": {"baseColorFactor": [rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 1.0],
                                                                    "metallicFactor": 0.0, "roughnessFactor": 0.9}, "doubleSided": True})
        meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": a0, "NORMAL": a0 + 1}, "indices": a0 + 2,
                                                     "material": len(materials) - 1}]})
        nodes.append({"name": name, "mesh": len(meshes) - 1})
    binb = b"".join(chunks)
    js = {"asset": {"version": "2.0", "generator": "erosion engine",
                    "extras": extras or {"note": "converted from feet / Z-up to metres / Y-up (x, z, -y)"}},
          "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
          "materials": materials, "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binb)}]}
    jb = json.dumps(js).encode("utf-8")
    jb += b" " * ((-len(jb)) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack("<II", len(binb), 0x004E4942) + binb)


def write_3dm(path, meshes, curves):
    """Rhino file with layers: foam, void, sections, faces. Returns "" on success or the reason it was skipped."""
    try:
        import Rhino
        import System
        f3 = Rhino.FileIO.File3dm()
        try:
            f3.Settings.ModelUnitSystem = Rhino.UnitSystem.Feet
        except Exception:
            pass
        layer_idx = {}

        try:
            import System.Drawing
        except Exception:
            pass

        def layer(name, rgb):
            if name not in layer_idx:
                col = System.Drawing.Color.FromArgb(rgb[0], rgb[1], rgb[2])
                try:
                    layer_idx[name] = f3.AllLayers.AddLayer(name, col)
                except Exception:
                    lay = Rhino.DocObjects.Layer()
                    lay.Name = name
                    lay.Color = col
                    layer_idx[name] = f3.AllLayers.Add(lay)
            return layer_idx[name]
        for name, mesh, rgb in meshes:
            if mesh is None:
                continue
            at = Rhino.DocObjects.ObjectAttributes()
            at.Name = name
            at.LayerIndex = layer(name, rgb)
            f3.Objects.AddMesh(mesh, at)
        for lname, name, crv in curves:
            at = Rhino.DocObjects.ObjectAttributes()
            at.Name = name
            at.LayerIndex = layer(lname, (120, 120, 120))
            f3.Objects.AddCurve(crv, at)
        if not f3.Write(path, 8):
            return "File3dm.Write returned false"
        return ""
    except Exception as e:
        return "%s: %s" % (type(e).__name__, e)


# ------------------------------------------------------------------ analysis
def face_depth(void_bool, face):
    """How many voxels deep the void goes straight in from each cell of a face (0 = foam at the face)."""
    ax = "XYZ".index(face[1])
    a = void_bool if face[0] == "-" else np.flip(void_bool, ax)
    a = np.moveaxis(a, ax, 0).astype(np.uint8)
    return np.cumprod(a, axis=0).sum(axis=0)


def face_layer(arr, face):
    ax = "XYZ".index(face[1])
    return np.take(arr, 0 if face[0] == "-" else arr.shape[ax] - 1, axis=ax)


def mesh_area(V, F):
    if V is None:
        return 0.0
    t = V[F]
    return float(0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum())


def tile_metrics(void_bool, cell, dims, void_mesh_arrays, foam_mesh_arrays):
    cv, ca = cell ** 3, cell ** 2
    nx, ny, nz = void_bool.shape
    total = void_bool.size * cv
    vol = float(void_bool.sum()) * cv
    lab, n = ndimage.label(void_bool)
    comps = []
    if n:
        sizes = ndimage.sum(void_bool, lab, index=np.arange(1, n + 1))
        objs = ndimage.find_objects(lab)
        for i in np.argsort(-sizes)[:60]:
            cid = int(i) + 1
            sl = objs[int(i)]
            touching = {}
            for fname in VIEWS:
                cnt = int((face_layer(lab, fname) == cid).sum())
                if cnt:
                    touching[fname] = round(cnt * ca, 3)
            comps.append({"id": cid, "volume_ft3": round(float(sizes[int(i)]) * cv, 3),
                          "bbox_min_ft": [round(sl[k].start * cell, 3) for k in range(3)],
                          "bbox_max_ft": [round(sl[k].stop * cell, 3) for k in range(3)],
                          "touches_faces_open_area_ft2": touching})
    # horizontal surfaces: solid with void directly above = a floor, void with solid directly above = a ceiling
    up = (~void_bool[:, :, :-1]) & void_bool[:, :, 1:]
    dn = void_bool[:, :, :-1] & (~void_bool[:, :, 1:])
    floor_area = (up.sum(axis=(0, 1)) * ca).tolist()
    ceil_area = (dn.sum(axis=(0, 1)) * ca).tolist()
    # voxel faces between void and foam (blocky estimate of wall area)
    wall = 0
    for ax in range(3):
        a = np.moveaxis(void_bool, ax, 0)
        wall += int((a[1:] != a[:-1]).sum())
    faces = {}
    for fname in VIEWS:
        m = face_layer(void_bool, fname)
        faces[fname] = {"open_cells": int(m.sum()), "open_area_ft2": round(float(m.sum()) * ca, 3),
                        "open_fraction": round(float(m.mean()), 4)}
    open_total = sum(v["open_area_ft2"] for v in faces.values())
    vm = mesh_area(*void_mesh_arrays) if void_mesh_arrays[0] is not None else 0.0
    fm = mesh_area(*foam_mesh_arrays) if foam_mesh_arrays[0] is not None else 0.0
    zc = np.nonzero(void_bool.any(axis=(0, 1)))[0]
    bbox = None
    if void_bool.any():
        idx = np.argwhere(void_bool)
        bbox = {"min_ft": (idx.min(0) * cell).round(3).tolist(), "max_ft": ((idx.max(0) + 1) * cell).round(3).tolist(),
                "centroid_ft": ((idx.mean(0) + 0.5) * cell).round(3).tolist()}
    return {"void_volume_ft3": round(vol, 3), "tile_volume_ft3": round(total, 3), "void_fraction": round(vol / total, 5),
            "foam_volume_ft3": round(total - vol, 3), "void_pieces": int(n), "largest_void_ft3": comps[0]["volume_ft3"] if comps else 0.0,
            "void_components": comps, "faces": faces, "open_area_on_faces_ft2": round(open_total, 3),
            "void_bbox": bbox, "void_z_range_ft": ([round(float(zc.min() * cell), 3), round(float((zc.max() + 1) * cell), 3)] if len(zc) else None),
            "void_mesh_area_ft2": round(vm, 3), "void_wall_area_ft2_estimate": round(max(vm - open_total, 0.0), 3),
            "foam_mesh_area_ft2": round(fm, 3), "voxel_wall_area_ft2": round(wall * ca, 3),
            "floor_area_by_z_ft2": [round(x, 3) for x in floor_area], "ceiling_area_by_z_ft2": [round(x, 3) for x in ceil_area],
            "floor_area_total_ft2": round(float(sum(floor_area)), 3),
            "void_area_profile_ft2": {"x": (void_bool.sum(axis=(1, 2)) * ca).round(3).tolist(),
                                      "y": (void_bool.sum(axis=(0, 2)) * ca).round(3).tolist(),
                                      "z": (void_bool.sum(axis=(0, 1)) * ca).round(3).tolist()}}


# ------------------------------------------------------------------ helpers for the export
def _jdefault(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError("not JSON serialisable: %s" % type(o).__name__)



# ------------------------------------------------------------------ the bundle (schema erosion-tile/2)
SCHEMA = "erosion-tile/3"
ENGINE_VERSION = "5f"
RECIPE_SCHEMA = "erosion-recipe/1"
RECIPE_FIELDS = ("tile_w", "tile_h", "cell", "steps", "gravity", "drain", "n_frames", "smooth", "seed")


def _write_json(path, obj, indent=None):
    with open(path, "w") as f:
        json.dump(obj, f, default=_jdefault, indent=indent)


def mask_on_grid(sm, cell, grid=0.5):
    """A face layer as a void mask on a fixed grid (default 6 inch), whatever cell size the tile was made at."""
    n0, n1 = int(round(sm.shape[0] * cell / grid)), int(round(sm.shape[1] * cell / grid))
    if (n0, n1) == tuple(sm.shape):
        return sm > 0.5
    return ndimage.zoom(sm.astype(np.float32), (n0 / float(sm.shape[0]), n1 / float(sm.shape[1])), order=1, mode="nearest", grid_mode=True) > 0.5


def image_plane(view, c, dims, shape):
    """Where an image sits in the tile: world = origin + u_axis * (col / px_per_ft) + v_axis * ((rows - row) / px_per_ft)."""
    w_ft, h_ft = view_extent(view, dims)
    o = np.array(uv_to_world(view, c, 0.0, 0.0, dims), dtype=float)
    u = np.array(uv_to_world(view, c, 1.0, 0.0, dims), dtype=float) - o
    v = np.array(uv_to_world(view, c, 0.0, 1.0, dims), dtype=float) - o
    return {"seen_from": view, "origin_ft": o.tolist(), "u_axis": u.tolist(), "v_axis": v.tolist(), "width_ft": float(w_ft),
            "height_ft": float(h_ft), "size_px": [int(shape[1]), int(shape[0])], "px_per_ft": float(shape[1] / w_ft),
            "pixel_rule": "row 0 is the top edge, column 0 the left edge; u runs right, v runs up"}


WELD_FT = 3.0                       # how deep (feet) the seam weld blends each face toward its opposite face


def weld_faces(void_sm, axes, cell):
    """Make opposite faces of the tile identical so repeated copies meet exactly (void meets void, floor meets floor).
    For each axis in `axes` the two face layers are replaced by their average, and the change fades out over WELD_FT feet
    into the tile, so the inside of the tile is untouched. Works on the smoothed void field (1 = void)."""
    V = np.array(void_sm, dtype=np.float32, copy=True)
    band = max(2, int(round(WELD_FT / cell)))
    for ax in "xyz":
        if ax not in axes:
            continue
        A = "xyz".index(ax)
        W = np.moveaxis(V, A, 0)                                   # a view: edits land in V
        n = W.shape[0]
        if n < 2 * band + 2:
            continue
        a, b = W[0].copy(), W[-1].copy()
        m = 0.5 * (a + b)
        for i in range(band):
            w = (1.0 - i / float(band)) ** 2
            W[i] += w * (m - a)
            W[n - 1 - i] += w * (m - b)
    return np.clip(V, 0.0, 1.0)


SUFFIX_ANALYSIS = "_analysis"       # folder for the program:   <tile_name>_analysis
SUFFIX_REFERENCE = "_reference"     # folder for you:           <tile_name>_reference


def _unique_pair(base, name):
    """The smallest version of `name` for which neither folder exists yet, so the pair always shares one version number."""
    n = 1
    while True:
        nm = name if n == 1 else "%s_v%d" % (name, n)
        a, r = os.path.join(base, nm + SUFFIX_ANALYSIS), os.path.join(base, nm + SUFFIX_REFERENCE)
        if not os.path.exists(a) and not os.path.exists(r):
            return nm, a, r
        n += 1


def export_bundle(ctx):
    """One click, two folders:
       <name>_analysis   everything the program needs (3D model, voxels, faces, sections, images, drawings, numbers)
       <name>_reference  what you keep (Rhino file, recipe, log, timelapse)"""
    t0 = time.time()
    dims, cell = ctx["dims"], ctx["cell"]
    void_sm, void_bool = ctx["void_sm"], ctx["void_bool"]
    base = ctx["base_dir"] or os.path.join(os.path.expanduser("~"), "Documents", "Erosion Exports")
    name, root, ref = _unique_pair(base, _safe_name(ctx["name"]))
    D = {k: os.path.join(root, *k.split("/")) for k in ("model", "voxels", "data", "images/faces", "images/sections",
                                                       "images/projections", "vector/faces", "vector/sections")}
    for d in [root, ref] + list(D.values()):
        os.makedirs(d, exist_ok=True)
    files, problems = [], []

    def rel(p):
        return os.path.relpath(p, root).replace("\\", "/")

    def add(p, role, what, **attrs):
        e = {"file": rel(p), "role": role, "what": what}
        e.update(attrs)
        files.append(e)

    tile_id = ctx.get("tile_id") or compute_tile_id(void_bool, ctx["config"])
    metrics = tile_metrics(void_bool, cell, dims, ctx["void_arrays"], ctx["foam_arrays"])
    vol_layout = {"order": "C", "axes": ["x", "y", "z"], "shape": list(void_bool.shape), "index": "(x * ny + y) * nz + z", "endian": "little"}

    # ---- voxels: plain binary, readable in a browser with no libraries ----
    vd = D["voxels"]
    soft = np.asarray(ctx["density_field"], dtype=np.float64)
    arrays = {
        "void.u8": (void_bool.astype(np.uint8), "uint8", "1 = void, 0 = foam"),
        "void_smooth.u8": (np.round(np.clip(void_sm, 0, 1) * 255).astype(np.uint8), "uint8", "smoothed void field 0..255 (what the meshes are cut from at level 127.5); merge these across joined tiles and re-mesh for smooth composites"),
        "material.u8": (np.round(np.clip(ctx["M"], 0, 1) * 255).astype(np.uint8), "uint8", "foam material integrity 255 = intact foam .. 0 = void"),
        "softness.u8": (np.round(np.clip((np.log2(np.maximum(soft, 1e-3)) + 4.0) / 8.0, 0, 1) * 255).astype(np.uint8), "uint8", "foam softness, log scale: softness = 2 ** (value / 255 * 8 - 4)"),
    }
    for fname, (arr, dt, what) in arrays.items():
        p = os.path.join(vd, fname)
        with open(p, "wb") as f:
            f.write(np.ascontiguousarray(arr).tobytes())
        add(p, "voxels." + fname.split(".")[0], what, dtype=dt, layout=vol_layout)

    # ---- 3D model: one GLB (the format three.js reads directly) ----
    (vv, vf), (fv, ff) = ctx["void_arrays"], ctx["foam_arrays"]
    parts = []
    if fv is not None:
        parts.append(("foam", fv, ff))
    if vv is not None:
        parts.append(("void", vv, vf))
    to_tile = [[1 / 0.3048, 0, 0, 0], [0, 0, -1 / 0.3048, 0], [0, 1 / 0.3048, 0, 0], [0, 0, 0, 1]]
    if parts:
        p = os.path.join(D["model"], "%s.glb" % name)
        write_glb(p, [(nm, V, F, FOAM_RGB if nm == "foam" else (200, 40, 55)) for nm, V, F in parts],
                  extras={"tile_id": tile_id, "name": name, "tile_ft": dims, "cell_ft": cell, "units": "metres, Y up",
                          "to_tile_ft_row_major": to_tile, "note": "tile_ft_position = to_tile_ft * [x, y, z, 1] of the glTF position"})
        add(p, "model.glb", "foam and void meshes with colours and normals for three.js (glTF binary; metres, Y up)",
            to_tile_ft_row_major=to_tile, nodes=[nm for nm, _, _ in parts])

    # ---- faces ----
    face_info, face_imgs, face_curves = {}, {}, []
    for fname in VIEWS:
        tag = fname
        sm, bl = face_layer(void_sm, fname), face_layer(void_bool, fname)
        img = orient(fname, sm)
        w_ft, h_ft = view_extent(fname, dims)
        cval = dims["XYZ".index(fname[1])] if fname[0] == "+" else 0.0
        col = color_image(img)
        face_imgs[fname] = col
        plane = image_plane(fname, cval, dims, col.shape)
        p = os.path.join(D["images/faces"], "face_%s.png" % tag)
        write_png(p, col)
        add(p, "image.face.color", "face %s seen from outside: pink foam, dark void" % fname, face=fname, plane=plane)
        p = os.path.join(D["images/faces"], "face_%s_mask.png" % tag)
        write_png(p, mask_image(img))
        add(p, "image.face.mask", "face %s as a mask: white = void opening, black = foam" % fname, face=fname, plane=plane)
        dep = face_depth(void_bool, fname)
        depi = orient(fname, dep.astype(np.float32))
        dmax = float(max(depi.max(), 1))
        up, _ = upscale(depi / dmax, cell)
        p = os.path.join(D["images/faces"], "face_%s_depth.png" % tag)
        write_png(p, (np.clip(up, 0, 1) * 255).astype(np.uint8))
        add(p, "image.face.depth", "face %s depth map: brighter = void runs deeper straight in (full white = %.1f ft)" % (fname, dmax * cell),
            face=fname, plane=plane, white_is_ft=dmax * cell)
        polys = contours_uv(img, cell, w_ft, h_ft)
        p = os.path.join(D["vector/faces"], "face_%s.svg" % tag)
        write_svg(p, polys, w_ft, h_ft, "face %s (seen from outside; 1 in = 1 ft)" % fname)
        add(p, "vector.face.svg", "face %s as a vector drawing (SVG, 1 in = 1 ft)" % fname, face=fname)
        for k, pl in enumerate(polys):
            face_curves.append(("faces", "face_%s_%d" % (fname, k), [uv_to_world(fname, cval, u, v, dims) for u, v in pl.tolist()]))
        rows = lambda a: ["".join("1" if x else "0" for x in r) for r in a]
        first = "XYZ".replace(fname[1], "")
        face_info[fname] = {"stored_axes": [first[0].lower(), first[1].lower()], "mask_rows": rows(bl),
                            "mask_rows_6in": rows(mask_on_grid(sm, cell)),
                            "depth_cells": dep.astype(int).tolist(), "open_cells": int(bl.sum()), "open_area_ft2": float(bl.sum()) * cell * cell,
                            "edges": {"first_axis_min": "".join("1" if x else "0" for x in bl[0, :]), "first_axis_max": "".join("1" if x else "0" for x in bl[-1, :]),
                                      "second_axis_min": "".join("1" if x else "0" for x in bl[:, 0]), "second_axis_max": "".join("1" if x else "0" for x in bl[:, -1])},
                            "max_depth_ft": float(dep.max()) * cell, "outline_uv_ft": [pl.round(3).tolist() for pl in polys], "plane": plane}
    net_imgs = {fname: color_image(orient(fname, face_layer(void_sm, fname)), 480) for fname in VIEWS}
    hh, ww = max(i.shape[0] for i in net_imgs.values()), max(i.shape[1] for i in net_imgs.values())
    net = np.empty((3 * hh + 24, 4 * ww + 30, 3), np.uint8)
    net[...] = (48, 48, 48)
    for fname, (r, c) in {"+Z": (0, 1), "-X": (1, 0), "-Y": (1, 1), "+X": (1, 2), "+Y": (1, 3), "-Z": (2, 1)}.items():
        im = net_imgs[fname]
        net[6 + r * (hh + 6):6 + r * (hh + 6) + im.shape[0], 6 + c * (ww + 6):6 + c * (ww + 6) + im.shape[1]] = im
    p = os.path.join(D["images/faces"], "faces_net.png")
    write_png(p, net)
    add(p, "image.faces_net", "all six faces unfolded like a cube net: top = +Z, middle row = -X, -Y, +X, +Y, bottom = -Z")

    # ---- sections ----
    n_sec = max(1, min(60, int(ctx["section_count"])))
    sec_info, sec_curves, mids = [], [], {}
    for ax, view in ((0, "-X"), (1, "-Y"), (2, "+Z")):
        axn = "xyz"[ax]
        smalls = []
        for i in range(n_sec):
            pos = (i + 0.5) / n_sec * dims[ax]
            k = int(np.clip(int(pos / cell), 0, void_sm.shape[ax] - 1))
            pc = (k + 0.5) * cell
            sl = np.take(void_sm, k, axis=ax)
            img = orient(view, sl)
            w_ft, h_ft = view_extent(view, dims)
            stem = "%s_%02d_at_%.2fft" % (axn, i + 1, pc)
            col = color_image(img)
            plane = image_plane(view, pc, dims, col.shape)
            p = os.path.join(D["images/sections"], stem + ".png")
            write_png(p, col)
            add(p, "image.section.color", "section at %s = %.2f ft (pink foam, dark void)" % (axn.upper(), pc), axis=axn.upper(), index=i + 1, position_ft=pc, plane=plane)
            p = os.path.join(D["images/sections"], stem + "_mask.png")
            write_png(p, mask_image(img))
            add(p, "image.section.mask", "the same section as a mask (white = void)", axis=axn.upper(), index=i + 1, position_ft=pc, plane=plane)
            polys = contours_uv(img, cell, w_ft, h_ft)
            p = os.path.join(D["vector/sections"], stem + ".svg")
            write_svg(p, polys, w_ft, h_ft, "section %s = %.2f ft (1 in = 1 ft)" % (axn.upper(), pc))
            add(p, "vector.section.svg", "the same section as a vector drawing (SVG, 1 in = 1 ft)", axis=axn.upper(), index=i + 1, position_ft=pc)
            for j, pl in enumerate(polys):
                sec_curves.append(("sections_" + axn, "%s_%02d_%d" % (axn, i + 1, j), [uv_to_world(view, pc, u, v, dims) for u, v in pl.tolist()]))
            small, _ = upscale(img, cell, 240)
            smalls.append(np.where((small > 0.5)[..., None], np.array(VOID_RGB, np.uint8), np.array(FOAM_RGB, np.uint8)).astype(np.uint8))
            if i == n_sec // 2:
                mids[axn] = smalls[-1]
            sec_info.append({"axis": axn.upper(), "index": i + 1, "position_ft": pc, "seen_from": view, "void_area_ft2": float((sl >= 0.5).sum()) * cell * cell,
                             "void_fraction": float((sl >= 0.5).mean()), "outline_uv_ft": [pl.round(3).tolist() for pl in polys], "plane": plane})
        p = os.path.join(D["images/sections"], "contact_sheet_%s.png" % axn)
        write_png(p, montage(smalls, int(math.ceil(math.sqrt(n_sec)))))
        add(p, "image.contact_sheet", "all %s sections on one sheet, low to high" % axn.upper(), axis=axn.upper())

    # ---- projections ----
    proj_small = {}
    for ax, view in ((0, "-X"), (1, "-Y"), (2, "+Z")):
        thick = void_bool.sum(axis=ax) * cell
        img = orient(view, thick.astype(np.float32))
        up, _ = upscale(img / max(dims[ax], 1e-9), cell)
        gray = (np.clip(up, 0, 1) * 255).astype(np.uint8)
        p = os.path.join(D["images/projections"], "void_thickness_along_%s.png" % "xyz"[ax])
        write_png(p, gray)
        add(p, "image.projection", "void met by a line of sight along %s: white = void all the way through (%.0f ft)" % ("xyz"[ax].upper(), dims[ax]),
            axis="xyz"[ax].upper(), plane=image_plane(view, 0.0, dims, gray.shape), white_is_ft=dims[ax])
        g_small = gray[::max(1, gray.shape[0] // 240), ::max(1, gray.shape[1] // 240)]
        proj_small[ax] = np.stack([g_small, g_small, g_small], axis=2)
    tiles = [proj_small[2], mids.get("x"), mids.get("y"), mids.get("z")]
    th = min(i.shape[0] for i in tiles if i is not None)
    tw = min(i.shape[1] for i in tiles if i is not None)
    tiles = [i[:th, :tw] for i in tiles if i is not None]
    p = os.path.join(root, "images", "thumbnail.png")
    write_png(p, montage(tiles, 2, gap=4))
    add(p, "image.thumbnail", "small overview for the library grid: plan void-thickness map, and mid X, Y and Z sections")

    # ---- data files ----
    p = os.path.join(D["data"], "faces.json")
    _write_json(p, {"schema": SCHEMA, "note": "mask_rows: +/-X faces are [y][z], +/-Y faces are [x][z], +/-Z faces are [x][y]; 1 = void. mask_rows_6in is the same face on a fixed 6 inch grid so tiles exported at different cell sizes compare. "
                                              "depth_cells: voxels of void straight in from each face cell. edges: the four border rows. outline_uv_ft: polygons in the seen-from-outside image frame, feet.",
                    "cell_ft": cell, "faces": face_info})
    add(p, "data.faces", "each face's mask, depth, edges, outlines and image plane")
    p = os.path.join(D["data"], "sections.json")
    _write_json(p, {"schema": SCHEMA, "sections": sec_info})
    add(p, "data.sections", "every section's position, void area, outlines and image plane")

    # ---- tile.json, README, manifest ----
    p = os.path.join(root, "tile.json")
    _write_json(p, {"schema": SCHEMA, "id": tile_id, "name": name, "exported": datetime.datetime.now().isoformat(timespec="seconds"),
                    "engine_version": ENGINE_VERSION, "units": "feet", "coordinate_system": "X, Y horizontal, Z up, origin at the tile's low corner",
                    "tile_ft": dims, "cell_ft": cell, "grid": list(void_bool.shape), "frame_exported": ctx["frame"], "last_frame": ctx["last"],
                    "config": ctx["config"], "metrics": metrics})
    add(p, "tile.json", "identity, the erosion settings used, and volume / area measurements")
    readme = """EROSION TILE: %s   (id %s, schema %s)
Units are FEET. X and Y are horizontal, Z is up, origin at the tile's low corner. Tile %.0f x %.0f x %.0f ft, %.3f ft cells, %d x %d x %d voxels, erosion frame %d of %d.

Start with manifest.json: every file has a machine-readable ROLE, and every image carries its place in the tile (origin, u and v axes, pixels per foot).

  model/        one GLB for three.js (foam and void, metres, Y up; the manifest gives the matrix back to tile feet).
  voxels/       raw binary grids [x][y][z], z fastest: index = (x*ny + y)*nz + z. void.u8, void_smooth.u8, material.u8, softness.u8.
                Join tiles by merging void_smooth and re-meshing, not by stacking the exported meshes (their faces are capped flat).
  data/         faces.json (each face's mask, depth, edges, outlines) and sections.json.
  images/       faces/ (colour, mask, depth, net), sections/ (colour + mask, contact sheets), projections/, thumbnail.png.
                Face images are seen from OUTSIDE the tile. Section images: X from -X (right = -Y), Y from -Y (right = +X), Z from above (right = +X, up = +Y). Masks: white = void.
  vector/       SVG drawings of the faces and sections, 1 inch = 1 foot.
  tile.json     identity, the erosion settings that made it, and volume / area measurements.
""" % (name, tile_id, SCHEMA, dims[0], dims[1], dims[2], cell, void_bool.shape[0], void_bool.shape[1], void_bool.shape[2], ctx["frame"], ctx["last"])
    p = os.path.join(root, "README.txt")
    with open(p, "w") as f:
        f.write(readme)
    add(p, "readme", "how the bundle works")
    p = os.path.join(root, "manifest.json")
    _write_json(p, {"schema": SCHEMA, "id": tile_id, "name": name, "tile_ft": dims, "cell_ft": cell, "grid": list(void_bool.shape), "units": "feet",
                    "voxel_layout": vol_layout, "files": files, "problems": problems}, indent=1)
    n_analysis = sum(len(fs) for _, _, fs in os.walk(root))

    # ---- the reference folder: Rhino file, recipe, log, timelapse ----
    rhino_path = None
    try:
        curves = [(ln, nm, rg.PolylineCurve([rg.Point3d(x, y, z) for x, y, z in pts])) for ln, nm, pts in face_curves + sec_curves]
        rp = os.path.join(ref, "%s.3dm" % name)
        msg = write_3dm(rp, [("foam", ctx["foam_mesh"], FOAM_RGB), ("void", ctx["void_mesh"], (200, 40, 55))], curves)
        if msg == "":
            rhino_path = rp
        else:
            problems.append("3dm file skipped (%s)" % msg)
    except Exception as e:
        problems.append("3dm file skipped (%s: %s)" % (type(e).__name__, e))
    with open(os.path.join(ref, "recipe.json"), "w", encoding="utf-8") as f:
        f.write(ctx.get("recipe_text") or pretty_recipe(build_recipe(ctx["config"], name, tile_id, float(void_bool.sum()) * cell ** 3, ctx["frame"], ctx["last"])))
    with open(os.path.join(ref, "log.txt"), "w") as f:
        f.write(ctx["log"])
    tl = os.path.join(ref, "timelapse")
    os.makedirs(tl, exist_ok=True)
    ax, k, sm_s = ctx["slice_axis"], ctx["slice_k"], ctx["smooth"]
    view = ("-X", "-Y", "+Z")[ax]
    r = int(math.ceil(3.0 * sm_s)) + 1
    lo, hi = max(0, k - r), min(void_sm.shape[ax], k + r + 1)
    maskf = ctx["mask"].astype(np.float32)
    growth = []
    for fr, Mf in enumerate(ctx["Ms"]):
        slab = smooth_field(np.take(np.clip(1.0 - Mf, 0.0, 1.0) * maskf, np.arange(lo, hi), axis=ax), sm_s)
        write_png(os.path.join(tl, "frame_%02d.png" % fr), color_image(orient(view, np.take(slab, k - lo, axis=ax))))
        growth.append({"frame": fr, "void_ft3": float((Mf < VOID_LEVEL).sum()) * cell ** 3, "void_fraction": float((Mf < VOID_LEVEL).mean())})
    _write_json(os.path.join(tl, "frames.json"), {"section": {"axis": "xyz"[ax].upper(), "position_ft": (k + 0.5) * cell, "seen_from": view}, "frames": growth})
    with open(os.path.join(ref, "README.txt"), "w") as f:
        f.write("""REFERENCE FILES for %s   (id %s)
Made in the same click as the folder %s%s, which is the one you send to the program.

  %s.3dm    Rhino file, feet, Z up: the foam and void meshes and the face and section outlines, on layers.
  recipe.json    the settings that rebuild this exact tile. Paste its text into a Panel wired to the engine's `recipe` input,
                 or type the path of this folder into `recipe`. The engine's log then says whether the tile matches (RECIPE CHECK).
  log.txt        the engine's log at the moment of export.
  timelapse/     one section image for every stored frame of the erosion (for animations), and frames.json with the void volume at each frame.
""" % (name, tile_id, name, SUFFIX_ANALYSIS, name))
    n_ref = sum(len(fs) for _, _, fs in os.walk(ref))
    lines = ["EXPORTED %d + %d files in %.1f s. One click, two folders:" % (n_analysis, n_ref, time.time() - t0),
             "  for the program: %s" % root,
             "  for you:         %s" % ref,
             "  id %s | void %.0f%% (%.0f ft3) in %d piece(s) | Rhino file: %s" % (tile_id, 100 * metrics["void_fraction"], metrics["void_volume_ft3"], metrics["void_pieces"],
                                                                              rhino_path if rhino_path else "not written")]
    lines += ["  NOTE: " + x for x in problems]
    return root, ref, "\n".join(lines)


# ------------------------------------------------------------------ recipes and cleanup
def compute_tile_id(void_bool, config):
    """Same voxels + same settings = same id. Sources are normalised so re-typed JSON gives the same id."""
    cfg = {k: v for k, v in config.items() if not (k == "weld" and not v)}      # a blank weld leaves the id exactly as before
    cfg["sources"] = [json.dumps(json.loads(x) if isinstance(x, str) else x, sort_keys=True) for x in config.get("sources", [])]
    return hashlib.sha1(np.asarray(void_bool).astype(np.uint8).tobytes() + json.dumps(cfg, sort_keys=True, default=_jdefault).encode()).hexdigest()[:16]


def build_recipe(config, name, tile_id, void_ft3, frame, last):
    """Everything needed to rebuild this tile from scratch, as a plain dict."""
    return {"schema": RECIPE_SCHEMA, "name": name, "engine_version": ENGINE_VERSION,
            "sim": {k: config[k] for k in RECIPE_FIELDS},
            "cleanup": {"min_void_ft3": config.get("min_void_ft3", 0.0), "min_foam_ft3": config.get("min_foam_ft3", 0.0), "weld": config.get("weld", "")},
            "foam": config["foam"],
            "sources": [json.loads(x) if isinstance(x, str) else x for x in config["sources"]],
            "frame": None if frame == last else int(frame),
            "expect": {"tile_id": tile_id, "void_ft3": round(float(void_ft3), 1), "frame": int(frame), "last_frame": int(last)}}


def pretty_recipe(r):
    """One setting per line, one source per line: easy to read and edit in a Panel."""
    keys = list(r.keys())
    out = ["{"]
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        v = r[k]
        if k == "sources" and v:
            out.append('  "sources": [')
            out.extend("    %s%s" % (json.dumps(x, default=_jdefault), "," if j < len(v) - 1 else "") for j, x in enumerate(v))
            out.append("  ]" + comma)
        else:
            out.append("  %s: %s%s" % (json.dumps(k), json.dumps(v, default=_jdefault), comma))
    out.append("}")
    return "\n".join(out)


def load_recipe(v):
    """The `recipe` input -> (overrides, recipe dict, warnings). Accepts recipe JSON text (a Panel, or lines from Read File),
    the path of a recipe.json / tile.json, or the path of a _reference (or _analysis) folder."""
    items = [x for x in _as_list(v) if not (isinstance(x, str) and not x.strip())]
    if not items:
        return {}, None, []
    if isinstance(items[0], dict):
        d = items[0]
    else:
        text = "\n".join(str(x) for x in items) if len(items) > 1 else str(items[0])
        text = text.strip().strip('"')
        if text.startswith("{"):
            try:
                d = json.loads(text)
            except Exception as e:
                raise ValueError("recipe is not valid JSON (%s). Paste the whole text of a recipe.json, or give the path of one." % e)
        else:
            pth = os.path.expandvars(os.path.expanduser(text))
            if os.path.isdir(pth):
                pth = os.path.join(pth, "recipe.json") if os.path.isfile(os.path.join(pth, "recipe.json")) else os.path.join(pth, "tile.json")
            if not os.path.isfile(pth):
                raise ValueError("recipe is neither recipe text nor a file or folder that exists: %s" % text)
            with open(pth, "r", encoding="utf-8-sig") as f:
                d = json.load(f)
    warns = []
    if not isinstance(d, dict):
        raise ValueError("recipe must be a JSON object")
    if "sim" not in d and isinstance(d.get("config"), dict):            # a tile.json from an export also works
        cfg = d["config"]
        d = {"schema": RECIPE_SCHEMA, "name": d.get("name"), "engine_version": d.get("engine_version"),
             "sim": {k: cfg[k] for k in RECIPE_FIELDS if k in cfg}, "foam": cfg.get("foam"), "sources": cfg.get("sources"),
             "cleanup": {"min_void_ft3": cfg.get("min_void_ft3", 0.0), "min_foam_ft3": cfg.get("min_foam_ft3", 0.0), "weld": cfg.get("weld", "")}, "frame": None,
             "expect": {"tile_id": d.get("id"), "frame": d.get("frame_exported"), "last_frame": d.get("last_frame")}}
    if not str(d.get("schema", "")).startswith("erosion-recipe/"):
        raise ValueError("recipe is not an erosion recipe (schema '%s')" % d.get("schema"))
    if d.get("engine_version") not in (None, ENGINE_VERSION):
        warns.append("NOTE: this recipe was made with engine %s, this is %s. The tile may differ slightly; see RECIPE CHECK." % (d.get("engine_version"), ENGINE_VERSION))
    ov = {}
    sim = d.get("sim") or {}
    for k in RECIPE_FIELDS:
        if sim.get(k) is not None:
            ov[k] = sim[k]
    if d.get("foam"):
        ov["foam"] = d["foam"]
    if d.get("sources") is not None:
        ov["sources"] = [x if isinstance(x, str) else json.dumps(x) for x in d["sources"]]
    cl = d.get("cleanup") or {}
    ov["min_void"] = float(cl.get("min_void_ft3") or 0.0)
    ov["min_foam"] = float(cl.get("min_foam_ft3") or 0.0)
    ov["weld"] = str(cl.get("weld") or "")
    if d.get("frame") is not None:
        ov["frame"] = int(d["frame"])
    return ov, d, warns


def cleanup_material(M, mask, cell, min_void, min_foam):
    """Remove specks from the finished material field. SEALED void pockets under min_void ft3 are filled with foam and
    FLOATING foam pieces under min_foam ft3 are dissolved. Anything that touches a tile face is left alone, because it may
    carry on into the next tile. Returns (material, info); the input is never modified."""
    info = {"pockets": 0, "pockets_ft3": 0.0, "pieces": 0, "pieces_ft3": 0.0}
    if min_void <= 0 and min_foam <= 0:
        return M, info
    M2 = np.array(M, copy=True)
    cv = cell ** 3

    def touching(lab, n):
        t = np.zeros(n + 1, bool)
        for f in VIEWS:
            t[np.unique(face_layer(lab, f))] = True
        return t
    if min_void > 0:
        lab, n = ndimage.label((M2 < VOID_LEVEL) & mask)
        if n:
            sizes = ndimage.sum(np.ones(lab.shape, np.float64), lab, index=np.arange(1, n + 1)) * cv
            kill = np.zeros(n + 1, bool)
            kill[1:] = (sizes < min_void)
            kill &= ~touching(lab, n)
            kill[0] = False
            if kill.any():
                sel = kill[lab]
                info["pockets"], info["pockets_ft3"] = int(kill.sum()), float(sel.sum() * cv)
                M2[sel] = 1.0
    if min_foam > 0:
        lab, n = ndimage.label((M2 >= VOID_LEVEL) & mask)
        if n:
            sizes = ndimage.sum(np.ones(lab.shape, np.float64), lab, index=np.arange(1, n + 1)) * cv
            kill = np.zeros(n + 1, bool)
            kill[1:] = (sizes < min_foam)
            kill &= ~touching(lab, n)
            kill[0] = False
            if kill.any():
                sel = kill[lab]
                info["pieces"], info["pieces_ft3"] = int(kill.sum()), float(sel.sum() * cv)
                M2[sel] = 0.0
    return M2, info



def run():
    warnings = []
    # ---- a wired recipe overrides the inputs it holds ----
    _RECIPE.clear()
    ov, recipe_dict, rwarns = load_recipe(globals().get("recipe"))
    _RECIPE.update(ov)
    warnings += rwarns
    # ---- read inputs (defaults used when an input is unwired) ----
    tile_w = float(_inp("tile_w", 20.0))
    tile_h = float(_inp("tile_h", 20.0))
    cell_req = float(_inp("cell", 0.5))
    steps = int(_inp("steps", 150))
    gravity = float(_inp("gravity", 0.0))
    drain = _truthy(_inp("drain", False))
    n_frames_req = max(1, int(_inp("n_frames", 30)))
    frame_req = _inp("frame", None)
    smooth = max(0.0, float(_inp("smooth", 0.8)))
    seed = int(_inp("seed", 1))
    foam_raw = _inp("foam", None)
    if isinstance(foam_raw, (list, tuple)):
        foam_raw = foam_raw[0] if len(foam_raw) else None
    foam = parse_foam(foam_raw)
    axis = int(np.clip(int(_inp("slice_axis", 1)), 0, 2))
    view = int(_inp("view", 0))

    # ---- snap the grid so cells fit the tile evenly ----
    nx = max(4, int(round(tile_w / cell_req)))
    cell = tile_w / nx
    nz = max(4, int(round(tile_h / cell)))
    shape = (nx, nx, nz)
    real_w, real_h = nx * cell, nz * cell
    dims = (real_w, real_w, real_h)
    n_cells = nx * nx * nz
    if n_cells > 2000000:
        return ("TOO MANY CELLS: %d. Increase 'cell' (bigger cells) and try again." % n_cells,
                None, None, None, None, None, None, None, None, None)

    max_frames = max(1, int(MAX_FRAME_BYTES / (8.0 * n_cells)))
    n_frames = min(n_frames_req, max_frames)
    if n_frames < n_frames_req:
        warnings.append("NOTE: n_frames lowered to %d to keep memory in check at this cell size." % n_frames)

    # ---- read the sources ----
    items = _as_list(_inp("sources", None))
    if not items:
        items = [json.dumps({"v": 1, "mode": "inject", "kind": "pt", "pt": [real_w / 2.0, real_w / 2.0, real_h / 2.0],
                             "dose": DEFAULT_DOSE[INJECT], "spread": DEFAULT_SPREAD[INJECT], "start": 0.0,
                             "duration": 0.0, "dir": None})]
        warnings.append("NOTE: no sources wired in, so one default inject in the middle is used. "
                        "Wire Source components into 'sources' (List Access).")
    if len(items) > MAX_SOURCES:
        warnings.append("NOTE: only the first %d sources are used." % MAX_SOURCES)
        items = items[:MAX_SOURCES]
    specs = []
    for i, it in enumerate(items):
        sp = parse_source(it, i, cell)
        if sp["kind"] == "pt":                     # keep single points inside the block
            x, y, z = sp["pt"]
            cx, cy, cz = min(max(x, 0.0), real_w), min(max(y, 0.0), real_w), min(max(z, 0.0), real_h)
            if sp["mode"] == SPRAY and sp.get("dir") is not None:
                cx, cy, cz = x, y, z               # an aimed spray's nozzle is meant to sit outside
            elif (cx, cy, cz) != (x, y, z):
                warnings.append("NOTE: source %d (%.1f, %.1f, %.1f) is outside the block; moved to the nearest edge." % (i, x, y, z))
            sp["pt"] = [cx, cy, cz]
        if sp["start"] >= steps and steps > 0:
            warnings.append("NOTE: source %d starts at step %d, after the run ends (%d steps), so it does nothing." % (i, sp["start"], steps))
        specs.append(sp)

    mask = container_mask(shape, "cube")

    # ---- run (or reuse) the simulation ----
    def skey(sp):
        return (sp["kind"], sp["mode"], tuple(round(c, 4) for c in sp["pt"]) if sp["kind"] == "pt"
                else tuple(tuple(round(c, 3) for c in p) for p in sp["pts"]),
                round(sp["dose"], 6), round(sp["spread"], 6), round(sp["start"], 6), round(sp["dur"], 6),
                tuple(round(c, 4) for c in sp["dir"]) if sp.get("dir") else None)

    fkey = (round(foam["noise"], 6), round(foam["scale"], 6), round(foam["grain"], 6), foam["seed"],
            round(foam["web"], 6), round(foam["web_open"], 6), round(foam["web_thickness"], 6), foam["layers"],
            foam["layer_count"], foam["layer_axis"], round(foam["layer_thickness"], 6), round(foam["layer_strength"], 6))
    key = (round(tile_w, 6), round(tile_h, 6), round(cell, 6), steps, round(gravity, 6), drain, n_frames, seed, fkey,
           tuple(skey(sp) for sp in specs))
    infos = []

    def build():
        rng = np.random.default_rng(seed)
        srcs = []
        for sp in specs:
            W, info, disp = build_source(shape, cell, mask, sp, dims, rng)
            srcs.append((W, sp["start"], sp["dur"]))
            infos.append((info, disp, float(W.sum()), float(W.max())))
        rho_f, Pm_f = make_foam_fields(shape, cell, dims, mask, foam)
        Ms, Cs = simulate(mask, srcs, steps, gravity, density=rho_f, perm_mult=Pm_f, cell=cell, n_frames=n_frames, drain=drain)
        return Ms, Cs, infos, 1.0 / rho_f

    t0 = time.time()
    (Ms, Cs, infos, S_field), cached = _get_sim(key, build)
    t_sim = time.time() - t0
    last = len(Ms) - 1

    # ---- which frame to show ----
    frame = last if frame_req is None else int(frame_req)
    if frame > last or frame < 0:
        warnings.append("NOTE: frame %d is out of range (0 to %d); showing frame %d." % (frame, last, min(max(frame, 0), last)))
        frame = min(max(frame, 0), last)
    M, C = Ms[frame], Cs[frame]
    min_void = max(0.0, float(_inp("min_void", 0.0)))
    min_foam = max(0.0, float(_inp("min_foam", 0.0)))
    M, cinfo = cleanup_material(M, mask, cell, min_void, min_foam)
    for i, (info, disp, w, peak) in enumerate(infos):
        lab = MODE_LABEL[specs[i]["mode"]]
        if specs[i]["spread"] > 1.5 * max(dims):
            warnings.append("NOTE: source %d (%s) has spread %.0f ft, far bigger than the block (%.0f ft). Spread is a WIDTH IN FEET; "
                            "try 1 to 12." % (i, lab, specs[i]["spread"], max(dims)))
        elif w <= 0.0:
            warnings.append("NOTE: source %d (%s) puts no solvent inside the block. Check its position, aim and spread." % (i, lab))
        elif peak < 0.5:
            warnings.append("NOTE: source %d (%s) is spread too thin to erode anything (its strongest spot has only %.0f%% of what "
                            "one cell needs). Lower its spread or raise its dose." % (i, lab, 100.0 * peak))

    # ---- stats ----
    block_ft3 = int(mask.sum()) * cell ** 3
    void_cells = int(np.count_nonzero((M < VOID_LEVEL) & mask))
    void_ft3 = void_cells * cell ** 3
    total_dose = sum(sp["dose"] for sp in specs)
    total_dose_cells = total_dose / (cell ** 3)
    solvent_left = float(C.sum()) / max(total_dose_cells, 1e-9) * 100.0

    # ---- slice preview ----
    slice_default = (real_h if axis == 2 else real_w) / 2.0
    slice_pos = float(_inp("slice_pos", slice_default))
    A = M if view == 0 else (C if view == 1 else S_field)
    k = int(np.clip(int(slice_pos / cell), 0, shape[axis] - 1))
    section = build_slice_mesh(A, axis, k, cell, view, float(C.max()))
    slice_void = int(np.count_nonzero(np.take((M < VOID_LEVEL) & mask, k, axis=axis)))
    if void_cells > 0 and slice_void == 0:
        warnings.append("NOTE: this slice does not cut through any void, so it looks solid. Move slice_pos toward a source.")
    if void_cells == 0 and frame == last:
        warnings.append("NOTE: nothing eroded. Raise a dose, lower a spread, or check that the sources are inside the block.")

    # ---- smooth meshes ----
    t1 = time.time()
    maskf = mask.astype(np.float32)
    void_field = np.clip(1.0 - M, 0.0, 1.0) * maskf
    foam_field = np.clip(M, 0.0, 1.0) * maskf
    void_sm = smooth_field(void_field, smooth)
    cleaned_sm = False
    weld = "".join(sorted(set(ch for ch in str(_inp("weld", "")).lower() if ch in "xyz")))
    if weld:                                            # make opposite faces match so copies interlock exactly
        void_sm = (weld_faces(void_sm, weld, cell) * maskf).astype(np.float32)
        cleaned_sm = True
    if min_void > 0 or min_foam > 0:                    # second pass on the smoothed field: smoothing can cut a thin bridge and leave a floater
        F2, c2 = cleanup_material(1.0 - void_sm, mask, cell, min_void, min_foam)
        if c2["pockets"] or c2["pieces"]:
            void_sm = ((1.0 - F2) * maskf).astype(np.float32)
            cleaned_sm = True
            cinfo = {k: cinfo[k] + c2[k] for k in cinfo}
    vv, vf, void_mesh_vol = field_to_arrays(void_sm, cell, smooth, presmoothed=True)
    if cleaned_sm:
        fv, ff, foam_mesh_vol = field_to_arrays((1.0 - void_sm) * maskf, cell, smooth, presmoothed=True)
    else:
        fv, ff, foam_mesh_vol = field_to_arrays(foam_field, cell, smooth)
    void_mesh = arrays_to_mesh(vv, vf)
    foam_mesh = arrays_to_mesh(fv, ff)
    t_mesh = time.time() - t1

    # ---- the tile as data (voxels + face footprints + every setting) ----
    void_bool = (void_sm >= 0.5) & mask
    config = {"tile_w": tile_w, "tile_h": tile_h, "cell": cell_req, "steps": steps, "gravity": gravity, "drain": bool(drain),
              "n_frames": n_frames, "frame": frame, "smooth": smooth, "seed": seed,
              "sources": [it if isinstance(it, str) else json.dumps(it) for it in items], "foam": foam,
              "min_void_ft3": min_void, "min_foam_ft3": min_foam, "weld": weld}
    tile_data = make_tile_data(void_bool, cell, dims, frame, config)
    tile_name = _inp("tile_name", None) or (recipe_dict or {}).get("name") or "tile"
    tile_name = str(tile_name)
    tile_id = compute_tile_id(void_bool, config)
    recipe_text = pretty_recipe(build_recipe(config, tile_name, tile_id, float(void_bool.sum()) * cell ** 3, frame, last))
    recipe_lines = []
    if recipe_dict is not None:
        exp = recipe_dict.get("expect") or {}
        recipe_lines.append("RECIPE: '%s' is wired in and replaces: %s. (Sliders wired into those inputs are ignored; unwire the recipe to use them.)" % (
            recipe_dict.get("name") or "unnamed", ", ".join(sorted(k for k in _RECIPE if k != "frame"))))
        if exp.get("tile_id"):
            if exp.get("frame") is not None and int(exp["frame"]) != frame:
                recipe_lines.append("RECIPE CHECK: not compared, you are looking at frame %d and the recipe tile is frame %s." % (frame, exp["frame"]))
            elif exp["tile_id"] == tile_id:
                recipe_lines.append("RECIPE CHECK: OK. This is exactly the recorded tile (id %s)." % tile_id)
            else:
                recipe_lines.append("RECIPE CHECK: DIFFERENT from the recorded tile (id %s now, %s recorded; void %.0f ft3 now, %s recorded)%s." % (
                    tile_id, exp["tile_id"], float(void_bool.sum()) * cell ** 3, exp.get("void_ft3", "?"),
                    ", made with engine %s" % recipe_dict["engine_version"] if recipe_dict.get("engine_version") not in (None, ENGINE_VERSION) else ""))
                if exp.get("void_ft3") and abs(float(void_bool.sum()) * cell ** 3 - float(exp["void_ft3"])) <= 0.005 * float(exp["void_ft3"]):
                    recipe_lines.append("  (Very close. If you did not edit the recipe, this is only tiny numeric differences between machines or library versions.)")

    # ---- block outline + source markers ----
    box = rg.Box(rg.Plane.WorldXY, rg.Interval(0, real_w), rg.Interval(0, real_w), rg.Interval(0, real_h))
    outline = [e.DuplicateCurve() for e in box.ToBrep().Edges]
    for p_ in layer_positions(foam, dims):
        ax_ = foam["layer_axis"]
        a_, b_ = [i for i in range(3) if i != ax_]
        corners = []
        for (u_, v_) in ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0)):
            c_ = [0.0, 0.0, 0.0]
            c_[ax_], c_[a_], c_[b_] = p_, u_ * dims[a_], v_ * dims[b_]
            corners.append(rg.Point3d(c_[0], c_[1], c_[2]))
        try:
            outline.append(rg.PolylineCurve(corners))
        except Exception:
            outline.extend(rg.LineCurve(x, y) for x, y in zip(corners[:-1], corners[1:]))
    src_out = [rg.Point3d(float(inf[1][0]), float(inf[1][1]), float(inf[1][2])) for inf in infos]

    n_src = len(specs)
    if foam["layers"] and foam["layer_count"] > 0 and foam["layer_thickness"] < 0.5 * cell:
        warnings.append("NOTE: layer_thickness %.2f ft is under half a cell (%.2f ft), so the layers are faint. Raise it or use smaller cells." % (foam["layer_thickness"], cell))
    if foam["layers"] and foam["layer_count"] > 0 and (dims[foam["layer_axis"]] / (foam["layer_count"] + 1.0)) < 2.0 * foam["layer_thickness"]:
        warnings.append("NOTE: the layers are so close together that they nearly touch. Lower layer_count or layer_thickness.")
    _notify("frame %d/%d | %.0f ft3 | %.1f%% void | %d src | %s%s%s" % (
                frame, last, void_mesh_vol, 100.0 * void_mesh_vol / block_ft3, n_src, "drain" if drain else "pool",
                " | noise %.2f" % foam["noise"] if foam["noise"] > 0 else "",
                " | %d layers" % foam["layer_count"] if (foam["layers"] and foam["layer_count"] > 0) else ""),
            [w for w in warnings if w.startswith("NOTE")])
    log = "\n".join(warnings + recipe_lines + [
        "FRAME: %d of %d" % (frame, last),
        "GRID: %d x %d x %d = %d cells,  CELL: %.3f ft (%.2f in)" % (nx, nx, nz, n_cells, cell, cell * 12.0),
        "TILE: %.2f' x %.2f' x %.2f' = %.0f ft3" % (real_w, real_w, real_h, block_ft3),
        "SIMULATION: %s (%.2f s), STEPS: %d, SEED: %d, GRAVITY: %.2f, BOTTOM: %s"
        % ("reused from cache" if cached else "ran", t_sim, steps, seed, gravity, "DRAIN (solvent falls out)" if drain else "POOL"),
        "MESHING: %.2f s, smooth = %.2f cells" % (t_mesh, smooth),
        "VOID: %.0f ft3 smooth mesh (%.0f ft3 counted in voxels) = %.1f%% of block, total dose %.0f ft3"
        % (void_mesh_vol, void_ft3, 100.0 * void_mesh_vol / block_ft3, total_dose),
        "FOAM LEFT: %.0f ft3 (mesh)" % foam_mesh_vol,
        "FOAM: noise %.2f, lobe scale %.1f ft, grain %.2f, foam_seed %d, membranes %s | %s" % (
            foam["noise"], foam["scale"], foam["grain"], foam["seed"],
            ("%.2f (%.0f%% open, %.1f ft thick)" % (foam["web"], 100 * foam["web_open"], foam["web_thickness"])) if foam["web"] > 0 else "off",
            ("LAYERS ON: %d along %s, every %.1f ft, %.2f ft thick, %s %.2f" % (
                foam["layer_count"], "XYZ"[foam["layer_axis"]], dims[foam["layer_axis"]] / (foam["layer_count"] + 1.0),
                foam["layer_thickness"], "resistant" if foam["layer_strength"] >= 0 else "weak seam", abs(foam["layer_strength"])))
            if (foam["layers"] and foam["layer_count"] > 0) else "layers off"),
        ("CLEANUP: %s%s" % (
            ("filled %d sealed void pocket(s) (%.1f ft3)" % (cinfo["pockets"], cinfo["pockets_ft3"])) if min_void > 0 else "sealed pockets kept (min_void 0)",
            (", dissolved %d floating foam piece(s) (%.1f ft3)" % (cinfo["pieces"], cinfo["pieces_ft3"])) if min_foam > 0 else ", floating foam kept (min_foam 0)")),
        "SOLVENT LEFT: %.1f%% of total dose" % solvent_left,
        "SLICE: axis %s, cell %d of %d (%.1f ft), view = %s, void cells in slice = %d"
        % ("XYZ"[axis], k, shape[axis], (k + 0.5) * cell, ("material", "solvent", "foam density")[min(view, 2)], slice_void),
    ] + ["SOURCE %d: %s | dose %.0f ft3, spread %.1f ft, start %.0f, duration %.0f"
         % (i, infos[i][0], specs[i]["dose"], specs[i]["spread"], specs[i]["start"], specs[i]["dur"]) for i in range(n_src)])
    # ---- one-click export ----
    base_dir = _inp("export_dir", None)
    base_dir = str(base_dir).strip() if base_dir not in (None, "") else None
    export_log, export_path = "", None
    if _truthy(_inp("export", False)):
        try:
            root_a, root_r, export_log = export_bundle(dict(
                void_sm=void_sm, void_bool=void_bool, M=M, Ms=Ms, density_field=S_field, cell=cell, dims=dims, config=config,
                tile_data=tile_data, log=log, void_arrays=(vv, vf), foam_arrays=(fv, ff), void_mesh=void_mesh, foam_mesh=foam_mesh,
                section_count=int(_inp("section_count", 9)), slice_axis=axis, slice_k=k, smooth=smooth, base_dir=base_dir,
                name=tile_name, frame=frame, last=last, mask=mask, tile_id=tile_id, recipe_text=recipe_text))
            export_path = [root_a, root_r]
            _notify("exported: %s" % os.path.basename(root_a), [])
        except Exception as e:
            export_log = "EXPORT FAILED: %s: %s" % (type(e).__name__, e)
            _notify("export failed", ["NOTE: " + export_log])
    else:
        dest = os.path.join(base_dir or os.path.join(os.path.expanduser("~"), "Documents", "Erosion Exports"), _safe_name(tile_name))
        export_log = ("Export is idle. Wire a Button to `export` and click it. One click writes two folders:\n"
                      "  for the program: %s\n  for you (Rhino file, recipe, log): %s") % (dest + SUFFIX_ANALYSIS, dest + SUFFIX_REFERENCE)
    return log, section, void_mesh, foam_mesh, outline, src_out, tile_data, export_log, export_path, recipe_text


log, section, void_mesh, foam_mesh, outline, src_pt_out, tile_data, export_log, export_path, recipe_text = run()
