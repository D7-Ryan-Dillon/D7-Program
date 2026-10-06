"""The V5 gathering tiles G1 to G5: the typology of each is kept, but every wall is foam left between voids, floors are flat shelves with irregular edges, and the outline is eroded."""
import math  # noqa: F401
from paths5 import *  # noqa: F401,F403


def G1():
    """Gathering 1, stepped amphitheater. A cavern bowl: flat stage at the ground datum, seating as contour terraces (1 ft risers) that wander in arcs round the stage, a rear walk 5 ft up, and a
    SEPARATE sloping ledge along the west wall that is the only way up. The roof rides the terraces. The upper north-east corner of the block is eaten away (a bite a neighbour can fill)."""
    P = SoftPorts().face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    cont, mask, _ = envelope((20, 20, 20), seed=11, bays=[bay("ne", 8, 8, 2.5, z0=12.0)], pads=P.pads())
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
    rooms = lobed(12, 4.5, D0, 14.0, 4.3, seed=1, n=3) + lobed(12, 9.5, D0 + 2.0, 14.5, 3.8, seed=2, n=2) + lobed(12, 13.5, D0 + 3.6, 16.0, 3.6, seed=3, n=2) + lobed(12, 16.8, D0 + 5.0, 17.0, 3.2, seed=4, n=2)
    rooms += [throat((3.0, 5.0), (9.0, 5.0), D0 + 3.4, spread=3.4, k=1.2)]
    ramp = path_pods(ledge_path, r=2.4, height=8.4, spacing=3.6, skip=0.5, stop=0.5)
    return recipe5("gathering_1_stepped_amphitheater_v5", cont, [floor_group("ground", [ground()]), floor_group("terraces", [seats]), floor_group("ledge", [ledge])], tame(rooms, mask) + tame(ramp, mask, skin=1.0) + P.sources(), seed=11, foam_seed=111)


def G2():
    """Gathering 2, void-field gathering. Not a hall: a field of separate rooms, each its own cave, divided by thick foam and joined where two barrels meet. Two fields, one over the other: the
    floor of the upper one is a thick shelf of ground (2 ft) with a lobed edge, so the ceilings below are domed foam and nothing reads as a slab."""
    P = SoftPorts().face("-y", 10, D0).face("+x", 10, D0).face("-x", 10, D0).face("+y", 10, D0).face("-y", 10, D1).face("+x", 10, D1).face("-x", 10, D1).face("+y", 10, D1)
    cont, mask, _ = envelope((20, 20, 20), seed=12, amp=1.2, roof=1.0, pads=P.pads())
    shelf = terrain(lambda x, y: D1, lobe_fn(10, 10, 14.0, 14.0, seed=7, wobble=0.12), n=40, zbot=D1 - 1.6, size=20.0)
    s = lobed(10, 10, D0, 10.0, 4.3, seed=1, n=3)
    s += [lobed(cx, cy, D0, 9.6, 3.4, seed=10 + i, n=1)[0] for i, (cx, cy) in enumerate([(4.8, 4.8), (15.2, 4.8), (4.8, 15.2), (15.2, 15.2)])]
    s += lobed(10, 10, D1, 17.6, 4.3, seed=2, n=3)
    s += [lobed(cx, cy, D1, 16.8, 3.2, seed=20 + i, n=1)[0] for i, (cx, cy) in enumerate([(10, 4.2), (15.8, 10), (10, 15.8), (4.2, 10)])]
    return recipe5("gathering_2_void_field_gathering_v5", cont, [floor_group("ground", [ground()]), floor_group("upper field", [shelf])], (tame(s, mask) + P.sources())[:24], seed=12, foam_seed=112)


def G3():
    """Gathering 3, inserted horizontal plate. One tall cave with a shelf of ground pushed into it: at the upper datum, full width where it grows out of the south wall, ending in a free,
    lobed edge a little past the middle. A low domed room under it, a hall over it, a double-height hall beyond its edge. The north-west corner of the block is a bay."""
    P = SoftPorts().face("+y", 10, D0).face("-y", 10, D0).face("-x", 15, D0).face("+x", 15, D0).face("-y", 10, D1).face("-x", 5, D1).face("+x", 5, D1)
    cont, mask, _ = envelope((20, 20, 20), seed=13, roof=1.0, bays=[bay("nw", 7, 7, 2.5)], pads=P.pads())
    wob = smooth_noise2(43, 7.0)
    shelf = terrain(lambda x, y: D1, lambda x, y: y < 12.3 + 2.2 * wob(x, 0.0) and y > -1, n=40, zbot=D1 - 1.6, size=20.0)
    s = lobed(10, 6.2, D0, 10.0, 4.3, seed=1, n=2) + lobed(4.5, 6, D0, 9.6, 3.4, seed=2, n=1) + lobed(15.5, 6, D0, 9.6, 3.4, seed=3, n=1)
    s += lobed(10, 7.2, D1, 17.4, 4.0, seed=4, n=2) + lobed(5, 7, D1, 16.5, 3.2, seed=5, n=1)
    s += lobed(11, 16.0, D0, 17.6, 4.3, seed=7, n=2) + lobed(4.5, 16.5, D0, 15.5, 3.4, seed=8, n=1)
    return recipe5("gathering_3_inserted_horizontal_plate_v5", cont, [floor_group("ground", [ground()]), floor_group("shelf", [shelf])], tame(s, mask) + P.sources(), seed=13, foam_seed=113)


def G4():
    """Gathering 4, contained room-within-volume. A kernel of foam stands in a tall cave and a small chamber is carved inside it: a room contained in a larger space. The cave wraps the kernel on
    every side and goes up over it into one hall. The kernel's walls are simply the foam the erosion left (2 to 3 ft)."""
    P = SoftPorts().face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    cont, mask, _ = envelope((20, 20, 20), seed=14, amp=1.2, pads=P.pads())
    s = lobed(10, 3.8, D0, 17.0, 4.3, seed=1, n=3) + lobed(3.0, 12.0, D0, 16.0, 2.9, seed=2, n=2) + lobed(17.0, 12.0, D0, 16.0, 2.9, seed=3, n=2) + lobed(10, 18.0, D0 + 5.0, 16.5, 2.6, seed=4, n=1)
    s += lobed(10, 12.0, 10.6, 17.6, 4.8, seed=5, n=3)                      # the hall over the kernel
    s += lobed(10, 12.0, D0 + 0.5, 8.0, 2.5, seed=6, n=2)                    # the room in the kernel
    s += [throat((10, 6.4), (10, 10.0), D0 + 3.0, spread=3.4, k=1.2)]        # its door
    return recipe5("gathering_4_contained_room_within_volume_v5", cont, [floor_group("ground", [ground()])], (tame(s, mask) + P.sources())[:24], seed=14, foam_seed=114)


def G5():
    """Gathering 5, linear edge gallery. An L-plan block (the north-east corner is a deep, rounded bay): a single gallery 6 to 7 ft wide runs the whole length of the L, from the east arm's end
    round the corner to the north arm's end, climbing as one natural ledge from the ground datum to the upper datum (slope about 0.37). The bay is an open court."""
    P = SoftPorts()
    P.items = [dict(axis="x", plane=20.0, u=5.0, floor=D0, inward=-1, kw=dict(slope=0.36, k=0.9, spread=3.8)), dict(axis="y", plane=20.0, u=5.0, floor=D1, inward=-1, kw={})]
    P.face("-y", 13.0, D0 + 2.6)                                              # doors on the way up: the ledge passes the south and west walls
    P.face("-x", 17.4, D0 + 9.45)
    cont, mask, _ = envelope((20, 20, 20), seed=15, roof=0.5, round_v=5.0, bays=[bay("ne", 10, 10, 2.5)], pads=P.pads())
    path = [(19.8, 5.0, D0), (13.0, 5.0, D0 + 2.6), (7.0, 5.4, D0 + 5.0), (5.0, 9.0, D0 + 6.6), (5.0, 15.0, D0 + 8.9), (5.0, 19.8, D1)]
    ledge = street(path, [6.4, 6.8, 7.4, 6.6, 6.2, 6.0], 12.0)
    s = path_pods(path, r=3.0, height=8.8, spacing=3.8, skip=2.0, stop=0.0)
    return recipe5("gathering_5_linear_edge_gallery_v5", cont, [floor_group("ground", [ground()]), floor_group("ledge", [ledge])], tame(s, mask, skin=1.2) + P.sources(), seed=15, foam_seed=115)
