# Plan: the Arrange tab overhaul (for discussion; nothing here is built)

Status: PLANNING, written 2026-10-04 for the owner's review. Arrange has not been changed in this round except for colours (the palette cleanup). Arrange internals stay off-limits until the owner says go (HANDOFF section 7).

## 1. Where Arrange is today

- `lib/arrange/autoGenerate.ts` grows an assembly one tile at a time from a seeded random pick: choose an open socket (area-weighted, optionally one long "spine" first), try every mirror x rotation (x tilt, x scale) of every tile in the bank, keep placements whose joint score is above `minScore`, stop at `amount` pieces.
- A **joint score** is void on void only: matched = open on both sides, dead = open on one side; `100 * matched / (matched + dead)`; `null` when nothing opens onto the joint (`lib/arrange/joints.ts`).
- Per-instance editing (move, rotate, mirror, scale, snap), joint rating and "regenerate marked", a "smooth and seal" CSG export (`lib/exporters/csgFuse.ts`), OBJ and manifest export. The assembly lives only in the tab's own state (not saved with the project).
- Two pieces were never confirmed in the browser: smooth and seal, and regenerate marked (HANDOFF section 7).

What is wrong with it for architectural tiles:
1. It does not know a tile is architecture. Tilt and Z-mirror turn floors into walls; scale breaks the 8 ft storeys; the only thing checked is void-on-void.
2. With the standard port on every tile (see `engine/tiles/README.md`), almost any pair scores 60 to 90 (196 of 210 pairs score 60 or more), so `minScore` no longer separates good joints from lazy ones. The score has to say more.
3. Nothing judges the **whole**: does a person get from one end to the other, do floors continue, is there daylight, does it print as one piece.
4. It builds one random result. There is no way to ask for "ten good ones" and keep the best.

## 2. What the data now offers (all built and tested in the app)

Every tile carries `spaces` (levels with floor heights, rooms, connections, routes, daylight, openings per face), `structure` (thin walls, overhang, grounded plates), per-face layers (`void`, `foam`, `plate`, `outside` masks), and its voxels. `lib/tiles/analyze.ts` runs on any voxel grid (a tile or a composite), kept equal to the engine's by `npm run check:parity`. `lib/tiles/facts.ts` already exposes the face layers and levels under any quarter turn or mirror, and was written for this overhaul. The tiles are 20 ft cubes with floors at z = 2 and z = 12 and openings (the standard port) at z about 6 and 16 on the face centres.

## 3. The idea

Arrange becomes the place where tiles are **composed into one building-like mass and judged as architecture**, while still being the place where the assignment's interlock tests are run (repeat, mirror, shift; 2, 4 and 8 copies). Three layers:

1. **A lattice model** (placement is exact and cheap to check).
   - Positions on a 20 ft lattice, with an optional 10 ft shift in X or Y for the "shift" test. Orientation = mirror in X x quarter turn about Z (8 options), plus stacking in Z (the top face is open and the next tile's ground slab is its roof). Tilt and scale are off by default and become an explicit "wall mode" and "scale range" (with a warning that they break the storeys).
   - An assembly is a list of instances on the lattice plus a graph of joints; the composite voxel grid is built by pasting each tile's voxels (up to 64 tiles of 40^3 cells is about 4 million cells: fine in the browser).
2. **A joint score v2** that explains itself (a breakdown the user can read, not one number):
   - void on void (today's rule), at the same weight as now so old numbers stay comparable;
   - **floor continuity**: at a joint, floors (plates) on both sides at the same height count as matched, a floor against a drop of more than one riser counts against it;
   - **foam on foam**: contact area of structure across the joint (no hairline joints);
   - **circulation**: an opening that is a route end on one side meets a route end on the other.
   The breakdown shows as a small bar per joint in the Joints panel and as a colour on the joint marker.
3. **Whole-assembly analysis**: run the same analysis (levels, rooms, routes, daylight, structure, print checks) on the composite and show it in a new panel: how many levels the whole has and whether they continue through joints, the longest route through the assembly, rooms that are cut off, floating foam across tiles, thin walls across joints, descriptors scored on the whole (reusing `lib/scoring`).

## 4. Features, in the order I would build them

| # | Feature | What it is | Size |
|---|---|---|---|
| 1 | Lattice placement and the move rules | exact 20 ft lattice and 10 ft shift, 8 orientations, stacking in Z, tilt and scale opt-in; instances saved with the project (Supabase) | M |
| 2 | Joint score v2 and its breakdown | built on `tileFacts`, shown in the Joints panel; the old score stays as the first line | M |
| 3 | Interlock test presets | one click builds a repeat, mirror or shift line of 2, 4 or 8 copies of the selected tile and reports the joint scores: the assignment's required test, per tile and for a pair | S-M |
| 4 | Pair matrix | the 15 x 15 best-joint matrix (what `engine/tiles/compat_matrix.py` prints) as a heat map inside the tab, so a good neighbour can be picked at a glance; clicking a cell adds that pair | S |
| 5 | Composite and whole analysis | paste the assembly into one voxel grid; run `analyzeTile`; the whole-assembly panel and its Evidence button (light the longest route, the floors, the cut-off rooms) | M-L |
| 6 | Generator v2 | beam search or annealing on an objective: joint scores, level continuity, route length, category mix, compactness, no floating foam; constraints (counts per category, at most N of one tile, a maximum height); seeds kept so a result can be reproduced | L |
| 7 | Variations gallery | generate 12 to 24 assemblies, score each, keep the best as saved variants with thumbnails (plan, section, 3D); compare two assemblies the way Analysis compares tiles | M |
| 8 | Manual editing, improved | drag with a live joint preview (colour by score), lock an instance, swap a tile keeping its place, undo and redo, groups | M |
| 9 | Outputs | whole-assembly STL (parts and scale as in Viewer), plan and section drawings of the assembly (reuse `lib/drawing` on the composite), assembly as a Boards tile (3D, plan, section), the animated build-up GIF, OBJ with plate and branch groups; smooth and seal keeping plate tops flat | M |
| 10 | Back into Rhino | export the composite as an engine `mass` (and `geo`) so a second engine pass can add passages where joints dead-end, then bring the result back | M (engine side S) |

Order and dependency: 1 first (everything else stands on it), 2 and 3 next (they fix the scoring and deliver the assignment test), then 5, then 6 and 7, then 8 to 10 in whatever order the owner wants. 4 can be done any time after 2.

## 5. How it should feel

- Left: the bank (tiles with their ports shown as small icons) and the generator settings. Centre: the 3D assembly (the same black, pink and orange look as the Viewer: ghosted foam, magenta void, peach plates), with joints marked by colour. Right: Joints (with the breakdown), the Instance editor, and the Whole panel (levels, routes, daylight, print checks, descriptors).
- A **Level** control that cuts the assembly at a floor and shows the plan of the whole, so circulation can be read.
- Everything saves with the project; the assembly is a saved object like a Builder tile, with variants.

## 6. Risks and how to keep them small

- **Performance**: the composite analysis on 64 tiles is the heavy step. Plan: analyse at half resolution for live feedback, full resolution on demand and in the background.
- **Analysis on soft forms**: the room watershed finds few rooms on the new organic tiles; levels, routes and daylight carry the whole-assembly reading. If the whole needs better rooms, that is an analysis change (engine and `lib/tiles` together, parity test).
- **Search cost**: the generator tries 8 orientations x 15 tiles x every open socket; with the port standard most of those are valid, so the objective, not feasibility, decides. Cap the search by time, keep seeds.
- **Verification**: the two unconfirmed pieces (smooth and seal, regenerate marked) get a real browser test before anything is built on them.
- Arrange internals are off-limits unless asked: this plan starts only on the owner's "go".

## 7. Owner's answers (2026-10-04)

1. **Target**: one connected, walkable building-like mass.
2. **Stacking**: tiles stack in Z as freely as they like.
3. **Wall mode**: no, drop it (tilt stays off).
4. **Scale**: keep the option, expected to be rarely used.
5. **Interlock test** (2/4/8 copies by repeat, mirror, shift): not graded, but wanted as a one-click test.
6. **Outputs**: all of them matter (Boards, STL, drawings, Rhino), each for a different reason; be thorough.
7. **Variants**: one at a time. Each assembly must be saveable back into the program as a tile like any other, so it can be compared in the Viewer tab (this makes feature 9's "assembly as a tile" and feature 10 central, and puts ranking/gallery (7) later).
8. **Taller or non-cubic tiles**: not needed; the owner will ask if so.

Status: still planning; nothing in Arrange is built.

## 8. Original questions (kept for the record)

1. **What is the target?** One building-like mass that is connected and walkable, or a looser aggregation (a field of clusters)? This sets the objective of the generator.
2. **Stacking**: should tiles stack in Z (floors meeting roofs) freely, or is the assembly mostly a horizontal layout with occasional second layers?
3. **Wall mode** (tilting a tile so its floors become walls): keep as an advanced option, or remove?
4. **Scale**: keep a scale range (mixed sizes) or fix 1:1 and let size come from the number of tiles?
5. **The assignment's test**: is "2, 4 and 8 copies by repeat, mirror and shift" a graded deliverable? If yes, feature 3 moves to the front and the report should export as an image or table.
6. **Outputs that matter most**: Boards images, a print (STL), or Rhino (feature 10)? That sets the order of 9 and 10.
7. **How many variations** do you want to look at, and how should they be ranked (your own taste, a score, both)?
8. **Non-cubic and taller tiles** (L, T, 2 to 3 storeys): needed for the next tile set, or later?
