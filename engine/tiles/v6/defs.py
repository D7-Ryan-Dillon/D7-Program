"""The V6 tiles (see docs/TILE_SET_V6.md): fifteen cubic blocks eroded inside, with wide openings at the shared datums; five of them STEPPED (a notch cut from the top that a neighbour fills),
each with a matching cubic backup (key + "c", name ending _v6c)."""
from defs_g import G1, G2, G3, G4, G5  # noqa: F401
from defs_o import O1, O2, O3, O4, O5  # noqa: F401
from defs_l import L1, L2, L3, L4, L5  # noqa: F401

TILES = {"G1": G1, "G2": G2, "G3": G3, "G4": G4, "G5": G5, "O1": O1, "O2": O2, "O3": O3, "O4": O4, "O5": O5, "L1": L1, "L2": L2, "L3": L3, "L4": L4, "L5": L5}
# the stepped tiles and their cubic backups
STEPPED = ["G1", "G5", "O2", "L4", "L5"]
for _k in STEPPED:
    TILES[_k + "c"] = (lambda f: (lambda: f(True)))(TILES[_k])
