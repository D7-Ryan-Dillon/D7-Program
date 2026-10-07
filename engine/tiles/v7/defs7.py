"""The 15 typology tiles as recipe builders. Every function returns a recipe dict (see kit.recipe). Docstring = the concept.

How the tiles interlock: a 20 ft lattice; ground slab top z = 2; a mid datum z = 12; two storeys of about 8 ft. Every tile carries the
STANDARD PORT (organic.port) on at least two side faces: a half-chamber centred on the face at the lower storey (z 6) and/or the upper
one (z 16), so any two tiles meet across a joint whatever is behind the face. Tiles that repeat along an axis are welded on it (`weld`);
mirror joins are exact for every tile.

Design language (why these are not literal): rooms are soft passages that swell and pinch and chambers that overlap, never straight
prismatic tunnels; plates are strata (warped, curved-edged, often bitten by the acetone), not boxes; the typology is read from the
section and the sequence of spaces, not from its furniture. Print scale: structure is at least ~1.25 ft (1 ft = 2.5 mm at 1 in = 10 ft).
Rules of thumb found while tuning: a chamber or passage of spread s clears a radius of about 0.85 s; the engine takes at most 24 sources.
"""
import math  # noqa: F401
from organic import *  # noqa: F401,F403

def lport(face, s=4.8, z=4.9, u=10.0, k=1.5):
    """A V7 low port: the half-chamber on a side face sits lower and wider than the V3 one, so its floor reaches the ground slab (a person can walk in)."""
    at = {"-x": (0.0, u), "+x": (20.0, u), "-y": (u, 0.0), "+y": (u, 20.0)}[face]
    return [chamber((at[0], at[1], z), s, k=k)]


def piers(points, r=1.6, name="piers", seed=0, n=14):
    """V7 structure: retained columns of foam (protected, so the erosion cannot take them) from the ground slab to the roof, so that nothing above hangs
    on a thin neck (a printed tile has to stand as one piece)."""
    cols = [column(x, y, [(1.5, r), (2.5, r), (18.0, r), (19.2, r * 0.9)], seed=seed + i, wobble=0.08, n=n) for i, (x, y) in enumerate(points)]
    return plate_group(name, cols, resistance=2.0, min_support=2.0)


def spine(path, widths, drop=1.6, step=1.0):
    """V7 structure: a solid wall of foam under the middle of a ramp or stair, from the ground up to the underside of the ribbon that is walked on
    (a retained plate that reaches the ground slab), so the ramp is carried all the way down and nothing hangs."""
    p = [(x, y, max(z - drop, 0.8)) for (x, y, z) in path]
    sp = street(p, widths, 1.0, step=step)
    sp.pop("thick")
    sp["zbot"] = 0.0
    return sp


SOFT = dict(noise=0.55, scale=3.6, grain=0.22)      # foam: strong noise, so walls read as eroded, not cut
TAU = 2 * math.pi


def _ground(res=2.0):
    return plate_group("ground slab", [box((0, 0, 0), (20, 20, FLOOR1))], resistance=res)


def _wave_y(amp, base, turns=2, phase=0.0):
    """An edge position that repeats along y (equal at y = 0 and y = 20) so welded tiles keep their outlines."""
    return lambda y: base + amp * math.sin(TAU * turns * y / 20.0 + phase)


# ===================================================================== GATHERING
def _terrace_height(x, y, warp, focus=(10.0, 3.2), stage=5.0):
    """Seating height: rises with distance from the stage in irregular, curving contour steps (unequal rise and tread). V7: the stage (the flat
    floor at the -Y door) is larger (it starts `stage` ft from the focus, V3 had about 1.2), so there is a floor to stand and walk on."""
    d = math.hypot((x - focus[0]) / 1.25 + 1.7 * warp(x, y), (y - focus[1]) + 1.7 * warp(y + 40, x))
    z = 2.0 + 10.0 * smoothstep(stage, 16.0, d) ** 0.9
    levels = [2.0, 3.5, 5.0, 6.6, 8.2, 9.8, 12.0]
    return min(levels, key=lambda a: abs(a - z))


def _g1_lane(x, y):
    """The gentle ledge (V7): a lane of even slope (0.33) up the west wall and along the north wall to the rim, so the rim can be reached on foot.
    Returns its height at (x, y) or None outside the lane."""
    if 1.0 <= y <= 19.0 and x < 5.6:
        return 2.0 + 0.33 * (y - 1.0)
    if y > 15.6 and 5.6 <= x <= 19.0:
        return min(10.5, 2.0 + 0.33 * 14.6 + 0.33 * (x - 5.6))
    return None


def G1():
    """Gathering 1, stepped amphitheater. A bowl eroded into the block. Its floor is one curved shell of terraces of unequal width and
    rise whose contour lines wander (never straight rows, never equal steps), falling to a low pool near the -Y face; pits bitten into
    the terraces by acetone; an undercroft cave beneath the high rim; an open dome over everything with a clerestory throat to each
    side, a stage entry at the front and doors at the back.
    V7: the same bowl and seating, with a larger flat stage at the -Y door and a gentle ledge (west wall, then north wall) up to the rim."""
    warp = field(5, 9.0)

    def top(x, y):
        lane = _g1_lane(x, y)
        return lane if lane is not None else _terrace_height(x, y, warp)
    seating = shell(top, 2.4, step=2.0 / 3.0)        # V7: a thicker shell, so the terraces and the ledge print
    plates = [_ground(), plate_group("seating terraces", [seating], resistance=2.0, min_support=6.0, max_span=12.0),
              piers([(1.8, 1.8), (18.2, 1.8), (1.8, 18.2), (18.2, 18.2)], r=1.6, name="corner piers", seed=11)]
    s = [chamber((10, 8.5, 15.2), 9.0, k=1.3)]
    s += vein([(0, 10, 15.6), (7, 10.5, 15.6), (13, 10.5, 15.6), (20, 10, 15.6)], [4.4, 5.0, 5.0, 4.4])
    s += vein([(10, 20, 15.6), (10, 15, 15.6), (10, 11, 15.2)], [4.4, 4.6, 5.0])
    s += port("-y", "LU") + port("+y", "L")
    s += [chamber((10, 17.5, 5.6), 4.4, k=1.4), chamber((4.5, 16.5, 5.2), 3.0), chamber((15.5, 16.5, 5.2), 3.0)]
    s += vein([(0, 17, 5), (4.5, 16.5, 5.2), (10, 17.5, 5.6), (15.5, 16.5, 5.2), (20, 17, 5)], [2.6, 3.0, 4.2, 3.0, 2.6])
    # (V3 bit three pits through the seating with cut sources; they left holes in the shell, so V7 keeps the seating whole)
    # headroom over the ledge: a passage that follows it, centred 4.4 ft above it
    s += vein([(5.2, 3.0, 6.0), (5.4, 12.0, 9.4), (5.8, 17.4, 10.6)], [4.8, 4.8, 5.4]) + [chamber((6.2, 15.8, 10.2), 4.8, k=1.2), chamber((8.4, 17.8, 12.0), 3.8, k=1.1)]
    return recipe("gathering_1_stepped_amphitheater_v7", plates, s, steps=170, gravity=0.5, seed=11, foam_seed=101, weld="x", **SOFT)


def G2():
    """Gathering 2, void-field gathering. No hall: a field of voids of different size (a vesicular rock), each its own room, separated
    by foam and linked by throats. A peanut-shaped great room in the middle (two merged chambers with a waist and an irregular floor
    at the waist), satellites at both levels, and a half-chamber on every face so the field carries on through the joint into the next
    tile. The big room is the assembly; the small ones are the places around it."""
    waist = blob(10, 10, 4.6, 4.0, 10.6, seed=4, wobble=0.18)
    plates = [_ground(), plate_group("waist floor", [slab(waist)], thickness=1.7, resistance=2.0, min_support=6.0)]
    s = [chamber((10, 10, 5.0), 6.0, k=1.5), chamber((10, 10, 14.8), 5.0, k=1.5)]
    s += [chamber((4.0, 4.5, 15.2), 3.4), chamber((16.5, 4.0, 15.2), 3.7), chamber((4.5, 16.0, 15.2), 3.5), chamber((16.0, 16.5, 15.0), 3.2)]
    s += [chamber((3.8, 3.8, 4.9), 4.2), chamber((16.4, 16.2, 4.9), 4.4)]
    for f in ("-x", "+x", "-y", "+y"):
        s += lport(f, s=5.2, z=4.7) + port(f, "U", s=4.0)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        s.append(passage([(10, 10, 4.8), (10 + dx * 5, 10 + dy * 5, 4.7), (10 + dx * 10, 10 + dy * 10, 4.8)], 4.0))
        s.append(passage([(10, 10, 14.8), (10 + dx * 5, 10 + dy * 5, 15.2), (10 + dx * 10, 10 + dy * 10, 16.0)], 2.3))
    return recipe("gathering_2_void_field_gathering_v7", plates, s, steps=170, gravity=0.5, seed=21, foam_seed=102, weld="xy", **SOFT)


def G3():
    """Gathering 3, inserted horizontal plate. One stratum of rock is left standing: a tongue that grows out of the -Y wall at the mid
    datum and ends in a curved, bitten free edge in the middle of a tall eroded cavern. Tall space above it, a lower cavern below it,
    and the tongue meets the floors of the next tile at both side faces."""
    warp = field(7, 9.0)

    def edge(x):
        return 6.6 + 6.0 * math.exp(-((x - 10.0) / 5.5) ** 2) + 0.7 * warp(x, 3.0)
    tongue = shell(lambda x, y: 12.0 + 0.3 * warp(x, y), 1.7, inside=lambda x, y: y < edge(x), step=1.0)
    plates = [_ground(), plate_group("inserted plate", [tongue], resistance=2.0, min_support=8.0, max_span=12.0)]
    s = [chamber((10, 9.5, 14.6), 5.4, k=1.4), chamber((10, 11.5, 6.1), 6.2, k=1.4)]
    def uport(face, u=10.0, z=14.0, s=3.8):          # V7: the upper port sits lower than the standard one (z 16), so the roof over the joins is 2 ft or more
        at = {"-x": (0.0, u), "+x": (20.0, u), "-y": (u, 0.0), "+y": (u, 20.0)}[face]
        return [chamber((at[0], at[1], z), s, k=1.5)]
    s += port("-x", "L", u=10.5) + uport("-x", 10.5, z=13.6, s=3.6) + port("+x", "L", u=10.5) + uport("+x", 10.5) + port("+y", "L") + uport("+y") + lport("-y", s=5.0, z=5.0) + uport("-y", s=3.8)
    s += vein([(10, 0, 5.2), (10, 5.5, 5.4), (10.2, 10.5, 5.6)], [4.6, 4.8, 5.0]) + vein([(10, 0, 14.8), (10.4, 5.0, 14.7), (10.4, 10.0, 14.8)], [4.2, 4.2, 5.0])
    s += vein([(0, 10.5, 13.8), (5, 11.0, 14.3), (10, 11.5, 14.2), (20, 10.5, 14.4)], [3.4, 4.2, 5.6, 4.0])
    s += vein([(0, 10.5, 6.0), (10, 12, 6.2), (20, 10.5, 6.0)], [4.2, 5.6, 4.2])
    s += vein([(10, 20, 15.3), (11, 16, 14.6)], [4.4, 5.0]) + vein([(10, 20, 6.0), (9, 16, 6.2)], [4.4, 5.0])
    s += [chamber((10, 13.2, 12.8), 2.3, k=1.2, cut=True), chamber((5.8, 9.4, 12.6), 2.0, k=1.2, cut=True)]
    return recipe("gathering_3_inserted_horizontal_plate_v7", plates, s, steps=170, gravity=0.5, seed=31, foam_seed=103, weld="x", **SOFT)


def G4():
    """Gathering 4, contained room-within-volume. A kernel of foam stands in the middle of an eroded ring cavern, and inside the kernel
    is a small room with one door: a room within a volume, with the volume eroded around it. Above the kernel the ring opens into one
    tall hall. The ring and the hall each reach all four faces.
    V7: the kernel is a retained dome of foam (a protected solid, so it stays whatever is eroded round it) and the room is carved into it with
    a door: about 7 ft clear and 7 ft across inside a wall about 1.4 ft thick. The ring sits on the floor and is wide enough to walk all round."""
    kernel = column(10.0, 10.0, [(1.5, 4.9), (7.0, 4.9), (9.0, 4.5), (10.4, 3.2), (11.2, 1.2)], seed=4, wobble=0.07)
    plates = [_ground(res=5.0), plate_group("kernel", [kernel], resistance=0.6, min_support=2.0)]
    R = 8.6
    ring = [(10 + R * math.cos(TAU * i / 8), 10 + R * math.sin(TAU * i / 8), 5.6) for i in range(8)]
    ring.append(ring[0])
    s = [passage(ring, 4.4, k=1.0), chamber((10, 10, 5.8), 4.0, k=2.2, cut=True), passage([(10, 10, 5.6), (15.0, 10, 5.6)], 3.9, k=1.6, cut=True)]
    s += [chamber((10, 10, 16.0), 5.6, k=1.4)]
    for f, (dx, dy) in (("-x", (-1, 0)), ("+x", (1, 0)), ("-y", (0, -1)), ("+y", (0, 1))):
        s += port(f, "LU", s=4.2)
        s.append(passage([(10 + dx * 8.2, 10 + dy * 8.2, 5.4), (10 + dx * 10, 10 + dy * 10, 5.4)], 3.8))
        s.append(passage([(10 + dx * 6.0, 10 + dy * 6.0, 14.7), (10 + dx * 10, 10 + dy * 10, 16.0)], 3.6))
    return recipe("gathering_4_contained_room_within_volume_v7", plates, s, steps=170, gravity=0.5, seed=41, foam_seed=104, weld="xy", **SOFT)


def G5():
    """Gathering 5, linear edge gallery. A long narrow gallery that swells and pinches runs up the -X edge on two levels behind a thick
    skin pierced by a few irregular windows; short arched portals open it onto a wide double-height hall on the +X side. It repeats
    along Y, and mirrored in X the two halls merge into one big hall with a gallery on each side.
    V7: the same gallery and hall; both gallery levels are wide and high enough to walk (7 ft clear), and a ramp climbs from the hall floor
    to the upper gallery (slope about 0.45) so the two levels are one route."""
    ledge = _wave_y(1.3, 8.4, 2, 1.0)
    floor = shell(lambda x, y: 12.0 + 0.25 * math.sin(TAU * y / 20.0 * 2), 1.7, inside=lambda x, y: x < ledge(y), step=1.0)
    ramp_path = [(19.0, 15.5, 2.0), (11.0, 15.5, 5.4), (10.8, 8.5, 8.35), (10.6, 1.8, 11.15), (9.0, 1.2, 12.0)]
    ramp = street(ramp_path, [4.4, 4.4, 4.4, 4.2, 4.2], 1.7, step=1.0)
    ramp_spine = spine(ramp_path, [3.0, 3.0, 3.0, 3.0, 3.0])
    plates = [_ground(), plate_group("gallery floor", [floor], resistance=2.0, min_support=8.0, max_span=12.0),
              plate_group("ramp", [ramp, ramp_spine], resistance=2.0, min_support=8.0, max_span=12.0),
              piers([(18.2, 1.8), (18.2, 18.2)], r=1.6, name="corner piers", seed=51)]
    s = vein([(4.6, 0, 5.4), (5.6, 6, 5.6), (4.2, 13, 5.3), (5.2, 20, 5.4)], [4.1, 4.3, 4.1, 4.2], k=0.8)
    s += vein([(4.6, 0, 15.9), (5.6, 7, 16.2), (4.4, 14, 15.8), (5.0, 20, 15.9)], [4.1, 4.3, 4.1, 4.2], k=0.8)
    s += vein([(14.8, 0, 6.4), (13.6, 8, 6.0), (15.2, 15, 6.6), (14.8, 20, 6.4)], [4.4, 5.6, 4.6, 4.4])
    s += [chamber((15.5, 10, 11.0), 5.0, k=1.5)]
    s += vein([(14.8, 0, 15.4), (14.0, 9, 15.5), (15.4, 16, 15.2), (14.8, 20, 15.4)], [4.0, 5.0, 4.4, 4.0])
    for y, z in ((5.0, 6.0), (14.5, 6.0)):
        s.append(passage([(5.2, y, z), (10, y + 0.5, z), (14, y, z)], 2.8))
    s += [chamber((0, 5.0, 15.6), 1.9), chamber((0, 12.5, 6.0), 1.9), chamber((0, 17.0, 15.6), 1.7)]
    s += port("+x", "LU", s=4.4)
    # headroom over the ramp, centred about 4 ft above it
    s += vein([(19.0, 15.5, 5.9), (11.0, 15.5, 9.3), (10.8, 8.5, 12.2), (10.6, 1.8, 15.0), (9.0, 1.2, 15.9)], [4.8, 4.8, 4.8, 4.8, 4.8], k=1.0)
    return recipe("gathering_5_linear_edge_gallery_v7", plates, s, steps=170, gravity=0.5, seed=51, foam_seed=105, weld="y", **SOFT)


# ===================================================================== OFFICE
def O1():
    """Office 1, open hall workspace. One great hall, about 16 ft clear, made of lobes at two heights joined by wide throats (a grotto),
    held up by a few slender remnant pillars (bone-shaped, thin at the waist, irregular) and not a grid of posts. A roof stratum
    caps it, pierced by irregular oculi. Lobes sit on every face, so halls meet across joints."""
    roof = box((0, 0, 18), (20, 20, 20))
    pillars = [column(6.4, 6.0, [(2, 2.3), (6, 1.5), (10, 1.3), (14, 1.7), (18, 2.1)], seed=1),
               column(14.6, 5.4, [(2, 1.9), (7, 1.2), (11, 1.4), (15, 1.2), (18, 1.8)], seed=2),
               column(11.4, 15.2, [(2, 2.4), (6, 1.7), (9, 1.3), (13, 1.8), (18, 2.3)], seed=3)]
    plates = [_ground(), plate_group("roof stratum", [roof], resistance=2.0, min_support=30.0, max_span=12.0),
              plate_group("remnant pillars", pillars, resistance=2.0, min_support=2.0)]
    s = []
    for z in (6.2, 13.4):
        s += [chamber((10, 10, z), 5.4, k=1.5), chamber((0, 10, z), 5.6, k=1.5), chamber((20, 10, z), 5.6, k=1.5),
              chamber((10, 0, z), 5.6, k=1.5), chamber((10, 20, z), 5.6, k=1.5)]
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            s.append(passage([(10, 10, z), (10 + dx * 5, 10 + dy * 5, z + 0.2), (10 + dx * 10, 10 + dy * 10, z)], 3.8))
    s += through_shaft(6.5, 13.5, 14.0, 20.5, 1.6, 2.4, "through", True, n=2)
    s += through_shaft(13.5, 6.5, 14.0, 20.5, 1.5, 2.2, "through", True, n=2)
    return recipe("office_1_open_hall_workspace_v7", plates, s, steps=170, gravity=0.5, seed=61, foam_seed=106, weld="xy", **SOFT)


def O2():
    """Office 2, cascaded / terraced plates. Three strata of floor are cantilevered out of the walls from alternating sides (left, right,
    left) and overlap in plan, so the section is a zigzag of floating floors stepping up through one cavern; their free edges are
    curved and bitten and the floors are slightly warped. Repeats along Y; a throat in every hall reaches the side faces."""
    def edge(base, p1, p2):
        return lambda y: base + 1.5 * math.sin(TAU * 2 * y / 20.0 + p1) + 0.8 * math.sin(TAU * 3 * y / 20.0 + p2)
    eA, eB, eC = edge(11.8, 0.6, 1.0), edge(8.6, 2.0, 0.2), edge(11.2, 3.6, 2.2)
    A = shell(lambda x, y: 6.6 + 0.3 * math.sin(TAU * y / 20), 1.7, inside=lambda x, y: x < eA(y), step=1.0)
    B = shell(lambda x, y: 11.8 + 0.3 * math.sin(TAU * y / 20 + 1.5), 1.7, inside=lambda x, y: x > eB(y), step=1.0)
    C = shell(lambda x, y: 16.6 + 0.3 * math.sin(TAU * y / 20 + 3.0), 1.7, inside=lambda x, y: x < eC(y), step=1.0)
    plates = [_ground(), plate_group("lower stratum (left)", [A], resistance=2.0, min_support=8.0),
              plate_group("middle stratum (right)", [B], resistance=2.0, min_support=8.0),
              plate_group("upper stratum (left)", [C], resistance=2.0, min_support=8.0)]
    s = vein([(14.5, 0, 6.0), (15.5, 7, 6.2), (14.0, 14, 5.8), (14.5, 20, 6.0)], [5.0, 5.8, 5.2, 5.0])
    s += vein([(5.0, 0, 10.8), (6.0, 7, 10.6), (4.8, 14, 10.9), (5.0, 20, 10.8)], [4.4, 5.0, 4.6, 4.4])
    s += vein([(14.5, 0, 16.0), (13.5, 8, 15.8), (15.0, 15, 16.0), (14.5, 20, 16.0)], [4.4, 5.2, 4.6, 4.4])
    s += vein([(5.0, 0, 3.8), (5.5, 10, 3.6), (5.0, 20, 3.8)], [2.0, 2.4, 2.0])
    s += [chamber((10.2, 10, 9.0), 3.4, k=1.3), chamber((10.4, 4, 14.0), 3.2, k=1.3), chamber((10.4, 16, 4.6), 2.8)]
    s += [chamber((6.0, 13.0, 6.8), 2.0, k=1.2, cut=True), chamber((14.5, 5.0, 11.9), 2.0, k=1.2, cut=True)]
    s += [chamber((5.4, 10.0, 18.8), 4.8, k=1.6)]       # V7: the roof above the top plate is opened, so the top terrace is open to the sky and can be walked
    s += port("+x", "LU", u=10.5)
    s += [passage([(5.0, 10, 10.8), (2.5, 10.5, 10.8), (0, 10.5, 10.8)], 3.6), passage([(14.5, 10, 6.0), (17.5, 10.5, 6.0), (20, 10.5, 6.0)], 3.8),
          passage([(14.5, 10, 16.0), (17.5, 10, 16.0), (20, 10.5, 16.0)], 3.6)]
    return recipe("office_2_cascaded_terraced_plates_v7", plates, s, steps=170, gravity=0.4, seed=71, foam_seed=107, weld="y", **SOFT)


def O3():
    """Office 3, flat deep-plan plate. Two broad flat floors, each a wide low room of scalloped lobes that swell and pinch, so foam
    islands are left standing as irregular columns; very deep in plan (far from the faces); lit by three funnel-shaped wells that flare
    upward through both floors. The mid floor is a stratum, nearly flat, bitten where the wells pass."""
    warp = field(21, 12.0)
    mid = shell(lambda x, y: 12.0 + 0.3 * warp(x, y), 1.8, step=1.0)
    plates = [_ground(res=5.0), plate_group("mid floor", [mid], resistance=1.6, min_support=20.0, max_span=14.0),
              piers([(1.8, 1.8), (18.2, 1.8), (1.8, 18.2), (18.2, 18.2)], r=1.6, name="corner piers", seed=80)]     # V7: the roof and the mid floor stand on four corner piers
    s = vein([(2, 3.5, 5.6), (10, 3.0, 5.8), (18, 3.5, 5.6)], [3.6, 4.6, 3.6])
    s += vein([(0, 10, 5.6), (10, 11.0, 5.8), (20, 10, 5.6)], [4.3, 3.4, 4.3])
    s += vein([(2, 17.0, 5.6), (10, 17.5, 5.8), (18, 17.0, 5.6)], [3.6, 4.5, 3.6])
    s += vein([(2, 4.5, 15.8), (10, 5.5, 15.6), (18, 4.5, 15.8)], [4.0, 3.6, 4.0])
    s += vein([(0, 10.5, 15.8), (10, 11.5, 15.6), (20, 10.5, 15.8)], [3.6, 4.6, 3.6])
    s += vein([(2, 16.0, 15.8), (10, 15.5, 15.6), (18, 16.0, 15.8)], [4.0, 3.6, 4.0])
    s += through_shaft(6.0, 14.0, 4.5, 20.5, 2.0, 3.6, "through", True, n=2, drift=(0.8, -0.6))
    s += through_shaft(14.4, 6.2, 4.5, 20.5, 2.0, 3.6, "through", True, n=2, drift=(-0.6, 0.8))
    s += through_shaft(10.0, 10.0, 4.5, 20.5, 1.6, 2.8, "through", True, n=2)
    s += lport("-x", s=5.0, z=5.0) + lport("+x", s=5.0, z=5.0) + port("-x", "U") + port("+x", "U")
    return recipe("office_3_flat_deep_plan_plate_v7", plates, s, steps=170, gravity=0.5, seed=81, foam_seed=108, weld="xy", **SOFT)


def O4():
    """Office 4, void-edge workspace. A tall funnel-shaped void bites into one corner, flaring upward. Both floors wrap round it and end
    in an open, eroded edge on the void; the workspace is two storeys of curved corridor-rooms that bend round the void from one face
    to the next. Not welded; it joins by rotation and mirror."""
    warp = field(31, 9.0)

    def outside(x, y):
        return math.hypot(x - 4.0, y - 4.0) > 5.2 + 0.7 * warp(x, y)
    mid = shell(lambda x, y: 12.0 + 0.2 * warp(x + 3, y), 1.8, inside=outside, step=1.0)
    plates = [_ground(), plate_group("wrapping floor", [mid], resistance=2.0, min_support=10.0, max_span=12.0)]
    s = through_shaft(4.0, 4.0, 2.5, 20.5, 3.4, 5.6, "through", False, n=3, drift=(0.6, 0.6))
    s += vein([(20, 10.0, 6.0), (14.5, 10.5, 6.1), (11.5, 12.5, 5.9), (10.5, 16.0, 6.0), (10, 20, 6.0)], [4.4, 4.8, 5.0, 4.6, 4.4])
    s += vein([(20, 10.0, 16.0), (15.0, 10.5, 15.8), (12.0, 13.0, 15.6), (10.8, 16.5, 15.8), (10, 20, 16.0)], [4.4, 4.6, 4.8, 4.4, 4.4])
    s += [chamber((10.0, 12.5, 11.0), 3.2, k=1.3), chamber((15.5, 15.5, 6.0), 3.8)]
    s += [passage([(5.0, 5.0, 5.3), (8.5, 7.5, 5.3), (11.5, 12.0, 5.3)], 3.9)]
    s += port("+x", "LU") + port("+y", "LU")
    s += lport("-x", s=4.8, z=5.2, u=7.5) + lport("-y", s=4.8, z=5.2, u=7.5)          # V7: the foot of the void can be entered from its own two faces
    return recipe("office_4_void_edge_workspace_v7", plates, s, steps=170, gravity=0.5, seed=91, foam_seed=109, weld="", **SOFT)


def O5():
    """Office 5, folded / undulating work surface. The mid floor is one continuous rippled stratum, high and low in two directions
    (slopes up to about 15 degrees), identical on opposite faces so it repeats; pockets are bitten into its low points; below it a
    soft ground hall of two crossing halls, above it two crossing halls that ride the folds."""
    def ripple(x, y):
        return 12.0 + 0.85 * math.sin(TAU * x / 20.0 + 0.4) * math.cos(TAU * y / 20.0) + 0.45 * math.sin(TAU * (x + 2 * y) / 20.0 + 1.0)
    mid = shell(ripple, 1.8, step=1.0)
    plates = [_ground(res=5.0), plate_group("folded floor", [mid], resistance=1.7, min_support=20.0, max_span=14.0)]
    s = vein([(0, 10, 5.6), (7, 9, 5.7), (13, 11, 5.5), (20, 10, 5.6)], [4.8, 4.2, 5.0, 4.8])
    s += vein([(10, 0, 5.6), (9, 7, 5.7), (11, 13, 5.5), (10, 20, 5.6)], [4.8, 5.0, 4.2, 4.8])
    s += vein([(0, 10, 16.0), (7, 11, 15.6), (13, 9, 15.4), (20, 10, 16.0)], [4.4, 4.8, 3.8, 4.4])
    s += vein([(10, 0, 16.0), (11, 7, 15.6), (9, 13, 15.4), (10, 20, 16.0)], [4.4, 3.8, 4.8, 4.4])
    s += [chamber((10, 10, 5.6), 6.0, k=1.5), chamber((10, 10, 15.2), 5.2, k=1.4)]
    s += [chamber((10.0, 10.0, 13.0), 4.0, k=2.2, cut=True)]      # V7: a hole through the folded floor joins the two storeys (a void you see across)
    for px, py in ((4.0, 6.0), (15.5, 15.0), (6.5, 15.5)):
        s.append(chamber((px, py, ripple(px, py) + 0.3), 2.2, k=1.2, cut=True))
    return recipe("office_5_folded_undulating_work_surface_v7", plates, s, steps=170, gravity=0.4, seed=101, foam_seed=110, weld="xy", **SOFT)


# ===================================================================== LOBBY
def L1():
    """Lobby 1, vertical void lobby. A tall chimney of a void, bell-shaped (swollen low, necked at the mid datum, flaring to the open
    top), with three landings of rock cantilevered from its walls at different heights and compass points so the way up is a spiral of
    ledges; a low entry reaches its base, and throats on two more faces reach it at the lower and upper storey.
    V7: the way up is a real stair: a ledge that winds three quarters of a turn round the void from the entry to the +X door at the mid datum
    (slope about 0.4, 4 ft wide), with the three landings as its resting places."""
    R = 5.4
    zs = [2.0, 3.1, 4.2, 5.3, 5.3, 6.4, 7.5, 8.6, 8.6, 9.7, 10.8, 12.0]          # two flat landings (the terraces) on the way up
    pts = [(10 + R * math.cos(-math.pi / 2 - 1.5 * math.pi * i / 11), 10 + R * math.sin(-math.pi / 2 - 1.5 * math.pi * i / 11), zs[i]) for i in range(12)]
    spiral = pts[:9]
    pts += [(17.7, 10.0, 12.0), (20.0, 10.0, 12.0)]          # touch-up: the top landing runs flat to the +X face, where a neighbour's floor at 12 ft meets it
    stair = street(pts, [5.0] * 14, 1.7, step=0.5)
    plates = [_ground(), plate_group("spiral stair", [stair, spine(spiral, [3.2] * 9)], resistance=2.0, min_support=6.0)]       # V7: a solid spine under the stair, down to the ground
    s = through_shaft(10, 10, 2.5, 8.5, 5.0, 6.6, "pool", False, n=2, k=1.4)
    s += through_shaft(10, 10, 8.5, 13.0, 6.6, 4.4, "pool", False, n=2, k=1.8)
    s += through_shaft(10, 10, 13.0, 20.5, 4.4, 7.4, "pool", False, n=2, k=1.4)
    s += port("-y", "L") + port("+x", "LU") + port("-x", "U")
    s += [passage([(10, 0, 6.0), (10, 4.5, 5.2), (10, 8, 5.4)], 3.9)]
    s += [passage([(0, 10, 16.0), (4, 10.5, 15.8), (8, 10, 15.5)], 3.8)]
    # headroom over the stair, centred about 4 ft above it
    s += vein([(pts[i][0], pts[i][1], pts[i][2] + 3.8) for i in (0, 3, 6, 9, 11, 12, 13)], [5.2] * 7, k=1.1)
    return recipe("lobby_1_vertical_void_lobby_v7", plates, s, steps=170, gravity=0.5, seed=111, foam_seed=111, weld="", **SOFT)


def L2():
    """Lobby 2, compressed sequential lobby. Along Y: a low pinched throat, a tall hall that climbs into a vault, and a low throat
    again. The two throats are identical, so tiles chain into a sequence of compress-release; alcoves open off the hall and a cross
    passage through it reaches the side faces.
    V7: the compression is sharper and can be walked: each throat is a tall keyhole slot (about 4.5 ft wide, 8 ft high) between wide ends and
    a very tall vaulted hall, so the sequence is wide, narrow, soaring, narrow, wide."""
    s = vein([(10, 0, 5.4), (10, 5.5, 5.4), (10, 10, 9.4), (10, 14.5, 5.4), (10, 20, 5.4)], [4.6, 2.4, 8.0, 2.4, 4.6])
    s += [zline(10, 5.5, 2.4, 10.4, 2.3), zline(10, 14.5, 2.4, 10.4, 2.3)]
    s += [chamber((10, 10, 14.6), 6.4, k=1.5)]
    s += [chamber((3.2, 9.5, 8.6), 3.6), chamber((16.8, 10.5, 8.0), 3.6)]
    s += vein([(0, 10, 6.0), (6, 10, 6.6), (14, 10, 6.6), (20, 10, 6.0)], [4.6, 4.6, 4.6, 4.6])
    s += vein([(0, 10, 15.8), (6, 10, 15.2)], [4.2, 4.0]) + vein([(20, 10, 15.8), (14, 10, 15.2)], [4.2, 4.0])
    s += [chamber((6.0, 3.0, 7.2), 2.8), chamber((14.0, 17.0, 7.0), 2.8)]
    s += lport("-x", s=5.0, z=5.0) + lport("+x", s=5.0, z=5.0) + port("-x", "U") + port("+x", "U")
    s += lport("-y", s=4.6, z=5.2) + lport("+y", s=4.6, z=5.2)
    return recipe("lobby_2_compressed_sequential_lobby_v7", [_ground()], s, steps=170, gravity=0.5, seed=121, foam_seed=112, weld="y", **SOFT)


def L3():
    """Lobby 3, continuous hall lobby. A tall nave that swells and narrows runs the full X length with a low aisle on each side on two
    storeys; ribs of foam stand between nave and aisles with irregular arched openings, so the hall reads as one continuous nave.
    It repeats along X.
    V7: set apart from L2: a long, even hall that runs the whole length with a steady rhythm of pillars; it is the horizontal one, L2 is the
    soaring one. Touch-up: the roof is raised (the nave is about 16 ft clear), and two terraces at the second-floor height (12 ft) stand on
    pillars along the two long walls, each running out to a side face, where its floor continues into the next tile."""
    s = vein([(0, 10, 10.4), (5, 9.6, 10.6), (10, 10.4, 10.4), (15, 9.6, 10.6), (20, 10, 10.4)], [7.0, 7.8, 7.0, 7.8, 7.0])
    # headroom over the terraces: the void climbs above each one
    s += vein([(0, 15.6, 14.2), (6, 15.5, 14.6), (13.5, 15.6, 14.4)], [4.4, 5.3, 5.0])
    s += vein([(6.5, 4.4, 14.4), (14, 4.5, 14.6), (20, 4.4, 14.2)], [5.0, 5.3, 4.4])
    s += lport("-x", s=5.2, z=5.0) + lport("+x", s=5.2, z=5.0)

    def north(x, y):
        return y > 13.4 - 0.9 * math.sin(0.55 * x + 0.6) and x < 12.8 + 1.4 * math.sin(0.5 * y)

    def south(x, y):
        return y < 6.6 + 0.9 * math.sin(0.5 * x + 2.0) and x > 7.2 - 1.4 * math.sin(0.5 * y + 1.0)
    t_north = shell(lambda x, y: 11.6, 1.7, inside=north, x0=0.0, y0=11.0, x1=16.0, y1=20.0, step=1.0)
    t_south = shell(lambda x, y: 11.6, 1.7, inside=south, x0=4.0, y0=0.0, x1=20.0, y1=9.0, step=1.0)
    legs = [column(x, y, [(1.5, 1.4), (2.5, 1.4), (11.0, 1.25), (11.6, 1.2)], seed=40 + i, wobble=0.08, n=8)
            for i, (x, y) in enumerate([(2.5, 15.8), (7.5, 16.4), (11.5, 15.6), (8.8, 3.6), (13.5, 4.4), (18.0, 3.6)])]
    plates = [_ground(), plate_group("roof", [box((0, 0, 19.0), (20, 20, 20))], resistance=5.0), plate_group("terraces", [t_north, t_south], resistance=2.0, min_support=6.0, max_span=12.0),
              plate_group("terrace pillars", legs, resistance=2.0, min_support=2.0),
              piers([(1.8, 1.8), (18.2, 1.8), (1.8, 18.2), (18.2, 18.2), (6.0, 10.0), (14.0, 10.0)], r=1.5, name="hall piers", seed=30, n=10)]
    return recipe("lobby_3_continuous_hall_lobby_v7", plates, s, steps=170, gravity=0.5, seed=131, foam_seed=113, weld="x", **SOFT)


def L4():
    """Lobby 4, topographic / ground-field lobby. The ground is a landscape: soft mounds and hollows rising to about 5 ft, flush with the
    datum at all four edges, pitted where acetone has eaten craters into it; above it a vaulted hall whose ceiling is eroded as a
    counter-landscape (domes over the mounds). Low entries reach each face and high throats reach two of them."""
    warp = field(51, 11.0)

    def land(x, y):
        edge = math.sin(math.pi * x / 20.0) * math.sin(math.pi * y / 20.0)
        apron = smoothstep(0.0, 3.2, min(x, 20.0 - x, y, 20.0 - y))        # V7: truly flush with the datum at the four edges (a flat apron), so every face meets a neighbour's floor
        return 2.0 + apron * edge ** 0.8 * (2.6 + 2.2 * (0.5 + 0.5 * warp(x, y)))
    # V7: an overlook on the north-east mound, 3.6 ft above the landscape, reached by a short ramp (slope about 0.47) from it
    z0 = land(8.5, 12.5)
    ramp_pts = [(8.5, 12.5, z0), (11.0, 15.0, z0 + 1.9), (14.0, 16.2, z0 + 3.6), (16.0, 16.4, z0 + 3.6)]
    ramp = street(ramp_pts + [(17.2, 16.6, z0 + 3.6)], [4.2, 4.2, 4.4, 6.0, 7.0], 1.7, step=0.5)
    deck = slab(blob(16.0, 16.4, 3.0, 2.8, z0 + 3.6, seed=7, wobble=0.12))
    plates = [plate_group("ground field", [ground_field(land, 20)], resistance=2.0),
              plate_group("overlook", [ramp, deck, spine(ramp_pts + [(17.2, 16.6, z0 + 3.6)], [3.0, 3.0, 3.0, 3.0, 3.0], drop=1.7),
                                column(16.4, 16.6, [(1.0, 2.0), (z0 + 1.2, 1.9), (z0 + 2.0, 1.9)], seed=3, wobble=0.06, n=14)], thickness=1.7, resistance=2.0, min_support=6.0)]
    s = [chamber((10, 10, 12.4), 7.6, k=1.4), chamber((4.5, 15.5, 11.2), 5.6, k=1.3), chamber((15.5, 4.5, 11.2), 5.6, k=1.3)]
    s += [chamber((14.6, 15.4, 12.4), 5.8, k=1.4), chamber((4.5, 4.5, 11.6), 5.2, k=1.3)]
    for f, pt in (("-x", (0, 10)), ("+x", (20, 10)), ("-y", (10, 0)), ("+y", (10, 20))):
        far = (10 + (pt[0] - 10) * 0.45, 10 + (pt[1] - 10) * 0.45)
        s += lport(f, s=5.2, z=5.4)
        s.append(passage([(pt[0], pt[1], 6.0), (far[0], far[1], land(*far) + 3.6)], 4.2))
    for f, pt in (("-x", (0, 10)), ("+x", (20, 10))):
        s += port(f, "U", s=4.2)
        s.append(passage([(pt[0], pt[1], 16.0), (10 + (pt[0] - 10) * 0.6, 10, 14.0)], 3.8))
    s += vein([(8.5, 12.5, z0 + 4.2), (11.0, 15.0, z0 + 6.0), (14.0, 16.2, z0 + 7.6)], [4.8, 4.8, 4.8], k=1.1)       # headroom over the ramp
    for cx, cy in ((7.0, 7.5), (13.5, 12.5), (10.5, 15.5)):
        s.append(chamber((cx, cy, land(cx, cy) + 0.6), 2.4, k=1.2, cut=True))
    return recipe("lobby_4_topographic_ground_field_lobby_v7", plates, s, steps=170, gravity=0.4, seed=141, foam_seed=114, weld="xy", **SOFT)


def L5():
    """Lobby 5, linear gallery lobby. A street of rock climbs through the tile, a ribbon that bends and changes width and rises from the
    ground datum to the mid datum, with a soft gallery of void over it that follows it and side rooms that open off it; a vault is
    eroded under its high end. Mirrored in X it climbs and descends, floors meeting at the datum."""
    path = [(0, 10, 2.5), (5, 8.4, 4.8), (11, 11.6, 8.0), (16, 8.8, 10.2), (20, 10, 12.0)]
    way = street(path, [8.0, 6.2, 7.8, 6.4, 8.0], 1.7, step=1.0)
    plates = [_ground(), plate_group("street", [way], resistance=2.0, min_support=6.0, max_span=12.0)]
    s = vein([(0, 10, 7.4), (5, 8.4, 9.4), (11, 11.6, 12.6), (16, 8.8, 14.6), (20, 10, 16.2)], [5.2, 5.8, 6.2, 5.8, 5.2])
    s += [chamber((6.5, 15.5, 7.2), 4.2), chamber((14.5, 4.0, 11.6), 4.0), chamber((17.5, 15.0, 15.0), 4.2), chamber((3.0, 3.5, 11.0), 3.2)]
    s += [chamber((15.5, 10.5, 6.0), 4.2, k=1.4), chamber((10.0, 4.0, 5.6), 3.4)]
    s += port("+x", "LU") + port("-x", "LU", s=4.6)
    s += [passage([(0, 10, 16.0), (2.5, 9.5, 13.5), (5.0, 8.6, 11.0)], 3.6)]
    s += lport("-y", s=4.8, z=5.2) + lport("+y", s=4.8, z=5.2) + [chamber((10.5, 16.2, 5.4), 3.8)]        # V7: the faces beside the ramp open at the ground too
    return recipe("lobby_5_linear_gallery_lobby_v7", plates, s, steps=170, gravity=0.5, seed=151, foam_seed=115, weld="", **SOFT)


TILES = {"G1": G1, "G2": G2, "G3": G3, "G4": G4, "G5": G5, "O1": O1, "O2": O2, "O3": O3, "O4": O4, "O5": O5,
         "L1": L1, "L2": L2, "L3": L3, "L4": L4, "L5": L5}
