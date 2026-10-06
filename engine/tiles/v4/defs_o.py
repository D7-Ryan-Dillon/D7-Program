"""The V4 office tiles O1 to O5. See defs.py for the family conventions."""
import math  # noqa: F401
from kit4 import *  # noqa: F401,F403


def _ground(res=3.0, poly=None):
    if poly is None:
        return plate_group("ground slab", [rect_slab(0, 0, 20, 20, D0)], thickness=SLAB0, resistance=res, auto_support=False)
    return plate_group("ground slab", [floor_poly(poly, D0)], thickness=SLAB0, resistance=res, auto_support=False)


def circle_poly(cx, cy, r, z, n=14):
    return slab([[round(cx + r * math.cos(2 * math.pi * i / n), 3), round(cy + r * math.sin(2 * math.pi * i / n), 3), z] for i in range(n)])


def O1():
    """Office 1, open hall workspace. One big hall you can see across, no partitions: a hall about 16 ft square and 13 ft high under a flat ceiling slab, four slender piers standing clear of the middle, and a
    long platform along the north wall (3 ft up, 16 ft long) that you reach by a 7.5 ft ramp running up the middle of the hall (slope 0.4): the platform is the one place that looks down on the rest.
    Doors on three faces at the ground datum."""
    piers = [box((x, y, D0), (x + 1.5, y + 1.5, 14.0)) for x in (4.0, 14.5) for y in (6.0, 10.0)]
    ramp = prism_yz([(6.0, 0.0), (13.5, 0.0), (13.5, D0 + 3.0), (6.0, D0)], 8.0, 12.0)
    plinth = box((2.0, 13.5, 0.0), (18.0, 18.5, D0 + 3.0))
    ceiling = rect_slab(0, 0, 20, 20, 15.0)
    P = Ports().face("-y", 10, D0).face("-x", 8, D0).face("+x", 8, D0)
    plates = [_ground(), plate_group("platform, ramp and piers", [ramp, plinth] + piers, thickness=1.0, resistance=3.0, auto_support=False),
              plate_group("ceiling", [ceiling], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(5.0, 8.2, D0, 14.4, 3.4, k=1.4), pod(15.0, 8.2, D0, 14.4, 3.4, k=1.4), pod(10.0, 4.4, D0, 14.4, 3.4, k=1.4)]            # the hall floor
    s += [pod(10.0, 8.0, D0 + 0.8, 14.4, 2.6, k=1.0), pod(10.0, 11.2, D0 + 2.4, 14.4, 2.6, k=1.0)]                                 # over the ramp
    s += [pod(5.4, 15.9, D0 + 3.0, 14.4, 3.0, k=1.2), pod(10.0, 15.9, D0 + 3.0, 14.4, 3.0, k=1.2), pod(14.6, 15.9, D0 + 3.0, 14.4, 3.0, k=1.2)]   # over the platform
    return recipe4("office_1_open_hall_workspace_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=21, foam_seed=121)


def O2():
    """Office 2, cascaded / terraced plates. Three deep floor plates step up the tile from south to north like a cascade: the ground floor at the south, a plate 2.5 ft up in the middle, and one 5 ft up on the
    north; each is 5 to 7 ft deep and 13.5 ft wide, with solid foam under it (the hill), and the drops between them are 2.5 ft (too high to step: they are walls to sit on or lean on). A 4 ft ramp
    climbs the west side from the ground floor to the top plate (slope 0.35) and meets each plate where its floor is the same height, so the plates are reached one after another by one path.
    One tall volume above them all."""
    p2 = box((5.5, 6.0, 0.0), (19.0, 12.0, D0 + 2.5))
    p3 = box((5.5, 12.0, 0.0), (19.0, 19.0, D0 + 5.0))
    ramp = prism_yz([(3.0, 0.0), (17.0, 0.0), (17.0, D0 + 5.0), (3.0, D0)], 1.5, 5.5)                    # a wedge of retained solid, 14 ft long, rising 5 ft (slope 0.36) ...
    top = box((1.5, 17.0, 0.0), (5.5, 19.0, D0 + 5.0))                                                       # ... and a landing at the top
    centre = [(3.5, 3.0, D0), (3.5, 17.0, D0 + 5.0)]
    P = Ports().face("-y", 10, D0).face("-x", 4.0, D0).face("+x", 4.0, D0)
    plates = [_ground(), plate_group("terraced plates", [p2, p3], thickness=1.0, resistance=3.0, auto_support=False),
              plate_group("ramp", [ramp, top], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = ramp_pods(trim(centre, 1.0, 1.5), r=2.3, height=8.6, spacing=3.6, k=1.3) + [pod(3.7, 16.9, D0 + 4.6, D0 + 14.0, 2.1, k=1.1), pod(6.6, 15.6, D0 + 4.8, D0 + 12.5, 2.4, k=1.1)]
    for (y, z) in ((4.6, D0), (9.0, D0 + 2.5), (15.3, D0 + 5.0)):                # the volume above each plate, riding the cascade up
        s.append(src_line([(7.4, y, z + 4.15), (15.4, y, z + 4.15)], dose_for(4.8, 10.0, 1.4), 4.8, "pool"))
    s += [src_line([(6.0, 9.5, 13.5), (14.0, 9.5, 13.5)], dose_for(5.0, 9.0, 1.0), 5.0, "pool"), src_line([(6.0, 14.8, 15.5), (14.0, 14.8, 15.5)], dose_for(4.6, 9.0, 1.0), 4.6, "pool")]
    return recipe4("office_2_cascaded_terraced_plates_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=22, foam_seed=122)


def O3():
    """Office 3, flat deep-plan plate. A single storey, 20 ft by 20 ft and only 10 ft high: one wide low room 16 ft square with eight feet of clear height, a floor plate and a roof plate (two flat
    slabs: the tile IS a plate), four slender piers between them, and four round light wells cut through the roof plate so the middle of a deep plan still sees the sky. Doors on all four faces
    at the ground datum."""
    piers = [box((x, y, D0), (x + 1.5, y + 1.5, 9.0)) for x in (6.5, 12.0) for y in (6.5, 12.0)]
    roof = [rect_slab(0, 0, 20, 20, 10.0)] + [circle_poly(cx, cy, 2.2, 10.0) for (cx, cy) in ((4.5, 4.5), (15.5, 4.5), (4.5, 15.5), (15.5, 15.5))]
    P = Ports().face("-y", 10, D0, h=7.5).face("+y", 10, D0, h=7.5).face("-x", 10, D0, h=7.5).face("+x", 10, D0, h=7.5)
    plates = [_ground(), plate_group("piers", piers, thickness=1.0, resistance=3.0, auto_support=False), plate_group("roof plate", roof, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [src_line([(4.8, y, D0 + 3.8), (15.2, y, D0 + 3.8)], dose_for(4.4, 10.0, 1.7), 4.4, "pool") for y in (5.0, 10.0, 15.0)]
    return recipe4("office_3_flat_deep_plan_plate_v4", box_container((20, 20, 10)), plates, s + P.sources(), steps=170, gravity=0.5, seed=23, foam_seed=123)


def O4():
    """Office 4, void-edge workspace. An L-shaped tile whose two arms are workspaces on two floors, each floor a strip 7 ft deep that runs along the edge of one tall void: a double-height void at
    the knuckle of the L, open to both floors, with the upper floor stopping at its edge. The notch of the L is the second void: open to the sky and free for a neighbour. Doors on both floors at the end of
    each arm, through each arm's far wall and through the walls of the notch; the upper floor is one connected strip round the void (a 4.5 ft opening in the 7 ft corner) and a receiving
    floor: it has no stair of its own, a neighbour's ramp arrives at it."""
    plan = L_plan(20.0, 20.0, 10.0, "ne")
    hole = [(2.5, 2.5), (7.0, 2.5), (7.0, 7.0), (2.5, 7.0)]
    upper = [floor_poly(plan, D1), floor_poly(hole, D1)]
    P = Ports().add("x", 20.0, 5.0, D0, -1, k=1.1, spread=4.2).add("y", 20.0, 5.0, D0, -1, k=1.1, spread=4.2).add("x", 20.0, 5.0, D1, -1, k=1.1, spread=4.2).add("y", 20.0, 5.0, D1, -1, k=1.1, spread=4.2)
    for z in (D0, D1):                                                                          # through the walls of the notch (so a neighbour that fills it can walk in) and the far walls of both arms
        P.add("x", 10.0, 15.0, z, -1, k=1.1, spread=4.2).add("y", 10.0, 15.0, z, -1, k=1.1, spread=4.2)
        P.add("x", 0.0, 15.0, z, 1, k=1.1, spread=4.2).add("y", 0.0, 15.0, z, 1, k=1.1, spread=4.2)
    plates = [_ground(poly=plan), plate_group("upper floor", upper, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(4.8, 4.8, D0, 17.0, 3.4)]                                                            # the void at the knuckle, double height
    s += [pod(14.2, 5.0, D0, 10.0, 3.9), pod(5.0, 14.2, D0, 10.0, 3.9)]                          # ground-floor workspace in the arms
    s += [pod(14.0, 5.0, D1, 17.0, 2.6), pod(5.0, 14.0, D1, 17.0, 2.6)]                          # upper-floor workspace in the arms
    for z in (D0, D1):
        sp = 4.8 if z == D0 else 3.8
        s += [throat((4.8, 4.8), (14.0, 5.0), z + 3.9, spread=sp, k=1.0), throat((4.8, 4.8), (5.0, 14.0), z + 3.9, spread=sp, k=1.0)]
    return recipe4("office_4_void_edge_workspace_v4", container_xy(plan), plates, s + P.sources(), steps=170, gravity=0.5, seed=24, foam_seed=124)


def O5():
    """Office 5, folded / undulating work surface. The floor and the roof are the same fold: one folded floor plate (flat valleys and flat ridges 1.6 ft wide joined by 3.4 ft slopes, 0.44 slope, a 1.5 ft
    rise, repeating every 10 ft across the tile) and a folded roof plate that runs parallel to it 9 ft above, so the whole room is a folded tube you work in. The work happens on the benches at two heights
    (the valley at the ground datum, the ridge 1.5 ft above it) and the people moving across the folds walk up and down gentle ramps. Doors on the valley lines at the ground datum."""
    def fold(x, y):
        u = (x % 10.0)
        u = min(u, 10.0 - u)                       # distance from the nearest valley centre (0..5)
        t = min(1.0, max(0.0, (u - 0.8) / 3.4))    # 0 on the valley bench, 1 on the ridge bench
        return D0 + 1.5 * t
    roof = shell(lambda x, y: fold(x, y) + 10.6, 1.0, step=0.5)
    P = Ports().face("-y", 10, D0).face("+y", 10, D0).face("-x", 10, D0).face("+x", 10, D0)
    plates = [plate_group("folded floor", [ground_field(fold, n=40, zbot=0.0, size=20.0)], thickness=1.0, resistance=3.0, auto_support=False),
              plate_group("folded roof", [roof], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = []
    for x in (5.8, 10.0, 14.2):
        s.append(src_line([(x, 6.0, fold(x, 5.0) + 5.4), (x, 14.0, fold(x, 5.0) + 5.4)], dose_for(5.0, 10.0, 1.3), 5.0, "pool"))
    s += [src_line([(6.0, 5.8, 7.0), (14.0, 5.8, 7.0)], dose_for(4.6, 8.0, 1.0), 4.6, "pool"), src_line([(6.0, 14.2, 7.0), (14.0, 14.2, 7.0)], dose_for(4.6, 8.0, 1.0), 4.6, "pool")]
    return recipe4("office_5_folded_undulating_work_surface_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=25, foam_seed=125)
