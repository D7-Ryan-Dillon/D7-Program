# Plan: multi-block 3D print export with embedded colour labels (Bambu P1S + AMS)

Status: BUILT (2026-10-05, on the owner's go). `lib/exporters/printLabels.ts`, `components/viewer/PrintBatchDialog.tsx` (Viewer, "3D print" button, Ctrl+P). Decisions taken: STL pairs only (no 3MF); labels are editable per block and default to O-4 / G-2 / L-2; 0.6 mm default depth; letters up to 6 mm; the foam is lowered so the underside under the label is exactly the plate and any sliver hanging below it is shaved off; the pocket is cut with three-bvh-csg and the T-junctions it leaves are split locally. Each block takes about 10 s (it runs on the page). Checked by `npm run check:arrange` (label spot on all 15 fixtures, closed label solid, pocket volume) and in the browser on four real tiles (the zip, its files, the progress); not yet loaded in Bambu Studio.

**Second line (2026-10-06):** each block can also carry an optional smaller second line under the label ("void field" under G-2), typed per block in the print window or filled from the tile type with *Name the types*. The first line keeps its size rules; the second is 42% of its height with a 22% gap, centred, and needs a first line of about 4.4 mm or more (second line at least 2 mm). If a block has no room for two lines the first line alone is cut and the window notes it. `LabelOptions.sub`, `labelBitmap(..., sub)`, `subFor(tile)` in `lib/exporters/printLabels.ts`; checked in `check:arrange`.

## What you asked for
Pick any number of blocks from the bank, set scale and parts, and get one folder of print files where every block carries a small label (O-4 for office 4, G-2 for gathering 2, L-2 for lobby 2 ...) sunk flush into its underside, 0.5 mm deep, in a second colour. The block prints with the label face down on the plate, so the label is the first layers and the block sits on top of it. A button in the Viewer opens the window.

## Is it possible? Yes, with three honest caveats
Everything needed is already in the project: the print geometry (`lib/exporters/stl.ts` already makes millimetre STLs at any scale for foam, void, plates and branches), boolean cutting (`three-bvh-csg`, already used by the legacy smooth), zips (`jszip`), and the tile numbering (`lib/boards/tileLabel.ts` reads "office_4_..." as office 4).

1. **Label depth and layers.** 0.5 mm is 2.5 layers at 0.2 mm, so the slicer will round it. Offer 0.4 / 0.6 / 0.8 mm and default to **0.6 mm** (three clean 0.2 mm layers: the first layer plus two). 0.5 mm is selectable; the window says what the slicer will do with it.
2. **Where the label can go.** Only where foam touches the plate. The tiles are eroded, so the underside is partly void (the Print checks already report "contact with the print bed, 22% of the footprint"). The label goes on the **largest flat patch of foam on the bottom layer**, and the window shows where. If a tile has no patch big enough for legible text it says so and offers a smaller label or a manual spot.
3. **Bambu Studio import.** The sure route is two STLs per block (the block with a pocket, and the label that fills it). Bambu Studio asks "load as one object with multiple parts?" when both are dropped in together; answer Yes and give each part its own filament. A single 3MF per block (or one 3MF for the whole plate) with the filaments already assigned is possible, but I cannot test it against Bambu Studio from here, so it is a second stage that you would try on your machine and report back.

## How each block is made
1. Take the tile's foam mesh at the chosen scale (existing code; Z up, bottom on the plate).
2. Find the largest rectangle of bottom-layer foam from the tile's voxels (a standard maximal-rectangle search; instant).
3. Draw the label text with a bold sans font (browser canvas text, traced to outlines; no new dependency; a vector font library such as opentype.js is the cleaner alternative if you want to approve one). The text is **mirrored** so it reads correctly when you look at the underside of the block.
4. Extrude it to the chosen depth, clip it to the foam (so no letter can hang over a void), and subtract it from the foam: the block gets a pocket, the label is the exact filler. Coordinates are shared, so the two files fit together when loaded as parts.
5. Check both meshes are watertight (the existing open-edge check) and report triangles, volume and filament length.

## The window (Viewer, a "3D print" button next to Export; also reachable from the Export window)
- **Blocks**: the bank as a checklist with thumbnails, category chips (Gathering / Workspace / Lobby / Cube builder / Assemblies) and Select all / none. Each row has an editable label (default from the name: O-4, G-2, L-2; cube-builder tiles and assemblies default to the first letters of their name).
- **Scale**: the existing ratios (1 in = 10 ft and so on) or "fit the longest side to N mm"; it shows the printed size and whether it fits the P1S plate (256 x 256 mm) with a warning if not.
- **Parts**: foam, void, plates, branches (the existing choice). The label goes on the foam; the void and other parts export plain.
- **Label**: on/off, text, height (default 6 mm, minimum 5), depth (0.4 / 0.5 / 0.6 / 0.8 mm), position (automatic best patch, or nudge), and a colour name for the file names (for example "Label white") so the slicer side is obvious.
- **Preview**: a small picture of each block's underside showing the pocket and the letters, and a red note where there is no room.
- **Output**: a zip with one folder per block (`O-4/O-4_block.stl`, `O-4/O-4_label.stl`, optional void/plates files) plus a `README.txt` saying how to load them in Bambu Studio and which filament goes on which part. Later options: one 3MF per block, and one plate 3MF with every block laid out on the bed.

## Efficiency on the AMS
Because the label is the first 2 to 3 layers only, each block needs just those few colour changes and then prints in a single colour. Several blocks on one plate multiply the changes on those first layers, so printing blocks in batches by label colour, or giving the label its own colour only on the first layers, keeps purge waste small. The window can estimate the number of colour changes per plate.

## Build order (each step usable on its own)
1. Label placement and text: largest bottom patch, canvas text to outlines, mirrored, extruded, clipped (unit-checked on all 15 fixtures: the label always lies inside foam).
2. Pocket plus label meshes with the CSG, watertight check, STL pairs for one block.
3. The window: blocks list, scale, parts, label settings, underside preview.
4. Batch export to a zip of folders with the README.
5. Optional: 3MF (per block, then a whole plate laid out), which needs a test on your printer.

## Questions for you
1. Label depth: is 0.6 mm (three 0.2 mm layers) fine as the default, with 0.5 mm available?
2. Labels for cube-builder tiles and assemblies: first letters of the name, or always typed by you?
3. Do you want a new font dependency (cleaner letters) or the no-dependency canvas text (good enough at 6 mm and up)?
4. Should the 3MF stage wait until you have loaded the STL pairs in Bambu Studio and confirmed that route works?
