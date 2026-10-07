# Assignment 2 (Proto-architectural spaces): where each part of the brief lives

The brief is `Assignemnt_02_ProtoArchitecturalSpaces.pdf` (due 10.01.2026 as printed in the PDF). One geometrical system for all fifteen tiles; every tile repeats, mirrors or shifts, rotates in 90 degree steps and **interlocks as complementary geometry** (not six flat cube faces butted together; the 20 ft lattice is "not a sealed cube"); the test is one gathering, one office and one lobby at 2, 4 and 8 copies by repeat, mirror and shift. The Grasshopper / engine script is frozen: everything below is the app or the recipes.

## The tile set to hand in

Fifteen 20 ft cubes, one per typology (`engine/tiles/v7`, `docs/TILE_SET_V7.md`): smooth carved masses with floors that walk, an opening with a floor behind it on every face, and every tile a single printable piece. Import the `_analysis` zips (`engine/tiles/v7/package/analysis/`, local; rebuild them with `python engine/tiles/v7/package.py`) into a **new project** in the app. How the tiles are written is `docs/RECIPE_WRITER.md`.

## PDF section to app sheet

All sheets are in **Boards tab → Export → "Assignment 2 sheets"**: one button per sheet, PNG output at the width, height and dpi set at the top of the panel (the panel's own sizes, for a TV or for 22 x 11 in print). Texts typed in the panel are saved with the project.

| PDF section | What it asks for | Where it comes from |
|---|---|---|
| Workflow, run logs | the overall workflow with the Versur logs | **Workflow and run logs**: your workflow text, the Versur logs you paste (they live outside the app) and the app's own interlock run log for every tile (repeat / mirror / shift at 2, 4, 8) |
| 4.1 | descriptors and Part 1 criteria | the **Analysis tab** (twelve matrix descriptors, each with its bar) and the **Part 1 text-to-image diagrams, external** (made outside the app) |
| 4.2 to 4.4 | one idea page per category | **4.2-4.4 Ideas by category** |
| 5.1 | 3 x 5 diagrammatic catalogue | **5.1 Diagram catalogue (3 x 5)** |
| 6.1 | 3 x 5 geometry catalogue with 2 to 4 copy aggregations and the Part 2 workflow pass | **6.1 Geometry catalogue (3 x 5)**: each tile with an aggregation that proves the interlock, the joint scores, and a "Part 2 pass" line the app computes (the aggregate is evaluated again and the carried descriptors compared with the single tile, within one band) |
| 7.1 | criteria carried forward or set aside | **7.1 Selection criteria** |
| 7.2 to 7.4 | evaluation per category | **7.2-7.4 Evaluation by category** |
| 8.1 | insights | **8.1 Overall insights** (your text, or a first draft from the numbers) |
| References | list | **References** (your list) |

Outside the app: the Part 1 text-to-image diagrams, the Versur run logs, and the PDF layout itself. **PDF export is not part of the app** (production is PNG).

## The tests the brief asks for, in the app

- **Arrange tab, Interlock test**: choose a tile, pattern (repeat, mirror, shift) and count (2, 4, 8); the result is valid when the copies are attached, collision-free, and every one reachable on foot. `npm run check:tiles` runs all fifteen at all counts and writes the table and pictures to `engine/tiles/v7/assemblies/`.
- **Arrange tab, Generate**: ten shapes (tower, terraced, courtyard, bridge, village ...) with branching wings and five sliders; every result has floors that meet floors, no dead-end stair and no stranded floor plate (`npm run check:generate`). The optional **Build connectors automatically** toggle covers floors a step too far apart (a ramp or stair of ordinary foam is built into the lower room and checked by the same walking rules).
- **Analysis tab**: the twelve descriptors, each with a bar (strength on the app's scale words, a fit line to the typology's target), the at-a-glance strip, the compare view, and the usable-space check.
- **Boards tab**: all of the sheets above.

## Honest limits (to say in the document)

- A building climbs only through tiles that lift circulation inside themselves (G5, L1, L5; L4 and G1 part of the way): the other upper floors (G2, G3, O3, O4, L3 and O2's top) are receiving floors that a neighbouring tile has to supply. The generator therefore builds towers and terraces as chains of climbing tiles, and reports what it came out as against what was asked.
- Joints: 198 of 225 ordered pairs and 117 of 120 unordered pairs join on foot; G1, L4 and L5 join only as the second tile of a pair in the pair matrix (in Arrange they join from any face once rotated).
- A few door-level pockets (G4 and L5 on -Y, O4's void foot, G1's upper ledge) are not joined to their tile's main floor; they are not counted as floor plates.
