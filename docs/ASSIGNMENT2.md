# Assignment 2 (Proto-architectural spaces): where each part of the brief lives

The brief is `Assignemnt_02_ProtoArchitecturalSpaces.pdf` (due 10.01.2026 as printed in the PDF). One geometrical system for all fifteen tiles; every tile repeats, mirrors or shifts, rotates in 90 degree steps and **interlocks as complementary geometry** (not six flat cube faces butted together; the 20 ft lattice is "not a sealed cube"); the test is one gathering, one office and one lobby at 2, 4 and 8 copies by repeat, mirror and shift. The Grasshopper / engine script is frozen: everything below is the app or the recipes.

## The tile set to hand in (updated: V7 is the set built on the first set; V6 below is the earlier cubic rework)

**V6** (`engine/tiles/v6`, `docs/TILE_SET_V6.md`): fifteen cubic tiles plus a matching cubic backup (`v6c`) of the five whose tops are notched. If the stepped tiles are accepted, use them; if not, the backups are the same tiles with the notch left out. Import the `_analysis` zips (`engine/tiles/v6/package/analysis/`, local) into a **new project** in the app (the V6 project loaded this way is `v6tiles`).

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

- **Arrange tab, Interlock test**: choose a tile, pattern (repeat, mirror, shift) and count (2, 4, 8); the result is valid when the copies are attached, collision-free, and every one reachable on foot. `npm run check:v6` runs all fifteen at all counts and writes the table and pictures to `engine/tiles/v6/assemblies/`.
- **Arrange tab, Auto Generate**: mixed gathering / office / lobby aggregations, with the optional **Build connectors automatically** toggle for floors a step too far apart (a ramp or stair of ordinary foam is built into the lower room and checked by the same walking rules).
- **Analysis tab**: the twelve descriptors, each with a bar (strength on the app's scale words, a fit line to the typology's target), the at-a-glance strip, the compare view, and the usable-space check.
- **Boards tab**: all of the sheets above.

## Honest limits (to say in the document)

- A nest into a stepped top is **walkable only for G5**; the other four stepped tiles nest collision-free, so the aggregate reads as one interlocked mass, but the nested cube is reached from its own neighbours, not through the notch.
- G3's shelf has no stair of its own in a 20 ft cube; it is a receiving floor (a neighbour's ramp arrives at it).
- Auto Generate does not choose nests on its own yet (they must be walkable to count), so the interlocking aggregations in 6.1 are the interlock tests, not the generator.
