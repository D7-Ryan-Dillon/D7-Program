# r: numpy, scipy, scikit-image
# =====================================================================
# EROSION CA - ENGINE 7  (floor plates, any-geometry input, bake-and-feed-back loop)
# Built from engine 5f: every 5f input, output and recipe still works and gives the same tile.
# Units: feet (decimal). 0.5 = 6 inches. Rhino world coordinates, Z up.
# Collects acetone applications from Source components (wire every Source's `src` into
# `sources`), optional floor plates from Floor Plates components (wire every `plates` into
# `plates`), runs the erosion, and gives you smooth meshes + a frame scrubber.
#
# INPUTS (all optional unless noted)
#   sources : LIST of texts from Erosion Source components (List Access)
#   plates  : LIST of texts from Floor Plates components (List Access)
#   geo     : (NEW) the FOAM to erode, instead of a cube. Any closed Brep / box / extrusion /
#             closed mesh / Rhino reference, or a list of them (they are united). The grid is
#             the geometry's bounding box. Blank = a cube made from tile_w, tile_h as before.
#   mass_in : (NEW) text from the `mass` OUTPUT of another engine. Starts this run from that
#             engine's finished result (its foam, its voids, its plates) instead of a fresh
#             block, so you can erode in several passes. Wins over geo / tile_w / tile_h / cell.
#   tile_w, tile_h, cell : cube size and cell size when there is no geo / mass (as in 5f)
#   steps, gravity, drain, seed, smooth, n_frames, frame, view, slice_axis, slice_pos : as in 5f
#             (slice_pos is a WORLD coordinate along slice_axis)
#   foam    : text from a Foam Source. With `mass`, blank = keep the foam of the earlier pass.
#   min_void, min_foam, weld : as in 5f (cleanup of specks, and seam weld for repeating tiles)
#   recipe  : text of a recipe.json (or the path of one, or of a _reference folder). It REPLACES
#             everything that defines the tile: the container (cube / box / geometry), the
#             starting mass, every setting, foam, sources and floor plates, so the exact tile is
#             rebuilt with NO Rhino geometry. frame, view, slice_* and the export inputs stay yours.
# EXPORT: wire a Button to `export`. One click writes two folders in export_dir:
#   <tile_name>_analysis   everything the program needs (GLB, voxels, faces, sections, plates.json,
#                          tile.json, manifest.json, recipe.json ...)
#   <tile_name>_reference  for you: <tile_name>.3dm (Rhino, in world coordinates, with the plates,
#                          struts, container and new-erosion layers), recipe.json, mass.json, log.txt, timelapse/
#   export_dir, tile_name, section_count, export_log, export_path : as in 5f
#
# OUTPUTS
#   log, section, void_mesh, foam_mesh, outline, src_pt_out, tile_data, export_log, export_path,
#   recipe_text : as in 5f
#   mass           : (NEW) the finished result as text -> the next engine's `mass` input
#   plates_mesh    : (NEW) the floor plates that survived (true flat tops)
#   structure_mesh : (NEW) the support branches that were grown
#   new_void_mesh  : (NEW) only what THIS run removed (an earlier pass's voids are not in it)
#   preview_mesh   : (NEW) the one mesh to look at: the whole solid with vertex colours (floor plates
#                    blue, support branches orange, cavity walls red, outer skin light grey). Wire it
#                    straight to a Mesh/Custom Preview with NO material swatch so the colours show.
#   cutaway        : (NEW input, int) 0 = whole block; 1 = remove everything beyond slice_pos on slice_axis;
#                    -1 = remove everything before it. Only changes preview_mesh, never the result.
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
from skimage import draw as skdraw
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

# ---- engine 7: floor plates, support branches, containers ----
STOP_RATE = 0.35          # fraction of solvent a 'stop' acetone loses per step in cells touching a plate
SLIDE_RATE = 0.4          # fraction of solvent an 'around' acetone slides toward the plate edge per step
MAX_SPECIES = 8           # distinct (plate_mode, cut) combinations among the sources
STRUT_REACH_FT = 30.0     # a support branch longer than this is reported
MAX_STRUTS_PER_PLATE = 40
MASS_SCHEMA = "erosion-mass/1"
POOL, STOP, AROUND, THROUGH = 0, 1, 2, 3
PLATE_MODE_NAMES = {"pool": POOL, "stop": STOP, "around": AROUND, "through": THROUGH, "ghost": THROUGH,
                    "p": POOL, "s": STOP, "a": AROUND, "t": THROUGH}
PLATE_MODE_LABEL = {POOL: "pool", STOP: "stop", AROUND: "around", THROUGH: "through"}
STRUCT6 = ndimage.generate_binary_structure(3, 1)

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
def simulate(mask, sources, steps, gravity=0.0, density=None, perm_mult=None, cell=REF_CELL, n_frames=30, drain=False,
             initial_material=None, plate=None, groups=None):
    """The erosion. M = material (1 foam ... 0 void). One solvent field per distinct (plate_mode, cut) among the sources
    (`groups`), so different acetone applications can treat floor plates differently.
    sources: list of (W, t_start, duration, group index), W in "dose cells"; times in ref steps.
    plate: the plate context from plate_sim_context (None = no plates). density already holds the plates' resistance."""
    _COUNTERS["sims"] += 1
    shape = mask.shape
    s = min(1.0, (cell / REF_CELL) ** 2)          # time-step size relative to reference
    n_int = max(0, int(round(int(steps) / s)))
    ds, dv = DIFF_SOLID, DIFF_VOID
    diss = DISSOLVE_K * s
    evap = 1.0 - (1.0 - EVAPORATION) ** s
    drain_frac = 1.0 - (1.0 - DRAIN_RATE) ** s
    maskf = mask.astype(np.float32)
    M = maskf.copy() if initial_material is None else np.asarray(initial_material, np.float32).copy() * maskf
    rho = np.ones(shape, np.float32) if density is None else density.astype(np.float32)
    S = 1.0 / rho                                 # soft foam also dissolves faster
    Pm = np.ones(shape, np.float32) if perm_mult is None else perm_mult.astype(np.float32)
    ds_field = np.minimum(ds * Pm, 0.9 * dv)      # how easily solvent creeps through intact foam, cell by cell
    g = float(np.clip(gravity, 0.0, 1.0)) * GRAVITY_MAX * math.sqrt(s)

    groups = list(groups) if groups else [(POOL, False)]
    ng = len(groups)
    C = [np.zeros(shape, np.float32) for _ in range(ng)]
    simple = (ng == 1 and plate is None)
    # how each solvent meets a plate: may it dissolve it (allow), does it flow through it (D_over / perm_over)
    allow = [None] * ng
    D_over = [None] * ng
    perm_over = [None] * ng
    pidx = None
    if plate is not None and len(plate["plate_idx"]):
        pidx = plate["plate_idx"]
        for gi, (mode, cut) in enumerate(groups):
            a = np.ones(shape, np.float32)
            a.reshape(-1)[pidx] = 1.0 if cut else 0.0
            allow[gi] = a
            if mode == THROUGH:
                D_over[gi], perm_over[gi] = dv, 1.0
            elif not cut:
                D_over[gi], perm_over[gi] = 0.0, 0.0
    else:
        plate = None
        simple = (ng == 1)

    instant_late, timed = [], []
    for W, t0, dur, gid in sources:
        if dur <= 0.0:
            if t0 <= 0.0:
                C[gid] += W                           # applied before the clock starts
            else:
                instant_late.append((W, t0, gid))
        else:
            timed.append((W, t0, t0 + dur, gid))

    snap_steps = sorted(set(int(round(v)) for v in np.linspace(0, n_int, n_frames + 1)))
    snap_set = set(snap_steps)

    def total_c():
        if ng == 1:
            return C[0].copy()
        out = C[0].copy()
        for c_ in C[1:]:
            out += c_
        return out
    Ms = [M.copy()]
    Cs = [total_c()]

    for it in range(1, n_int + 1):
        t_prev, t_cur = (it - 1) * s, it * s
        # 0. apply any solvent whose time has come
        for W, t0, gid in instant_late:
            if t_prev <= t0 < t_cur:
                C[gid] += W
        for W, t0, t1, gid in timed:
            ov = min(t_cur, t1) - max(t_prev, t0)
            if ov > 0.0:
                C[gid] += W * (ov / (t1 - t0))

        # 1. dissolve (plate cells only by solvents that are allowed to cut)
        if simple:
            c0 = C[0]
            dM = np.minimum(M, diss * c0 * S)
            dM = np.minimum(dM, c0 / rho)             # dissolving one unit of foam costs rho units of solvent
            M -= dM
            c0 -= rho * dM
        else:
            Ceff = [C[gi] if allow[gi] is None else C[gi] * allow[gi] for gi in range(ng)]
            Ct = Ceff[0].copy()
            for ce in Ceff[1:]:
                Ct += ce
            dM = np.minimum(M, diss * Ct * S)
            dM = np.minimum(dM, Ct / rho)
            M -= dM
            ratio = np.zeros_like(Ct)
            np.divide(rho * dM, Ct, out=ratio, where=Ct > 1e-20)
            for gi in range(ng):
                C[gi] -= Ceff[gi] * ratio

        # 2. spread, 3. fall, then the plate behaviours, drain, evaporation
        Dbase = (ds_field + (dv - ds_field) * (1.0 - M)) * maskf
        if g > 0.0:
            permbase = maskf * (np.minimum(0.05 * Pm, 0.5) + 0.95 * (1.0 - M))
        for gi in range(ng):
            c = C[gi]
            D = Dbase
            if D_over[gi] is not None:
                D = Dbase.copy()
                D.reshape(-1)[pidx] = D_over[gi]
            dC = np.zeros_like(c)
            for ax in range(3):
                lo = [slice(None)] * 3
                hi = [slice(None)] * 3
                lo[ax] = slice(0, -1)
                hi[ax] = slice(1, None)
                lo, hi = tuple(lo), tuple(hi)
                Df = np.minimum(D[lo], D[hi])
                flux = Df * (c[hi] - c[lo])
                dC[lo] += flux
                dC[hi] -= flux
            c += dC
            if g > 0.0:
                perm = permbase
                if perm_over[gi] is not None:
                    perm = permbase.copy()
                    perm.reshape(-1)[pidx] = perm_over[gi]
                f = g * c[:, :, 1:] * np.minimum(perm[:, :, 1:], perm[:, :, :-1])
                c[:, :, 1:] -= f
                c[:, :, :-1] += f
            if plate is not None:
                mode = groups[gi][0]
                flat = c.reshape(-1)
                if mode == STOP and len(plate["adj_idx"]):
                    flat[plate["adj_idx"]] *= (1.0 - STOP_RATE)           # a 'stop' acetone is soaked up where it touches a plate
                elif mode == AROUND and len(plate["slide_src"]):
                    amt = SLIDE_RATE * flat[plate["slide_src"]]           # an 'around' acetone slides off toward the plate edge
                    flat[plate["slide_src"]] -= amt
                    np.add.at(flat, plate["slide_dst"], amt)
            if drain:
                c[:, :, 0] *= (1.0 - drain_frac * (1.0 - M[:, :, 0]) * maskf[:, :, 0])
            c *= (1.0 - evap)
            np.maximum(c, 0.0, out=c)

        if it in snap_set:
            Ms.append(M.copy())
            Cs.append(total_c())

    return Ms, Cs


# ==== GRASSHOPPER SECTION ===============================================
import Rhino.Geometry as rg


# =====================================================================
# ENGINE 7: GEOMETRY -> GRID  (containers and plates)
# Triangle meshes are turned into grid data with plain numpy (no Rhino calls),
# so a recipe that stores triangles rebuilds the same thing on any machine.
# =====================================================================
_JX, _JY = 1.3e-6, 0.7e-6          # tiny offsets (fractions of a cell) so a column never lands exactly on a mesh edge


def mesh_column_hits(V, F, nx, ny, cell):
    """Where vertical lines through the centre of every grid column meet a triangle mesh.
    V (n,3) vertices in grid coordinates (feet), F (m,3) triangle indices.
    Returns (column index = i*ny + j, z) sorted by column then z."""
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    jx, jy = _JX * cell, _JY * cell
    cols, zs = [], []
    for tri in F:
        p = V[tri]
        i0 = max(0, int(math.ceil((p[:, 0].min() - jx) / cell - 0.5)))
        i1 = min(nx - 1, int(math.floor((p[:, 0].max() - jx) / cell - 0.5)))
        j0 = max(0, int(math.ceil((p[:, 1].min() - jy) / cell - 0.5)))
        j1 = min(ny - 1, int(math.floor((p[:, 1].max() - jy) / cell - 0.5)))
        if i1 < i0 or j1 < j0:
            continue
        den = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(den) < 1e-14:
            continue
        X = ((np.arange(i0, i1 + 1) + 0.5) * cell + jx)[:, None]
        Y = ((np.arange(j0, j1 + 1) + 0.5) * cell + jy)[None, :]
        l1 = ((p[1, 1] - p[2, 1]) * (X - p[2, 0]) + (p[2, 0] - p[1, 0]) * (Y - p[2, 1])) / den
        l2 = ((p[2, 1] - p[0, 1]) * (X - p[2, 0]) + (p[0, 0] - p[2, 0]) * (Y - p[2, 1])) / den
        l3 = 1.0 - l1 - l2
        inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not inside.any():
            continue
        z = l1 * p[0, 2] + l2 * p[1, 2] + l3 * p[2, 2]
        ii, jj = np.nonzero(inside)
        cols.append((ii + i0) * ny + (jj + j0))
        zs.append(z[inside])
    if not cols:
        return np.zeros(0, np.int64), np.zeros(0)
    c = np.concatenate(cols)
    z = np.concatenate(zs)
    o = np.lexsort((z, c))
    return c[o], z[o]


def column_intervals(c, z):
    """Pairs the sorted hits of every column into inside-intervals. Returns ({column: [(z0, z1), ...]}, odd columns)."""
    out, odd = {}, 0
    if len(c) == 0:
        return out, 0
    bounds = np.flatnonzero(np.diff(c)) + 1
    starts = np.concatenate(([0], bounds))
    ends = np.concatenate((bounds, [len(c)]))
    for s, e in zip(starts, ends):
        zz = z[s:e]
        if len(zz) % 2:
            odd += 1
            zz = zz[:-1]
        if len(zz) < 2:
            continue
        out[int(c[s])] = [(float(zz[k]), float(zz[k + 1])) for k in range(0, len(zz), 2)]
    return out, odd


def mask_from_intervals(intervals, shape, cell):
    m = np.zeros(shape, dtype=bool)
    ny, nz = shape[1], shape[2]
    for col, ivs in intervals.items():
        i, j = divmod(col, ny)
        for z0, z1 in ivs:
            k0 = max(0, int(math.ceil(z0 / cell - 0.5)))
            k1 = min(nz - 1, int(math.floor(z1 / cell - 0.5)))
            if k1 >= k0:
                m[i, j, k0:k1 + 1] = True
    return m


def box_mesh(lo, hi):
    """The 12 triangles of an axis-aligned box (for hand-written recipes)."""
    x0, y0, z0 = [float(a) for a in lo]
    x1, y1, z1 = [float(a) for a in hi]
    V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
    F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
    return np.array(V), np.array(F)


# ---- Rhino objects -> triangle arrays ----
def _geom_from_guid(g):
    docs = []
    try:
        import Rhino
        docs.append(Rhino.RhinoDoc.ActiveDoc)
        docs.extend(list(Rhino.RhinoDoc.OpenDocuments()))
    except Exception:
        pass
    try:
        import scriptcontext as sc
        docs.append(sc.doc)
    except Exception:
        pass
    for d in docs:
        if d is None:
            continue
        try:
            obj = d.Objects.FindId(g)
        except Exception:
            obj = None
        if obj is not None and obj.Geometry is not None:
            return obj.Geometry
    raise ValueError("no Rhino object found for referenced id " + str(g))


def _unwrap(v):
    if v is None:
        return None
    if type(v).__name__ == "Guid":
        return _unwrap(_geom_from_guid(v))
    if hasattr(v, "Value") and not hasattr(v, "Vertices") and not hasattr(v, "Faces") and not hasattr(v, "IsSolid"):
        return _unwrap(v.Value)
    return v


def geo_to_triangles(values, warnings, label="geo"):
    """Closed Rhino geometry (or a list of it) -> (V, F) numpy arrays in world coordinates."""
    Vs, Fs, off = [], [], 0
    for item in _as_list(values):
        g = _unwrap(item)
        if g is None:
            continue
        if isinstance(g, rg.Mesh):
            mesh = g.DuplicateMesh()
            if not mesh.IsClosed:
                warnings.append("NOTE: a mesh in %s is not closed; the inside of it is guessed column by column." % label)
        else:
            brep = None
            if isinstance(g, rg.Brep):
                brep = g
            elif hasattr(g, "ToBrep"):
                brep = g.ToBrep()
            elif isinstance(g, rg.Surface):
                brep = rg.Brep.CreateFromSurface(g)
            if brep is None:
                raise ValueError("%s accepts closed Breps, boxes, extrusions or meshes. Got %s." % (label, type(g).__name__))
            if not brep.IsSolid:
                warnings.append("NOTE: a Brep in %s is not a closed solid; the inside of it is guessed column by column." % label)
            parts = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.QualityRenderMesh)
            if not parts:
                raise ValueError("a Brep in %s could not be meshed." % label)
            mesh = rg.Mesh()
            for part in parts:
                mesh.Append(part)
        mesh.Faces.ConvertQuadsToTriangles()
        V = np.array([[float(mesh.Vertices[i].X), float(mesh.Vertices[i].Y), float(mesh.Vertices[i].Z)] for i in range(mesh.Vertices.Count)])
        F = np.array([[int(mesh.Faces[i].A), int(mesh.Faces[i].B), int(mesh.Faces[i].C)] for i in range(mesh.Faces.Count)], dtype=np.int64)
        Vs.append(V)
        Fs.append(F + off)
        off += len(V)
    if not Vs:
        raise ValueError("%s is empty." % label)
    return np.vstack(Vs), np.vstack(Fs)


# ---- packing helpers (recipes and the mass text) ----
def _pack_arr(a, dtype):
    return base64.b64encode(zlib.compress(np.ascontiguousarray(a, dtype=dtype).tobytes(), 6)).decode("ascii")


def _unpack_arr(text, shape, dtype):
    a = np.frombuffer(zlib.decompress(base64.b64decode(text)), dtype=dtype)
    if a.size != int(np.prod(shape)):
        raise ValueError("packed array does not match its grid")
    return a.reshape(shape).copy()


def _pack_bits(b):
    return base64.b64encode(zlib.compress(np.packbits(np.asarray(b, dtype=bool).ravel()).tobytes(), 6)).decode("ascii")


def _unpack_bits(text, shape):
    n = int(np.prod(shape))
    bits = np.unpackbits(np.frombuffer(zlib.decompress(base64.b64decode(text)), dtype=np.uint8))
    if bits.size < n:
        raise ValueError("packed mask does not match its grid")
    return bits[:n].reshape(shape).astype(bool)


def _digest(*parts):
    h = hashlib.sha1()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode("utf-8"))
    return h.hexdigest()[:16]


# ---- the container (the foam block) ----
def container_from_spec(c, cell_req, warnings, geo_label="container"):
    """A container description (the form stored in recipes) -> dict(origin, cell, shape, dims, mask, spec).
    kinds: box {min, size} | mesh {v, f} | mask {origin, cell, shape, mask}"""
    kind = c.get("kind")
    if kind == "mask":
        shape = tuple(int(n) for n in c["shape"])
        cell = float(c["cell"])
        return dict(origin=tuple(float(a) for a in c["origin"]), cell=cell, shape=shape,
                    mask=_unpack_bits(c["mask"], shape), spec=c)
    if kind == "box":
        lo = [float(a) for a in c.get("min", [0.0, 0.0, 0.0])]
        size = [float(a) for a in c["size"]]
        V, F = box_mesh(lo, [lo[a] + size[a] for a in range(3)])
    elif kind == "mesh":
        V, F = np.array(c["v"], dtype=np.float64), np.array(c["f"], dtype=np.int64)
    else:
        raise ValueError("container kind must be box, mesh or mask (got %s)" % kind)
    return container_from_triangles(V, F, cell_req, warnings, spec=c)


def container_from_triangles(V, F, cell, warnings, spec=None):
    lo, hi = V.min(axis=0), V.max(axis=0)
    shape = tuple(max(4, int(math.ceil((hi[a] - lo[a]) / cell - 1e-6))) for a in range(3))
    if int(np.prod(shape)) > 2000000:
        raise ValueError("Too many cells (%d): increase cell size." % int(np.prod(shape)))
    c, z = mesh_column_hits(V - lo, F, shape[0], shape[1], cell)
    ivs, odd = column_intervals(c, z)
    if odd:
        warnings.append("NOTE: %d grid columns cut the container surface an odd number of times (an open or self-touching mesh); those columns may be wrong." % odd)
    mask = mask_from_intervals(ivs, shape, cell)
    if not mask.any():
        raise ValueError("the container geometry occupies no cells. Check its size and the cell input.")
    return dict(origin=tuple(float(a) for a in lo), cell=float(cell), shape=shape, mask=mask, spec=spec)


def container_record(cont, V=None, F=None):
    """What a recipe stores to rebuild the container with no Rhino geometry. A box stays a box, small
    geometry stays triangles (editable), large geometry is stored as the exact voxel mask."""
    if cont["spec"] and cont["spec"].get("kind") in ("box", "mesh", "mask"):
        return cont["spec"]
    if V is not None and len(F) <= 30000:
        return {"kind": "mesh", "v": [[round(float(c), 4) for c in v] for v in V], "f": [[int(a) for a in f] for f in F]}
    return {"kind": "mask", "origin": [float(a) for a in cont["origin"]], "cell": float(cont["cell"]),
            "shape": [int(n) for n in cont["shape"]], "mask": _pack_bits(cont["mask"])}


# =====================================================================
# ENGINE 7: FLOOR PLATES
# A plate is stored per grid COLUMN as an exact top and bottom height (NaN = no plate in that
# column). That is what lets a sloped or flat top be a true plane: the final mesh is built from
# this exact data, not from the stepped voxels. The voxel cells a plate covers are used only by
# the simulation (erosion) and the support check.
# =====================================================================
def parse_plate_group(item, idx):
    """One entry of `plates` (text from a Floor Plates component, or a hand-written dict) -> normalised group."""
    try:
        d = item if isinstance(item, dict) else json.loads(str(item))
        if d.get("kind") != "plates":
            raise ValueError("kind is not 'plates'")
        g = dict(name=str(d.get("name") or "plates %d" % (idx + 1)),
                 thickness=float(d.get("thickness", 1.0)),
                 resistance=float(np.clip(float(d.get("resistance", 1.0)), 0.05, 50.0)),
                 anchor_ft=max(0.0, float(d.get("anchor_ft", 1.5))),
                 anchor_strength=float(np.clip(float(d.get("anchor_strength", 3.0)), 1.0, 20.0)),
                 auto_support=_truthy(d.get("auto_support", True)),
                 min_support=max(0.0, float(d.get("min_support", 6.0))),
                 max_span=max(1.0, float(d.get("max_span", 12.0))),
                 strut_size=float(np.clip(float(d.get("strut_size", 1.5)), 0.25, 10.0)),
                 verticality=float(np.clip(float(d.get("verticality", 0.3)), 0.0, 1.0)),
                 branch_from_top=_truthy(d.get("branch_from_top", False)),
                 support_pts=[[float(a) for a in p] for p in (d.get("support_pts") or [])],
                 shapes=list(d["shapes"]))
        if not g["shapes"]:
            raise ValueError("no shapes")
        if abs(g["thickness"]) < 1e-6:
            raise ValueError("thickness is 0")
    except Exception as e:
        raise ValueError("plates item %d is not a valid Floor Plates output (%s). Wire the 'plates' output of a Floor Plates "
                         "component into 'plates'." % (idx, e))
    return g


def _newell(P):
    q = np.roll(P, -1, axis=0)
    n = np.array([np.sum((P[:, 1] - q[:, 1]) * (P[:, 2] + q[:, 2])),
                  np.sum((P[:, 2] - q[:, 2]) * (P[:, 0] + q[:, 0])),
                  np.sum((P[:, 0] - q[:, 0]) * (P[:, 1] + q[:, 1]))])
    ln = float(np.linalg.norm(n))
    if ln < 1e-9:
        return None
    n = n / ln
    return -n if n[2] < 0 else n


def _area_xy(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def plate_occupancy(top, bot, cell, nz):
    """The voxel cells a plate covers: every cell at least half filled by the slab, and at least one per column."""
    zlo = np.arange(nz) * cell
    zhi = zlo + cell
    with np.errstate(invalid="ignore"):
        ov = np.minimum(top[:, :, None], zhi) - np.maximum(bot[:, :, None], zlo)
        occ = ov >= 0.5 * cell
        foot = np.isfinite(top) & np.isfinite(bot)
        miss = foot & ~occ.any(axis=2)
    if miss.any():
        kmid = np.clip(np.floor(((np.where(foot, top, 0.0) + np.where(foot, bot, 0.0)) / 2.0) / cell).astype(int), 0, nz - 1)
        ii, jj = np.nonzero(miss)
        occ[ii, jj, kmid[ii, jj]] = True
    return occ


def field_columns(s, org, nx, ny, cell):
    """A plate stored as a height grid (compact: a warped floor is a few hundred numbers, not thousands of triangles).
    {"type": "field", "x0", "y0", "step", "nx", "ny", "top": heights at the (nx+1)*(ny+1) grid points, x-major,
     "thick": slab thickness below the top (or "zbot": a constant bottom height, for solid ground),
     "mask": optional string of nx*ny 0/1 saying which grid cells the plate covers (x-major)}.
    Returns (top, bot) per grid column, NaN where the plate is absent."""
    fx, fy, st = int(s["nx"]), int(s["ny"]), float(s["step"])
    T = np.array(s["top"], dtype=float).reshape(fx + 1, fy + 1)
    M = np.ones((fx, fy), bool) if s.get("mask") in (None, "") else (np.frombuffer(str(s["mask"]).encode("ascii"), dtype=np.uint8) == 49).reshape(fx, fy)
    u = ((np.arange(nx) + 0.5) * cell - (float(s["x0"]) - org[0])) / st
    v = ((np.arange(ny) + 0.5) * cell - (float(s["y0"]) - org[1])) / st
    inx = (u >= 0) & (u < fx)
    iny = (v >= 0) & (v < fy)
    i0 = np.clip(np.floor(u).astype(int), 0, fx - 1)
    j0 = np.clip(np.floor(v).astype(int), 0, fy - 1)
    fu = np.clip(u - i0, 0.0, 1.0)[:, None]
    fv = np.clip(v - j0, 0.0, 1.0)[None, :]
    I, J = i0[:, None], j0[None, :]
    top = (T[I, J] * (1 - fu) * (1 - fv) + T[I + 1, J] * fu * (1 - fv) + T[I, J + 1] * (1 - fu) * fv + T[I + 1, J + 1] * fu * fv)
    on = inx[:, None] & iny[None, :] & M[I, J]
    bot = np.full_like(top, float(s["zbot"])) if "zbot" in s else top - float(s.get("thick", 1.0))
    return np.where(on, top, np.nan), np.where(on, bot, np.nan)


def build_plates(groups, first_group, first_id, origin, shape, cell, mask, warnings):
    """Rasterise every shape of every new group. Returns a list of plate dicts (ids first_id, first_id+1, ...)."""
    nx, ny, nz = shape
    org = np.array(origin, dtype=float)
    xs = (np.arange(nx) + 0.5) * cell
    ys = (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    plates = []

    def add(gi, kind, top, bot, normal, thick, name):
        if not np.isfinite(top).any():
            warnings.append("NOTE: a plate in group '%s' occupies no grid cells (too small or outside the block) and is skipped." % name)
            return
        plates.append(dict(id=first_id + len(plates), group=gi, kind=kind, top=top.astype(np.float32), bot=bot.astype(np.float32),
                           normal=[float(a) for a in normal], thickness=float(thick), name=name))

    for off_i, g in enumerate(groups):
        gi = first_group + off_i
        polys = []
        for s in g["shapes"]:
            kind = s.get("type")
            if kind == "poly":
                P = np.array(s["pts"], dtype=float) - org
                n = _newell(P)
                if n is None:
                    raise ValueError("a curve in plate group '%s' has no area." % g["name"])
                if n[2] < 0.3:
                    raise ValueError("a curve in plate group '%s' is nearly vertical. Floor plates need a curve that lies flat or at a gentle slope." % g["name"])
                if n[2] < 0.5:
                    warnings.append("NOTE: a curve in plate group '%s' slopes more than 60 degrees; the grid represents it poorly." % g["name"])
                if (P.min(axis=0) < -1e-6).any() or (P[:, :2].max(axis=0) > np.array([nx, ny]) * cell + 1e-6).any():
                    warnings.append("NOTE: a curve in plate group '%s' reaches outside the block; only the part inside is used." % g["name"])
                c = P.mean(axis=0)
                dev = float(np.abs((P - c) @ n).max())
                if dev > 0.1:
                    warnings.append("NOTE: a curve in plate group '%s' is not flat (%.2f ft off its best plane); the best-fit plane is used." % (g["name"], dev))
                rr, cc = skdraw.polygon(P[:, 0] / cell - 0.5, P[:, 1] / cell - 0.5, shape=(nx, ny))
                m = np.zeros((nx, ny), bool)
                m[rr, cc] = True
                polys.append(dict(P=P, n=n, c=c, mask=m, area=_area_xy(P)))
            elif kind == "field":
                top, bot = field_columns(s, org, nx, ny, cell)
                add(gi, "mesh", top, bot, [0.0, 0.0, 1.0], float(np.nanmedian(top - bot)) if np.isfinite(top).any() else 0.0, g["name"])
            elif kind in ("mesh", "box"):
                if kind == "mesh":
                    V, F = np.array(s["v"], dtype=float), np.array(s["f"], dtype=np.int64)
                else:
                    V, F = box_mesh(s["min"], s["max"])
                if ((V - org).min(axis=0) < -1e-6).any() or ((V - org)[:, :2].max(axis=0) > np.array([nx, ny]) * cell + 1e-6).any():
                    warnings.append("NOTE: plate geometry in group '%s' reaches outside the block; only the part inside is used." % g["name"])
                cidx, z = mesh_column_hits(V - org, F, nx, ny, cell)
                ivs, odd = column_intervals(cidx, z)
                if odd:
                    warnings.append("NOTE: plate geometry in group '%s' is not closed in %d columns; those columns may be wrong." % (g["name"], odd))
                nsheet = max([len(v) for v in ivs.values()] or [0])
                for si in range(nsheet):
                    top = np.full((nx, ny), np.nan)
                    bot = np.full((nx, ny), np.nan)
                    for col, lst in ivs.items():
                        if len(lst) > si:
                            i, j = divmod(col, ny)
                            bot[i, j], top[i, j] = lst[si]
                    add(gi, "mesh", top, bot, [0.0, 0.0, 1.0], float(np.nanmedian(top - bot)) if np.isfinite(top).any() else 0.0, g["name"])
            else:
                raise ValueError("plate shape type '%s' is not known (use poly, mesh or box)." % kind)
        # curves: a curve lying inside a bigger curve in the same plane is an opening in it
        for a, pa in enumerate(polys):
            pa["depth"], pa["parent"] = 0, None
            na = int(pa["mask"].sum())
            if na == 0:
                continue
            best = None
            for b, pb in enumerate(polys):
                if a == b or pb["area"] <= pa["area"]:
                    continue
                if int((pa["mask"] & pb["mask"]).sum()) < 0.9 * na:
                    continue
                p0 = pa["P"][0]
                zb = pb["c"][2] - (pb["n"][0] * (p0[0] - pb["c"][0]) + pb["n"][1] * (p0[1] - pb["c"][1])) / pb["n"][2]
                if abs(zb - p0[2]) > 0.5 * cell + 0.05:
                    continue
                pa["depth"] += 1
                if best is None or pb["area"] < polys[best]["area"]:
                    best = b
            pa["parent"] = best
        for a, pa in enumerate(polys):
            if pa["depth"] % 2:
                continue
            foot = pa["mask"].copy()
            for b, pb in enumerate(polys):
                if pb["parent"] == a and pb["depth"] % 2:
                    foot &= ~pb["mask"]
            n, c = pa["n"], pa["c"]
            thick = g["thickness"]
            if abs(thick) < cell:
                warnings.append("NOTE: plate group '%s' thickness %.2f ft is under one cell (%.2f ft); one cell is used." % (g["name"], abs(thick), cell))
            dz = max(abs(thick), cell) / n[2]
            zplane = c[2] - (n[0] * (X - c[0]) + n[1] * (Y - c[1])) / n[2]
            if thick >= 0:
                top, bot = zplane, zplane - dz
            else:
                bot, top = zplane, zplane + dz
            add(gi, "poly", np.where(foot, top, np.nan), np.where(foot, bot, np.nan), n, abs(thick), g["name"])
    return plates


def rasterize_plate_ids(plates, pid, shape, cell, mask, warnings):
    """Writes each plate's id into the cell grid (first plate wins where plates overlap)."""
    for p in plates:
        occ = plate_occupancy(p["top"], p["bot"], cell, shape[2]) & mask & (pid == 0)
        if not occ.any():
            warnings.append("NOTE: plate %d ('%s') is outside the block, so it is skipped." % (p["id"], p["name"]))
        pid[occ] = p["id"]


def plate_sim_context(pid, plates, shape, cell, mask):
    """Everything the simulation needs to know about the plates."""
    nx, ny, nz = shape
    isplate = pid > 0
    adj = ndimage.binary_dilation(isplate, STRUCT6) & ~isplate & mask
    topmap = np.full((nx, ny), np.nan)
    for p in plates:
        topmap = np.fmax(topmap, p["top"])
    foot = np.isfinite(topmap)
    dxy = np.zeros((2, nx, ny))
    if foot.any():
        filled = np.where(foot, topmap, float(np.nanmean(topmap)))
        gx, gy = np.gradient(filled, cell)
        gm = np.hypot(gx, gy)
        edt = ndimage.distance_transform_edt(foot)
        ex, ey = np.gradient(edt)
        em = np.hypot(ex, ey)
        down = gm > 0.05                                           # a sloped plate: slide downhill, otherwise toward the edge
        with np.errstate(invalid="ignore", divide="ignore"):
            ux = np.where(down, -gx / np.maximum(gm, 1e-9), -ex / np.maximum(em, 1e-9))
            uy = np.where(down, -gy / np.maximum(gm, 1e-9), -ey / np.maximum(em, 1e-9))
        dxy[0] = np.where(foot, np.rint(ux), 0)
        dxy[1] = np.where(foot, np.rint(uy), 0)
    below = np.zeros_like(isplate)
    below[:, :, 1:] = isplate[:, :, :-1]
    contact = below & ~isplate & mask
    ci, cj, ck = np.nonzero(contact)
    di, dj = dxy[0][ci, cj].astype(int), dxy[1][ci, cj].astype(int)
    ti, tj = ci + di, cj + dj
    ok = ((di != 0) | (dj != 0)) & (ti >= 0) & (ti < nx) & (tj >= 0) & (tj < ny)
    ci, cj, ck, ti, tj = ci[ok], cj[ok], ck[ok], ti[ok], tj[ok]
    ok2 = ~isplate[ti, tj, ck] & mask[ti, tj, ck]
    ci, cj, ck, ti, tj = ci[ok2], cj[ok2], ck[ok2], ti[ok2], tj[ok2]
    return dict(plate_idx=np.flatnonzero(isplate), adj_idx=np.flatnonzero(adj),
                slide_src=((ci * ny + cj) * nz + ck).astype(np.int64), slide_dst=((ti * ny + tj) * nz + ck).astype(np.int64))


def anchor_factor(pid, plates, groups, shape, cell, mask):
    """Foam near a plate is made denser (fading with distance) so the connection survives erosion."""
    fac = np.ones(shape, np.float32)
    for gi, g in enumerate(groups):
        if g["anchor_ft"] <= 0 or g["anchor_strength"] <= 1.0:
            continue
        ids = [p["id"] for p in plates if p["group"] == gi]
        if not ids:
            continue
        cells = np.isin(pid, ids)
        if not cells.any():
            continue
        dist = ndimage.distance_transform_edt(~cells, sampling=cell)
        f = 1.0 + (g["anchor_strength"] - 1.0) * np.clip(1.0 - dist / g["anchor_ft"], 0.0, 1.0)
        fac = np.maximum(fac, np.where((dist <= g["anchor_ft"]) & ~cells & mask, f, 1.0).astype(np.float32))
    return fac


def apply_column_rule(M, plates, pid):
    """A plate column is kept whole (full thickness, flat top and bottom) when at least half of its cells survived the
    erosion, and removed whole otherwise. Returns (material, {plate id: kept-columns grid})."""
    M = M.copy()
    kept = {}
    for p in plates:
        cells = pid == p["id"]
        cnt = cells.sum(axis=2)
        alive = (cells & (M >= VOID_LEVEL)).sum(axis=2)
        keep = (cnt > 0) & (alive >= 0.5 * np.maximum(cnt, 1))
        kept[p["id"]] = keep
        M[cells & keep[:, :, None]] = 1.0
        M[cells & ~keep[:, :, None]] = 0.0
    return M, kept


def plate_field(plates, kept, shape, cell, mask):
    """The exact plate shape as a 0..1 field whose 0.5 level is the true plate surface (the top of a plate is a real plane or
    slope). Only kept columns contribute."""
    nz = shape[2]
    zc = (np.arange(nz) + 0.5) * cell
    P = np.zeros(shape, np.float32)
    for p in plates:
        keep = kept.get(p["id"])
        if keep is None or not keep.any():
            continue
        with np.errstate(invalid="ignore"):
            d = np.minimum(p["top"][:, :, None] - zc, zc - p["bot"][:, :, None])
        f = np.nan_to_num(np.clip(0.5 + d / (2.0 * cell), 0.0, 1.0))
        kf = ndimage.gaussian_filter(keep.astype(np.float32), 0.6, mode="nearest")
        P = np.maximum(P, np.minimum(f, kf[:, :, None]).astype(np.float32))
    return P * mask.astype(np.float32)


# ---------------------------------------------------------------------
# SUPPORT PASS: every plate must be held to the main foam body
# ---------------------------------------------------------------------
def main_ground(body, mask):
    """The foam a plate may hang from: the largest foam piece, plus any piece touching the outer skin of the block."""
    lab, n = ndimage.label(body, structure=STRUCT6)
    if n == 0:
        return np.zeros(body.shape, bool)
    sizes = ndimage.sum(body, lab, index=np.arange(1, n + 1))
    keep = {int(np.argmax(sizes)) + 1}
    skin = np.zeros(body.shape, bool)
    skin[0, :, :] = skin[-1, :, :] = True
    skin[:, 0, :] = skin[:, -1, :] = True
    skin[:, :, 0] = skin[:, :, -1] = True
    skin |= ndimage.binary_dilation(~mask, STRUCT6) & mask
    for l in np.unique(lab[skin & body]):
        if l:
            keep.add(int(l))
    return np.isin(lab, list(keep))


def capsule_cells(a, b, r, shape, cell):
    """Grid cells within distance r of the segment a-b. Returns (slices, boolean array of that sub-box)."""
    lo = np.maximum(np.floor((np.minimum(a, b) - r) / cell).astype(int) - 1, 0)
    hi = np.minimum(np.ceil((np.maximum(a, b) + r) / cell).astype(int) + 1, np.array(shape))
    sl = tuple(slice(int(lo[k]), int(hi[k])) for k in range(3))
    g = [(np.arange(lo[k], hi[k]) + 0.5) * cell for k in range(3)]
    X, Y, Z = np.meshgrid(g[0], g[1], g[2], indexing="ij")
    ab = b - a
    L2 = float(ab @ ab)
    if L2 < 1e-12:
        t = np.zeros_like(X)
    else:
        t = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1] + (Z - a[2]) * ab[2]) / L2, 0.0, 1.0)
    d2 = (X - (a[0] + t * ab[0])) ** 2 + (Y - (a[1] + t * ab[1])) ** 2 + (Z - (a[2] + t * ab[2])) ** 2
    return sl, d2 <= r * r


def support_pass(M, mask, pid, plates, groups, cell, rng, warnings, struts_in=None):
    """Holds every plate to the main foam body. Measures each plate's contact with the body and its longest unsupported
    span; while the contact is below the group's min_support or a span exceeds max_span, grows a strut (a capsule of
    strut_size across) from the worst spot on the plate to the nearest foam, at any angle. Struts count as foam body, so
    they branch into trees. Returns (material, struts grid, report per plate). Not an engineering calculation."""
    M = M.copy()
    shape = M.shape
    F = (M >= VOID_LEVEL) & mask
    plate_any = pid > 0
    struts = np.zeros(shape, bool) if struts_in is None else struts_in.copy()
    ground = main_ground(F & ~plate_any, mask)
    report = []
    total = 0
    ax_pts = [(np.arange(n) + 0.5) * cell for n in shape]
    for p in plates:
        g = groups[p["group"]]
        Pc = (pid == p["id"]) & F
        rep = dict(id=p["id"], group=p["group"], name=p["name"], present=bool(Pc.any()), contact_ft2=0.0, span_ft=0.0,
                   struts=0, supported=False, strut_list=[], notes=[])
        if not Pc.any():
            report.append(rep)
            continue

        def measure():
            S = Pc & ndimage.binary_dilation(ground, STRUCT6)
            faces = 0
            for ax in range(3):
                a = np.moveaxis(Pc, ax, 0)
                b = np.moveaxis(ground, ax, 0)
                faces += int((a[:-1] & b[1:]).sum()) + int((a[1:] & b[:-1]).sum())
            contact = faces * cell * cell
            if S.any():
                dist = ndimage.distance_transform_edt(~S, sampling=cell)
                span = float(dist[Pc].max())
            else:
                dist, span = None, float("inf")
            return S, contact, span, dist

        def add_strut(i, j):
            nonlocal M, F, ground, struts, total
            zt, zb = float(p["top"][i, j]), float(p["bot"][i, j])
            cx, cy = ax_pts[0][i], ax_pts[1][j]
            starts = [(np.array([cx, cy, zb - 0.25 * cell]), "under")]
            if g["branch_from_top"]:
                starts.append((np.array([cx, cy, zt + 0.25 * cell]), "top"))
            surf = ground & ndimage.binary_dilation(~ground, STRUCT6)
            si = np.argwhere(surf)
            if len(si) == 0:
                return False, "no foam body to attach to"
            pts = np.column_stack([ax_pts[0][si[:, 0]], ax_pts[1][si[:, 1]], ax_pts[2][si[:, 2]]])
            tree = cKDTree(pts)
            best = None
            for relax in (False, True):
                for s, side in starts:
                    dd, ii = tree.query(s, k=min(48, len(pts)))
                    dd, ii = np.atleast_1d(dd), np.atleast_1d(ii)
                    for d_, i_ in zip(dd, ii):
                        q = pts[i_]
                        if not relax:
                            if side == "under" and q[2] > zt + 1e-6:
                                continue                      # off the underside, branches only go to foam beside or below
                            if side == "top" and q[2] < zb - 1e-6:
                                continue
                        v = q - s
                        L = float(np.linalg.norm(v))
                        if L < 1e-6:
                            continue
                        hfrac = float(np.hypot(v[0], v[1])) / L
                        cost = L * (1.0 + 3.0 * g["verticality"] * hfrac)
                        if best is None or cost < best[0]:
                            best = (cost, s, q, L, side, relax)
                if best is not None:
                    break
            if best is None:
                return False, "no reachable foam"
            _, s, q, L, side, relax = best
            r = max(0.5 * g["strut_size"], 0.5 * cell) + 0.15 * cell
            sl, cm = capsule_cells(s, q, r, shape, cell)
            cells = cm & mask[sl] & ~plate_any[sl]
            new = cells & ~F[sl]
            if not new.any():
                return False, "branch adds nothing"
            M[sl][cells] = 1.0
            F[sl] |= cells
            struts[sl] |= cells
            ground[sl] |= cells
            total += 1
            note = "from the %s" % ("top face" if side == "top" else "underside")
            if relax:
                note += " (no foam on the preferred side, so the nearest foam was used)"
            if L > STRUT_REACH_FT:
                note += " (long branch, %.0f ft)" % L
            rep["strut_list"].append(dict(start=[round(float(a), 3) for a in s], end=[round(float(a), 3) for a in q],
                                          diameter_ft=round(2 * r, 3), length_ft=round(L, 3), side=side))
            return True, note

        S, contact, span, dist = measure()
        for pt in g["support_pts"]:
            cols = np.nonzero(Pc.any(axis=2))
            if len(cols[0]) == 0:
                break
            q = np.array(pt, dtype=float)
            d2 = (ax_pts[0][cols[0]] - q[0]) ** 2 + (ax_pts[1][cols[1]] - q[1]) ** 2
            n = int(np.argmin(d2))
            okk, note = add_strut(int(cols[0][n]), int(cols[1][n]))
            if okk:
                rep["struts"] += 1
            else:
                rep["notes"].append("support point skipped: " + note)
            S, contact, span, dist = measure()
        stall = 0
        while g["auto_support"] and (contact < g["min_support"] - 1e-9 or span > g["max_span"]) and rep["struts"] < MAX_STRUTS_PER_PLATE and stall < 3 and total < 400:
            if not ground.any():
                rep["notes"].append("no foam body to attach to")
                break
            if S.any():
                lim = float(dist[Pc].max())
                cand = np.argwhere(Pc & (dist >= 0.85 * lim - 1e-9))
            else:
                dg = ndimage.distance_transform_edt(~ground, sampling=cell)
                m = float(dg[Pc].min())
                cand = np.argwhere(Pc & (dg <= m + 1e-6))
            pick = cand[int(rng.integers(len(cand)))]
            okk, note = add_strut(int(pick[0]), int(pick[1]))
            if okk:
                rep["struts"] += 1
                stall = 0
                if note.startswith("from") and ("preferred" in note or "long" in note):
                    rep["notes"].append(note)
            else:
                stall += 1
                if stall >= 3:
                    rep["notes"].append("could not add more support: " + note)
            S, contact, span, dist = measure()
        rep["contact_ft2"] = round(float(contact), 3)
        rep["span_ft"] = round(float(span), 3) if np.isfinite(span) else None
        rep["supported"] = bool(contact >= g["min_support"] - 1e-9 and span <= g["max_span"])
        report.append(rep)
    if total >= 400:
        warnings.append("NOTE: the support pass stopped at 400 branches.")
    return M, struts, report


# ---------------------------------------------------------------------
# MASS: the finished result as text, to start another engine from it
# ---------------------------------------------------------------------
def make_mass(M, mask, origin, cell, pid, plates, groups, struts, foam):
    shape = M.shape
    return json.dumps(dict(
        schema=MASS_SCHEMA, engine=ENGINE_VERSION, origin=[float(a) for a in origin], cell=float(cell), shape=list(shape),
        mask=_pack_bits(mask), material=_pack_arr(np.round(np.clip(M, 0.0, 1.0) * 255.0), "u1"),
        plate_id=_pack_arr(pid, "<u2"), struts=_pack_bits(struts), foam=foam,
        groups=[{k: v for k, v in g.items() if k != "shapes"} for g in groups],
        plates=[dict(id=p["id"], group=p["group"], kind=p["kind"], name=p["name"], normal=p["normal"], thickness=p["thickness"],
                     top=_pack_arr(p["top"], "<f4"), bot=_pack_arr(p["bot"], "<f4")) for p in plates]),
        separators=(",", ":"))


def read_mass(value):
    """The `mass` input (text, dict or a Panel's lines) -> dict of arrays, or None."""
    items = [x for x in _as_list(value) if not (isinstance(x, str) and not x.strip())]
    if not items:
        return None
    first = items[0]
    if hasattr(first, "Value"):
        first = first.Value
    d = first if isinstance(first, dict) else json.loads("\n".join(str(x) for x in items) if len(items) > 1 else str(first))
    if d.get("schema") != MASS_SCHEMA:
        raise ValueError("mass must come from the `mass` output of an engine 7 (schema %s)." % MASS_SCHEMA)
    shape = tuple(int(n) for n in d["shape"])
    if len(shape) != 3 or min(shape) < 4 or int(np.prod(shape)) > 2000000:
        raise ValueError("the mass has an invalid grid.")
    M = _unpack_arr(d["material"], shape, "u1").astype(np.float32) / 255.0
    plates = []
    for pd in d.get("plates") or []:
        plates.append(dict(id=int(pd["id"]), group=int(pd["group"]), kind=pd["kind"], name=pd["name"], normal=pd["normal"],
                           thickness=float(pd["thickness"]), top=_unpack_arr(pd["top"], shape[:2], "<f4"), bot=_unpack_arr(pd["bot"], shape[:2], "<f4")))
    groups = []
    for g in d.get("groups") or []:
        g = dict(g)
        g["shapes"] = []
        groups.append(g)
    return dict(origin=tuple(float(a) for a in d["origin"]), cell=float(d["cell"]), shape=shape, mask=_unpack_bits(d["mask"], shape),
                M=M, pid=_unpack_arr(d["plate_id"], shape, "<u2").astype(np.int32), struts=_unpack_bits(d["struts"], shape),
                foam=d.get("foam"), groups=groups, plates=plates, raw=d)


# ---------------------------------------------------------------------
# PLATE REPORT (plates.json in the export)
# ---------------------------------------------------------------------
def _clear_run(void_bool, i, j, k0, step, cell, nz):
    run = 0
    k = k0
    while 0 <= k < nz and void_bool[i, j, k]:
        run += 1
        k += step
    return run


def plate_report(plates, groups, kept, support_rep, void_bool, cell, origin):
    nz = void_bool.shape[2]
    rep_by_id = {r["id"]: r for r in support_rep}
    out = []
    for p in plates:
        g = groups[p["group"]]
        foot = np.isfinite(p["top"]) & np.isfinite(p["bot"])
        keep = kept.get(p["id"], np.zeros_like(foot)) & foot
        entry = dict(id=p["id"], name=p["name"], group=p["group"], kind=p["kind"], resistance=g["resistance"], thickness_ft=round(p["thickness"], 3),
                     original_area_ft2=round(float(foot.sum()) * cell * cell, 3), area_ft2=round(float(keep.sum()) * cell * cell, 3),
                     kept_fraction=round(float(keep.sum()) / max(float(foot.sum()), 1.0), 4), present=bool(keep.any()))
        sr = rep_by_id.get(p["id"])
        if sr:
            entry["support"] = dict(contact_area_ft2=sr["contact_ft2"], longest_unsupported_span_ft=sr["span_ft"], struts_added=sr["struts"],
                                    supported=sr["supported"], min_support_ft2=g["min_support"], max_span_ft=g["max_span"],
                                    branch_from_top=g["branch_from_top"], struts=sr["strut_list"], notes=sr["notes"])
        if not keep.any():
            out.append(entry)
            continue
        top, bot = p["top"][keep], p["bot"][keep]
        # slope = plane fitted through the kept tops (a gradient of the grid is wrong at a plate's edge columns)
        ki, kj = np.nonzero(keep)
        if len(ki) >= 3:
            A = np.column_stack([(ki + 0.5) * cell, (kj + 0.5) * cell, np.ones(len(ki))])
            coef = np.linalg.lstsq(A, top.astype(np.float64), rcond=None)[0]
            slope = float(np.degrees(np.arctan(math.hypot(coef[0], coef[1]))))
        else:
            slope = 0.0
        oz = float(origin[2])
        entry["top_z_ft"] = dict(min=round(float(top.min()) + oz, 3), max=round(float(top.max()) + oz, 3), mean=round(float(top.mean()) + oz, 3))
        entry["bottom_z_ft"] = dict(min=round(float(bot.min()) + oz, 3), max=round(float(bot.max()) + oz, 3))
        entry["slope_deg"] = round(slope, 2)
        above, below = {}, {}
        ii, jj = np.nonzero(keep)
        ca, cb = np.zeros(len(ii)), np.zeros(len(ii))
        for n, (i, j) in enumerate(zip(ii, jj)):
            zt, zb = float(p["top"][i, j]), float(p["bot"][i, j])
            k = int(math.ceil(zt / cell - 1e-6))
            if k >= nz:
                ca[n] = nz * cell - zt
            else:
                run = _clear_run(void_bool, i, j, k, 1, cell, nz)
                ca[n] = run * cell + (k * cell - zt) if run else 0.0
            k = int(math.floor(zb / cell + 1e-6)) - 1
            if k < 0:
                cb[n] = zb
            else:
                run = _clear_run(void_bool, i, j, k, -1, cell, nz)
                cb[n] = run * cell + (zb - (k + 1) * cell) if run else 0.0
        a2 = cell * cell
        for key, arr in (("space_above", ca), ("space_below", cb)):
            entry[key] = dict(clear_height_ft=dict(min=round(float(arr.min()), 3), mean=round(float(arr.mean()), 3), max=round(float(arr.max()), 3)),
                              area_clear_8ft_ft2=round(float((arr >= 8.0).sum()) * a2, 3), area_clear_10ft_ft2=round(float((arr >= 10.0).sum()) * a2, 3),
                              area_with_void_ft2=round(float((arr > 0).sum()) * a2, 3))
        col_above = np.zeros(keep.shape)
        col_below = np.zeros(keep.shape)
        col_above[ii, jj], col_below[ii, jj] = ca, cb
        filled = ndimage.binary_fill_holes(keep)
        holes = filled & ~keep
        designed = ndimage.binary_fill_holes(foot) & ~foot
        lab, n = ndimage.label(holes)
        openings = []
        for h in range(1, n + 1):
            m = lab == h
            hi, hj = np.nonzero(m)
            # void straight above and below the opening = a vertical connection through the floor
            zc = float(np.nanmean(p["top"][foot])) if foot.any() else 0.0
            through = True
            col = void_bool[hi, hj, :]
            through = bool(col.any())
            openings.append(dict(area_ft2=round(float(m.sum()) * a2, 3), centroid_ft=[round(float(hi.mean() + 0.5) * cell + origin[0], 3), round(float(hj.mean() + 0.5) * cell + origin[1], 3), round(zc + oz, 3)],
                                 designed=bool(designed[m].any()), void_above_or_below=through))
        entry["openings"] = dict(count=len(openings), total_area_ft2=round(float(holes.sum()) * a2, 3), list=openings,
                                 edge_eroded_area_ft2=round(float((foot & ~keep & ~holes).sum()) * a2, 3))
        pad = np.pad(keep.astype(np.float32), 1)
        polys = []
        for c in measure.find_contours(pad, 0.5):
            c = measure.approximate_polygon(c, 0.1) if len(c) > 3 else c
            polys.append([[round(float((r - 1.0 + 0.5) * cell), 3), round(float((q - 1.0 + 0.5) * cell), 3)] for r, q in c])
        entry["outline_xy_ft"] = polys
        out.append(entry)
    return out



def parse_source(item, idx, cell):
    """One entry of `sources` (text from a Source component) -> normalised spec dict."""
    try:
        d = item if isinstance(item, dict) else json.loads(str(item))
        kind = d["kind"]
        mode = MODE_NAMES[str(d["mode"]).lower()] if not isinstance(d["mode"], int) else int(d["mode"])
        pm = d.get("plate_mode", "pool")
        plate_mode = int(pm) if isinstance(pm, (int, float)) and not isinstance(pm, bool) else PLATE_MODE_NAMES[str(pm).strip().lower()]
        if plate_mode not in PLATE_MODE_LABEL:
            raise ValueError("unknown plate_mode")
        spec = dict(kind=kind, mode=mode, pt=d.get("pt"), pts=d.get("pts"),
                    dose=float(d.get("dose", DEFAULT_DOSE[mode])),
                    spread=float(d.get("spread", DEFAULT_SPREAD[mode])),
                    start=float(d.get("start", 0.0)),
                    dur=float(d.get("duration", DEFAULT_DURATION[mode])),
                    dir=d.get("dir"), plate_mode=plate_mode, cut=_truthy(d.get("cut", False)))
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
    so dragging the frame / smooth / slice sliders is instant. Each engine on the canvas has its own cache slot,
    so two engines in one definition (a second pass) never overwrite each other."""
    try:
        import scriptcontext as sc
        store = sc.sticky
    except Exception:
        store = _LOCAL_CACHE
    try:
        slot = "erosion_engine_7_" + str(ghenv.Component.InstanceGuid)
    except Exception:
        slot = "erosion_engine_7_standalone"
    hit = store.get(slot)
    if hit is not None and hit[0] == key:
        return hit[1], True
    res = builder()
    store[slot] = (key, res)
    return res, False


# ---------------------------------------------------------------------
# SMOOTH MESHING (marching cubes)
# ---------------------------------------------------------------------
def smooth_field(field, smooth):
    f = np.asarray(field, dtype=np.float32)
    if smooth > 0:
        f = ndimage.gaussian_filter(f, sigma=float(smooth), mode="nearest")
    return f


def weld_degenerate(verts, faces, cell):
    """Marching cubes on a field that is exactly 0.5 somewhere (a plate whose top lies on a grid plane) puts several
    corners of a triangle on the same spot. Rhino calls a mesh with such faces invalid, so merge corners that coincide,
    drop the collapsed triangles and the corners nothing uses any more."""
    q = np.round(verts / (cell * 1e-4)).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = np.asarray(inv).reshape(-1)
    faces = inv[faces]
    ok = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    faces = faces[ok]
    used, remap = np.unique(faces, return_inverse=True)
    return verts[first][used], np.asarray(remap).reshape(faces.shape)


def field_to_arrays(field, cell, smooth, presmoothed=False):
    f = np.asarray(field, dtype=np.float32) if presmoothed else smooth_field(field, smooth)
    f = np.pad(f, 1, mode="constant", constant_values=0.0)
    if f.max() <= 0.5 or f.min() >= 0.5:
        return None, None, 0.0
    verts, faces, _, _ = measure.marching_cubes(f, level=0.5)
    verts = (verts - 1.0 + 0.5) * cell
    verts, faces = weld_degenerate(verts, faces, cell)
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


def arrays_to_mesh(verts, faces, origin=(0.0, 0.0, 0.0)):
    """Marching-cubes arrays (grid coordinates) -> a Rhino mesh placed in WORLD coordinates (grid coordinates + origin)."""
    if verts is None:
        return None
    mesh = rg.Mesh()
    ox, oy, oz = origin
    for x, y, z in verts.tolist():
        mesh.Vertices.Add(x + ox, y + oy, z + oz)
    for a, b, c in faces.tolist():
        mesh.Faces.AddFace(a, b, c)
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    return mesh


PREVIEW_COLORS = {"skin": (205, 205, 205), "cavity": (225, 80, 80), "plate": (50, 110, 230), "strut": (245, 150, 30)}


def build_preview_mesh(verts, faces, cell, origin, mask, Pk, struts, cut_axis, cut_pos, cut_side):
    """ONE mesh for looking at the whole result in Grasshopper: the foam surface with every vertex coloured by what it
    is (floor plate = blue, support branch = orange, cavity wall = red, outer skin = light grey). Nothing overlaps, so
    nothing z-fights or hides behind the void. cut_side +1 / -1 removes the triangles beyond / before cut_pos (world
    coordinate on cut_axis) so you can look inside; 0 keeps everything."""
    if verts is None:
        return None
    shape = np.array(mask.shape)
    idx = np.clip(np.floor(verts / cell).astype(int), 0, shape - 1)
    col = np.empty((len(verts), 3), dtype=np.int32)
    col[:] = PREVIEW_COLORS["cavity"]
    skin = mask & ~ndimage.binary_erosion(mask, structure=STRUCT6, border_value=0)
    skin = ndimage.binary_dilation(skin, structure=STRUCT6)
    col[skin[idx[:, 0], idx[:, 1], idx[:, 2]]] = PREVIEW_COLORS["skin"]
    for name, zone in (("strut", struts if struts is not None and struts.any() else None),
                       ("plate", (Pk >= 0.5) if Pk is not None else None)):
        if zone is not None:
            z = ndimage.binary_dilation(zone, structure=STRUCT6)
            col[z[idx[:, 0], idx[:, 1], idx[:, 2]]] = PREVIEW_COLORS[name]
    keep = np.ones(len(faces), dtype=bool)
    if cut_side:
        cen = verts[faces][:, :, cut_axis].mean(axis=1) + origin[cut_axis]
        keep = (cen <= cut_pos) if cut_side > 0 else (cen >= cut_pos)
    f = faces[keep]
    if len(f) == 0:
        return None
    used, inv = np.unique(f, return_inverse=True)
    f = inv.reshape(f.shape)
    mesh = rg.Mesh()
    ox, oy, oz = origin
    for (x, y, z_), (r, g, b) in zip(verts[used].tolist(), col[used].tolist()):
        mesh.Vertices.Add(x + ox, y + oy, z_ + oz)
        mesh.VertexColors.Add(r, g, b)
    for a, b_, c in f.tolist():
        mesh.Faces.AddFace(a, b_, c)
    mesh.Normals.ComputeNormals()
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


def build_slice_mesh(A, axis, k, cell, view, cmax, origin=(0.0, 0.0, 0.0)):
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
                mesh.Vertices.Add(p[0] + origin[0], p[1] + origin[1], p[2] + origin[2])
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
GLB_RGB = {"foam": FOAM_RGB, "void": (200, 40, 55), "plates": (95, 125, 170), "struts": (219, 114, 40)}
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


def tile_metrics(void_bool, cell, dims, void_mesh_arrays, foam_mesh_arrays, mask=None):
    cv, ca = cell ** 3, cell ** 2
    nx, ny, nz = void_bool.shape
    total = (void_bool.size if mask is None else int(np.count_nonzero(mask))) * cv
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


# =====================================================================
# SPACES: levels, rooms, connections, routes, daylight, openings, structure
# Everything here is measured on the voxels, so it works for any tile. The same algorithms exist in the web app
# (lib/tiles/*.ts) so the Builder's tiles are processed exactly like these; docs/DATA_FORMAT.md section 13 is the
# specification. Change one, change the other, and run `npm run check:parity` in the repo.
# =====================================================================
ANALYSIS_VERSION = 1
QUANT = 4                   # distances are compared in quarter cells (integers, so Python and TypeScript agree exactly)
ROOM_H_FT = 2.0             # a room's distance peak must stand this much above the saddle (neck) to the next room
MIN_ROOM_FT3 = 20.0         # a room smaller than this is merged into the room it shares the most surface with (or dropped as a speck)
MIN_LINK_FT2 = 8.0          # two rooms are connected when the opening between them is at least this big ...
MIN_LINK_NECK_FT = 2.0      # ... and at least this wide
LEVEL_MIN_FRAC = 0.015      # a level needs this share of the plan area as floor within one layer
LIT_FT = 6.0                # a floor cell is "lit" when open sky above, or an open side face, is within this distance (same layer)
LIT_CAP_FT = 20.0           # light distances are capped here (an unreachable floor counts as this far)
ROUTE_STEP = 6              # route bends are counted on points this many cells apart
THIN_WALLS_FT = (1.0, 1.5, 2.0, 3.0)
SIDE_FACES = ("-X", "+X", "-Y", "+Y")
OPENING_MIN_FT2 = 4.0       # an opening on a tile face counts from this size
_BIG = 10 ** 9


def _round(x, n=3):
    return None if x is None else round(float(x), n)


def edt_q(void_bool):
    """Distance from every void cell to the nearest foam cell centre, in quarter cells (integer); foam cells get -1."""
    if void_bool.all():
        q = np.full(void_bool.shape, 10 ** 6, dtype=np.int64)
    else:
        d = ndimage.distance_transform_edt(void_bool)
        q = np.rint(np.sqrt(np.rint(d * d)) * QUANT).astype(np.int64)
    q[~void_bool] = -1
    return q


def edt_sq_cells(boolean):
    """Squared distance in cells (an exact integer) from every True cell to the nearest False cell."""
    if boolean.all():
        return np.full(boolean.shape, 10 ** 12, dtype=np.int64)
    d = ndimage.distance_transform_edt(boolean)
    return np.rint(d * d).astype(np.int64)


# ------------------------------------------------------------------ what is above every cell
def vertical_fields(void_bool):
    """clear_top: void from this cell straight up to the open top (sky). run_up: void cells from this cell up to the next foam or the top."""
    nx, ny, nz = void_bool.shape
    clear_top = np.flip(np.cumprod(np.flip(void_bool, 2), axis=2), 2).astype(bool)
    run_up = np.zeros(void_bool.shape, np.int32)
    for k in range(nz - 1, -1, -1):
        above = run_up[:, :, k + 1] if k + 1 < nz else 0
        run_up[:, :, k] = np.where(void_bool[:, :, k], above + 1, 0)
    return clear_top, run_up


def light_distance(void_bool, clear_top, cell):
    """Steps (cells) to the nearest light, per void cell: open sky above, or a void cell on a side face, reached through the void of the same layer (8 neighbours)."""
    nx, ny, nz = void_bool.shape
    cap = max(1, int(round(LIT_CAP_FT / cell)))
    ldist = np.full(void_bool.shape, cap, np.int16)
    edge = np.zeros((nx, ny), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    st8 = np.ones((3, 3), bool)
    for k in range(nz):
        V = void_bool[:, :, k]
        if not V.any():
            continue
        cur = V & (clear_top[:, :, k] | edge)
        dk = np.full(V.shape, cap, np.int16)
        dk[cur] = 0
        for it in range(1, cap):
            nxt = ndimage.binary_dilation(cur, structure=st8, mask=V) if cur.any() else cur
            fresh = nxt & ~cur
            if not fresh.any():
                break
            dk[fresh] = it
            cur = nxt
        ldist[:, :, k] = dk
    return ldist


def _clear_stats(run_cells, cell):
    """min / mean / max clear height (ft) of a set of floor cells, ignoring runs under 1 ft; falls back to all of them."""
    h = np.asarray(run_cells, dtype=np.float64) * cell
    if len(h) == 0:
        return {"min": 0.0, "mean": 0.0, "max": 0.0}
    k = h[h >= 1.0 - 1e-9]
    if len(k):
        h = k
    return {"min": _round(h.min()), "mean": _round(h.mean()), "max": _round(h.max())}


# ------------------------------------------------------------------ levels
def analyze_levels(void_bool, mask, cell, pid, fields):
    """Floors: a void cell with foam directly below it is floor, at the height of the foam's top. Layers with enough floor
    are levels; neighbouring layers are one level (a ramp is one sloped level). Each level also describes the space above its floor."""
    clear_top, run_up, ldist = fields
    nx, ny, nz = void_bool.shape
    solid = (~void_bool) & mask
    floor = void_bool[:, :, 1:] & solid[:, :, :-1]
    area_k = floor.sum(axis=(0, 1)) * cell * cell                           # index k - 1 -> floor at layer k
    plan = float(mask.any(axis=2).sum()) * cell * cell
    thr = max(2.0, LEVEL_MIN_FRAC * plan)
    ks = [k + 1 for k in range(nz - 1) if area_k[k] >= thr]
    groups = []
    for k in ks:
        if groups and k == groups[-1][-1] + 1:
            groups[-1].append(k)
        else:
            groups.append([k])
    levels, level_of_k = [], {}
    lit_steps = int(round(LIT_FT / cell))
    for n, g in enumerate(groups):
        a = np.array([area_k[k - 1] for k in g])
        z = np.array([k * cell for k in g])
        sel = np.zeros(void_bool.shape, bool)
        for k in g:
            sel[:, :, k] = floor[:, :, k - 1]
        ids = sorted(set(int(v) for k in g for v in np.unique(pid[:, :, k - 1][floor[:, :, k - 1]]) if v > 0)) if pid is not None else []
        zmean = float((a * z).sum() / a.sum())
        n_f = int(sel.sum())
        if (z.max() - z.min()) >= 1.0:
            name = "the ramp from %g to %g ft" % (round(z.min() * 2) / 2.0, round(z.max() * 2) / 2.0)
        else:
            name = "the %g ft floor" % (round(zmean * 2) / 2.0)
        levels.append({"id": n + 1, "name": name, "z_ft": _round(zmean), "z_min_ft": _round(z.min()), "z_max_ft": _round(z.max()),
                       "area_ft2": _round(a.sum()), "kind": "sloped" if (z.max() - z.min()) >= 1.0 else "flat",
                       "layers": [g[0], g[-1]], "plate_ids": ids,
                       "clear_height_ft": _clear_stats(run_up[sel], cell), "volume_above_ft3": _round(float(run_up[sel].sum()) * cell ** 3),
                       "sky_fraction": _round(int((sel & clear_top).sum()) / n_f, 4), "lit_fraction": _round(int((sel & (ldist <= lit_steps)).sum()) / n_f, 4)})
        for k in g:
            level_of_k[k] = n + 1
    return levels, level_of_k, floor


# ------------------------------------------------------------------ rooms (marker watershed on the distance field)
def _nb_max(a, void_bool):
    """Largest value among the six neighbours that are void (foam and the tile edge count as -inf)."""
    pad = np.full((a.shape[0] + 2, a.shape[1] + 2, a.shape[2] + 2), -_BIG, np.int64)
    pad[1:-1, 1:-1, 1:-1] = np.where(void_bool, a, -_BIG)
    out = np.full(a.shape, -_BIG, np.int64)
    for ax in range(3):
        for s in (-1, 1):
            sl = [slice(1, -1)] * 3
            sl[ax] = slice(1 + s, pad.shape[ax] - 1 + s)
            out = np.maximum(out, pad[tuple(sl)])
    return out


def room_markers(q, void_bool, h_q):
    """Peaks of the distance field with at least h of prominence: reconstruction by dilation of (q - h) under q, then its plateaus
    that have no higher neighbour. One marker per plateau."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    rec = np.where(void_bool, q - h_q, -_BIG)
    while True:
        nxt = np.where(void_bool, np.minimum(np.maximum(rec, _nb_max(rec, void_bool)), q), -_BIG)
        if np.array_equal(nxt, rec):
            break
        rec = nxt
    idx = np.arange(rec.size).reshape(rec.shape)
    rows, cols = [], []
    has_higher = np.zeros(rec.shape, bool)
    for ax in range(3):
        sa = [slice(None)] * 3
        sb = [slice(None)] * 3
        sa[ax], sb[ax] = slice(0, -1), slice(1, None)
        a, b = rec[tuple(sa)], rec[tuple(sb)]
        both = void_bool[tuple(sa)] & void_bool[tuple(sb)]
        eq = both & (a == b)
        rows.append(idx[tuple(sa)][eq])
        cols.append(idx[tuple(sb)][eq])
        ha = np.zeros(rec.shape, bool)
        hb = np.zeros(rec.shape, bool)
        ha[tuple(sa)] = both & (b > a)
        hb[tuple(sb)] = both & (a > b)
        has_higher |= ha | hb
    r, c = np.concatenate(rows), np.concatenate(cols)
    n_comp, comp = connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(rec.size, rec.size)), directed=False)
    comp = comp.reshape(rec.shape)
    bad = np.zeros(n_comp, bool)
    bad[np.unique(comp[has_higher & void_bool])] = True
    lab, n = ndimage.label(void_bool & ~bad[comp])
    return lab


def flood_rooms(q, void_bool, markers):
    """Marker watershed: cells are claimed from the highest distance down, each by the room next to it (ties: lower cell index)."""
    import heapq
    nx, ny, nz = void_bool.shape
    px, py, pz = nx + 2, ny + 2, nz + 2
    V = np.zeros((px, py, pz), bool)
    V[1:-1, 1:-1, 1:-1] = void_bool
    Q = np.zeros((px, py, pz), np.int64)
    Q[1:-1, 1:-1, 1:-1] = np.where(void_bool, q, 0)
    L = np.zeros((px, py, pz), np.int32)
    L[1:-1, 1:-1, 1:-1] = markers
    vl, ql, ll = V.ravel().tolist(), Q.ravel().tolist(), L.ravel().tolist()
    sx, sy = py * pz, pz
    offs = (-sx, sx, -sy, sy, -1, 1)
    heap = [(-ql[i], i) for i, v in enumerate(ll) if v]
    heapq.heapify(heap)
    while heap:
        _, c = heapq.heappop(heap)
        lc = ll[c]
        for o in offs:
            n = c + o
            if vl[n] and not ll[n]:
                ll[n] = lc
                heapq.heappush(heap, (-ql[n], n))
    out = np.array(ll, dtype=np.int32).reshape(px, py, pz)
    return out[1:-1, 1:-1, 1:-1]


def room_interfaces(lab, dist_ft, cell):
    """Where two rooms touch: {(a, b): {n, nz, sum[3], dmax}} with a < b (n = number of touching cell faces)."""
    out = {}
    for ax in range(3):
        sa = [slice(None)] * 3
        sb = [slice(None)] * 3
        sa[ax], sb[ax] = slice(0, -1), slice(1, None)
        a, b = lab[tuple(sa)], lab[tuple(sb)]
        m = (a > 0) & (b > 0) & (a != b)
        if not m.any():
            continue
        idx = np.nonzero(m)
        aa, bb = a[idx], b[idx]
        da, db = dist_ft[tuple(sa)][idx], dist_ft[tuple(sb)][idx]
        pos = np.stack(idx, axis=1).astype(np.float64) + 0.5
        pos[:, ax] += 0.5
        lo, hi = np.minimum(aa, bb), np.maximum(aa, bb)
        d = np.maximum(da, db)
        for l_, h_ in sorted(set(zip(lo.tolist(), hi.tolist()))):
            s = (lo == l_) & (hi == h_)
            e = out.setdefault((l_, h_), {"n": 0, "nz": 0, "sum": np.zeros(3), "dmax": 0.0})
            e["n"] += int(s.sum())
            if ax == 2:
                e["nz"] += int(s.sum())
            e["sum"] += pos[s].sum(axis=0) * cell
            e["dmax"] = max(e["dmax"], float(d[s].max()))
    return out


def label_rooms(void_bool, cell):
    q = edt_q(void_bool)
    d = np.where(void_bool, q / float(QUANT) * cell, 0.0)                       # feet from a void cell to the nearest foam cell centre
    h_q = max(1, int(round(ROOM_H_FT / cell * QUANT)))
    lab = flood_rooms(q, void_bool, room_markers(q, void_bool, h_q))
    min_cells = int(math.ceil(MIN_ROOM_FT3 / cell ** 3))
    # merge small rooms into the neighbour they share the most surface with
    while True:
        cnt = np.bincount(lab.ravel())
        small = [(int(cnt[i]), i) for i in range(1, len(cnt)) if 0 < cnt[i] < min_cells]
        if not small:
            break
        inter = room_interfaces(lab, d, cell)
        merged = False
        for _, r in sorted(small):
            nb = [(-v["n"], (b if a == r else a)) for (a, b), v in inter.items() if r in (a, b)]
            if nb:
                lab[lab == r] = sorted(nb)[0][1]
                merged = True
                break
        if not merged:
            break
    # what is still smaller than a room is a speck of void, not a room
    cnt = np.bincount(lab.ravel())
    specks = [int(cnt[i]) for i in range(1, len(cnt)) if 0 < cnt[i] < min_cells]
    for i in range(1, len(cnt)):
        if 0 < cnt[i] < min_cells:
            lab[lab == i] = 0
    # final numbering: biggest room first (ties: the room that starts first in raster order)
    flat = lab.ravel()
    ids = [int(i) for i in np.unique(flat) if i > 0]
    first = {i: int(np.argmax(flat == i)) for i in ids}
    vol = {i: int((flat == i).sum()) for i in ids}
    order = sorted(ids, key=lambda i: (-vol[i], first[i]))
    remap = np.zeros(int(flat.max()) + 1, np.int32)
    for n, i in enumerate(order):
        remap[i] = n + 1
    return remap[lab], d, {"count": len(specks), "volume_ft3": _round(sum(specks) * cell ** 3)}


def classify_room(ext, clear, sky, footprint):
    """The room's kind from its proportions (feet): shaft, gallery, terrace, hall, cave, low room, room."""
    lng, wid = max(ext[0], ext[1]), max(min(ext[0], ext[1]), 0.5)
    h_max, h_mean = clear["max"], clear["mean"]
    if h_max >= 12.0 and h_max >= 2.0 * wid:
        return "shaft"
    if lng >= 3.0 * wid and wid <= 10.0:
        return "gallery"
    if sky >= 0.6:
        return "terrace"
    if footprint >= 100.0 and h_mean >= 8.0:
        return "hall"
    if sky < 0.05 and h_mean < 9.0:
        return "cave"
    if h_mean < 7.0:
        return "low room"
    return "room"


def analyze_rooms(void_bool, mask, cell, levels, level_of_k, floor, fields):
    clear_top, run_up, ldist = fields
    nx, ny, nz = void_bool.shape
    lab, dist, specks = label_rooms(void_bool, cell)
    n_rooms = int(lab.max())
    ca, cv = cell * cell, cell ** 3
    lit_steps = int(round(LIT_FT / cell))
    rooms = []
    for r in range(1, n_rooms + 1):
        R = lab == r
        cells = int(R.sum())
        idx = np.argwhere(R)
        lo, hi = idx.min(0), idx.max(0) + 1
        ext = ((hi - lo) * cell).tolist()
        fl = floor & R[:, :, 1:]
        n_floor = int(fl.sum())
        full = np.zeros(void_bool.shape, bool)
        full[:, :, 1:] = fl
        if n_floor:
            clear = _clear_stats(run_up[full], cell)
            sky = int((full & clear_top).sum()) / n_floor
            lit_f = int((full & (ldist <= lit_steps)).sum()) / n_floor
            ldm = float(ldist[full].mean()) * cell
        else:
            col_h = R.sum(axis=2)
            clear = _clear_stats(col_h[col_h > 0], cell)
            sky, lit_f, ldm = 0.0, 0.0, 0.0
        fz = [kk * cell for kk in range(1, nz) if fl[:, :, kk - 1].any()]
        foot = float(R.any(axis=2).sum()) * ca
        kind = classify_room(ext, clear, sky, foot)
        faces_open = {}
        for f in VIEWS:
            a_ = float(face_layer(R, f).sum()) * ca
            if a_ > 0:
                faces_open[f] = _round(a_)
        lv = sorted(set(level_of_k[kk] for kk in range(1, nz) if kk in level_of_k and fl[:, :, kk - 1].any()))
        centroid = ((idx.mean(0) + 0.5) * cell).tolist()
        rooms.append({"id": r, "kind": kind, "volume_ft3": _round(cells * cv), "cells": cells, "volume_share": 0.0,
                      "floor_area_ft2": _round(n_floor * ca), "footprint_ft2": _round(foot),
                      "bbox_min_ft": [_round(v) for v in (lo * cell).tolist()], "bbox_max_ft": [_round(v) for v in (hi * cell).tolist()],
                      "extent_ft": [_round(v) for v in ext], "clear_height_ft": clear,
                      "floor_z_ft": {"min": _round(min(fz)) if fz else None, "max": _round(max(fz)) if fz else None},
                      "sky_fraction": _round(sky, 4), "lit_fraction": _round(lit_f, 4), "light_distance_ft": _round(ldm),
                      "open_below": bool(R[:, :, 0].any()), "faces_open_ft2": faces_open, "level_ids": lv, "centroid_ft": [_round(v) for v in centroid]})
    total = float(void_bool.sum()) * cv
    for rm in rooms:
        rm["volume_share"] = _round(rm["volume_ft3"] / total if total else 0.0, 4)
    # names: a level word when there is more than one floor, the kind, the clear height and the footprint
    zs = [rm["floor_z_ft"]["min"] for rm in rooms if rm["floor_z_ft"]["min"] is not None]
    zlo, zhi = (min(zs), max(zs)) if zs else (0, 0)
    seen = {}
    for rm in rooms:
        z = rm["floor_z_ft"]["min"]
        word = ""
        if len(levels) >= 2 and z is not None and zhi - zlo >= 2.0:
            word = "lower " if z - zlo < 0.2 * (zhi - zlo) else ("upper " if zhi - z < 0.2 * (zhi - zlo) else "middle ")
        h = rm["clear_height_ft"]["max"] if rm["kind"] == "shaft" else rm["clear_height_ft"]["mean"]
        a_, b_ = sorted(rm["extent_ft"][:2], reverse=True)
        base = "%s%s, %d ft clear, %d by %d ft" % (word, rm["kind"], int(round(h)), int(round(a_)), int(round(b_)))
        seen[base] = seen.get(base, 0) + 1
        rm["name"] = base if seen[base] == 1 else "%s (%d)" % (base, seen[base])
    return rooms, lab, dist, specks


def analyze_connections(rooms, lab, dist, cell):
    inter = room_interfaces(lab, dist, cell)
    conns = []
    for (a, b), v in sorted(inter.items()):
        area = v["n"] * cell * cell
        neck = max(0.0, (2.0 * v["dmax"] / cell - 1.0)) * cell
        if area < MIN_LINK_FT2 or neck < MIN_LINK_NECK_FT - 1e-9:
            continue
        vs = v["nz"] / float(v["n"])
        conns.append({"id": len(conns) + 1, "rooms": [a, b], "area_ft2": _round(area), "neck_ft": _round(neck),
                      "centre_ft": [_round(x / v["n"]) for x in v["sum"]], "orientation": "vertical" if vs > 0.6 else ("horizontal" if vs < 0.2 else "mixed")})
    n = len(rooms)
    deg = {r["id"]: 0 for r in rooms}
    parent = {r["id"]: r["id"] for r in rooms}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for c in conns:
        a, b = c["rooms"]
        deg[a] += 1
        deg[b] += 1
        parent[find(a)] = find(b)
    comps = len(set(find(r["id"]) for r in rooms)) if rooms else 0
    access = [r["id"] for r in rooms if any(a >= MIN_LINK_FT2 for a in r["faces_open_ft2"].values())]
    graph = {"rooms": n, "connections": len(conns), "components": comps, "loops": max(0, len(conns) - n + comps),
             "dead_ends": sum(1 for r in rooms if deg[r["id"]] == 1), "degree": [deg[r["id"]] for r in rooms], "access_rooms": access,
             "neck_ft": {"min": _round(min([c["neck_ft"] for c in conns])) if conns else None, "max": _round(max([c["neck_ft"] for c in conns])) if conns else None}}
    return conns, graph


# ------------------------------------------------------------------ routes (shortest ways through the void)
def _face_cells(shape, face):
    g = np.zeros(shape, bool)
    ax = "XYZ".index(face[1])
    sl = [slice(None)] * 3
    sl[ax] = 0 if face[0] == "-" else shape[ax] - 1
    g[tuple(sl)] = True
    return g


def void_graph(void_bool, cell):
    from scipy.sparse import coo_matrix
    nx, ny, nz = void_bool.shape
    idx = np.arange(void_bool.size).reshape(void_bool.shape)
    rows, cols, wts = [], [], []
    for dx in (0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if (dx, dy, dz) <= (0, 0, 0):
                    continue
                sa = (slice(0, nx - dx), slice(max(0, -dy), ny - max(0, dy)), slice(max(0, -dz), nz - max(0, dz)))
                sb = (slice(dx, nx), slice(max(0, dy), ny - max(0, -dy)), slice(max(0, dz), nz - max(0, -dz)))
                m = void_bool[sa] & void_bool[sb]
                rows.append(idx[sa][m])
                cols.append(idx[sb][m])
                wts.append(np.full(int(m.sum()), math.sqrt(dx * dx + dy * dy + dz * dz) * cell))
    r, c, w = np.concatenate(rows), np.concatenate(cols), np.concatenate(wts)
    return coo_matrix((w, (r, c)), shape=(void_bool.size, void_bool.size)).tocsr()


def analyze_routes(void_bool, lab, cell):
    """Shortest way through the void between every pair of side faces that have an opening (26 neighbours, Dijkstra)."""
    from scipy.sparse.csgraph import dijkstra
    shape = void_bool.shape
    faces = [f for f in SIDE_FACES if (void_bool & _face_cells(shape, f)).any()]
    out = {"routes": [], "main": None}
    if len(faces) < 2:
        return out
    G = void_graph(void_bool, cell)
    D, P = {}, {}
    for f in faces:
        src = np.flatnonzero((void_bool & _face_cells(shape, f)).ravel())
        d, pred, _ = dijkstra(G, directed=False, indices=src, min_only=True, return_predecessors=True)
        D[f], P[f] = d, pred
    best = None
    for a in range(len(faces)):
        for b in range(a + 1, len(faces)):
            f, g = faces[a], faces[b]
            tgt = np.flatnonzero((void_bool & _face_cells(shape, g)).ravel())
            dd = D[f][tgt]
            if not np.isfinite(dd.min()):
                continue
            end = int(tgt[int(np.argmin(dd))])
            path = [end]
            while P[f][path[-1]] >= 0:
                path.append(int(P[f][path[-1]]))
            path.reverse()
            xyz = np.array(np.unravel_index(path, shape)).T.astype(np.float64)
            pts = (xyz + 0.5) * cell
            length = float(dd.min()) + cell
            straight = float(np.linalg.norm(pts[-1] - pts[0])) + cell
            samp = pts[::ROUTE_STEP]
            if len(samp) < 2 or np.linalg.norm(samp[-1] - pts[-1]) > 1e-9:
                samp = np.vstack([samp, pts[-1]])
            seg = np.diff(samp, axis=0)
            nrm = np.linalg.norm(seg, axis=1)
            bends = 0
            for q in range(1, len(seg)):
                if nrm[q] > 1e-9 and nrm[q - 1] > 1e-9:
                    if float(np.dot(seg[q], seg[q - 1]) / (nrm[q] * nrm[q - 1])) < math.cos(math.radians(35.0)):
                        bends += 1
            rooms_on = []
            for v in lab[tuple(np.array(np.unravel_index(path, shape)))].tolist():
                if v and v not in rooms_on:
                    rooms_on.append(int(v))
            keep = pts[::max(1, int(round(1.0 / cell)))]
            rt = {"from": f, "to": g, "length_ft": _round(length), "straight_ft": _round(straight), "sinuosity": _round(length / max(straight, 1e-9)),
                  "bends": bends, "rooms": rooms_on, "points_ft": [[_round(v, 2) for v in p] for p in keep.tolist()]}
            out["routes"].append(rt)
            if best is None or length > best["length_ft"] + 1e-6:
                best = rt
    out["main"] = best
    return out


def route_profile(void_bool, lab, route, cell):
    """Void cross-section area (ft2) in each slice along the route's main horizontal direction, counting only the rooms the route passes."""
    if not route or not route["rooms"]:
        return None
    pts = np.array(route["points_ft"], dtype=np.float64)
    span = np.abs(pts[-1] - pts[0])
    ax = 0 if span[0] >= span[1] else 1
    R = np.isin(lab, route["rooms"])
    prof = (R.sum(axis=tuple(a for a in range(3) if a != ax)) * cell * cell)
    p = prof[prof > 0]
    med = float(np.median(p)) if len(p) else 0.0
    sq, inrun = 0, False
    for v in prof:
        if v > 0 and v < 0.6 * med:
            if not inrun:
                sq += 1
            inrun = True
        else:
            inrun = False
    return {"axis": "xyz"[ax], "area_ft2": [_round(v, 2) for v in prof.tolist()], "min_ft2": _round(p.min()) if len(p) else 0.0,
            "max_ft2": _round(p.max()) if len(p) else 0.0, "median_ft2": _round(med), "ratio": _round(float(p.max() / max(p.min(), 1e-9)) if len(p) else 1.0),
            "squeezes": sq}


# ------------------------------------------------------------------ openings on the tile faces
def analyze_openings(void_bool, cell):
    """Openings (connected void on a tile face, 4 neighbours) per face: count, areas, total."""
    ca = cell * cell
    out = {}
    for f in VIEWS:
        lay = face_layer(void_bool, f)
        lab, n = ndimage.label(lay)
        areas = sorted([float((lab == i).sum()) * ca for i in range(1, n + 1)], reverse=True) if n else []
        areas = [a for a in areas if a >= OPENING_MIN_FT2 - 1e-9]
        out[f] = {"count": len(areas), "areas_ft2": [_round(a) for a in areas], "total_ft2": _round(float(lay.sum()) * ca)}
    return out


# ------------------------------------------------------------------ structure and printability
def thin_share(foam, cell):
    """Share of the foam that is thinner than each wall thickness in THIN_WALLS_FT: foam is opened with a ball of that diameter
    (cells farther than the radius from any void are the core; everything within the radius of the core is kept)."""
    out = {}
    nfoam = int(foam.sum())
    if nfoam == 0:
        return {("%g" % w): 0.0 for w in THIN_WALLS_FT}
    dsq = edt_sq_cells(foam)
    for w in THIN_WALLS_FT:
        rc = (w / 2.0) / cell
        core = foam & (dsq >= int(math.ceil(rc * rc - 1e-9)))
        if not core.any():
            out["%g" % w] = 1.0
            continue
        d2 = edt_sq_cells(~core)
        kept = foam & (d2 <= int(math.floor(rc * rc + 1e-9)))
        out["%g" % w] = _round(1.0 - kept.sum() / float(nfoam), 4)
    return out


def analyze_structure(void_bool, mask, cell, pid, struts):
    foam = (~void_bool) & mask
    ca, cv = cell * cell, cell ** 3
    lab, n = ndimage.label(foam)
    sizes = np.bincount(lab.ravel(), minlength=n + 1)[1:] if n else np.array([], int)
    order = np.argsort(-sizes, kind="stable") if n else []
    bottom = np.unique(lab[:, :, 0][foam[:, :, 0]]) if n else np.array([], int)
    grounded = set(int(i) for i in bottom if i > 0)
    pieces = [{"id": int(i) + 1, "volume_ft3": _round(sizes[i] * cv), "grounded": (int(i) + 1) in grounded} for i in order[:12]]
    over = foam[:, :, 1:] & void_bool[:, :, :-1]
    foam_surface = 0
    for ax in range(3):
        a = np.moveaxis(foam, ax, 0)
        v = np.moveaxis(void_bool, ax, 0)
        foam_surface += int((a[1:] & v[:-1]).sum()) + int((a[:-1] & v[1:]).sum())
    plates = []
    plate_cells = 0
    if pid is not None and pid.any():
        for pidn in sorted(int(v) for v in np.unique(pid) if v > 0):
            pc = pid == pidn
            cols = pc.any(axis=2)
            ids = set(int(v) for v in np.unique(lab[pc]) if v > 0)
            plate_cells += int(pc.sum())
            plates.append({"id": pidn, "cells": int(pc.sum()), "area_ft2": _round(int(cols.sum()) * ca),
                           "thickness_ft": _round(pc.sum() / max(int(cols.sum()), 1) * cell),
                           "piece": min(ids) if ids else 0, "grounded": bool(ids & grounded)})
    nfoam = int(foam.sum())
    return {"foam_ft3": _round(nfoam * cv), "foam_pieces": int(n), "main_piece_share": _round(float(sizes.max()) / float(sizes.sum()), 4) if n else 0.0,
            "pieces": pieces, "floating_ft3": _round(float(sizes.sum() - sizes.max()) * cv) if n else 0.0,
            "thin_share": thin_share(foam, cell),
            "overhang_area_ft2": _round(float(over.sum()) * ca), "overhang_share": _round(float(over.sum()) / max(foam_surface, 1), 4),
            "bed_contact_ft2": _round(float(foam[:, :, 0].sum()) * ca), "foam_surface_ft2": _round(foam_surface * ca),
            "plate_share": _round(plate_cells / float(nfoam), 4) if nfoam else 0.0,
            "branches_ft3": _round(float(np.count_nonzero(struts)) * cv) if struts is not None else 0.0, "plates": plates}


# ------------------------------------------------------------------ the whole thing
def analyze_tile(void_bool, mask, cell, pid=None, struts=None):
    """Levels, rooms, connections, graph, routes, route profile, daylight, openings and structure of a tile (docs/DATA_FORMAT.md section 13)."""
    void_bool = np.asarray(void_bool, dtype=bool)
    mask = np.ones(void_bool.shape, bool) if mask is None else np.asarray(mask, dtype=bool)
    clear_top, run_up = vertical_fields(void_bool)
    ldist = light_distance(void_bool, clear_top, cell)
    fields = (clear_top, run_up, ldist)
    levels, level_of_k, floor = analyze_levels(void_bool, mask, cell, pid, fields)
    rooms, lab, dist, specks = analyze_rooms(void_bool, mask, cell, levels, level_of_k, floor, fields)
    conns, graph = analyze_connections(rooms, lab, dist, cell)
    graph["specks"] = specks
    routes = analyze_routes(void_bool, lab, cell)
    prof = route_profile(void_bool, lab, routes["main"], cell)
    nfl = int(floor.sum())
    lit_steps = int(round(LIT_FT / cell))
    day = {"lit_floor_fraction": _round(int((floor & (ldist[:, :, 1:] <= lit_steps)).sum()) / nfl if nfl else 0.0, 4),
           "sky_floor_fraction": _round(int((floor & clear_top[:, :, 1:]).sum()) / nfl if nfl else 0.0, 4),
           "mean_light_distance_ft": _round(float(ldist[:, :, 1:][floor].mean()) * cell if nfl else 0.0), "floor_area_ft2": _round(nfl * cell * cell),
           "lit_within_ft": LIT_FT}
    return {"version": ANALYSIS_VERSION, "levels": levels, "rooms": rooms, "connections": conns, "graph": graph, "routes": routes["routes"],
            "main_route": routes["main"], "profile": prof, "daylight": day, "openings": analyze_openings(void_bool, cell),
            "structure": analyze_structure(void_bool, mask, cell, pid, struts), "room_labels": lab}


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
SCHEMA = "erosion-tile/4"
ENGINE_VERSION = "7.0"
RECIPE_SCHEMA = "erosion-recipe/2"
RECIPE_FIELDS = ("tile_w", "tile_h", "cell", "steps", "gravity", "drain", "n_frames", "smooth", "seed")


def _tile_extras(ctx, metrics):
    """Fields engine 7 adds to tile.json: where the tile sits in the world, what the container is, the floor plates."""
    out = {"origin_ft": [round(float(a), 4) for a in ctx.get("origin", (0.0, 0.0, 0.0))],
           "container": {"kind": ctx.get("container_kind", "cube"), "volume_ft3": metrics["tile_volume_ft3"],
                         "mask_file": "voxels/mask.u8" if ctx.get("container_kind") in ("geometry", "mass") else None}}
    if ctx.get("plates_json"):
        out["plates"] = [{"id": p["id"], "name": p["name"], "area_ft2": p["area_ft2"], "present": p["present"], "slope_deg": p.get("slope_deg"),
                          "top_z_ft": p.get("top_z_ft"), "supported": (p.get("support") or {}).get("supported"),
                          "struts_added": (p.get("support") or {}).get("struts_added")} for p in ctx["plates_json"]]
        out["plates_file"] = "data/plates.json"
    out["recipe_file"] = "recipe.json"
    an = ctx.get("_analysis")
    if an:
        out["levels"] = [{"id": lv["id"], "name": lv["name"], "z_ft": lv["z_ft"], "area_ft2": lv["area_ft2"], "kind": lv["kind"]} for lv in an["levels"]]
        out["analysis"] = {"version": ANALYSIS_VERSION, "spaces_file": "data/spaces.json", "structure_file": "data/structure.json", "rooms_file": "voxels/rooms.u8"}
    if ctx.get("meta"):
        out["meta"] = ctx["meta"]
    return out


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


# ------------------------------------------------------------------ architectural drawings and print files
POCHE_FOAM = "#1b1b1b"          # the cut through foam
POCHE_PLATE = "#4f6f95"         # the cut through a floor plate
FLOOR_TINT = "#dcdcdc"          # the floor of a level, seen below the cut
PLAN_CUT_FT = 4.0               # plans are cut this far above the level's floor
PRINT_RATIO_DEFAULT = 120.0     # 1 : 120 = 1 inch per 10 feet
MAX_PLANS = 10


def _svg_d(polys, h_ft):
    """Closed polylines in (u right, v up) feet -> SVG path data (y down)."""
    return " ".join("M " + " L ".join("%.2f %.2f" % (x, h_ft - y) for x, y in p) + " Z" for p in polys if len(p) >= 3)


def write_sheet(path, w_ft, h_ft, title, foam, plates, tint=None, hlines=None, labels=None):
    """One drawing as SVG at 1 inch = 10 feet: foam and plates cut solid (even-odd, so holes read as void), white void, a 10 ft grid ruler,
    optional level lines (z, text) and labels (x, y, text). Foam / plates / tint: lists of closed polylines in (u right, v up) feet."""
    pad, band = 3.5, 5.5
    W, H = w_ft + 2 * pad, h_ft + 2 * pad + band
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<svg xmlns="http://www.w3.org/2000/svg" width="%.3fin" height="%.3fin" viewBox="0 0 %.2f %.2f" font-family="Arial, Helvetica, sans-serif">' % (W / 10.0, H / 10.0, W, H),
           "<title>%s</title>" % title, '<rect x="0" y="0" width="%.2f" height="%.2f" fill="#ffffff"/>' % (W, H), '<g transform="translate(%.2f %.2f)">' % (pad, pad)]
    if tint:
        out.append('<path d="%s" fill="%s" fill-rule="evenodd" stroke="none"/>' % (_svg_d(tint, h_ft), FLOOR_TINT))
    out.append('<path d="%s" fill="%s" fill-rule="evenodd" stroke="none"/>' % (_svg_d(foam, h_ft), POCHE_FOAM))
    if plates:
        out.append('<path d="%s" fill="%s" fill-rule="evenodd" stroke="none"/>' % (_svg_d(plates, h_ft), POCHE_PLATE))
    out.append('<rect x="0" y="0" width="%.2f" height="%.2f" fill="none" stroke="#000000" stroke-width="0.08"/>' % (w_ft, h_ft))
    for z, text in hlines or []:
        y = h_ft - z
        out.append('<line x1="-1.0" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#c43383" stroke-width="0.05" stroke-dasharray="0.6 0.4"/>' % (y, w_ft + 1.0, y))
        out.append('<text x="-1.3" y="%.2f" font-size="0.9" text-anchor="end" fill="#c43383">%s</text>' % (y + 0.3, text))
    for x, y, text in labels or []:
        out.append('<text x="%.2f" y="%.2f" font-size="0.9" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="0.12" paint-order="stroke">%s</text>' % (x, h_ft - y, text))
    for t in range(0, int(w_ft) + 1, 10):
        out.append('<line x1="%d" y1="%.2f" x2="%d" y2="%.2f" stroke="#000000" stroke-width="0.06"/>' % (t, h_ft, t, h_ft + 0.7))
        out.append('<text x="%d" y="%.2f" font-size="0.9" text-anchor="middle" fill="#000000">%d ft</text>' % (t, h_ft + 1.8, t))
    head, _, tail = title.partition(" | ")
    out.append('<text x="0" y="%.2f" font-size="1.1" fill="#000000">%s</text>' % (h_ft + 3.6, head))
    if tail:
        out.append('<text x="0" y="%.2f" font-size="0.9" fill="#555555">%s</text>' % (h_ft + 5.0, tail))
    out.append("</g></svg>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def _polys(slice2d, view, cell, w_ft, h_ft):
    return [p.tolist() for p in contours_uv(orient(view, np.asarray(slice2d, dtype=np.float32)), cell, w_ft, h_ft)]


def write_drawings(outdir, add, void_bool, foam_sm, Pk, analysis, cell, dims, name):
    """Plan of every level (cut 4 ft above its floor, the floor tinted) and sections through X and Y at 1/4, 1/2 and 3/4. Poche drawings in SVG."""
    nx, ny, nz = void_bool.shape
    levels = analysis["levels"]
    flats = [(lv["z_ft"], "%.1f" % lv["z_ft"]) for lv in levels if lv["kind"] == "flat"] + \
            [(0.5 * (lv["z_min_ft"] + lv["z_max_ft"]), "%.0f-%.0f" % (lv["z_min_ft"], lv["z_max_ft"])) for lv in levels if lv["kind"] != "flat"]
    pick = levels if len(levels) <= MAX_PLANS else [levels[int(round(i * (len(levels) - 1) / float(MAX_PLANS - 1)))] for i in range(MAX_PLANS)]
    for lv in pick:
        kc = int(min(nz - 1, max(0, int((lv["z_ft"] + PLAN_CUT_FT) / cell))))
        k0, k1 = lv["layers"]
        tint_m = np.zeros((nx, ny), np.float32)
        for k in range(k0, k1 + 1):
            tint_m = np.maximum(tint_m, (void_bool[:, :, k] & ~void_bool[:, :, k - 1]).astype(np.float32))
        labels = [(rm["centroid_ft"][0], rm["centroid_ft"][1], "%s %.0f ft2" % (rm["kind"], rm["floor_area_ft2"])) for rm in analysis["rooms"] if lv["id"] in rm["level_ids"]]
        p = os.path.join(outdir, "plan_level_%02d_z%.1f.svg" % (lv["id"], lv["z_ft"]))
        write_sheet(p, dims[0], dims[1], "%s | plan of %s, cut at %.1f ft, 1 in = 10 ft" % (name, lv["name"], lv["z_ft"] + PLAN_CUT_FT),
                    _polys(foam_sm[:, :, kc], "+Z", cell, dims[0], dims[1]), _polys(Pk[:, :, kc], "+Z", cell, dims[0], dims[1]) if Pk is not None else [],
                    _polys(tint_m, "+Z", cell, dims[0], dims[1]), None, labels)
        add(p, "drawing.plan", "plan of %s cut %.1f ft above its floor: foam solid, plates blue, floor tinted, void white; 1 in = 10 ft" % (lv["name"], PLAN_CUT_FT),
            level=lv["id"], cut_z_ft=round(lv["z_ft"] + PLAN_CUT_FT, 2))
    for ax, view, w_ft in ((0, "+X", dims[1]), (1, "-Y", dims[0])):
        for frac in (0.25, 0.5, 0.75):
            k = int(np.clip(int(frac * void_bool.shape[ax]), 0, void_bool.shape[ax] - 1))
            pos = (k + 0.5) * cell
            f2 = np.take(foam_sm, k, axis=ax)
            p2 = np.take(Pk, k, axis=ax) if Pk is not None else None
            p = os.path.join(outdir, "section_%s_%05.1fft.svg" % ("xyz"[ax], pos))
            write_sheet(p, w_ft, dims[2], "%s | section %s = %.1f ft, 1 in = 10 ft" % (name, "xyz"[ax].upper(), pos),
                        _polys(f2, view, cell, w_ft, dims[2]), _polys(p2, view, cell, w_ft, dims[2]) if p2 is not None else [], None, flats, None)
            add(p, "drawing.section", "section at %s = %.1f ft: foam solid, plates blue, void white, level lines in magenta; 1 in = 10 ft" % ("xyz"[ax].upper(), pos),
                axis="xyz"[ax].upper(), position_ft=round(pos, 2))


def write_stl(path, V, F, ratio, label):
    """Binary STL in millimetres, Z up. ratio 120 means 1 : 120 (1 inch = 10 feet), so 1 ft = 2.54 mm."""
    s = 304.8 / float(ratio)
    P = np.asarray(V, dtype=np.float64) * s
    tri = P[np.asarray(F, dtype=np.int64)]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
    rec = np.zeros(len(tri), dtype=np.dtype([("n", "<f4", (3,)), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    rec["n"], rec["v"] = n, tri
    with open(path, "wb") as f:
        f.write(("erosion engine %s scale 1:%g millimetres" % (label, ratio)).encode("ascii")[:80].ljust(80, b" "))
        f.write(struct.pack("<I", len(tri)))
        f.write(rec.tobytes())
    return P.min(axis=0), P.max(axis=0)


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
                                                       "images/projections", "vector/faces", "vector/sections", "vector/drawings")}
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
    metrics = tile_metrics(void_bool, cell, dims, ctx["void_arrays"], ctx["foam_arrays"], ctx.get("mask"))
    analysis = analyze_tile(void_bool, ctx.get("mask"), cell, ctx.get("pid"), ctx.get("struts"))
    ctx["_analysis"] = analysis
    ox, oy, oz = ctx.get("origin", (0.0, 0.0, 0.0))
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
    if ctx.get("container_kind") in ("geometry", "mass") and ctx.get("mask") is not None:
        arrays["mask.u8"] = (np.asarray(ctx["mask"], dtype=np.uint8), "uint8", "the block of foam: 1 = inside the container, 0 = outside it (cells outside hold neither foam nor void)")
    if ctx.get("plates"):
        arrays["plates.u8"] = (np.clip(ctx["pid"], 0, 255).astype(np.uint8), "uint8", "floor plates that survived: 0 = none, n = plate n of data/plates.json (these cells are foam in void.u8)")
    if ctx.get("struts") is not None and np.any(ctx["struts"]):
        arrays["struts.u8"] = (np.asarray(ctx["struts"], dtype=np.uint8), "uint8", "support branches grown to hold the plates: 1 = branch (foam in void.u8)")
    arrays["rooms.u8"] = (np.clip(analysis["room_labels"], 0, 255).astype(np.uint8), "uint8", "which room each void cell belongs to: 0 = foam (or a speck too small to be a room), n = room n of data/spaces.json")
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
    extra_parts = []                         # plates and branches go in a second file, so every program that reads the main GLB sees only foam and void
    if ctx.get("plates_arrays") is not None:
        extra_parts.append(("plates",) + tuple(ctx["plates_arrays"]))
    if ctx.get("struts_arrays") is not None:
        extra_parts.append(("struts",) + tuple(ctx["struts_arrays"]))
    to_tile = [[1 / 0.3048, 0, 0, 0], [0, 0, -1 / 0.3048, 0], [0, 1 / 0.3048, 0, 0], [0, 0, 0, 1]]
    if parts:
        p = os.path.join(D["model"], "%s.glb" % name)
        write_glb(p, [(nm, V, F, GLB_RGB[nm]) for nm, V, F in parts],
                  extras={"tile_id": tile_id, "name": name, "tile_ft": dims, "cell_ft": cell, "units": "metres, Y up",
                          "to_tile_ft_row_major": to_tile, "note": "tile_ft_position = to_tile_ft * [x, y, z, 1] of the glTF position"})
        add(p, "model.glb", "foam and void meshes with colours and normals for three.js (glTF binary; metres, Y up)",
            to_tile_ft_row_major=to_tile, nodes=[nm for nm, _, _ in parts])
        if extra_parts:
            pp = os.path.join(D["model"], "%s_parts.glb" % name)
            write_glb(pp, [(nm, V, F, GLB_RGB[nm]) for nm, V, F in extra_parts],
                      extras={"tile_id": tile_id, "name": name, "tile_ft": dims, "cell_ft": cell, "units": "metres, Y up", "to_tile_ft_row_major": to_tile,
                              "note": "the floor plates and support branches of the foam, same frame as the main GLB; they lie inside the foam mesh (colour them over it)"})
            add(pp, "model.parts", "the floor plates and support branches as separate meshes (parts of the foam, for colouring or printing them apart); same frame as model.glb",
                to_tile_ft_row_major=to_tile, nodes=[nm for nm, _, _ in extra_parts])

    # ---- faces ----
    face_info, face_imgs, face_curves = {}, {}, []
    plate_mask = (np.asarray(ctx["pid"]) > 0) if ctx.get("pid") is not None else np.zeros(void_bool.shape, bool)
    mask_b = np.ones(void_bool.shape, bool) if ctx.get("mask") is None else np.asarray(ctx["mask"], dtype=bool)
    foam_only = (~void_bool) & mask_b & ~plate_mask
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
                            "foam_mask_rows": rows(face_layer(foam_only, fname)), "plate_mask_rows": rows(face_layer(plate_mask, fname)),
                            **({"outside_mask_rows": rows(face_layer(~mask_b, fname))} if not mask_b.all() else {}),
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
    _write_json(p, {"schema": SCHEMA, "note": "mask_rows: +/-X faces are [y][z], +/-Y faces are [x][z], +/-Z faces are [x][y]; 1 = void. foam_mask_rows: 1 = foam that is not a plate; plate_mask_rows: 1 = floor plate; outside_mask_rows (non-cube containers only): 1 = outside the block. mask_rows_6in is the same face on a fixed 6 inch grid so tiles exported at different cell sizes compare. "
                                              "depth_cells: voxels of void straight in from each face cell. edges: the four border rows. outline_uv_ft: polygons in the seen-from-outside image frame, feet.",
                    "cell_ft": cell, "faces": face_info})
    add(p, "data.faces", "each face's mask, depth, edges, outlines and image plane")
    p = os.path.join(D["data"], "sections.json")
    _write_json(p, {"schema": SCHEMA, "sections": sec_info})
    add(p, "data.sections", "every section's position, void area, outlines and image plane")
    if ctx.get("plates_json"):
        p = os.path.join(D["data"], "plates.json")
        _write_json(p, {"schema": SCHEMA, "note": "Floor plates. Coordinates: *_z_ft and centroid_ft are WORLD feet (tile feet + origin_ft in tile.json); outline_xy_ft is in tile feet (origin at the tile's low corner). "
                                                  "space_above / space_below: clear height of void straight above the top / below the bottom of each kept plate column. openings: holes in the plate "
                                                  "(designed = drawn as an inner curve, otherwise eroded); void_above_or_below = a vertical connection through the floor. support: how the plate is held to the main foam body.",
                        "origin_ft": [float(a) for a in ctx.get("origin", (0.0, 0.0, 0.0))], "groups": [{k_: v for k_, v in g.items() if k_ not in ("shapes",)} for g in ctx["groups"]],
                        "plates": ctx["plates_json"]})
        add(p, "data.plates", "each floor plate: position, slope, thickness, area, how it is held up (branches), clear height above and below, openings through it")

    p = os.path.join(D["data"], "spaces.json")
    _write_json(p, {"schema": SCHEMA, "analysis_version": ANALYSIS_VERSION,
                    "note": "The void read as spaces (docs/DATA_FORMAT.md section 13). levels: floors found from foam with void on top (a ramp is one sloped level), each with the space above it. rooms: the void split at necks "
                            "(a distance peak must stand room_h_ft above the saddle to the next room); voxels/rooms.u8 holds each cell's room. connections: openings between rooms. routes: shortest ways through the void between "
                            "pairs of side faces. profile: void cross-section along the main route. daylight: floor cells with open sky or an open side face within lit_within_ft. openings: connected void on each tile face. "
                            "All lengths feet, areas ft2, volumes ft3, in tile coordinates (origin at the tile's low corner).",
                    "params": {"quant": QUANT, "room_h_ft": ROOM_H_FT, "min_room_ft3": MIN_ROOM_FT3, "min_link_ft2": MIN_LINK_FT2, "min_link_neck_ft": MIN_LINK_NECK_FT,
                               "level_min_frac": LEVEL_MIN_FRAC, "lit_ft": LIT_FT, "lit_cap_ft": LIT_CAP_FT, "opening_min_ft2": OPENING_MIN_FT2},
                    "cell_ft": cell, "levels": analysis["levels"], "rooms": analysis["rooms"], "connections": analysis["connections"], "graph": analysis["graph"],
                    "routes": analysis["routes"], "main_route": analysis["main_route"], "profile": analysis["profile"], "daylight": analysis["daylight"],
                    "openings": analysis["openings"]})
    add(p, "data.spaces", "the void as spaces: levels, rooms (kind, name, clear height, light), connections, routes through the void, cross-section profile, daylight, face openings")
    pj = {q["id"]: q for q in (ctx.get("plates_json") or [])}
    sp = []
    for q in analysis["structure"]["plates"]:
        e = dict(q)
        src = pj.get(q["id"])
        if src:
            e.update({k_: src[k_] for k_ in ("name", "slope_deg", "top_z_ft", "present") if k_ in src})
            if "thickness_ft" in src:
                e["designed_thickness_ft"] = src["thickness_ft"]
            if src.get("support"):
                e["support"] = {k_: src["support"][k_] for k_ in ("contact_area_ft2", "longest_unsupported_span_ft", "struts_added", "supported") if k_ in src["support"]}
            if src.get("space_above"):
                e["clear_above_ft"] = src["space_above"]["clear_height_ft"]
                e["clear_below_ft"] = src["space_below"]["clear_height_ft"]
        sp.append(e)
    st = dict(analysis["structure"])
    st["plates"] = sp
    p = os.path.join(D["data"], "structure.json")
    _write_json(p, {"schema": SCHEMA, "analysis_version": ANALYSIS_VERSION,
                    "note": "How the foam holds together and how it prints. foam_pieces / pieces: separate bodies (grounded = touches the bottom face, which prints on the bed). thin_share: share of the foam thinner than each wall thickness in feet. "
                            "overhang_area_ft2: foam facing down over void (needs support when printed). plates: each floor plate with whether it joins the grounded foam body. Multiply feet by the print scale to get millimetres.",
                    "cell_ft": cell, "structure": st})
    add(p, "data.structure", "foam pieces, thin-wall shares, overhang and bed contact (printability), and each plate's connection to the grounded foam")
    if ctx.get("foam_sm") is not None:
        write_drawings(D["vector/drawings"], add, void_bool, ctx["foam_sm"], ctx.get("plate_field"), analysis, cell, dims, name)

    # ---- tile.json, README, manifest ----
    p = os.path.join(root, "tile.json")
    _write_json(p, {"schema": SCHEMA, "id": tile_id, "name": name, "exported": datetime.datetime.now().isoformat(timespec="seconds"),
                    "engine_version": ENGINE_VERSION, "units": "feet", "coordinate_system": "X, Y horizontal, Z up, origin at the tile's low corner",
                    "tile_ft": dims, "cell_ft": cell, "grid": list(void_bool.shape), "frame_exported": ctx["frame"], "last_frame": ctx["last"],
                    "config": ctx["config"], "metrics": metrics, **_tile_extras(ctx, metrics)})
    add(p, "tile.json", "identity, the erosion settings used, and volume / area measurements")
    p = os.path.join(root, "recipe.json")
    with open(p, "w", encoding="utf-8") as f:
        f.write(ctx.get("recipe_text") or pretty_recipe(build_recipe(ctx["config"], name, tile_id, float(void_bool.sum()) * cell ** 3, ctx["frame"], ctx["last"])))
    add(p, "recipe", "the recipe: everything (container, floor plates, any starting mass, foam, sources, settings) needed to rebuild this exact tile with no Rhino geometry")
    readme = """EROSION TILE: %s   (id %s, schema %s)
Units are FEET. X and Y are horizontal, Z is up, origin at the tile's low corner. Tile %.0f x %.0f x %.0f ft, %.3f ft cells, %d x %d x %d voxels, erosion frame %d of %d.

Start with manifest.json: every file has a machine-readable ROLE, and every image carries its place in the tile (origin, u and v axes, pixels per foot).

  model/        one GLB for three.js (foam and void, metres, Y up; the manifest gives the matrix back to tile feet), plus <name>_parts.glb with the floor plates and branches when there are any.
  voxels/       raw binary grids [x][y][z], z fastest: index = (x*ny + y)*nz + z. void.u8, void_smooth.u8, material.u8, softness.u8.
                Join tiles by merging void_smooth and re-meshing, not by stacking the exported meshes (their faces are capped flat).
  data/         faces.json (each face's mask, depth, edges, outlines) and sections.json.
  images/       faces/ (colour, mask, depth, net), sections/ (colour + mask, contact sheets), projections/, thumbnail.png.
                Face images are seen from OUTSIDE the tile. Section images: X from -X (right = -Y), Y from -Y (right = +X), Z from above (right = +X, up = +Y). Masks: white = void.
  vector/       SVG drawings of the faces and sections, 1 inch = 1 foot.
  tile.json     identity, the erosion settings that made it, and volume / area measurements.
  recipe.json   the recipe: rebuilds this exact tile (container, floor plates, foam, sources, settings) with no Rhino geometry.
  data/plates.json   (when there are floor plates) each plate's position, slope, thickness, area, supports, clear height above and below, openings.
  voxels/mask.u8, plates.u8, struts.u8   (when used) the container, the floor plates and the support branches as grids. voxels/rooms.u8 = which room each void cell is in.
  data/spaces.json   the void read as spaces: levels, rooms, connections, routes, daylight, face openings. data/structure.json: foam pieces, thin walls, overhang (printability).
  vector/drawings/   poche plans (one per level) and sections as SVG, 1 inch = 10 feet: foam solid, plates blue, void white.
  model/<name>.glb        nodes foam (the whole solid) and void. model/<name>_parts.glb (when there are plates or branches): nodes plates and struts, parts of the foam.
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
        curves = [(ln, nm, rg.PolylineCurve([rg.Point3d(x + ox, y + oy, z + oz) for x, y, z in pts])) for ln, nm, pts in face_curves + sec_curves]
        for gname, pts in ctx.get("plate_curves") or []:
            curves.append(("plate_curves", gname, rg.PolylineCurve([rg.Point3d(x, y, z) for x, y, z in pts + [pts[0]]])))
        layers3 = [("foam", ctx["foam_mesh"], FOAM_RGB), ("void", ctx["void_mesh"], (200, 40, 55))]
        if ctx.get("container_kind") == "mass" and ctx.get("new_void_mesh") is not None:
            layers3.append(("new_erosion", ctx.get("new_void_mesh"), (255, 130, 25)))
        if ctx.get("plates_mesh") is not None:
            layers3.append(("floor_plates", ctx["plates_mesh"], (90, 110, 130)))
        if ctx.get("structure_mesh") is not None:
            layers3.append(("support_branches", ctx["structure_mesh"], (150, 150, 90)))
        if ctx.get("container_tri") is not None:
            cm = rg.Mesh()
            cV, cF = ctx["container_tri"]
            for x, y, z in np.asarray(cV).tolist():
                cm.Vertices.Add(x, y, z)
            for a, b, c in np.asarray(cF).tolist():
                cm.Faces.AddFace(int(a), int(b), int(c))
            cm.Normals.ComputeNormals()
            layers3.append(("container", cm, (120, 120, 120)))
        rp = os.path.join(ref, "%s.3dm" % name)
        msg = write_3dm(rp, layers3, curves)
        if msg == "":
            rhino_path = rp
        else:
            problems.append("3dm file skipped (%s)" % msg)
    except Exception as e:
        problems.append("3dm file skipped (%s: %s)" % (type(e).__name__, e))
    with open(os.path.join(ref, "recipe.json"), "w", encoding="utf-8") as f:
        f.write(ctx.get("recipe_text") or pretty_recipe(build_recipe(ctx["config"], name, tile_id, float(void_bool.sum()) * cell ** 3, ctx["frame"], ctx["last"])))
    if ctx.get("mass_text"):
        with open(os.path.join(ref, "mass.json"), "w") as f:
            f.write(ctx["mass_text"])
    with open(os.path.join(ref, "log.txt"), "w") as f:
        f.write(ctx["log"])
    ratio = float(ctx.get("print_ratio") or 0.0)
    print_note = ""
    if ratio > 0:
        try:
            pdir = os.path.join(ref, "print")
            os.makedirs(pdir, exist_ok=True)
            size_mm = None
            for part_, (pv_, pf_) in (("foam", ctx["foam_arrays"]), ("void", ctx["void_arrays"])):
                if pv_ is not None and len(pf_):
                    lo_, hi_ = write_stl(os.path.join(pdir, "%s_%s_1to%g.stl" % (name, part_, ratio)), pv_, pf_, ratio, part_)
                    if part_ == "foam":
                        size_mm = hi_ - lo_
            if size_mm is not None:
                print_note = "print files 1:%g (1 inch = %.1f ft): foam block %.0f x %.0f x %.0f mm, in %s" % (ratio, ratio / 12.0, size_mm[0], size_mm[1], size_mm[2], pdir)
        except Exception as e:
            problems.append("print files skipped (%s: %s)" % (type(e).__name__, e))
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

  %s.3dm    Rhino file, feet, Z up, in WORLD coordinates (it overlays your model): foam, void, new erosion, floor plates, support branches, the container, the plate curves, and the face and section outlines, on layers.
  recipe.json    the settings that rebuild this exact tile. Paste its text into a Panel wired to the engine's `recipe` input,
                 or type the path of this folder into `recipe`. The engine's log then says whether the tile matches (RECIPE CHECK).
  mass.json      the finished result (foam, voids, plates, branches) as text: paste it into a Panel wired to the NEXT engine's `mass_in` to carry on eroding from here.
  log.txt        the engine's log at the moment of export.
  timelapse/     one section image for every stored frame of the erosion (for animations), and frames.json with the void volume at each frame.
  print/         binary STL files (millimetres, Z up) at the print scale: foam (the physical block) and void (its negative). The `print_scale` input is the ratio: 120 = 1 inch per 10 feet (the default), 0 = off.
""" % (name, tile_id, name, SUFFIX_ANALYSIS, name))
    n_ref = sum(len(fs) for _, _, fs in os.walk(ref))
    lines = ["EXPORTED %d + %d files in %.1f s. One click, two folders:" % (n_analysis, n_ref, time.time() - t0),
             "  for the program: %s" % root,
             "  for you:         %s" % ref,
             "  id %s | void %.0f%% (%.0f ft3) in %d piece(s) | Rhino file: %s" % (tile_id, 100 * metrics["void_fraction"], metrics["void_volume_ft3"], metrics["void_pieces"],
                                                                              rhino_path if rhino_path else "not written")]
    if print_note:
        lines.append("  " + print_note)
    lines += ["  NOTE: " + x for x in problems]
    return root, ref, "\n".join(lines)


# ------------------------------------------------------------------ recipes and cleanup
def compute_tile_id(void_bool, config):
    """Same voxels + same settings = same id. Sources are normalised so re-typed JSON gives the same id. Settings that
    engine 7 added (plates, container, starting mass) only enter the id when they are used, so a plain 5f tile keeps its id."""
    cfg = {k: v for k, v in config.items() if not k.startswith("_") and not (k == "weld" and not v)}      # a blank weld leaves the id exactly as before
    cfg["sources"] = [json.dumps(json.loads(x) if isinstance(x, str) else x, sort_keys=True) for x in config.get("sources", [])]
    if cfg.get("plates"):
        cfg["plates"] = [json.dumps(json.loads(x) if isinstance(x, str) else x, sort_keys=True) for x in cfg["plates"]]
    else:
        cfg.pop("plates", None)
    return hashlib.sha1(np.asarray(void_bool).astype(np.uint8).tobytes() + json.dumps(cfg, sort_keys=True, default=_jdefault).encode()).hexdigest()[:16]


def build_recipe(config, name, tile_id, void_ft3, frame, last):
    """Everything needed to rebuild this tile from scratch, as a plain dict. Self-contained: the container (cube, box or the
    triangles of your geometry), the floor plates (curve points / triangles) and any starting mass are stored in it, so it
    rebuilds without any Rhino geometry."""
    r = {"schema": RECIPE_SCHEMA, "name": name, "engine_version": ENGINE_VERSION,
         "sim": {k: config[k] for k in RECIPE_FIELDS},
         "cleanup": {"min_void_ft3": config.get("min_void_ft3", 0.0), "min_foam_ft3": config.get("min_foam_ft3", 0.0), "weld": config.get("weld", "")},
         "foam": config["foam"],
         "sources": [json.loads(x) if isinstance(x, str) else x for x in config["sources"]]}
    if config.get("_meta"):
        r["meta"] = config["_meta"]
    if config.get("_container"):
        r["container"] = config["_container"]
    if config.get("plates"):
        r["plates"] = [json.loads(x) if isinstance(x, str) else x for x in config["plates"]]
    if config.get("_start"):
        r["start"] = config["_start"]
    r["frame"] = None if frame == last else int(frame)
    r["expect"] = {"tile_id": tile_id, "void_ft3": round(float(void_ft3), 1), "frame": int(frame), "last_frame": int(last)}
    return r


def pretty_recipe(r):
    """One setting per line, one source / plate group per line: easy to read and edit in a Panel."""
    keys = list(r.keys())
    out = ["{"]
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        v = r[k]
        if k in ("sources", "plates") and v:
            out.append('  "%s": [' % k)
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
    # engine 7: a recipe also fixes the container, the floor plates and any starting mass (and blanks the live inputs)
    ov["container"] = d.get("container")
    ov["plates"] = [x if isinstance(x, str) else json.dumps(x) for x in (d.get("plates") or [])]
    ov["mass_in"] = json.dumps(d["start"], separators=(",", ":")) if d.get("start") else None
    ov["geo"] = None
    return ov, d, warns


def cleanup_material(M, mask, cell, min_void, min_foam, protected=None):
    """Remove specks from the finished material field. SEALED void pockets under min_void ft3 are filled with foam and
    FLOATING foam pieces under min_foam ft3 are dissolved. Anything that touches a tile face (or the outer skin of the
    geometry) is left alone, because it may carry on into the next tile; so is anything holding a protected cell
    (a floor plate). Returns (material, info); the input is never modified."""
    info = {"pockets": 0, "pockets_ft3": 0.0, "pieces": 0, "pieces_ft3": 0.0}
    if min_void <= 0 and min_foam <= 0:
        return M, info
    M2 = np.array(M, copy=True)
    cv = cell ** 3
    prot = protected if (protected is not None and protected.any()) else None
    skin = None if mask.all() else (ndimage.binary_dilation(~mask, STRUCT6) & mask)

    def touching(lab, n):
        t = np.zeros(n + 1, bool)
        for f in VIEWS:
            t[np.unique(face_layer(lab, f))] = True
        if skin is not None:
            t[np.unique(lab[skin])] = True
        if prot is not None:
            t[np.unique(lab[prot])] = True
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
    foam_given = foam_raw is not None
    axis = int(np.clip(int(_inp("slice_axis", 1)), 0, 2))
    view = int(_inp("view", 0))
    if not all(math.isfinite(v) and v > 0 for v in (tile_w, tile_h, cell_req)):
        raise ValueError("tile_w, tile_h and cell must be finite and positive.")

    # ---- the block of foam: a wired mass, else the recipe's container, else your geometry, else a cube ----
    mass_in = read_mass(_inp("mass_in", None))
    container_spec = _inp("container", None)
    geo_raw = _inp("geo", None)
    origin = (0.0, 0.0, 0.0)
    tri = None                       # (V, F) triangles of the container, for the recipe and the Rhino file
    container_rec = None             # what the recipe stores for the container
    if mass_in is not None:
        if container_spec or _as_list(geo_raw):
            warnings.append("NOTE: a mass_in is wired in, so geo / container are ignored; the mass already holds the block.")
        cell, shape, mask, origin = mass_in["cell"], mass_in["shape"], mass_in["mask"], mass_in["origin"]
        if not foam_given and mass_in["foam"]:
            foam_raw = mass_in["foam"]
    elif container_spec:
        cont = container_from_spec(container_spec, cell_req, warnings)
        cell, shape, mask, origin = cont["cell"], cont["shape"], cont["mask"], cont["origin"]
        container_rec = container_spec
        if container_spec.get("kind") == "mesh":
            tri = (np.array(container_spec["v"], dtype=float), np.array(container_spec["f"], dtype=np.int64))
        elif container_spec.get("kind") == "box":
            lo_ = [float(a) for a in container_spec.get("min", [0.0, 0.0, 0.0])]
            tri = box_mesh(lo_, [lo_[a] + float(container_spec["size"][a]) for a in range(3)])
    elif _as_list(geo_raw):
        V_, F_ = geo_to_triangles(geo_raw, warnings, "geo")
        cont = container_from_triangles(V_, F_, cell_req, warnings)
        cell, shape, mask, origin = cont["cell"], cont["shape"], cont["mask"], cont["origin"]
        container_rec = container_record(cont, V_, F_)
        tri = (V_, F_)
    else:
        # ---- snap the grid so cells fit the tile evenly (a plain cube, exactly as in 5f) ----
        nx_ = max(4, int(round(tile_w / cell_req)))
        cell = tile_w / nx_
        nz_ = max(4, int(round(tile_h / cell)))
        shape = (nx_, nx_, nz_)
        mask = container_mask(shape, "cube")
    foam = parse_foam(foam_raw)
    nx, ny, nz = shape
    dims = (nx * cell, ny * cell, nz * cell)
    n_cells = nx * ny * nz
    if n_cells > 2000000:
        return ("TOO MANY CELLS: %d. Increase 'cell' (bigger cells) and try again." % n_cells,) + (None,) * 13
    maskf = mask.astype(np.float32)

    max_frames = max(1, int(MAX_FRAME_BYTES / (8.0 * n_cells)))
    n_frames = min(n_frames_req, max_frames)
    if n_frames < n_frames_req:
        warnings.append("NOTE: n_frames lowered to %d to keep memory in check at this cell size." % n_frames)

    # ---- read the sources (positions are world coordinates; the grid starts at `origin`) ----
    items = _as_list(_inp("sources", None))
    if not items and mass_in is None:
        items = [json.dumps({"v": 1, "mode": "inject", "kind": "pt", "pt": [origin[a] + dims[a] / 2.0 for a in range(3)],
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
        if sp["kind"] == "pt":
            sp["pt"] = [float(sp["pt"][a]) - origin[a] for a in range(3)]
        else:
            sp["pts"] = [[float(p[a]) - origin[a] for a in range(3)] for p in sp["pts"]]
        if sp["kind"] == "pt":                     # keep single points inside the block
            x, y, z = sp["pt"]
            cx, cy, cz = min(max(x, 0.0), dims[0]), min(max(y, 0.0), dims[1]), min(max(z, 0.0), dims[2])
            if sp["mode"] == SPRAY and sp.get("dir") is not None:
                cx, cy, cz = x, y, z               # an aimed spray's nozzle is meant to sit outside
            elif (cx, cy, cz) != (x, y, z):
                warnings.append("NOTE: source %d (%.1f, %.1f, %.1f) is outside the block; moved to the nearest edge." % (i, x + origin[0], y + origin[1], z + origin[2]))
            sp["pt"] = [cx, cy, cz]
        if sp["start"] >= steps and steps > 0:
            warnings.append("NOTE: source %d starts at step %d, after the run ends (%d steps), so it does nothing." % (i, sp["start"], steps))
        specs.append(sp)
    combos = sorted(set((sp["plate_mode"], bool(sp["cut"])) for sp in specs)) or [(POOL, False)]
    if len(combos) > MAX_SPECIES:
        raise ValueError("more than %d different (plate_mode, cut) combinations among the sources." % MAX_SPECIES)
    for sp in specs:
        sp["gid"] = combos.index((sp["plate_mode"], bool(sp["cut"])))

    # ---- floor plates: inherited from a mass, plus the new groups wired in ----
    plate_items = _as_list(_inp("plates", None))
    groups, plates = [], []
    pid = np.zeros(shape, np.int32)
    struts0 = np.zeros(shape, bool)
    if mass_in is not None:
        groups = [dict(g) for g in mass_in["groups"]]
        plates = list(mass_in["plates"])
        pid = mass_in["pid"].copy()
        struts0 = mass_in["struts"].copy()
    new_cells = np.zeros(shape, bool)
    if plate_items:
        new_groups = [parse_plate_group(it, i) for i, it in enumerate(plate_items)]
        first_id = max([p["id"] for p in plates] or [0]) + 1
        new_plates = build_plates(new_groups, len(groups), first_id, origin, shape, cell, mask, warnings)
        rasterize_plate_ids(new_plates, pid, shape, cell, mask, warnings)
        new_cells = (pid >= first_id) & (pid > 0)
        groups.extend(new_groups)
        plates.extend(new_plates)
    plates = [p for p in plates if (pid == p["id"]).any()]
    has_plates = bool(plates)
    psim = plate_sim_context(pid, plates, shape, cell, mask) if has_plates else None
    M0 = None
    if mass_in is not None:
        M0 = np.asarray(mass_in["M"], dtype=np.float32) * maskf
        M0[new_cells & mask] = 1.0

    # ---- run (or reuse) the simulation ----
    def skey(sp):
        return (sp["kind"], sp["mode"], tuple(round(c, 4) for c in sp["pt"]) if sp["kind"] == "pt"
                else tuple(tuple(round(c, 3) for c in p) for p in sp["pts"]),
                round(sp["dose"], 6), round(sp["spread"], 6), round(sp["start"], 6), round(sp["dur"], 6),
                tuple(round(c, 4) for c in sp["dir"]) if sp.get("dir") else None, sp["plate_mode"], bool(sp["cut"]))

    fkey = (round(foam["noise"], 6), round(foam["scale"], 6), round(foam["grain"], 6), foam["seed"],
            round(foam["web"], 6), round(foam["web_open"], 6), round(foam["web_thickness"], 6), foam["layers"],
            foam["layer_count"], foam["layer_axis"], round(foam["layer_thickness"], 6), round(foam["layer_strength"], 6))
    plate_key = _digest(pid.tobytes(), json.dumps([{k: v for k, v in g.items() if k != "shapes"} for g in groups], sort_keys=True, default=_jdefault),
                        *[p["top"].tobytes() + p["bot"].tobytes() for p in plates])
    key = (shape, round(cell, 6), steps, round(gravity, 6), drain, n_frames, seed, fkey,
           tuple(skey(sp) for sp in specs), _digest(mask.tobytes()), tuple(round(o, 6) for o in origin), plate_key,
           _digest(M0.tobytes()) if M0 is not None else None)
    infos = []

    def build():
        rng = np.random.default_rng(seed)
        srcs = []
        for sp in specs:
            W, info, disp = build_source(shape, cell, mask, sp, dims, rng)
            if has_plates and sp["plate_mode"] != THROUGH and not sp["cut"]:
                W[pid > 0] = 0.0                    # this acetone cannot enter a plate, so none lands inside one
            srcs.append((W, sp["start"], sp["dur"], sp["gid"]))
            infos.append((info, disp, float(W.sum()), float(W.max())))
        rho_f, Pm_f = make_foam_fields(shape, cell, dims, mask, foam)
        if has_plates:
            halo = anchor_factor(pid, plates, groups, shape, cell, mask)       # resistant foam where a plate meets the foam
            rho_f = rho_f * halo
            Pm_f = Pm_f / np.sqrt(halo)
            res = np.ones(shape, np.float32)
            for p in plates:
                res[pid == p["id"]] = groups[p["group"]]["resistance"]
            pc = pid > 0                                                       # plates follow the foam fields, times their own resistance
            rho_f[pc] = rho_f[pc] * res[pc]
            Pm_f[pc] = Pm_f[pc] / np.sqrt(res[pc])
        Ms, Cs = simulate(mask, srcs, steps, gravity, density=rho_f, perm_mult=Pm_f, cell=cell, n_frames=n_frames, drain=drain,
                          initial_material=M0, plate=psim, groups=combos)
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
    C = Cs[frame]
    min_void = max(0.0, float(_inp("min_void", 0.0)))
    min_foam = max(0.0, float(_inp("min_foam", 0.0)))

    # ---- finish one frame: plate columns kept or removed whole, specks cleaned, plates held up ----
    posted = {}

    def post(fr):
        if fr in posted:
            return posted[fr]
        Mf = Ms[fr]
        kept_ = {}
        if has_plates:
            Mf, kept_ = apply_column_rule(Mf, plates, pid)
        prot = ((pid > 0) & (Mf >= VOID_LEVEL)) if has_plates else None
        M2, ci = cleanup_material(Mf, mask, cell, min_void, min_foam, prot)
        struts_, srep_ = struts0, []
        if has_plates:
            sw = []
            M2, struts_, srep_ = support_pass(M2, mask, pid, plates, groups, cell, np.random.default_rng(seed + 31), sw, struts0)
            for w in sw:
                if w not in warnings:
                    warnings.append(w)
        posted[fr] = (M2, struts_, kept_, srep_, ci)
        return posted[fr]

    M, struts, kept, srep, cinfo = post(frame)
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

    # ---- slice preview (slice_pos is a world coordinate) ----
    slice_default = origin[axis] + dims[axis] / 2.0
    slice_pos = float(_inp("slice_pos", slice_default))
    A = M if view == 0 else (C if view == 1 else S_field)
    k = int(np.clip(int((slice_pos - origin[axis]) / cell), 0, shape[axis] - 1))
    section = build_slice_mesh(A, axis, k, cell, view, float(C.max()), origin)
    slice_void = int(np.count_nonzero(np.take((M < VOID_LEVEL) & mask, k, axis=axis)))
    if void_cells > 0 and slice_void == 0:
        warnings.append("NOTE: this slice does not cut through any void, so it looks solid. Move slice_pos toward a source.")
    if void_cells == 0 and frame == last:
        warnings.append("NOTE: nothing eroded. Raise a dose, lower a spread, or check that the sources are inside the block.")

    # ---- smooth meshes. Plates are taken out of the foam body before it is smoothed and put back as their EXACT shape,
    #      so a plate's top and bottom stay true planes while everything else is smoothed ----
    t1 = time.time()
    body = M.copy()
    Pk = None
    if has_plates:
        body[pid > 0] = 0.0
        Pk = plate_field(plates, kept, shape, cell, mask)
    void_field = np.clip(1.0 - body, 0.0, 1.0) * maskf
    foam_field = np.clip(body, 0.0, 1.0) * maskf
    void_sm = smooth_field(void_field, smooth)
    cleaned_sm = False
    weld = "".join(sorted(set(ch for ch in str(_inp("weld", "")).lower() if ch in "xyz")))
    if weld:                                            # make opposite faces match so copies interlock exactly
        void_sm = (weld_faces(void_sm, weld, cell) * maskf).astype(np.float32)
        cleaned_sm = True
    if min_void > 0 or min_foam > 0:                    # second pass on the smoothed field: smoothing can cut a thin bridge and leave a floater
        Fin = (1.0 - void_sm) if Pk is None else np.maximum(1.0 - void_sm, Pk)
        F2, c2 = cleanup_material(Fin, mask, cell, min_void, min_foam, None if Pk is None else (Pk >= 0.5))
        if c2["pockets"] or c2["pieces"]:
            void_sm = ((1.0 - F2) * maskf).astype(np.float32)
            cleaned_sm = True
            cinfo = {k_: cinfo[k_] + c2[k_] for k_ in cinfo}
    if Pk is not None:
        void_sm = (np.minimum(void_sm, 1.0 - Pk) * maskf).astype(np.float32)
    if cleaned_sm:
        foam_sm = ((1.0 - void_sm) * maskf).astype(np.float32)
    else:
        foam_sm = smooth_field(foam_field, smooth)
        if Pk is not None:
            foam_sm = np.maximum(foam_sm, Pk).astype(np.float32)
    vv, vf, void_mesh_vol = field_to_arrays(void_sm, cell, smooth, presmoothed=True)
    fv, ff, foam_mesh_vol = field_to_arrays(foam_sm, cell, smooth, presmoothed=True)
    void_mesh = arrays_to_mesh(vv, vf, origin)
    foam_mesh = arrays_to_mesh(fv, ff, origin)
    plates_mesh = structure_mesh = plates_arr = struts_arr = None
    if Pk is not None and (Pk >= 0.5).any():
        plates_arr = tuple(field_to_arrays(Pk, cell, 0, presmoothed=True)[:2])
        plates_mesh = arrays_to_mesh(*plates_arr, origin=origin)
    if struts.any():
        struts_arr = tuple(field_to_arrays(smooth_field(struts.astype(np.float32), smooth), cell, 0, presmoothed=True)[:2])
        structure_mesh = arrays_to_mesh(*struts_arr, origin=origin)
    baseline = maskf if M0 is None else np.clip(M0, 0.0, 1.0) * maskf
    new_void_mesh = arrays_to_mesh(*field_to_arrays(np.minimum(baseline, void_sm).astype(np.float32), cell, 0, presmoothed=True)[:2], origin=origin)
    try:
        cut_side = int(np.sign(int(_inp("cutaway", 0) or 0)))
    except (TypeError, ValueError):
        cut_side = 0
    preview_mesh = build_preview_mesh(fv, ff, cell, origin, mask, Pk, struts, axis, float(_inp("slice_pos", origin[axis] + dims[axis] / 2.0)), cut_side)
    t_mesh = time.time() - t1

    # ---- the tile as data (voxels + face footprints + every setting) ----
    void_bool = (void_sm >= 0.5) & mask
    config = {"tile_w": tile_w, "tile_h": tile_h, "cell": cell_req, "steps": steps, "gravity": gravity, "drain": bool(drain),
              "n_frames": n_frames, "frame": frame, "smooth": smooth, "seed": seed,
              "sources": [it if isinstance(it, str) else json.dumps(it) for it in items], "foam": foam,
              "min_void_ft3": min_void, "min_foam_ft3": min_foam, "weld": weld}
    if plate_items:
        config["plates"] = [it if isinstance(it, str) else json.dumps(it) for it in plate_items]
    if container_rec is not None:
        config["container"] = _digest(mask.tobytes(), json.dumps([round(o, 6) for o in origin]), repr(round(cell, 9)))
        config["_container"] = container_rec
    if mass_in is not None:
        config["start"] = _digest(json.dumps(mass_in["raw"], sort_keys=True))
        config["_start"] = mass_in["raw"]
    cfg_pub = {k_: v for k_, v in config.items() if not k_.startswith("_") and k_ != "plates"}
    if plate_items:
        cfg_pub["plates"] = []
        for g in groups[len(groups) - len(plate_items):]:
            gs = {k_: v for k_, v in g.items() if k_ != "shapes"}
            gs["shape_count"] = len(g["shapes"])
            cfg_pub["plates"].append(gs)
    if container_rec is not None:
        cfg_pub["container"] = {"kind": container_rec.get("kind"), "origin_ft": [round(float(o), 4) for o in origin], "shape": list(shape)}
    tile_data = make_tile_data(void_bool, cell, dims, frame, cfg_pub)
    tile_name = _inp("tile_name", None) or (recipe_dict or {}).get("name") or "tile"
    tile_name = str(tile_name)
    meta = dict((recipe_dict or {}).get("meta") or {})
    for k_ in ("category", "typology", "variant"):
        v_ = _inp(k_, None)
        if v_ not in (None, ""):
            meta[k_] = str(v_)
    if meta:
        config["_meta"] = meta
    tile_id = compute_tile_id(void_bool, config)
    recipe_text = pretty_recipe(build_recipe(config, tile_name, tile_id, float(void_bool.sum()) * cell ** 3, frame, last))
    plates_json = plate_report(plates, groups, kept, srep, void_bool, cell, origin) if has_plates else []
    pid_out = pid.copy()                              # plate ids of the cells of plates that survived (removed columns drop out)
    for p in plates:
        kc = kept.get(p["id"])
        if kc is not None:
            pid_out[(pid == p["id"]) & ~kc[:, :, None]] = 0
    Mlast, struts_last = post(last)[:2]
    mass_text = make_mass(Mlast, mask, origin, cell, pid, plates, groups, struts_last, foam)
    recipe_lines = []
    if recipe_dict is not None:
        exp = recipe_dict.get("expect") or {}
        recipe_lines.append("RECIPE: '%s' is wired in and replaces: %s. (Sliders wired into those inputs are ignored; unwire the recipe to use them.)" % (
            recipe_dict.get("name") or "unnamed", ", ".join(sorted(k_ for k_ in _RECIPE if k_ != "frame"))))
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

    # ---- block outline + source markers (world coordinates) ----
    box = rg.Box(rg.Plane.WorldXY, rg.Interval(origin[0], origin[0] + dims[0]), rg.Interval(origin[1], origin[1] + dims[1]), rg.Interval(origin[2], origin[2] + dims[2]))
    outline = [e.DuplicateCurve() for e in box.ToBrep().Edges]
    for p_ in layer_positions(foam, dims):
        ax_ = foam["layer_axis"]
        a_, b_ = [i for i in range(3) if i != ax_]
        corners = []
        for (u_, v_) in ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0)):
            c_ = [0.0, 0.0, 0.0]
            c_[ax_], c_[a_], c_[b_] = p_, u_ * dims[a_], v_ * dims[b_]
            corners.append(rg.Point3d(c_[0] + origin[0], c_[1] + origin[1], c_[2] + origin[2]))
        try:
            outline.append(rg.PolylineCurve(corners))
        except Exception:
            outline.extend(rg.LineCurve(x, y) for x, y in zip(corners[:-1], corners[1:]))
    src_out = [rg.Point3d(float(inf[1][0]) + origin[0], float(inf[1][1]) + origin[1], float(inf[1][2]) + origin[2]) for inf in infos]

    n_src = len(specs)
    if foam["layers"] and foam["layer_count"] > 0 and foam["layer_thickness"] < 0.5 * cell:
        warnings.append("NOTE: layer_thickness %.2f ft is under half a cell (%.2f ft), so the layers are faint. Raise it or use smaller cells." % (foam["layer_thickness"], cell))
    if foam["layers"] and foam["layer_count"] > 0 and (dims[foam["layer_axis"]] / (foam["layer_count"] + 1.0)) < 2.0 * foam["layer_thickness"]:
        warnings.append("NOTE: the layers are so close together that they nearly touch. Lower layer_count or layer_thickness.")
    for r_ in srep:
        if r_["present"] and not r_["supported"]:
            warnings.append("NOTE: plate %d ('%s') is not fully held up (contact %.1f ft2, span %s ft)%s." % (
                r_["id"], r_["name"], r_["contact_ft2"], r_["span_ft"], "; " + r_["notes"][-1] if r_["notes"] else ""))
        elif not r_["present"]:
            warnings.append("NOTE: plate %d ('%s') was eroded away completely." % (r_["id"], r_["name"]))
    _notify("frame %d/%d | %.0f ft3 | %.1f%% void | %d src | %s%s%s%s" % (
                frame, last, void_mesh_vol, 100.0 * void_mesh_vol / max(block_ft3, 1e-9), n_src, "drain" if drain else "pool",
                " | noise %.2f" % foam["noise"] if foam["noise"] > 0 else "",
                " | %d layers" % foam["layer_count"] if (foam["layers"] and foam["layer_count"] > 0) else "",
                " | %d plate(s), %d branch(es)" % (len(plates), sum(r_["struts"] for r_ in srep)) if has_plates else ""),
            [w for w in warnings if w.startswith("NOTE")])
    log_lines = warnings + recipe_lines + [
        "FRAME: %d of %d" % (frame, last),
        "GRID: %d x %d x %d = %d cells,  CELL: %.3f ft (%.2f in)" % (nx, ny, nz, n_cells, cell, cell * 12.0),
        "TILE: %.2f' x %.2f' x %.2f' (%s), foam block %.0f ft3, origin (%.2f, %.2f, %.2f)" % (
            dims[0], dims[1], dims[2], "from a mass" if mass_in is not None else ("geometry" if container_rec is not None else "cube"), block_ft3, origin[0], origin[1], origin[2]),
        "SIMULATION: %s (%.2f s), STEPS: %d, SEED: %d, GRAVITY: %.2f, BOTTOM: %s"
        % ("reused from cache" if cached else "ran", t_sim, steps, seed, gravity, "DRAIN (solvent falls out)" if drain else "POOL"),
        "MESHING: %.2f s, smooth = %.2f cells" % (t_mesh, smooth),
        "VOID: %.0f ft3 smooth mesh (%.0f ft3 counted in voxels) = %.1f%% of block, total dose %.0f ft3"
        % (void_mesh_vol, void_ft3, 100.0 * void_mesh_vol / max(block_ft3, 1e-9), total_dose),
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
        % ("XYZ"[axis], k, shape[axis], (k + 0.5) * cell + origin[axis], ("material", "solvent", "foam density")[min(view, 2)], slice_void),
    ]
    if has_plates:
        log_lines.append("PLATES: %d plate(s) in %d group(s); %d branch(es) grown. Solvents: %s" % (
            len(plates), len(groups), sum(r_["struts"] for r_ in srep),
            ", ".join("%s%s" % (PLATE_MODE_LABEL[m_], "+cut" if c_ else "") for m_, c_ in combos)))
        for pj in plates_json:
            if pj["present"]:
                sp_ = pj.get("support", {})
                log_lines.append("  PLATE %d '%s': %.0f of %.0f ft2 kept, top z %.2f..%.2f, slope %.1f deg | contact %.1f ft2, span %s ft, %d branch(es), %s | clear above %.1f ft (mean), below %.1f ft" % (
                    pj["id"], pj["name"], pj["area_ft2"], pj["original_area_ft2"], pj["top_z_ft"]["min"], pj["top_z_ft"]["max"], pj["slope_deg"],
                    sp_.get("contact_area_ft2", 0.0), sp_.get("longest_unsupported_span_ft"), sp_.get("struts_added", 0),
                    "HELD UP" if sp_.get("supported") else "NOT fully held", pj["space_above"]["clear_height_ft"]["mean"], pj["space_below"]["clear_height_ft"]["mean"]))
    log_lines += ["SOURCE %d: %s | dose %.0f ft3, spread %.1f ft, start %.0f, duration %.0f | plates: %s%s"
                  % (i, infos[i][0], specs[i]["dose"], specs[i]["spread"], specs[i]["start"], specs[i]["dur"],
                     PLATE_MODE_LABEL[specs[i]["plate_mode"]], " + cut" if specs[i]["cut"] else "") for i in range(n_src)]
    log = "\n".join(log_lines)
    # ---- one-click export ----
    base_dir = _inp("export_dir", None)
    base_dir = str(base_dir).strip() if base_dir not in (None, "") else None
    export_log, export_path = "", None
    if _truthy(_inp("export", False)):
        try:
            root_a, root_r, export_log = export_bundle(dict(
                void_sm=void_sm, void_bool=void_bool, M=M, Ms=Ms, density_field=S_field, cell=cell, dims=dims, config=cfg_pub,
                tile_data=tile_data, log=log, void_arrays=(vv, vf), foam_arrays=(fv, ff), void_mesh=void_mesh, foam_mesh=foam_mesh,
                section_count=int(_inp("section_count", 9)), slice_axis=axis, slice_k=k, smooth=smooth, base_dir=base_dir,
                name=tile_name, frame=frame, last=last, mask=mask, tile_id=tile_id, recipe_text=recipe_text,
                origin=origin, mass_text=mass_text, plates=plates, groups=groups, plates_json=plates_json, pid=pid_out, struts=struts,
                plates_mesh=plates_mesh, structure_mesh=structure_mesh, new_void_mesh=new_void_mesh, container_tri=tri,
                plates_arrays=plates_arr, struts_arrays=struts_arr, foam_sm=foam_sm, plate_field=Pk, meta=meta,
                print_ratio=float(_inp("print_scale", PRINT_RATIO_DEFAULT) or 0.0),
                container_kind=("mass" if mass_in is not None else ("geometry" if container_rec is not None else "cube")),
                plate_curves=[(g["name"], s["pts"]) for g in groups for s in g["shapes"] if s.get("type") == "poly"]))
            export_path = [root_a, root_r]
            _notify("exported: %s" % os.path.basename(root_a), [])
        except Exception as e:
            export_log = "EXPORT FAILED: %s: %s" % (type(e).__name__, e)
            _notify("export failed", ["NOTE: " + export_log])
    else:
        dest = os.path.join(base_dir or os.path.join(os.path.expanduser("~"), "Documents", "Erosion Exports"), _safe_name(tile_name))
        export_log = ("Export is idle. Wire a Button to `export` and click it. One click writes two folders:\n"
                      "  for the program: %s\n  for you (Rhino file, recipe, mass, log): %s") % (dest + SUFFIX_ANALYSIS, dest + SUFFIX_REFERENCE)
    return log, section, void_mesh, foam_mesh, outline, src_out, tile_data, export_log, export_path, recipe_text, mass_text, plates_mesh, structure_mesh, new_void_mesh, preview_mesh


log, section, void_mesh, foam_mesh, outline, src_pt_out, tile_data, export_log, export_path, recipe_text, mass, plates_mesh, structure_mesh, new_void_mesh, preview_mesh = run()


