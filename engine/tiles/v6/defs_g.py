"""The V6 gathering tiles G1 to G5: the cubic block of V3 with its section ideas kept, eroded inside, wide openings at the shared datums (1 / 11 / 21 ft), 8 ft clear in the main spaces and 7 ft under
shelves; G1 and G5 are STEPPED (a notch cut from the top that a neighbour fills: a cube shifted by 10 ft in x or y and 10 ft up) and each has a matching cubic backup (`_v6c`)."""
import math  # noqa: F401
from paths6 import *  # noqa: F401,F403


def _name(base, cubic):
    return base + ("c" if cubic else "")


def G1(cubic=False):
    """Gathering 1, stepped amphitheater. A bowl eroded into the block: a flat stage at the ground datum at the front, seating as contour terraces (1 ft risers, 2.4 ft treads) that wander in arcs round
    the stage and climb to a rear walk 5 ft up, a SEPARATE sloping ledge along the west wall as the way up, a roof that rides the seating up. STEPPED: the stage half of the roof is cut away 10 ft down
    (the roof steps up with the seating); a cube shifted 10 ft and 10 ft up nests over the stage."""
    P = WidePorts(wide=5.0, foyer_h=8.4).face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    steps = [] if cubic else [step_top("y-", 10, 10)]
    cont, mask, _ = cube_env((20, 20, 20), steps)
    wob = smooth_noise2(41, 6.0)

    def top(x, y):
        d = math.hypot(x - 12.0, (y - 3.0) * 1.15) + 0.8 * wob(x, y)
        n = 0 if d < 6.0 else min(5, 1 + int((d - 6.0) / 2.4))
        return D0 + n * 1.0 if y < 16.5 else D0 + 5.0

    def inside(x, y):
        return x > 8.0 + 0.8 * wob(x, y + 5) and y > 4.4 and not (x > 14.5 and y < 9.5)       # the terraces stop short of the east door: its apron stays level
    seats = terrain(top, inside, n=40, zbot=0.0, size=20.0)
    ledge_path = [(4.6, 3.5, D0), (4.4, 10.0, D0 + 2.4), (4.8, 16.5, D0 + 5.0)]
    ledge = street(ledge_path, [3.8, 4.4, 3.8], 12.0)
    rooms = lobed(12, 4.5, D0, 9.6, 4.3, seed=1, n=3) + lobed(12, 9.5, D0 + 2.0, 14.5, 3.8, seed=2, n=2) + lobed(12, 13.5, D0 + 3.6, 16.0, 3.6, seed=3, n=2) + lobed(12, 16.8, D0 + 5.0, 17.0, 3.2, seed=4, n=2)
    rooms += [throat((3.0, 5.0), (9.0, 5.0), D0 + 3.4, spread=3.4, k=1.2)]
    ramp = path_pods(ledge_path, r=2.4, height=8.4, spacing=3.6, skip=0.5, stop=0.5)
    return recipe6(_name("gathering_1_stepped_amphitheater_v6", cubic), cont, [floor_group("ground", [ground()]), floor_group("terraces", [seats]), floor_group("ledge", [ledge])], tame(rooms, mask) + tame(ramp, mask, skin=1.0) + P.sources(), seed=11, foam_seed=411)


def G2(cubic=False):
    """Gathering 2, void-field gathering. Not a hall: a field of separate rooms, each its own cave, divided by thick foam and joined where two barrels meet. Two fields, one over the other: the
    floor of the upper one is a thick shelf of ground (1.6 ft) with a lobed edge, so the ceilings below are domed foam and nothing reads as a slab. A cube."""
    P = WidePorts(wide=5.2, foyer_h=8.6).face("-y", 10, D0).face("+x", 10, D0).face("-x", 10, D0).face("+y", 10, D0).face("-y", 10, D1).face("+x", 10, D1).face("-x", 10, D1).face("+y", 10, D1)
    cont, mask, _ = cube_env((20, 20, 20))
    shelf = terrain(lambda x, y: D1, lobe_fn(10, 10, 14.0, 14.0, seed=7, wobble=0.12), n=40, zbot=D1 - 1.6, size=20.0)
    s = lobed(10, 10, D0, 10.0, 4.3, seed=1, n=3)
    s += [lobed(cx, cy, D0, 9.6, 3.4, seed=10 + i, n=1)[0] for i, (cx, cy) in enumerate([(4.8, 4.8), (15.2, 4.8), (4.8, 15.2), (15.2, 15.2)])]
    s += lobed(10, 10, D1, 17.6, 4.3, seed=2, n=3)
    s += [lobed(cx, cy, D1, 16.8, 3.2, seed=20 + i, n=1)[0] for i, (cx, cy) in enumerate([(10, 4.2), (15.8, 10), (10, 15.8), (4.2, 10)])]
    return recipe6("gathering_2_void_field_gathering_v6", cont, [floor_group("ground", [ground()]), floor_group("upper field", [shelf])], (tame(s, mask) + P.sources())[:24], seed=12, foam_seed=112)


def G3(cubic=False):
    """Gathering 3, inserted horizontal plate. One tall cave with a shelf of ground pushed into it: at the upper datum, full width where it grows out of the south wall, ending in a free, lobed edge a
    little past the middle. A low domed room under it (7 ft clear), a hall over it, a double-height hall beyond its edge. A cube."""
    P = WidePorts(wide=5.2, foyer_h=8.6).face("+y", 10, D0).face("-y", 10, D0).face("-x", 15, D0).face("+x", 15, D0).face("-y", 10, D1).face("-x", 5, D1).face("+x", 5, D1)
    cont, mask, _ = cube_env((20, 20, 20))
    wob = smooth_noise2(43, 7.0)
    shelf = terrain(lambda x, y: D1, lambda x, y: y < 12.3 + 2.2 * wob(x, 0.0) and y > -1, n=40, zbot=D1 - 1.6, size=20.0)
    s = lobed(10, 6.2, D0, 10.0, 4.3, seed=1, n=2) + lobed(4.5, 6, D0, 9.6, 3.4, seed=2, n=1) + lobed(15.5, 6, D0, 9.6, 3.4, seed=3, n=1)
    s += lobed(10, 7.2, D1, 17.4, 4.0, seed=4, n=2) + lobed(5, 7, D1, 16.5, 3.2, seed=5, n=1)
    s += lobed(11, 16.0, D0, 17.6, 4.3, seed=7, n=2) + lobed(4.5, 16.5, D0, 15.5, 3.4, seed=8, n=1)
    return recipe6("gathering_3_inserted_horizontal_plate_v6", cont, [floor_group("ground", [ground()]), floor_group("shelf", [shelf])], tame(s, mask) + P.sources(), seed=13, foam_seed=113)


def G4(cubic=False):
    """Gathering 4, contained room-within-volume. A kernel of foam stands in a tall cave and a small chamber is carved inside it: a room contained in a larger space (the one small door the type needs).
    The cave wraps the kernel on every side and goes up over it into one hall; a walkable ring round the kernel joins the forecourt and both side passages. A cube."""
    P = WidePorts(wide=5.4, foyer_h=9.0).face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    cont, mask, _ = cube_env((20, 20, 20))
    s = lobed(10, 3.8, D0, 17.0, 4.3, seed=1, n=3) + lobed(3.0, 12.0, D0, 16.0, 2.9, seed=2, n=2) + lobed(17.0, 12.0, D0, 16.0, 2.9, seed=3, n=2) + lobed(10, 18.0, D0 + 5.0, 16.5, 2.6, seed=4, n=1)
    s += lobed(10, 12.0, 10.6, 17.6, 4.8, seed=5, n=3)                      # the hall over the kernel
    s += lobed(10, 12.0, D0 + 0.5, 8.0, 2.5, seed=6, n=2)                    # the room in the kernel
    s += [throat((10, 6.4), (10, 10.0), D0 + 3.0, spread=3.4, k=1.2)]        # its door
    return recipe6("gathering_4_contained_room_within_volume_v6", cont, [floor_group("ground", [ground()])], (tame(s, mask) + P.sources())[:24], seed=14, foam_seed=114)


def G5(cubic=False):
    """Gathering 5, linear edge gallery. A gallery 6 to 7 ft wide runs the length of two sides, from the east wall round the corner to the north wall, climbing as one natural ledge from the ground
    datum to the upper datum (slope about 0.37) with doors at its two ends and at the notch wall; the court it wraps is an open hall. STEPPED: the upper north-east quarter of the block is cut away (10 x 10 ft, 10 ft
    down): the gallery ends under an open sky, and a cube shifted by 10 ft in x and y and up 10 ft nests in it."""
    P = WidePorts(wide=4.8, foyer_h=8.6, plate_mode="stop", door_k=0.6, foyer_k=0.9)
    P.items = [dict(axis="x", plane=20.0, u=5.0, floor=D0, inward=-1, kw=dict(slope=0.36, k=0.7, spread=4.4)), dict(axis="y", plane=20.0, u=6.8, floor=D1, inward=-1, kw=dict(spread=4.8))]
    P.add("x", 10.0, 18.4, D1, -1, spread=4.0)                                # the notch wall: the landing's door, where the cube that fills the notch has its ground floor
    steps = [] if cubic else [box_cut(10, 20, 10, 20, 10, 20)]
    cont, mask, _ = cube_env((20, 20, 20), steps)
    path = [(19.8, 5.0, D0), (13.0, 5.0, D0 + 2.6), (8.8, 5.4, D0 + 5.0), (6.8, 9.0, D0 + 6.6), (6.8, 15.0, D0 + 8.9), (6.8, 19.8, D1)]
    ledge = street(path, [6.0, 6.2, 6.2, 5.6, 5.4, 5.4], 12.0)
    landing = terrain(lambda x, y: D1, lambda x, y: 4.0 < x < 10.2 + 0.3 * math.sin(3 * y) and 17.4 < y < 20.5, n=40, zbot=D1 - 1.6, size=20.0)   # flat at the upper datum: the ledge arrives here and the notch wall's door opens from it
    s = path_pods(path, r=3.2, height=9.2, spacing=3.3, skip=2.0, stop=0.0, k=2.6, plate_mode="stop")
    s += [pod(8.2, 18.2, D1 - 0.2, D1 + 8.6, 3.2, k=1.2)]                     # headroom over the landing
    s += lobed(14.5, 14.5, D0, 9.0, 3.6, seed=9, n=2)                         # the court the gallery wraps
    return recipe6(_name("gathering_5_linear_edge_gallery_v6", cubic), cont, [floor_group("ground", [ground()]), floor_group("ledge", [ledge]), floor_group("landing", [landing])], tame(s, mask, skin=1.2) + P.sources(), seed=15, foam_seed=115)
