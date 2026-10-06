"""The V6 lobby tiles L1 to L5: cubic blocks (L1 two storeys tall) eroded inside; L4 and L5 are STEPPED with cubic backups."""
import math  # noqa: F401
from paths6 import *  # noqa: F401,F403
from defs_g import _name


def L1(cubic=False):
    """Lobby 1, vertical void lobby. A 20 x 20 x 40 ft block with one tall chimney of a void and, winding round it twice, a natural spiral ledge that climbs two storeys at about 0.27 (a ramp that is
    part of the rock, 3.6 to 4.4 ft wide). The ledge passes the west wall at the ground datum, at 11 ft and at 21 ft, so the doors stack in one place: you arrive at the foot of the void and climb round it."""
    P = WidePorts(wide=5.0, foyer_h=8.6).face("-x", 10, D0).face("-x", 10, D1).face("-x", 10, D2)
    cont, mask, _ = cube_env((20, 20, 40))
    R = 5.0
    pts = []
    n = 48
    for i in range(n + 1):
        t = 4 * math.pi * i / n
        th = math.pi + t
        pts.append((10 + R * math.cos(th), 10 + R * math.sin(th), D0 + 20.0 * i / n))
    spiral = ribbon2(pts[::2], [3.8, 4.4, 4.0, 4.2, 3.8, 4.4, 4.0, 4.2, 3.8], 1.8)
    # landings at the upper doors: a small lobed shelf of ground in front of each, flat
    wob = smooth_noise2(46, 5.0)
    shelves = [terrain(lambda x, y, z=z: z, lambda x, y: x < 3.9 + 0.4 * wob(x, y) and abs(y - 10.0) < 2.8 + 0.4 * wob(y, x), n=20, zbot=z - 2.0, size=10.0, x0=0.0, y0=5.0) for z in (D1, D2)]
    segs = []
    spread = 4.6
    for q in range(8):
        a, b = q * 6, q * 6 + 6
        seg = [(x, y, z + 0.85 * spread + 0.05) for (x, y, z) in pts[a:b + 1]]
        length = sum(math.dist(seg[i], seg[i + 1]) for i in range(len(seg) - 1))
        segs.append(src_line(seg, dose_for(spread, length, 1.5), spread, "pool", False))
    segs += path_pods(pts[38:], r=2.7, height=9.0, spacing=3.4, skip=0.0, stop=0.0, k=2.0)       # the last quarter turn needs help: the solvent thins out near the end of a line
    chim = [lobed(10, 10, z0, z1, 2.7, seed=60 + i, n=1)[0] for i, (z0, z1) in enumerate(((D0, 14.0), (12.5, 26.5), (25.0, 38.4)))]
    return recipe6("lobby_1_vertical_void_lobby_v6", cont, [floor_group("ground", [ground()]), floor_group("spiral ledge", [spiral]), floor_group("landing 1", [shelves[0]]), floor_group("landing 2", [shelves[1]])], tame(segs, mask, skin=1.0) + chim + P.sources(), seed=26, foam_seed=126)


def L2(cubic=False):
    """Lobby 2, compressed sequential lobby. Three tall chambers one after another from south to north, joined where the foam between them is pierced by a narrow, tall slot: the way in goes
    low and narrow, high and wide, narrow, wide, narrow, wide. The slots are simply the thinnest places between neighbouring caves (the one place a narrow opening is the idea). A cube."""
    P = WidePorts(wide=5.2, foyer_h=9.0).face("-y", 10, D0).face("-x", 10, D0).face("+x", 10, D0).face("+y", 10, D0)
    cont, mask, _ = cube_env((20, 20, 20))
    rooms = lobed(10, 3.4, D0, 16.0, 3.3, seed=1, n=2) + lobed(10, 10.6, D0, 17.6, 4.2, seed=2, n=3) + lobed(14.6, 10.8, D0, 12.5, 3.2, seed=4, n=2) + lobed(10, 17.2, D0, 15.5, 3.1, seed=3, n=2)
    slots = [pod(10, 7.0, D0, 9.6, 1.9, k=1.3), pod(10, 14.0, D0, 9.6, 1.9, k=1.3)]
    return recipe6("lobby_2_compressed_sequential_lobby_v6", cont, [floor_group("ground", [ground()])], tame(rooms, mask) + slots + P.sources(), seed=27, foam_seed=127)


def L3(cubic=False):
    """Lobby 3, continuous hall lobby. A long nave, 8 ft wide and 17 ft high, running the whole length of the tile, with a low aisle on each side separated from it by a wall of foam that the erosion has
    perforated into a rhythm of piers and arches (nothing is built): the hall reads as continuous because its walls are a rhythm, not a surface. A cube."""
    P = WidePorts(wide=5.4, foyer_h=9.2).face("-y", 10, D0).face("+y", 10, D0).face("-x", 10, D0).face("+x", 10, D0)
    cont, mask, _ = cube_env((20, 20, 20))
    nave = lobed(10, 4.0, D0, 17.6, 3.6, seed=1, n=2) + lobed(10, 9.5, D0, 17.6, 3.6, seed=2, n=2) + lobed(10, 15.2, D0, 17.6, 3.6, seed=3, n=2)
    aisles = [lobed(x, y, D0, 10.5, 2.1, seed=40 + i, n=1)[0] for i, (x, y) in enumerate([(3.9, 6.8), (3.9, 12.6), (16.1, 6.8), (16.1, 12.6)])]
    return recipe6("lobby_3_continuous_hall_lobby_v6", cont, [floor_group("ground", [ground()])], tame(nave + aisles, mask, skin=1.2) + P.sources(), seed=28, foam_seed=128)


def L4(cubic=False):
    """Lobby 4, topographic / ground-field lobby. The floor is a landscape: a broad swell and two low mounds rising from the ground datum at the south to about 5.5 ft at the north, none steeper than
    0.45, walked as a field. The roof is the counter-landscape: a vault that follows the ground up. STEPPED: the low south 10 ft of the roof is cut 10 ft down (the roof follows the ground up); a cube
    shifted 10 ft and 10 ft up nests over the entrance."""
    P = WidePorts(wide=5.0, foyer_h=8.4).face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    steps = [] if cubic else [step_top("y-", 10, 10)]
    cont, mask, _ = cube_env((20, 20, 20), steps)

    def top(x, y):
        swell = 4.4 * sstep(6.0, 17.0, y)
        mound = 0.8 * math.exp(-((x - 6.0) ** 2 + (y - 10.0) ** 2) / 6.0) + 0.8 * math.exp(-((x - 14.5) ** 2 + (y - 13.5) ** 2) / 6.0)
        return D0 + swell + mound
    land = terrain(top, None, n=40, zbot=0.0, size=20.0)
    rooms = []
    for i, (y, r) in enumerate(((5.0, 4.4), (9.5, 4.4), (13.5, 4.2), (17.0, 3.6))):
        h = 9.0 if y < 8 else 9.5
        rooms += lobed(10, y, top(10, y), top(10, y) + h, r, seed=50 + i, n=3)
    return recipe6(_name("lobby_4_topographic_ground_field_lobby_v6", cubic), cont, [floor_group("the ground field", [land])], tame(rooms, mask) + P.sources(), seed=29, foam_seed=129)


def L5(cubic=False):
    """Lobby 5, linear gallery lobby. A ring gallery round the block's edge: a long low gallery from chamber to chamber, with a tall chamber at each corner (beads on a string); the gallery is how you
    arrive, the chambers are where you stop. STEPPED: the north-east corner chamber loses its top (10 x 10 ft, 10 ft down); a cube shifted 10 ft in x and y and up 10 ft nests in it."""
    P = WidePorts(wide=4.8, foyer_h=8.6).add("x", 20.0, 5.0, D0, -1).add("y", 20.0, 5.0, D0, -1).add("x", 0.0, 5.0, D0, 1).add("y", 0.0, 5.0, D0, 1)
    steps = [] if cubic else [box_cut(10, 20, 10, 20, 10, 20)]
    cont, mask, _ = cube_env((20, 20, 20), steps)
    rooms = lobed(15, 5, D0, 17.4, 3.8, seed=1, n=2) + lobed(5, 5, D0, 17.4, 4.0, seed=2, n=3) + lobed(5, 15, D0, 17.4, 3.8, seed=3, n=2) + lobed(15, 15, D0, 9.0, 3.6, seed=4, n=2)
    rooms += [throat((14, 5), (6.5, 5), D0 + 3.5, spread=3.6, k=1.2), throat((5, 6.5), (5, 14), D0 + 3.5, spread=3.6, k=1.2), throat((15, 6.5), (15, 13.5), D0 + 3.5, spread=3.6, k=1.2), throat((6.5, 15), (13.5, 15), D0 + 3.5, spread=3.6, k=1.2)]
    return recipe6(_name("lobby_5_linear_gallery_lobby_v6", cubic), cont, [floor_group("ground", [ground()])], tame(rooms, mask) + P.sources(), seed=30, foam_seed=130)
