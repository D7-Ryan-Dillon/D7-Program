# Authoring tiles that interlock: handoff for the next tile set

A short brief for whoever writes the recipes (including ChatGPT). Arrange will place any tile that follows these rules, in any of 8 orientations, and will discover the fits itself: you do not describe positions. Everything below is checked by `npm run check:interlock` and `engine/headless/tests/t_shaped_tile.py`.

## What a tile is to Arrange
Three kinds of cell, from the exported voxels (`voxels/void.u8`, `voxels/mask.u8`, `voxels/plates.u8`, `voxels/struts.u8`, all on one grid, index = (x*ny + y)*nz + z, z fastest):
- **outside the container** (`mask = 0`): belongs to no one; another tile's material may fill it. This is the notch of an L, the empty side of a step.
- **material** (`mask = 1`, `void = 0`): foam, floor plates, support branches.
- **carved space** (`mask = 1`, `void = 1`): rooms, passages, shafts, doorways.
Two tiles may share bounding-box space only through outside-container cells. Material may never enter another tile's carved space, and carved space is never shared: design so the notch is exactly the volume you intend a neighbour to fill.

## Constraints
- **Cell size 0.5 ft** (`sim.cell` = 0.5). Arrange rejects other cell sizes. 20 ft = 40 cells; 10 ft = 20 cells.
- **Dimensions**: every width, depth and height a multiple of 10 ft; floor-to-floor 10 ft (a lobby is 2 or 3 of those, 20 or 30 ft). Any size is accepted, but multiples of 10 ft are what let tiles meet on a 10 ft registration lattice (Arrange also fits them off-lattice, at any 0.5 ft offset).
- **Container**: use `container` = `box` (cube or any block), or `mesh` / the Container component with closed geometry (L, stepped, notched, tapered). The grid is the container's bounding box at 0.5 ft; the engine writes `voxels/mask.u8` whenever the container is not a plain cube/box (`tile.json` `container.mask_file`). Cells outside the container hold neither foam nor void. A notch should be a clean rectilinear cut (multiples of 10 ft, or at least 5 ft) so another tile can sit in it.
- **Origin**: any (world coordinates are fine); Arrange places by the container's low corner. Keep the tile's lowest floor plate no lower than 0.5 ft above the container's base (so the floor is inside the tile) - the usual 1 ft slab (`thickness` 1.0, plate top at z = 1 ft) works.
- **Floor elevations**: put floor plate TOPS at the same heights tiles will need to meet: z = 1 ft (ground floor) and +10 ft per storey (11, 21, ...). A walkable joint needs a floor on both sides within the level tolerance (0.5 ft exact, 1.5 ft riser, up to the ramp rise if ramps are allowed), so keep floors at these heights unless a step is the point.
- **Floors**: each floor should be one connected plate (no 1 ft islands); the standing area of a space must be at least about 12 ft2 to count as a space, and the tile's biggest floor is its "main floor": the route must reach it. A level with no stair or ramp to the rest is reported as not reachable (fine if intended: it is reached from a neighbour that has the stair).
- **Connection geometry (doorways)**: a connection is an opening on the container surface with a floor under it. Minimum: **4 ft wide, 7 ft high**, starting at floor level (clear width 2.5 ft and headroom 6.5 ft are what is tested; 4 x 7 ft leaves margin). Put openings on the SAME planes the neighbour will present: box faces, and the walls of notches and steps (an opening on a notch wall is what the neighbour's opening will meet). Matching openings should be at the same floor height and at least as wide as the narrower one, ideally centred on 10 ft centres (5, 15 ft) so mirrored and rotated copies line up.
- **Vertical connections**: a shaft or hole in a floor/roof joins spaces visually, never as a route. For people to move between levels put a ramp or stair INSIDE a tile (voxel steps of at most 0.5 ft rise per 0.5 ft run, i.e. 45 degrees or gentler), or let two tiles meet side by side at different levels.
- **Walls**: at least 1 ft of foam between a room and the container surface (so a neighbour's wall and yours do not make hairline joints); keep a roof slab on top (the app prints and analyses it).
- **Supported transformations**: rotation about the vertical axis in 90 degree steps, mirror in X, vertical shifts in 0.5 ft steps, copies and repeats. Not supported: tilting, non-0.5 ft cells, hexagonal prisms (they are for the Builder, not Arrange). Scaling exists but is an advanced option.
- **Do not**: leave material in the notch (it is outside: it will be ignored), carve a room that opens through the container's outside edge without a floor, rely on void sharing between tiles, or make the only doorway lead to a closet (a pocket under 12 ft2 does not connect the tile).

## What Arrange then does (so you can design for it)
It scores each contact patch (void on void, floors meeting, structure on structure, route ends meeting), calls a joint walkable only when a person can stand on a floor on each side, step across and keep clearance, finds nested placements itself (notch wall to opening, step to step, any rotation or mirror, any lateral offset and floor level), keeps one connected route from the entrance, and says why when a bank cannot be assembled. To test a new tile: drop its `_analysis` folder into the app, then in Arrange use Tools > Interlock test and the pair matrix (a shaped tile should score 100 against its complement, "nested").

## Quick checklist before exporting a tile
1. cell 0.5; sizes multiples of 10 ft; the container is the shape you want (the exported `mask.u8` exists if it is not a box).
2. at least one floor plate whose top is at 1 ft (+10 ft per storey), one connected piece, reachable from at least one doorway.
3. every intended connection is a 4 x 7 ft (or larger) opening at floor level on a container surface, centred on a 5 ft grid.
4. notches are clean, their walls carry the openings that the complementary tile's walls will carry.
5. no carved space in the notch, no material the neighbour is meant to fill.
