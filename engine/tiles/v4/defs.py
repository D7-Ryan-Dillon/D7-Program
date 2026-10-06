"""The V4 tiles: fifteen recipes (three categories x five typologies of Assignment 2), a second deliberate set, coordinated as an interlocking family. The concept of each is the docstring of its
function (defs_g.py gathering, defs_o.py office, defs_l.py lobby); docs/TILE_SET_V4.md has the design matrix and the evidence.

FAMILY CONVENTIONS (coordinated design choices of THIS set, not engine requirements):
  * the 20 ft x 20 ft registration lattice of the assignment; a lobby tile may stack the same footprint two or three increments (40 or 60 ft); a tile need not fill its cell
    (an L with a notch, a single 10 ft storey)
  * floor slabs 1 ft thick at 10 ft intervals: slab k spans z = 10k .. 10k+1, so its TOP (the floor) is D0 = 1, D1 = 11, D2 = 21, D3 = 31 ft
  * steps and notches of a container sit on multiples of 10 ft (in plan and in height)
  * the standard doorway: about 8 ft wide and 8 ft high above a floor, centred on a 5 ft line (x or y = 5, 10 or 15), cut through a container face OR a notch wall; the floor continues to the opening
  * real stairs and ramps (never steeper than 0.5, in practice 0.45 or less) wherever a floor changes by more than a step; seating terraces and plate edges (1 ft and higher risers) are never the way up
"""
from defs_g import G1, G2, G3, G4, G5  # noqa: F401
from defs_o import O1, O2, O3, O4, O5  # noqa: F401
from defs_l import L1, L2, L3, L4, L5  # noqa: F401

TILES = {"G1": G1, "G2": G2, "G3": G3, "G4": G4, "G5": G5, "O1": O1, "O2": O2, "O3": O3, "O4": O4, "O5": O5, "L1": L1, "L2": L2, "L3": L3, "L4": L4, "L5": L5}
