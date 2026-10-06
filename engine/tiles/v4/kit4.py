"""Helpers for the V4 tile set (a second, deliberate set: see docs/TILE_SET_V4.md). Builds on kit.py and organic.py of the first set.

What is new here, and why:
  * containers that are not cubes (a notch in plan, a step in section, a slot): `container_xy`, `container_xz`, `container_yz` take a profile and extrude it,
    so a tile can leave room for a neighbour (outside-the-container cells belong to nobody);
  * floors at the family datums (D0 = 1 ft, D1 = 11 ft, D2 = 21 ft ...) as plates that are protected foam with flat tops;
  * REAL level changes: `stair` / `ramp` slabs (a tilted plate whose top is an exact plane; each 0.5 ft cell column rises at most one cell) and `seating`
    (terraces whose risers are far over a step, so they can never be the way up: a separate aisle stair is the route);
  * doorways with a floor: `door` carves a portal through a face at a given floor, so two tiles that agree on the datums meet floor to floor;
  * `Tile` collects plates and sources, `recipe4` writes the engine recipe.
All dimensions are feet, Z up, the tile's low corner at (0, 0, 0).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from kit import *  # noqa: F401,F403,E402
import kit as _kit  # noqa: E402
from organic import *  # noqa: F401,F403,E402

# ---- the V4 family datums ------------------------------------------------------------------------------------------------------------------
D0 = 1.0     # ground floor top
D1 = 11.0    # upper floor top (a 10 ft storey)
D2 = 21.0    # third floor top (a tall lobby)
D3 = 31.0
STOREY = 10.0
SLAB0 = 1.0  # thickness of the ground slab
SLAB = 1.5   # thickness of an upper floor
PORT_W = 6.0   # standard doorway: clear width ...
PORT_H = 8.0   # ... and clear height above the floor, ft (the tested minimum is 2.5 ft x 6.5 ft; this leaves margin)
SOFT = dict(noise=0.55, scale=3.6, grain=0.22)   # the same eroded foam as the first set


def floor_top(level):
    return [D0, D1, D2, D3][level]


# ---- containers (profiles are closed polygons) ------------------------------------------------------------------------------------------------
def _closed(prism):
    return {"kind": "mesh", "v": prism["v"], "f": prism["f"]}


def prism_xy(profile, z0, z1):
    """Closed mesh: a profile in (x, y) extruded between z0 and z1."""
    n = len(profile)
    V = [[round(float(x), 4), round(float(y), 4), float(z0)] for x, y in profile] + [[round(float(x), 4), round(float(y), 4), float(z1)] for x, y in profile]
    F = []
    for i in range(n):
        j = (i + 1) % n
        F += [[i, j, n + j], [i, n + j, n + i]]
    for t in triangulate(profile):
        F.append([t[0], t[2], t[1]])
        F.append([n + t[0], n + t[1], n + t[2]])
    return {"type": "mesh", "v": V, "f": F}


def container_xy(profile, z0=0.0, z1=20.0):
    """A container whose plan is `profile` [(x, y), ...] and whose height runs z0..z1 (an L, a T, a bar)."""
    return _closed(prism_xy(profile, z0, z1))


def container_xz(profile, y0=0.0, y1=20.0):
    """A container whose section along y is `profile` [(x, z), ...] extruded y0..y1 (a step, a slot, a stepped terrace)."""
    return _closed(prism_xz(profile, y0, y1))


def container_yz(profile, x0=0.0, x1=20.0):
    return _closed(prism_yz(profile, x0, x1))


def box_container(size, lo=(0.0, 0.0, 0.0)):
    return {"kind": "box", "min": list(map(float, lo)), "size": list(map(float, size))}


def L_plan(w=20.0, d=20.0, notch=10.0, corner="ne"):
    """Plan of an L: the w x d footprint minus a notch x notch square at `corner` (ne, nw, se, sw)."""
    n = notch
    pts = {
        "ne": [(0, 0), (w, 0), (w, d - n), (w - n, d - n), (w - n, d), (0, d)],
        "nw": [(0, 0), (w, 0), (w, d), (n, d), (n, d - n), (0, d - n)],
        "se": [(0, 0), (w - n, 0), (w - n, n), (w, n), (w, d), (0, d)],
        "sw": [(n, 0), (w, 0), (w, d), (0, d), (0, n), (n, n)],
    }[corner]
    return pts


# ---- plates -------------------------------------------------------------------------------------------------------------------------------
def floor_plate(x0, y0, x1, y1, top, thick=SLAB):
    """A flat floor: a rectangle whose TOP is at `top`, extruded down by the group's thickness (rectangles are `slab`s)."""
    return rect_slab(x0, y0, x1, y1, top)


def floor_poly(pts_xy, top):
    return slab([[x, y, top] for x, y in pts_xy])


def stair_slab(x0, x1, y0, y1, z0, z1, axis="y"):
    """A sloped slab = a stair or ramp: its top is the plane through z0 at the start and z1 at the end of the run (axis 'y': the run goes from
    y0 to y1 and the slab spans x0..x1; axis 'x': from x0 to x1 spanning y0..y1). Each 0.5 ft column rises at most one cell when the slope is
    at most 1 : 1. A walking stair wants risers of 0.5 ft (slope up to ~0.7); anything steeper is not a stair."""
    if axis == "y":
        pts = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]]
    else:
        pts = [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]]
    return slab(pts)


def seating(x0, x1, y_from, treads, rises, depth, base=D0, direction=1, under=0.0):
    """Seating terraces as solid boxes (a stepped solid mass): tread i is a box from `under` (default the ground) up to its top, `depth` ft deep, rising
    by `rises` (a list or one number) per tread, going in +y (direction 1) or -y. The risers are far bigger than a step: seats and steps to sit on, never
    the way up. Returns a list of box shapes."""
    out = []
    y = y_from
    z = base
    for i in range(treads):
        r = rises[i] if isinstance(rises, (list, tuple)) else rises
        z += r
        ya, yb = (y, y + depth) if direction == 1 else (y - depth, y)
        out.append(box((x0, ya, under), (x1, yb, z)))
        y = yb if direction == 1 else ya
    return out


# ---- carving ------------------------------------------------------------------------------------------------------------------------------
def _line_len(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def tunnel(pts, spread, plate_mode="pool", cut=False, k=0.8, smooth=True):
    """A straight or curved passage through the points (a source line); the spread is the width (radius ~0.85 x spread)."""
    return passage(pts, spread, plate_mode=plate_mode, cut=cut, k=k) if smooth else src_line(pts, dose_for(spread, _line_len(pts), k), spread, plate_mode, cut)


def room_box(x0, y0, x1, y1, zc, spread, axis="x", k=1.0, plate_mode="pool", cut=False, step=None):
    """A flat-floored room filling a box in plan: parallel tunnels at height zc spaced about spread*1.1 apart. axis 'x': tunnels run along x."""
    step = step or spread * 1.15
    out = []
    if axis == "x":
        n = max(1, int(math.ceil((y1 - y0) / step)))
        for i in range(n):
            y = y0 + (y1 - y0) * (i + 0.5) / n
            out.append(src_line([(x0, y, zc), (x1, y, zc)], dose_for(spread, x1 - x0, k), spread, plate_mode, cut))
    else:
        n = max(1, int(math.ceil((x1 - x0) / step)))
        for i in range(n):
            x = x0 + (x1 - x0) * (i + 0.5) / n
            out.append(src_line([(x, y0, zc), (x, y1, zc)], dose_for(spread, y1 - y0, k), spread, plate_mode, cut))
    return out


def door(face, u, floor, spread=4.8, depth=6.0, plate_mode="pool", k=1.2, size=None):
    """A doorway with a floor: a short tunnel from \`depth\` ft inside the face out through it, centred at \`u\` along the face. Its centre sits one radius
    (0.85 x spread) above the floor, so the void starts at the floor plate and is about 8 ft high (spread 4.8: 8.2 ft high, 8 ft wide at its widest, a
    doorway of about 6 ft clear width at the heights people use). face is '-x' '+x' '-y' '+y'; \`size\` is the tile's width when it is not 20 ft."""
    zc = floor + 0.85 * spread + 0.05
    S = size or 20.0
    if face in ("-x", "+x"):
        x_end = 0.0 if face == "-x" else S
        sgn = 1 if face == "-x" else -1
        a_ = (x_end + sgn * depth, u, zc)
        b_ = (x_end - sgn * 0.8, u, zc)
    else:
        y_end = 0.0 if face == "-y" else S
        sgn = 1 if face == "-y" else -1
        a_ = (u, y_end + sgn * depth, zc)
        b_ = (u, y_end - sgn * 0.8, zc)
    return src_line([a_, b_], dose_for(spread, depth + 0.8, k), spread, plate_mode, False)


def shaft(x, y, z0, z1, r, plate_mode="through", n=None):
    """A vertical shaft of radius ~r from z0 to z1 (a stack of short pieces so it is round)."""
    n = n or max(2, int((z1 - z0) / 3.0))
    return through_shaft(x, y, z0, z1, r / 0.85, r / 0.85, plate_mode=plate_mode, n=n)


# ---- the recipe ---------------------------------------------------------------------------------------------------------------------------------
def recipe4(name, container, plates, sources, steps=170, gravity=0.5, seed=1, foam_seed=1, noise=0.55, scale=3.6, grain=0.22, web=0.0,
            cell=0.5, smooth=0.8, min_void=6.0, min_foam=8.0, weld=""):
    """Writes a recipe with the container as given (a box or a mesh) and the V4 meta (variant V4)."""
    gravity = float(os.environ.get("V4_GRAVITY", gravity))      # for experiments only
    r = _kit.recipe(name, plates, sources, size=(20.0, 20.0, 20.0), steps=steps, gravity=gravity, seed=seed, noise=noise, scale=scale, grain=grain, web=web,
                    foam_seed=foam_seed, weld=weld, cell=cell, smooth=smooth, min_void=min_void, min_foam=min_foam)
    r["container"] = container
    r["meta"] = tile_meta4(name)
    return r


def tile_meta4(name):
    import re
    m = re.match(r"^(gathering|office|lobby)_(\d+)_(.+?)(?:_v(\d+))?$", name, re.I)
    if not m:
        return {}
    out = {"category": m.group(1).lower(), "typology": m.group(3).replace("_", " "), "slot": int(m.group(2))}
    if m.group(4):
        out["variant"] = "V" + m.group(4)
    return out


def storey_room(x0, y0, x1, y1, floor, ceil, spread=4.4, spacing=None, zc=None, fill=0.8, axis="x", plate_mode="pool", reach=0.85, roof=None):
    """A storey-high room whose CLEAR footprint is about x0..x1 by y0..y1: parallel tunnels between a floor plate and the plate above it (the next
    slab underside is a flat ceiling). The tunnels sit near the top, the solvent falls and pools on the floor, so the void runs from floor to ceiling
    with soft walls. A tunnel of spread s clears a radius of about reach * s, so the tunnel centres are pulled in by that much from the footprint edge
    (which leaves the skin of foam you asked for); a footprint smaller than twice the radius gets a single tunnel down its middle.
    The dose is sized to the room: fill x footprint x height, shared between the tunnels (a flat-ceilinged room is bigger than the round tunnel the
    spread alone would clear). Several rooms in one tile each get their own dose."""
    R = reach * spread
    # a ceiling that is the underside of a plate (ceil on a datum slab) lets the blob press into it; a ceiling that is the roof (within 2 ft of the top of the
    # container) must keep its blob a skin below it or the roof is eaten through. `roof` overrides the guess.
    if roof is None:
        roof = ceil > 15.0 and abs(ceil - round(ceil / 10.0) * 10.0) > 0.05
    if zc is None:
        zc = (ceil - R - 0.3) if roof else (ceil - 0.75 * R)
    spacing = spacing or spread * 0.95
    ax, ay = (x0 + R, x1 - R)
    by, bz = (y0 + R, y1 - R)
    if ax > ay:
        ax = ay = (x0 + x1) / 2.0
    if by > bz:
        by = bz = (y0 + y1) / 2.0
    total = fill * (x1 - x0) * (y1 - y0) * (ceil - floor)
    out = []
    if axis == "x":
        n = max(1, int(math.ceil((bz - by) / spacing)) + (1 if bz > by else 0))
        for i in range(n):
            y = by if n == 1 else by + (bz - by) * i / (n - 1)
            pts = [(ax, y, zc), (ay, y, zc)] if ay > ax else [(ax - 0.01, y, zc), (ax + 0.01, y, zc)]
            out.append(src_line(pts, int(round(total / n)), spread, plate_mode, False))
    else:
        n = max(1, int(math.ceil((ay - ax) / spacing)) + (1 if ay > ax else 0))
        for i in range(n):
            x = ax if n == 1 else ax + (ay - ax) * i / (n - 1)
            pts = [(x, by, zc), (x, bz, zc)] if bz > by else [(x, by - 0.01, zc), (x, by + 0.01, zc)]
            out.append(src_line(pts, int(round(total / n)), spread, plate_mode, False))
    return out


def stair_path(points, width, z0, z1, solid=False):
    """A stair or ramp that follows a path along walls: straight flights joined by flat square landings at the corners. `points` is the centre line
    [(x, y), ...] (axis-aligned legs), `width` its width, z0 and z1 the floor heights at the two ends. The rise is spread evenly over the run, so the
    slope is (z1 - z0) / run: keep it at or under 0.5 (a 0.5 ft riser per 1 ft tread), the steepest the shared walking rules accept (a standing place needs
    a clear disc, which a steeper surface breaks). Returns (shapes, run, slope, center): flat landings and tilted flights as plate shapes in one list, the run, the slope, and the centre line [(x, y, z), ...]."""
    w = width
    legs = []
    n = len(points)
    for i in range(n - 1):
        (xa, ya), (xb, yb) = points[i], points[i + 1]
        L = abs(xb - xa) + abs(yb - ya)
        dx = (xb > xa) - (xb < xa)
        dy = (yb > ya) - (yb < ya)
        # a leg starts after the landing at its first corner and ends before the landing at its last corner
        start = (w / 2.0 if i > 0 else 0.0)
        end = (w / 2.0 if i < n - 2 else 0.0)
        legs.append((xa, ya, dx, dy, start, L - end))
    run = sum(e - s for (_, _, _, _, s, e) in legs)
    slope = (z1 - z0) / run
    shapes = []
    center = []
    z = z0
    for i, (xa, ya, dx, dy, s, e) in enumerate(legs):
        za = z
        zb = z + slope * (e - s)
        p0 = (xa + dx * s, ya + dy * s)
        p1 = (xa + dx * e, ya + dy * e)
        if dx != 0:
            ylo, yhi = ya - w / 2.0, ya + w / 2.0
            if solid:        # a wedge of retained solid from the ground up to the walking surface (the solvent cannot get under it)
                shapes.append(prism_xz([(p0[0], 0.0), (p1[0], 0.0), (p1[0], zb), (p0[0], za)], ylo, yhi))
            else:
                shapes.append(slab([[p0[0], ylo, za], [p0[0], yhi, za], [p1[0], yhi, zb], [p1[0], ylo, zb]]))
        else:
            xlo, xhi = xa - w / 2.0, xa + w / 2.0
            if solid:
                shapes.append(prism_yz([(p0[1], 0.0), (p1[1], 0.0), (p1[1], zb), (p0[1], za)], xlo, xhi))
            else:
                shapes.append(slab([[xlo, p0[1], za], [xhi, p0[1], za], [xhi, p1[1], zb], [xlo, p1[1], zb]]))
        center.append((p0[0], p0[1], za))
        center.append((p1[0], p1[1], zb))
        z = zb
        if i < len(legs) - 1:
            cx, cy = points[i + 1]
            shapes.append(box((cx - w / 2.0, cy - w / 2.0, 0.0), (cx + w / 2.0, cy + w / 2.0, z)) if solid else rect_slab(cx - w / 2.0, cy - w / 2.0, cx + w / 2.0, cy + w / 2.0, z))
    return shapes, run, slope, center



def pod(cx, cy, z0, z1, r, k=1.2, plate_mode="pool"):
    """A vertical room: a line source standing from z0 to z1 that clears a barrel about \`r\` ft in radius at mid-height (it is a little narrower at the floor and
    under the ceiling: about 0.85 r and 0.75 r). Measured in lab_pod.py: built for R = r / 1.15 with 1.2 x the volume of a cylinder. Keep r at or under
    4 ft: a bigger blob leaks above the slab it is meant to stop at (use two pods side by side for a bigger room)."""
    R = r / 1.15
    spread = R / 0.85
    return src_line([(cx, cy, z0 + 0.4), (cx, cy, z1 - 0.4)], int(round(k * math.pi * R * R * (z1 - z0 + 1.3 * R))), spread, plate_mode, False)


def throat(a, b, z, spread=4.2, k=1.2, plate_mode="pool"):
    """A passage between two points at one height (a horizontal tunnel of the given spread: about 0.85 x spread in radius)."""
    return src_line([(a[0], a[1], z), (b[0], b[1], z)], dose_for(spread, math.dist(a, b) + 1.0, k), spread, plate_mode, False)



# ---- poche: retained walls with room-shaped holes ------------------------------------------------------------------------------------------
def in_circle(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_rect(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1


def in_capsule(a, b, r):
    ax, ay = a
    bx, by = b
    L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1e-9

    def f(x, y):
        t = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2))
        return (x - (ax + t * (bx - ax))) ** 2 + (y - (ay + t * (by - ay))) ** 2 <= r * r
    return f


def poche(rooms, z0, z1, step=1.0, size=20.0, solid_where=None, wobble=0.0, seed=1):
    """Retained walls between rooms: a solid column from z0 to z1 over everything that is NOT in a room (a height grid, the engine's "field" shape: a few hundred
    numbers). \`rooms\` are tests f(x, y) -> True inside a room; the room footprints are therefore exact, the walls between them are protected foam, and the solvent
    put in a room cannot leave it (except through a doorway you cut out of the walls by adding a room shape that runs to the face). \`wobble\` (ft) roughens the
    outlines so the walls read as bitten, not drawn. \`solid_where\` forces cells to stay solid (a pier inside a room). Returns one plate shape."""
    n = int(round(size / step))
    rs = np.random.RandomState(seed)
    ph = rs.uniform(0, 6.283, 4)

    def rough(x, y):
        return wobble * (math.sin(1.7 * x + ph[0]) * math.cos(1.3 * y + ph[1]) + 0.6 * math.sin(2.9 * y + 1.1 * x + ph[2])) if wobble else 0.0
    mask = ""
    for i in range(n):
        for j in range(n):
            cx, cy = (i + 0.5) * step, (j + 0.5) * step
            inside = any(f(cx + rough(cx, cy), cy + rough(cy, cx)) for f in rooms)
            if solid_where is not None and solid_where(cx, cy):
                inside = False
            mask += "0" if inside else "1"
    if "1" not in mask:
        raise ValueError("poche: no wall left")
    top = [round(float(z1), 2)] * ((n + 1) * (n + 1))
    return {"type": "field", "x0": 0.0, "y0": 0.0, "step": step, "nx": n, "ny": n, "top": top, "zbot": float(z0), "mask": mask}



def door_plane(axis, plane, u, floor, inward, spread=4.8, depth=6.0, plate_mode="pool", k=1.0):
    """A doorway through ANY plane of the container (a face, the wall of a notch, a step): axis 'x' or 'y' is the way through, \`plane\` its coordinate, \`u\` the
    centre along the wall, \`inward\` +1 or -1 the direction from the plane into the tile's own side."""
    zc = floor + 0.85 * spread + 0.05
    if axis == "x":
        a_ = (plane + inward * depth, u, zc)
        b_ = (plane - inward * 0.8, u, zc)
    else:
        a_ = (u, plane + inward * depth, zc)
        b_ = (u, plane - inward * 0.8, zc)
    return src_line([a_, b_], dose_for(spread, depth + 0.8, k), spread, plate_mode, False)


def ring_ramp(cx, cy, half, width, z0, z1, loops, start="s"):
    """A ramp that climbs round a square (centre cx, cy, the centre line \`half\` from the middle) in \`loops\` turns, as straight flights with a flat landing at every
    corner: returns (shapes, slope). Each loop is four flights; the rise is spread evenly over the run."""
    pts = []
    corners = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half)]
    order = {"s": 0, "e": 1, "n": 2, "w": 3}[start]
    seq = [corners[(order + i) % 4] for i in range(4)]
    for k in range(loops):
        pts += seq
    pts.append(seq[0])
    shapes, run, slope, center = stair_path(pts, width, z0, z1)
    return shapes, slope, center



def ramp_void(center, spread, above=None, seg=8.0, k=1.3, plate_mode="pool"):
    """The headroom over a stair or ramp: line sources that follow its centre line (from stair_path) \`above\` ft higher (default one radius plus 0.05, so the void
    starts at the walking surface), cut into pieces of about \`seg\` ft so each follows the climb. Returns a list of sources."""
    R = 0.85 * spread
    above = above if above is not None else R + 0.05
    pts = []
    for i in range(0, len(center) - 1, 2):
        a, b = center[i], center[i + 1]
        L = math.dist(a, b)
        n = max(1, int(math.ceil(L / seg)))
        for j in range(n):
            u0, u1 = j / n, (j + 1) / n
            p0 = tuple(a[q] + (b[q] - a[q]) * u0 for q in range(3))
            p1 = tuple(a[q] + (b[q] - a[q]) * u1 for q in range(3))
            pts.append(((p0[0], p0[1], p0[2] + above), (p1[0], p1[1], p1[2] + above)))
    out = []
    for p0, p1 in pts:
        out.append(src_line([p0, p1], dose_for(spread, math.dist(p0, p1) + 1.2, k), spread, plate_mode, False))
    return out



def trim(center, a, b):
    """The centre line of a stair or ramp (from stair_path) without its first \`a\` ft and its last \`b\` ft (measured along the line): the headroom tunnels stop short of a face so the wall stays."""
    pts = [center[i] for i in range(0, len(center), 2)] + [center[-1]]
    segs = [(center[i], center[i + 1]) for i in range(0, len(center) - 1, 2)]
    total = sum(math.dist(p, q) for p, q in segs)
    out = []
    pos = 0.0
    for p, q in segs:
        L = math.dist(p, q)
        lo, hi = max(a - pos, 0.0), min(total - b - pos, L)
        if hi > lo and L > 0:
            f0, f1 = lo / L, hi / L
            out.append(tuple(p[i] + (q[i] - p[i]) * f0 for i in range(3)))
            out.append(tuple(p[i] + (q[i] - p[i]) * f1 for i in range(3)))
        pos += L
    return out



class Ports:
    """The doorways of a tile, cut the same way everywhere. A port is an opening 6 ft wide and 8 ft high above a floor, in a face of the container OR in the wall of a notch or step. Each one
    has two parts: a short door tunnel (a source) that eats the passage through the skin of foam, and a frame (three small retained boxes: two jambs and a lintel, 1.5 ft deep) that bounds
    the opening at the wall, so the opening is exactly 6 x 8 ft however the rooms behind it erode, and the wall round it stays. Neighbours that agree on the datum and the centre line meet
    floor to floor through an identical opening. \`add\` takes the wall as an axis ('x' or 'y'), its coordinate, the centre u along it, the floor height and \`inward\` (+1 or -1, from the wall into this
    tile); the faces of a 20 ft box are the shortcuts \`face('-y', 10, D0)\`."""

    def __init__(self, size=20.0):
        self.items = []
        self.size = size

    def add(self, axis, plane, u, floor, inward, w=6.0, h=8.0, spread=4.4, depth=7.0, k=2.2, sill=0.0, slope=0.0):
        """`sill` > 0 lays a floor plate at `floor` from the wall in to that depth, for a port whose floor is not the ground slab (an upper landing that stops short of the wall).
        `slope` > 0 tilts the door tunnel up as it goes in, for a port whose floor is a ramp that starts at the wall (the headroom then follows the surface)."""
        self.items.append(dict(axis=axis, plane=plane, u=u, floor=floor, inward=inward, w=w, h=h, spread=spread, depth=depth, k=k, sill=sill, slope=slope))
        return self

    def face(self, name, u, floor, **kw):
        axis = "x" if name[1] == "x" else "y"
        plane = 0.0 if name[0] == "-" else self.size
        inward = 1 if name[0] == "-" else -1
        return self.add(axis, plane, u, floor, inward, **kw)

    def sources(self):
        out = []
        for p in self.items:
            zc = p["floor"] + 0.85 * p["spread"] + 0.05
            ax, plane, u, inw = p["axis"], p["plane"], p["u"], p["inward"]
            zi = zc + p["slope"] * p["depth"]
            a = (plane + inw * p["depth"], u, zi) if ax == "x" else (u, plane + inw * p["depth"], zi)
            b = (plane - inw * 1.2, u, zc) if ax == "x" else (u, plane - inw * 1.2, zc)
            out.append(src_line([a, b], dose_for(p["spread"], p["depth"] + 1.2, p["k"]), p["spread"], "pool", False))
        return out

    def frames(self, depth=1.5):
        """The frames as plate boxes (jambs and lintel) bounding every port."""
        boxes = []
        for p in self.items:
            ax, plane, u, inw, f = p["axis"], p["plane"], p["u"], p["inward"], p["floor"]
            lo, hi = (plane, plane + inw * depth) if inw > 0 else (plane - depth, plane)
            top = f + p["h"] + 1.5
            for (a0, a1, z0, z1) in ((u - p["w"] / 2 - 1.5, u - p["w"] / 2, f, top), (u + p["w"] / 2, u + p["w"] / 2 + 1.5, f, top), (u - p["w"] / 2, u + p["w"] / 2, f + p["h"], top)):
                if ax == "x":
                    boxes.append(box((lo, a0, z0), (hi, a1, z1)))
                else:
                    boxes.append(box((a0, lo, z0), (a1, hi, z1)))
        return boxes

    def sills(self):
        out = []
        for p in self.items:
            if p["sill"] > 0:
                a0, a1 = p["u"] - p["w"] / 2 - 1.0, p["u"] + p["w"] / 2 + 1.0
                b0, b1 = (p["plane"], p["plane"] + p["inward"] * p["sill"]) if p["inward"] > 0 else (p["plane"] - p["sill"], p["plane"])
                out.append(rect_slab(b0, a0, b1, a1, p["floor"]) if p["axis"] == "x" else rect_slab(a0, b0, a1, b1, p["floor"]))
        return out

    def plate_group(self):
        """One plate group for the frames; the sills (if any) go in as flat floors in the same group."""
        return plate_group("door frames", self.frames() + self.sills(), thickness=1.0, resistance=3.0, auto_support=False)



def ramp_pods(center, r=3.0, height=8.8, spacing=None, k=1.2, inset=0.0):
    """The room over a stair or ramp, as a row of vertical pods that follows it: each pod stands from the walking surface (so the solvent pools on the slope and the floor of the
    void IS the stair) up to \`height\` ft above it, r ft in radius, one every \`spacing\` ft (about 1.5 r) along the centre line (from stair_path; pass trim(center, a, b) to stop short of
    a face). Round tunnels laid along a slope leave a wedge of foam over it; these do not. Returns a list of sources (mind the 24-source limit: a 25 ft ramp takes 6 to 7 pods)."""
    spacing = spacing or 1.5 * r
    k = k * min(1.0, spacing / (1.8 * r))          # the pods overlap along the row: each carries only its share of the volume
    out = []
    for i in range(0, len(center) - 1, 2):
        a, b = center[i], center[i + 1]
        L = math.dist(a, b)
        n = max(1, int(round(L / spacing)))
        for j in range(n + 1):
            f = j / n
            x, y, z = (a[q] + (b[q] - a[q]) * f for q in range(3))
            out.append(pod(x, y, z - 0.2, z + height, r, k=k))
    return out
