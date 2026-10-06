"""The V6 workspace tiles O1 to O5: cubic blocks eroded inside; O2 is STEPPED (stage-side top cut) with a cubic backup."""
import math  # noqa: F401
from paths6 import *  # noqa: F401,F403
from defs_g import _name


def O1(cubic=False):
    """Office 1, open hall workspace. One big vaulted cavern you can see across, made of three overlapping barrels so the foam left between them stands as natural spurs and pillars (nothing is
    placed). A raised platform of ground along the north side (3 ft up, a lobed edge) reached by a natural ramp up the middle. A cube."""
    P = WidePorts(wide=5.6, foyer_h=9.4).face("-y", 10, D0).face("-x", 8, D0).face("+x", 8, D0)
    cont, mask, _ = cube_env((20, 20, 20))
    platform = terrain(lambda x, y: D0 + 3.0, lobe_fn(10, 16.8, 8.2, 3.4, seed=3, wobble=0.2), n=40, zbot=0.0, size=20.0)
    rpath = [(10.0, 6.2, D0), (10.2, 10.0, D0 + 1.7), (10.0, 13.6, D0 + 3.0)]
    ramp = street(rpath, [6.0, 5.2, 4.6], 12.0)
    rooms = lobed(6, 6.5, D0, 14.5, 4.3, seed=1, n=3) + lobed(14, 6.5, D0, 14.5, 4.3, seed=2, n=3) + lobed(10, 12.0, D0, 14.5, 4.3, seed=3, n=3)
    over = lobed(10, 16.8, D0 + 3.0, 15.0, 3.7, seed=4, n=2) + lobed(5.0, 16.0, D0 + 3.0, 14.0, 3.0, seed=5, n=1) + lobed(15.0, 16.0, D0 + 3.0, 14.0, 3.0, seed=6, n=1)
    rp = path_pods(rpath, r=2.4, height=8.4, spacing=3.6, skip=0.0, stop=0.0)
    return recipe6("office_1_open_hall_workspace_v6", cont, [floor_group("ground", [ground()]), floor_group("platform", [platform]), floor_group("ramp", [ramp])], tame(rooms + over, mask) + tame(rp, mask, skin=1.0) + P.sources(), seed=21, foam_seed=221)


def O2(cubic=False):
    """Office 2, cascaded / terraced plates. Floors that step up the tile like terraces of travertine: ground, a shelf 2.5 ft up, a shelf 5 ft up, each lobed and deep enough to work on, with the
    drops between them too high to step (2.5 ft). One ramp along the west wall climbs to the top and meets each shelf where it is level with it. STEPPED: the front (low) 10 ft of the roof is cut 10 ft
    down: the cave rides up the cascade and the roof steps with it; a cube shifted 10 ft and 10 ft up nests over the lowest terrace."""
    P = WidePorts(wide=5.0, foyer_h=8.4).face("-y", 10, D0).face("-x", 5, D0).face("+x", 5, D0)
    steps = [] if cubic else [step_top("y-", 10, 10)]
    cont, mask, _ = cube_env((20, 20, 20), steps)
    s1 = shelf(lambda x, y: D0 + 2.5, lobe_fn(12.5, 9.3, 8.8, 3.8, seed=4, wobble=0.18), (2.0, 4.0, 22.0, 15.0), zbot=0.0)
    s2 = shelf(lambda x, y: D0 + 5.0, lobe_fn(12.5, 15.5, 8.8, 4.6, seed=5, wobble=0.18), (2.0, 9.0, 22.0, 22.0), zbot=0.0)
    rpath = [(3.4, 3.2, D0), (3.0, 10.0, D0 + 2.6), (3.6, 17.0, D0 + 5.0)]
    ramp = street(rpath, [4.0, 4.2, 4.2], 12.0)
    rooms = lobed(12, 4.2, D0, 9.6, 4.2, seed=1, n=3) + lobed(12.5, 9.3, D0 + 2.5, 14.5, 4.0, seed=2, n=3) + lobed(12.5, 15.2, D0 + 5.0, 16.5, 3.8, seed=3, n=3)
    rp = path_pods(rpath, r=2.4, height=8.4, spacing=3.6, skip=0.0, stop=0.5) + [pod(6.6, 15.4, D0 + 4.8, D0 + 12.5, 2.3, k=1.4)]
    return recipe6(_name("office_2_cascaded_terraced_plates_v6", cubic), cont, [floor_group("ground", [ground()]), floor_group("shelf one", [s1]), floor_group("shelf two", [s2]), floor_group("ramp", [ramp])],
                   tame(rooms, mask) + tame(rp, mask, skin=1.0) + P.sources(), seed=22, foam_seed=122)


def O3(cubic=False):
    """Office 3, flat deep-plan plate. A single 10 ft storey: a wide low cave under a roof of foam, made of four overlapping barrels with the foam left between them as natural pillars, and four
    skylights that are simply shafts that reached the sky. The tile IS a plate in section (its floor and its thin crust). A 20 x 20 x 10 ft block."""
    P = WidePorts(wide=4.9, foyer_h=8.4).face("-y", 10, D0).face("+y", 10, D0).face("-x", 10, D0).face("+x", 10, D0)
    cont, mask, _ = cube_env((20, 20, 10))
    rooms = lobed(6, 10, D0, 8.8, 4.0, seed=1, n=3) + lobed(14, 10, D0, 8.8, 4.0, seed=2, n=3) + lobed(10, 5.0, D0, 8.8, 3.5, seed=3, n=2) + lobed(10, 15.0, D0, 8.8, 3.5, seed=4, n=2)
    sky = [pod(x, y, 6.0, 10.8, 1.8, k=1.3) for (x, y) in ((5, 5), (15, 5), (5, 15), (15, 15))]
    return recipe6("office_3_flat_deep_plan_plate_v6", cont, [floor_group("ground", [ground()])], tame(rooms, mask, skin=1.4) + sky + P.sources(), seed=23, foam_seed=123)


def O4(cubic=False):
    """Office 4, void-edge workspace. Workspace on two floors that WRAP the outside of the block (a shelf of ground along the west and south sides and round the corner, with a lobed inner edge) and
    look over one double-height void at the north-east corner. A cube."""
    P = WidePorts(wide=4.8, foyer_h=8.4)
    for z in (D0, D1):
        P.add("x", 20.0, 5.0, z, -1).add("y", 20.0, 5.0, z, -1).add("x", 0.0, 5.0, z, 1).add("y", 0.0, 5.0, z, 1)
    cont, mask, _ = cube_env((20, 20, 20))
    wob = smooth_noise2(44, 5.0)

    def inside(x, y):
        return not (x > 10.5 and y > 10.5) and math.hypot(x - 8.4, y - 8.4) > 3.9 + 0.5 * wob(x, y)
    shelf = terrain(lambda x, y: D1, inside, n=40, zbot=D1 - 1.6, size=20.0)
    rooms = lobed(8.4, 8.4, D0, 17.6, 3.4, seed=1, n=2) + lobed(4.5, 4.5, D0, 10.0, 3.2, seed=2, n=1) + lobed(14.5, 5, D0, 10.0, 3.8, seed=3, n=2) + lobed(5, 14.5, D0, 10.0, 3.8, seed=4, n=2)
    rooms += lobed(4.5, 4.5, D1, 17.6, 3.2, seed=5, n=1) + lobed(14.5, 5, D1, 17.6, 3.4, seed=6, n=1) + lobed(5, 14.5, D1, 17.6, 3.4, seed=7, n=1)
    rooms += [throat((4.5, 4.5), (14.5, 5), z + 3.4, spread=3.4, k=1.2) for z in (D0, D1)] + [throat((4.5, 4.5), (5, 14.5), z + 3.4, spread=3.4, k=1.2) for z in (D0, D1)]
    return recipe6("office_4_void_edge_workspace_v6", cont, [floor_group("ground", [ground()]), floor_group("upper floor", [shelf])], (tame(rooms, mask, skin=2.0) + P.sources())[:24], seed=24, foam_seed=124)


def O5(cubic=False):
    """Office 5, folded / undulating work surface. The floor is a landscape of soft folds: flat valley benches and flat ridge benches joined by gentle slopes (a 1.2 ft rise every 5 ft) running across
    the tile, and the cave over it follows the folds, a vault that undulates the same way. People cross the folds on slopes of 0.3. A cube."""
    P = WidePorts(wide=5.4, foyer_h=9.0).face("-y", 10, D0).face("+y", 10, D0).face("-x", 10, D0).face("+x", 10, D0)
    cont, mask, _ = cube_env((20, 20, 20))

    def fold(x, y):
        u = x % 10.0
        u = min(u, 10.0 - u)
        return D0 + 1.2 * sstep(0.8, 4.2, u)
    floor_ = terrain(fold, None, n=40, zbot=0.0, size=20.0)
    rooms = []
    for i, (x, y) in enumerate([(5, 5), (10, 5), (15, 5), (5, 10), (10, 10), (15, 10), (5, 15), (10, 15), (15, 15)]):
        rooms += lobed(x, y, fold(x, y), 15.0, 3.7, seed=30 + i, n=1)
    return recipe6("office_5_folded_undulating_work_surface_v6", cont, [floor_group("folded floor", [floor_])], tame(rooms, mask) + P.sources(), seed=25, foam_seed=125)
