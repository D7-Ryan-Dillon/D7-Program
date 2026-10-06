"""The V4 lobby tiles L1 to L5. See defs.py for the family conventions."""
import math  # noqa: F401
from kit4 import *  # noqa: F401,F403


def _ground(res=3.0, poly=None, size=20.0):
    if poly is None:
        return plate_group("ground slab", [rect_slab(0, 0, size, size, D0)], thickness=SLAB0, resistance=res, auto_support=False)
    return plate_group("ground slab", [floor_poly(poly, D0)], thickness=SLAB0, resistance=res, auto_support=False)


def L1():
    """Lobby 1, vertical void lobby. A 20 x 20 ft tile stacked to 40 ft (two lattice increments): one tall void and, round its walls, a single ramp that climbs two storeys in two turns (4 ft wide,
    about 0.31 slope, 0.5 ft risers, a flat landing at every corner) under a void that goes on up to 38 ft. The corner landings fall at the upper datums, so a door opens onto the ramp at D1 and D2 as well as the ground. Arrival and
    the rise through the building are one thing: you come in at the foot of the void and climb round it."""
    ramp, slope, center = ring_ramp(10.0, 10.0, 6.0, 4.0, D0, 21.0, 2, start="s")
    P = Ports().face("-x", 10, D0).face("-y", 4.0, D1, sill=2.6).face("-y", 4.0, 21.0, sill=2.6).face("-x", 4.0, D1, sill=2.6).face("-x", 4.0, 21.0, sill=2.6)
    plates = [_ground(), plate_group("ring ramp", ramp, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = []
    for (z0, z1) in ((D0, 14.0), (12.5, 26.5), (25.0, 38.4)):                     # the tall void as three stacked lengths of pod, so it stays as wide at the top as at the bottom
        s += [pod(6.2, 6.2, z0, z1, 3.8), pod(13.8, 6.2, z0, z1, 3.8), pod(6.2, 13.8, z0, z1, 3.8), pod(13.8, 13.8, z0, z1, 3.8), pod(10.0, 10.0, z0, z1, 3.6)]
    return recipe4("lobby_1_vertical_void_lobby_v4", box_container((20, 20, 40)), plates, (s + P.sources())[:24], steps=190, gravity=0.5, seed=26, foam_seed=126)


def L2():
    """Lobby 2, compressed sequential lobby. A sequence of three chambers along the tile from south to north, joined by deliberate pinches: a 4 ft doorway at the south face, a 4 ft opening in a full-height
    diaphragm wall between the first and second chamber, and a 3.6 ft opening between the second and the third. The chambers are tall eroded rooms (about 8 to 14 ft across); the pinches are the retained
    foam walls with a lintel over each opening, so the way in goes low and narrow, high and wide, narrow, wide, narrow, wide. Side doors from the middle chamber for the neighbours."""
    def wall(y0, y1, gap0, gap1, lintel=9.0):
        return [box((0.0, y0, D0), (gap0, y1, 19.0)), box((gap1, y0, D0), (20.0, y1, 19.0)), box((gap0, y0, lintel), (gap1, y1, 19.0))]
    walls = wall(0.0, 1.5, 8.0, 12.0) + wall(7.5, 9.0, 8.0, 12.0) + wall(14.5, 16.0, 8.2, 11.8)
    P = Ports().face("-x", 11.7, D0).face("+x", 11.7, D0).face("+y", 10, D0)
    plates = [_ground(), plate_group("pinch walls", walls, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(7.0, 4.6, D0, 17.6, 3.0, k=1.0), pod(13.0, 4.6, D0, 17.6, 3.0, k=1.0)]                    # the first chamber
    s += [pod(6.0, 11.7, D0, 17.6, 3.3), pod(10.0, 11.7, D0, 17.6, 3.3), pod(14.0, 11.7, D0, 17.6, 3.3)]  # the second, wider and taller
    s += [pod(7.5, 17.4, D0, 17.6, 2.6, k=1.0), pod(12.5, 17.4, D0, 17.6, 2.6, k=1.0)]                  # the third
    s += [pod(10.0, 8.25, D0, 8.6, 2.0, k=1.0), pod(10.0, 15.25, D0, 8.6, 1.9, k=1.0), pod(10.0, 0.75, D0, 8.6, 2.0, k=1.0)]     # the pinches, void from the floor to the lintel
    return recipe4("lobby_2_compressed_sequential_lobby_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=27, foam_seed=127)


def L3():
    """Lobby 3, continuous hall lobby. A long nave, 9 ft wide and 17 ft high, runs the whole length of the tile from south door to north door, flanked on each side by a row of four slender piers (an arcade)
    and, behind the piers, a low side aisle; the arcade makes the nave read as one continuous hall whose walls are a rhythm, not a surface. Doors at the two ends and through each aisle."""
    piers = [box((x, y, D0), (x + 1.4, y + 1.4, 17.0)) for x in (5.0, 13.6) for y in (3.6, 7.6, 11.6, 15.6)]
    P = Ports().face("-y", 10, D0).face("+y", 10, D0).face("-x", 10, D0).face("+x", 10, D0)
    plates = [_ground(), plate_group("arcade", piers, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(10.0, 4.5, D0, 17.6, 3.4), pod(10.0, 9.0, D0, 17.6, 3.4), pod(10.0, 14.0, D0, 17.6, 3.4), pod(10.0, 17.0, D0, 17.6, 3.0, k=1.0)]
    s += [pod(3.4, 6.0, D0, 10.0, 2.3), pod(3.4, 14.0, D0, 10.0, 2.3), pod(16.6, 6.0, D0, 10.0, 2.3), pod(16.6, 14.0, D0, 10.0, 2.3)]
    return recipe4("lobby_3_continuous_hall_lobby_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=28, foam_seed=128)


def L4():
    """Lobby 4, topographic / ground-field lobby. The floor is a landscape: ground that rises from the ground datum at the south door in one broad swell, with two low mounds on it (benches of flat ground
    at three heights), to about 5 ft at the north; none of it steeper than 0.45, so the whole lobby is walked as a field, not by stairs. Above it the roof is the counter-landscape: a vault that follows the
    ground up. Doors at the south and both sides at the ground datum."""
    def ground(x, y):
        t = min(1.0, max(0.0, (y - 3.0) / 13.0))
        swell = 4.2 * (t * t * (3 - 2 * t))
        mound = 0.8 * math.exp(-((x - 6.0) ** 2 + (y - 9.0) ** 2) / 6.0) + 0.8 * math.exp(-((x - 14.5) ** 2 + (y - 13.5) ** 2) / 6.0)
        return D0 + swell + mound
    P = Ports().face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    plates = [plate_group("the ground field", [ground_field(ground, n=40, zbot=0.0, size=20.0)], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = []
    for (y, z) in ((5.5, D0), (9.0, D0 + 1.5), (12.5, D0 + 3.4), (15.2, D0 + 4.6)):
        s.append(src_line([(5.6, y, z + 4.2), (14.4, y, z + 4.2)], dose_for(4.8, 10.0, 1.5), 4.8, "pool"))
    s += [src_line([(6.0, 12.0, 14.0), (14.0, 12.0, 14.0)], dose_for(5.0, 8.0, 1.0), 5.0, "pool")]
    return recipe4("lobby_4_topographic_ground_field_lobby_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=29, foam_seed=129)


def L5():
    """Lobby 5, linear gallery lobby. An L-shaped tile: one long flat gallery runs the length of the L, from the east arm's end round the corner to the north arm's end, 7 ft wide and 8 ft high, and at three
    places along it (the end of each arm and the corner) it swells into a tall chamber 8 ft across and 17 ft high, like beads on a string: the gallery is how you arrive, the chambers are where you stop.
    Doors on both arm ends, through the far walls of the arms (the outside of the L's corner) and through the notch walls."""
    plan = L_plan(20.0, 20.0, 10.0, "ne")
    P = Ports().add("x", 20.0, 5.0, D0, -1, k=1.1, spread=4.2).add("y", 20.0, 5.0, D0, -1, k=1.1, spread=4.2).add("x", 10.0, 15.0, D0, -1, k=1.1, spread=4.2).add("y", 10.0, 15.0, D0, -1, k=1.1, spread=4.2).add("x", 0.0, 5.0, D0, 1, k=1.1, spread=4.2).add("y", 0.0, 5.0, D0, 1, k=1.1, spread=4.2)
    plates = [_ground(poly=plan), P.plate_group()]
    s = [pod(15.0, 5.0, D0, 17.4, 3.4), pod(5.0, 5.0, D0, 17.4, 3.6), pod(5.0, 15.0, D0, 17.4, 3.4)]
    s += [throat((14.0, 5.0), (6.5, 5.0), D0 + 3.9, spread=4.2, k=0.9), throat((5.0, 6.5), (5.0, 14.0), D0 + 3.9, spread=4.2, k=0.9)]
    return recipe4("lobby_5_linear_gallery_lobby_v4", container_xy(plan), plates, s + P.sources(), steps=170, gravity=0.5, seed=30, foam_seed=130)
