# Authoring tiles that interlock: handoff for whoever writes the recipes

A short brief for whoever writes the recipes (including ChatGPT). Arrange places any tile that follows the technical rules below, in any of 8 orientations, and discovers the fits itself: you do not describe positions. What is checked by software is checked by `npm run check:interlock`, `npm run check:arrange` and `engine/headless/tests/t_shaped_tile.py`.

**Four different kinds of statement are made here, and they are kept apart on purpose.** Do not read a design convention as an engine rule, or the other way round.

| Kind | What it is | Who set it | Can you depart from it? |
|---|---|---|---|
| **A. The assignment's registration lattice** | a **20 ft × 20 ft plan module with a 20 ft vertical increment**. A tile is one increment, "not a sealed cube": its mass, voids and floors may step, notch, overlap or take L, T or plus figures. A **lobby tile may stack the same footprint two or three increments tall (40 ft or 60 ft)** when the type is a void, stair or sectional gathering | the brief (`Assignemnt_02_ProtoArchitecturalSpaces.pdf`) | only by the studio's decision |
| **B. Optional internal floor spacing** | where floors sit *inside* a tile: for example a floor every 10 ft (two storeys in one 20 ft increment). It is a design choice of a tile set; the 20 ft increment is not the floor-to-floor height, and two or three increments is 40 or 60 ft tall, not 20 or 30 | the tile set | yes, per tile |
| **C. Engine and app capabilities** | what the software can read and place (the next section) | the software | these are limits, not recommendations |
| **D. Connection datums recommended for one set** | the heights and opening positions that a particular family agrees on so its tiles meet without remodelling (see the end) | that set's author | yes: they are coordination conventions |

## What a tile is to Arrange (C)
Three kinds of cell, from the exported voxels (`voxels/void.u8`, `voxels/mask.u8`, `voxels/plates.u8`, `voxels/struts.u8`, all on one grid, index = (x*ny + y)*nz + z, z fastest):
- **outside the container** (`mask = 0`): belongs to no one; another tile's material may fill it. This is the notch of an L, the empty side of a step.
- **material** (`mask = 1`, `void = 0`): foam, floor plates, support branches.
- **carved space** (`mask = 1`, `void = 1`): rooms, passages, shafts, doorways.

The collision policy is conservative and is the one rule here that is a restriction on purpose:
- Two tiles may share bounding-box space **only through outside-container cells**.
- **Material may never enter another tile's carved space** (it would fill a room or a doorway).
- **Carved space is never shared**: two tiles may not both claim the same carved cell (the "shared void" overlap is rejected by default; it is a policy switch, off). So continuity is made by openings that **meet at the container surface** (floor meets floor, void meets void across the joint), not by rooms that interpenetrate. Design the notch to be exactly the volume you intend a neighbour to fill, and put the opening on the notch wall.

## Technical capabilities and limits (C)
- **Cell size 0.5 ft** (`sim.cell` = 0.5). Arrange rejects other cell sizes. 20 ft = 40 cells; 10 ft = 20 cells.
- **Dimensions**: any size on the 0.5 ft grid is accepted (Arrange places at any 0.5 ft offset in all three directions), so the 20 ft registration lattice and multiples of 10 ft are conventions for tiles meeting without an offset, not requirements.
- **Container**: `container` = `box` (cube or any block), or `mesh` / the Container component with closed geometry (L, stepped, notched, tapered). The grid is the container's bounding box at 0.5 ft; the engine writes `voxels/mask.u8` whenever the container is not a plain cube/box (`tile.json` `container.mask_file`). Cells outside the container hold neither foam nor void.
- **Origin**: any (world coordinates are fine); Arrange places by the container's low corner.
- **Recipe limits**: at most **24 sources** per recipe and a recipe panel of about **32,000 characters** (Grasshopper cuts longer text, which shows as "recipe is not valid JSON"); warped plates are stored as `field` height grids so the recipe stays short.
- **Supported transformations**: rotation about the vertical axis in 90 degree steps, mirror in X, vertical shifts in 0.5 ft steps, copies and repeats. Not supported: tilting, non-0.5 ft cells, hexagonal prisms (they are for the Builder, not Arrange). Scaling exists but is an advanced option.
- **Walking rules** (the program's single walking model, `lib/walking.ts`, shared by Arrange and Analysis; proto-architecture tolerances, not code compliance; editable per project): a place to stand needs a floor under it, **6.5 ft headroom** and a clear disc **2.5 ft wide**; two neighbouring floors are one surface when they differ by no more than **one step, 0.5 ft**; a floor area under **12 ft²** is a pocket, not a space.
- **A jump is never a route.** Whatever a setting says, a height change bigger than one step is crossed only by actual geometry: a stair, a ramp or a stepped floor, i.e. a run of standing cells each within one step of the next, with the headroom and width above it. Two floors that are close but more than a step apart across a clear doorway are reported as **needing a connector** (a stair or ramp that is not there yet), and the generator never counts a connector as a way in. Put real stairs or ramps inside the tile (rise 0.5 ft per 0.5 ft of run is the steepest the grid can express; use gentler, 0.5 ft per 1 to 2 ft of run, so there is generous clearance).
- **Vertical connections across tile boundaries**: a joint across a **horizontal** plane (one tile stacked on another) joins spaces visually and by air, but **never carries a route**. People change level inside a tile (stair, ramp, stepped floor), or by crossing a side joint between tiles whose floors sit at different levels. A shaft or a hole in a floor or roof is a view.
- **Doorways**: a connection is an opening on the container surface with a floor under it, at least **4 ft wide and 7 ft high** from floor level (the tested minimum is 2.5 ft clear width and 6.5 ft headroom; 4 x 7 ft leaves margin, more is better). Put openings on the planes the neighbour presents: box faces, and the walls of notches and steps.
- **Floors**: each floor should be one connected plate (no 1 ft islands); the tile's biggest floor is its "main floor" and must be reachable from a doorway; a level with no stair or ramp to the rest is reported as not reachable (fine if intended: it is reached from a neighbour).
- **Walls**: at least 1 ft of foam between a room and the container surface so two walls do not make hairline joints; keep a roof slab (the app prints and analyses it).
- **Do not**: leave material in a notch (it is outside: it will be ignored), carve a room that opens through the container's edge without a floor, rely on void sharing between tiles, or make the only doorway lead to a closet.

## What Arrange then does (so you can design for it)
It scores each contact patch (void on void, floors meeting, structure on structure, route ends meeting), calls a joint walkable only when a person can stand on a floor on each side, step across and keep clearance, finds nested placements itself (notch wall to opening, step to step, any rotation or mirror, any lateral offset and floor level), keeps one connected route from the entrance, and says why when a bank cannot be assembled. To test a new tile: drop its `_analysis` folder into the app, then in Arrange use Tools > Interlock test and the pair matrix (a shaped tile should score 100 against its complement, "nested").

## Coordinated connection datums for one family (D)
Floor heights and opening positions are conventions that a **family** of tiles agrees on so that its members meet without remodelling. They are not engine requirements, and two families that chose different datums are not incompatible: Arrange can offset a tile vertically by any 0.5 ft, so a tile whose floors are 1 ft higher or lower still meets another family's floors (the offset is just no longer a whole increment, and the registration lattice is not kept).

- The **earlier set** (`engine/tiles/recipes`, 20 x 20 x 20 ft, ground slab top at **z = 2 ft**, mid datum at **z = 12 ft**, a standard half-chamber port on the side faces) and the **L, step and notch fixtures used to test shaped tiles** (floor tops at **z = 1 ft** and **z = 11 ft**, 4 x 7 ft doorways) are two such conventions. Mixing them costs a 1 ft vertical offset between the two families; mixing tiles inside one family costs nothing.
- Within a family: pick the floor tops once (for example 1 ft and 11 ft above the container base, or 2 ft and 12 ft), pick the doorway width, height and centre line (centred on 5 ft centres so mirrored and rotated copies line up), and put the same openings on the notch and step walls the complementary tile presents. A tile that is two or three increments tall keeps the datum of every 10 ft storey inside it, or says which it does not.
- Heights are measured from the container base. Floor plate **tops** are what meet.

## Quick checklist before exporting a tile
1. cell 0.5; the container is the shape you want (the exported `mask.u8` exists if it is not a box); tile height is one, two or three 20 ft increments if the type is a lobby void, stair or sectional gathering, one increment otherwise.
2. at least one floor plate; one connected main floor; reachable from at least one doorway; real stairs or ramps (not bare jumps) wherever the floor changes by more than 0.5 ft.
3. every intended connection is a 4 x 7 ft (or larger) opening at floor level on a container surface, on the family's agreed centre line and datum.
4. notches are clean and their walls carry the openings the complementary tile's walls will carry.
5. no carved space in the notch, no material the neighbour is meant to fill, no room that depends on another tile's room existing in the same cells.
6. at most 24 sources, recipe under about 32,000 characters, and `RECIPE CHECK: OK` when it is rebuilt.
