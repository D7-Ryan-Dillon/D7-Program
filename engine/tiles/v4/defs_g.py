"""The V4 gathering tiles G1 to G5. See defs.py for the family conventions."""
import math  # noqa: F401
from kit4 import *  # noqa: F401,F403


def _ground(res=3.0, poly=None):
    if poly is None:
        return plate_group("ground slab", [rect_slab(0, 0, 20, 20, D0)], thickness=SLAB0, resistance=res, auto_support=False)
    return plate_group("ground slab", [floor_poly(poly, D0)], thickness=SLAB0, resistance=res, auto_support=False)


def G1():
    """Gathering 1, stepped amphitheater. A bowl in one tall eroded cavern: a flat stage at the ground datum, five seating terraces (1 ft risers, 2.2 ft
    treads: seats, not steps) climbing away from it to a rear walk 5 ft up, and a SEPARATE 4 ft aisle stair (0.33 slope, 0.5 ft risers) along the west wall
    that is the only way up. The roof is high (about 13 ft above the top row). Doors onto the stage on the south and on both sides."""
    y0, depth, n = 6.0, 2.2, 5
    terr = seating(5.5, 19.0, y0, n, 1.0, depth, base=D0)
    rear = box((5.5, y0 + n * depth, 0.0), (19.0, 19.0, D0 + n * 1.0))
    flights, run, slope, center = stair_path([(3.5, 3.5), (3.5, 17.0)], 4.0, D0, D0 + n * 1.0)
    P = Ports().face("-y", 10, D0).face("-x", 4.0, D0).face("+x", 4.0, D0)
    plates = [_ground(), plate_group("seating terraces", terr + [rear], thickness=1.0, resistance=3.0, auto_support=False),
              plate_group("aisle stair", flights, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = []
    for y in (5.4, 9.0, 12.3, 14.6):         # one tunnel per bay, riding the terraces up, so the roof of the bowl steps with the seating
        top = D0 if y < y0 else D0 + min(n, 1 + int((y - y0) / depth)) * 1.0
        s.append(src_line([(5.6, y, top + 4.15), (14.6, y, top + 4.15)], dose_for(4.8, 12.0, 1.5), 4.8, "pool"))
    s += [src_line([(5.5, 9.0, 14.5), (15.0, 9.0, 14.5)], dose_for(5.0, 12.0, 1.0), 5.0, "pool"), src_line([(5.5, 13.5, 14.5), (15.0, 13.5, 14.5)], dose_for(5.0, 12.0, 1.0), 5.0, "pool")]
    return recipe4("gathering_1_stepped_amphitheater_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=11, foam_seed=111)


def G2():
    """Gathering 2, void-field gathering. No hall: a field of separate voids, each its own room, divided by retained foam walls and joined by doorways. Two fields stacked
    on two floors. On the ground a great round room 8 ft across with four satellite rooms at the corners, each through its own 4.8 ft doorway; above, a different field (a
    big round room with four satellites in a cross). Each room is a circle of its own radius; the foam between them is 1.5 to 3 ft thick; a doorway reaches each of the four faces on each floor. The upper field is a receiving floor: it has no stair of its own, a neighbour's ramp arrives at it."""
    gz = [in_circle(10.0, 10.0, 4.0), in_circle(4.2, 4.2, 2.8), in_circle(15.8, 4.2, 2.8), in_circle(4.2, 15.8, 2.8), in_circle(15.8, 15.8, 2.8)]
    gz += [in_capsule((7.6, 7.6), (5.6, 5.6), 2.4), in_capsule((12.4, 7.6), (14.4, 5.6), 2.4), in_capsule((7.6, 12.4), (5.6, 14.4), 2.4), in_capsule((12.4, 12.4), (14.4, 14.4), 2.4)]
    gz += [in_rect(7.0, 0.0, 13.0, 7.0), in_rect(13.0, 7.0, 20.0, 13.0)]
    uz = [in_circle(10.0, 10.0, 4.0), in_circle(10.0, 4.2, 2.8), in_circle(15.8, 10.0, 2.8), in_circle(10.0, 15.8, 2.8), in_circle(4.2, 10.0, 2.8)]
    uz += [in_rect(7.6, 5.0, 12.4, 7.4), in_rect(12.6, 7.6, 14.6, 12.4), in_rect(7.6, 12.6, 12.4, 14.8), in_rect(5.2, 7.6, 7.4, 12.4)]
    uz += [in_rect(7.0, 0.0, 13.0, 5.0), in_rect(14.0, 7.0, 20.0, 13.0)]
    P = Ports().face("-y", 10, D0).face("+x", 10, D0).face("-x", 10, D0).face("+y", 10, D0).face("-y", 10, D1).face("+x", 10, D1).face("-x", 10, D1).face("+y", 10, D1)
    plates = [plate_group("floors", [rect_slab(0, 0, 20, 20, D0), rect_slab(0, 0, 20, 20, D1)], thickness=1.0, resistance=3.0, auto_support=False),
              plate_group("walls of the field", [poche(gz, D0, 10.0, wobble=0.25, seed=3), poche(uz, D1, 18.6, wobble=0.25, seed=7)], resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(10.0, 10.0, D0, 10.0, 4.4)] + [pod(cx, cy, D0, 10.0, 3.2) for (cx, cy) in ((4.2, 4.2), (15.8, 4.2), (4.2, 15.8), (15.8, 15.8))]
    s += [pod(10.0, 10.0, D1, 17.4, 4.0), pod(10.0, 4.2, D1, 17.4, 3.2), pod(15.8, 10.0, D1, 17.4, 3.2), pod(10.0, 15.8, D1, 17.4, 3.2), pod(4.2, 10.0, D1, 17.4, 3.2)]
    return recipe4("gathering_2_void_field_gathering_v4", box_container((20, 20, 20)), plates, (s + P.sources())[:24], steps=170, gravity=0.5, seed=21, foam_seed=112)


def G3():
    """Gathering 3, inserted horizontal plate. One tall eroded hall with a plate pushed into it: a flat floor at the upper datum that grows out of the south wall (full width, where it
    meets the doors) and ends in a curved, free edge a little past the middle of the hall. Below it a low ground room; above it the hall goes up to the roof; beyond its edge the hall is
    double height. The plate is the whole idea, so nothing else is allowed to look like it. Doors on all four faces at the ground and on three faces of the plate; the plate is a receiving floor, reached where a neighbour's ramp arrives at 11 ft."""
    edge = [(0, 0), (20, 0), (20, 11.0), (18.0, 12.0), (15.0, 12.8), (11.5, 13.0), (8.0, 12.5), (5.0, 12.0), (2.0, 11.4), (0, 11.0)]
    P = Ports().face("-y", 10, D0).face("+y", 10, D0).face("-x", 15, D0).face("+x", 15, D0).face("-y", 10, D1).face("-x", 5, D1).face("+x", 5, D1)
    plates = [_ground(), plate_group("inserted plate", [floor_poly(edge, D1)], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(5.0, 6.2, D0, 10.0, 3.7), pod(10.0, 6.0, D0, 10.0, 3.7), pod(15.0, 6.2, D0, 10.0, 3.7)]                       # the low room under the plate
    s += [pod(5.4, 7.2, D1, 17.4, 3.2, k=0.8), pod(10.0, 7.2, D1, 17.4, 3.2, k=0.8), pod(14.6, 7.2, D1, 17.4, 3.2, k=0.8)]                  # the hall over the plate
    s += [pod(6.2, 15.4, D0, 17.6, 3.5), pod(13.8, 15.4, D0, 17.6, 3.5), pod(10.0, 12.6, D0 + 2.0, 17.6, 3.5)]              # the tall hall beyond its edge
    return recipe4("gathering_3_inserted_horizontal_plate_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=31, foam_seed=113)


def G4():
    """Gathering 4, contained room-within-volume. A big tall eroded volume, and standing in it an enclosure of retained foam, 10 ft by 9 ft and 9 ft high with its own roof and one 3.6 ft door: a small room
    contained inside a larger space. The room's walls are plates (they resist the erosion that made everything around them); the volume wraps it on every side and rises over its roof into one tall hall.
    Doors onto the volume's forecourt from the south and both sides."""
    wall = 1.5
    ex0, ey0, ex1, ey1 = 5.0, 7.0, 15.0, 16.0
    walls = [box((ex0, ey0, D0), (8.2, ey0 + wall, 9.0)), box((11.8, ey0, D0), (ex1, ey0 + wall, 9.0)), box((ex0, ey1 - wall, D0), (ex1, ey1, 9.0)),
             box((ex0, ey0 + wall, D0), (ex0 + wall, ey1 - wall, 9.0)), box((ex1 - wall, ey0 + wall, D0), (ex1, ey1 - wall, 9.0))]
    roof = box((ex0, ey0, 9.0), (ex1, ey1, 10.0))
    P = Ports().face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    plates = [_ground(), plate_group("the room", walls + [roof], thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = [pod(5.6, 4.6, D0, 17.6, 3.0, k=0.9), pod(10.0, 4.4, D0, 17.6, 3.2, k=0.9), pod(14.4, 4.6, D0, 17.6, 3.0, k=0.9)]       # the forecourt, full height
    s += [pod(3.0, 11.5, D0, 17.6, 2.4, k=0.9), pod(17.0, 11.5, D0, 17.6, 2.4, k=0.9), pod(10.0, 17.8, D0 + 6.0, 17.6, 2.0, k=0.9)]  # the volume down both sides and behind
    s += [pod(8.0, 11.5, 10.4, 17.6, 3.2), pod(12.0, 11.5, 10.4, 17.6, 3.2)]                                               # the hall over the room's roof
    s += [pod(10.0, 11.6, D0 + 0.5, 8.5, 3.0, k=1.1)]                                                                       # the room itself
    return recipe4("gathering_4_contained_room_within_volume_v4", box_container((20, 20, 20)), plates, s + P.sources(), steps=170, gravity=0.5, seed=41, foam_seed=114)


def G5():
    """Gathering 5, linear edge gallery. An L-shaped tile: a single gallery 7 ft wide runs the whole length of the L, from the east arm's end round the corner to the north arm's end, climbing as one
    solid ramp from the ground datum to the upper datum (slope about 0.44, 0.5 ft risers, one corner landing). The notch beside it is open to the sky, so the gallery is the edge of an open
    court; behind it a thick wall of foam. Arrive at the ground at the east, leave at the upper datum at the north."""
    plan = L_plan(20.0, 20.0, 10.0, "ne")
    flights, run, slope, center = stair_path([(19.8, 5.0), (5.0, 5.0), (5.0, 19.8)], 7.0, D0, D1, solid=True)
    P = Ports().add("x", 20.0, 5.0, D0, -1, k=2.0, spread=4.2, slope=0.44).add("y", 20.0, 5.0, D1, -1, k=1.1, spread=4.2)
    plates = [_ground(poly=plan), plate_group("gallery ramp", flights, thickness=1.0, resistance=3.0, auto_support=False), P.plate_group()]
    s = ramp_pods(trim(center, 4.0, 0.0), r=2.9, height=8.6, spacing=4.0, k=1.3)
    return recipe4("gathering_5_linear_edge_gallery_v4", container_xy(plan), plates, s + P.sources(), steps=170, gravity=0.5, seed=51, foam_seed=115)
