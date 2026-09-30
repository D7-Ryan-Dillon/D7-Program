# HANDOFF: what the evaluation and assembly program needs from the Grasshopper tool chain

Written at the end of the Grasshopper chat (2026-09-26) for a fresh chat that starts the app. It covers only what the app receives from Grasshopper and what it must know to read it. What the app should do is for the user to say. Reference files are saved next to this doc in the Project under `claude/reference/`.

## 1. The project in one paragraph

FAU School of Architecture, studio ARC4327 Architectural Design 7 (Fall 2026), project **Workspace 2.0 - Mapping the Office of the Future**. **Assignment 2, Proto-Architectural Spaces, is due 10.01.2026** (20% of the grade). The team must make **15 proto-spaces**: three categories (Gathering, Office, Lobby) times five typologies each, all in **one geometrical system**. The team chose **cellular automata**: a Grasshopper/Rhino 8 script that erodes a 20 x 20 x 20 ft block of pink foam with acetone-like sources. Each proto-space is a **tile** that must be repeated, mirrored, shifted and rotated in 90 degree steps and must **interlock** with its neighbours (floor meets floor, void meets void, circulation continues). Part 3 scores the fifteen against criteria taken from the Assignment 1 Part 3 matrix. The user leads the technical side; the studio also has a shared 'Versur' workflow (the user does not want it involved yet). Team concept: the carved 'canyon' of Namba Parks and erosion types (river canyons, yardangs, talus, fjords, slot canyons, hoodoos) as vocabulary.

Assignment texts are in the Project as `Assignemnt_02_ProtoArchitecturalSpaces.pdf` (note the spelling) and `Assignment_01_TopologyPrecedent_20260826_151729.pdf`. The team's own Assignment 1 Part 3 matrix (descriptor -> qualitative criterion -> quantitative criterion) is **not** in the Project; the app chat should ask the user for it.

## 2. What was built in the Grasshopper chat

A Rhino 8 Grasshopper tool chain (Python 3 script components, numpy/scipy/scikit-image). All units are feet, Rhino coordinates (X, Y horizontal, Z up).
- **Source component** (`erosion_source.py`): one acetone application (inject, pour, spray, or line along a curve) with dose, spread, start, duration.
- **Foam component** (`erosion_foam.py`): seeded density noise, Voronoi web membranes, and resistant or weak layers (strata) along an axis.
- **Engine** (`erosion_engine_5f.py`, the final one; do not create new ones): a voxel continuous-state CA (material M and solvent C; dissolve, diffuse, gravity, drain, evaporate), 0.5 ft cells, 40 x 40 x 40 grid, marching-cubes smooth meshes, a frame scrubber, and:
  - **recipes**: a recipe.json holds every setting and source; pasting it into the `recipe` input rebuilds the exact tile, and the log says `RECIPE CHECK: OK` when the tile id matches;
  - **cleanup**: `min_void` (fills sealed pockets) and `min_foam` (dissolves floating foam), in ft3;
  - **weld** (new in 5f): makes two opposite faces identical on the chosen axes (x, y, xy) over the last 3 ft, so repeated copies meet exactly;
  - **one-click export** to two folders per tile, `<name>_analysis` (for the program) and `<name>_reference` (for the user), see section 3.
- **Aggregate component** (`erosion_aggregate.py`): places 2, 4 or 8 copies of one tile by repeat, mirror, rotate or shift and scores every joint (section 5).
- **15 recipes**, in three iterations (section 6). All recipes reload with `RECIPE CHECK: OK` and the geometry was checked against a headless copy of the engine. The user ran the recipes in Rhino and confirmed that Rhino reproduces the forms.
- Descriptor scoring was deliberately **kept out of Grasshopper**. An earlier engine version (5d) contained analysis code (floors, portals, circulation, wall thickness); it is parked, not part of 5f, and saved as `claude/reference/parked_engine_5d_with_analysis.py`.

## 3. What the app receives: one `_analysis` folder per tile

The user exports with one button; each export writes two sibling folders in the chosen export directory. **Only `<name>_analysis` is for the app.** A second export of the same name becomes `_v2` on both folders (the tile id stays the same for the same tile).

```
<tile_name>_analysis/
  README.txt            plain-language description (same facts as below)
  manifest.json         START HERE: every file with a machine-readable role; image placement
  tile.json             identity, the settings that made it, all measurements
  model/<name>.glb      foam and void meshes for three.js
  voxels/void.u8  void_smooth.u8  material.u8  softness.u8     40*40*40 = 64,000 bytes each
  data/faces.json       per face: mask, depth, edges, outline, plane
  data/sections.json    per section: void area/fraction, outline
  images/thumbnail.png
  images/faces/face_<+X|-X|+Y|-Y|+Z|-Z>.png  _mask.png  _depth.png,  faces_net.png
  images/sections/<x|y|z>_NN_at_<pos>ft.png and _mask.png (5 or 9 per axis), contact_sheet_<x|y|z>.png
  images/projections/void_thickness_along_<x|y|z>.png
  vector/faces/*.svg    vector/sections/*.svg   (1 inch = 1 foot)

<tile_name>_reference/  (for the user, not the app)
  recipe.json  <name>.3dm  log.txt  README.txt  timelapse/frame_00..12.png + frames.json
```

A full export is about 87 files (5 sections per axis) in the analysis folder. Section count is an input (default 9).

### Conventions (all are stated in `manifest.json` and `README.txt` too)
- **Units feet.** Tile 20 x 20 x 20 ft, `cell_ft` 0.5, `grid` [40, 40, 40], origin at the tile's low corner, X and Y horizontal, **Z up**.
- **Voxels** are raw little-endian uint8, C order, axes [x][y][z] with **z fastest**: `index = (x*ny + y)*nz + z`. `void.u8`: 1 = void, 0 = foam. `void_smooth.u8`: smoothed void field 0..255, the meshes are cut from it at level 127.5. `material.u8`: 255 intact foam .. 0 void. `softness.u8`: foam softness on a log scale, `softness = 2 ** (value/255*8 - 4)`.
- **GLB**: nodes `foam` and `void`, metres, Y up. The manifest gives `to_tile_ft_row_major` = [[3.28084,0,0,0],[0,0,-3.28084,0],[0,3.28084,0,0],[0,0,0,1]], i.e. x_ft = 3.28084 x_m, y_ft = -3.28084 z_m, z_ft = 3.28084 y_m. The glb extras carry `tile_id`, `name`, `tile_ft`.
- **Meshes are capped flat on the six faces.** To join tiles, merge `void_smooth` across tiles and re-mesh; do not stack the exported meshes.
- **Face images** are seen from OUTSIDE the tile: +X: right = +Y, up = +Z; -X: right = -Y; +Y: right = -X; -Y: right = +X; +Z (looking down): right = +X, up = +Y; -Z (looking up): right = -X, up = +Y. Row 0 is the top edge. Every image entry in the manifest has a `plane` (origin_ft, u_axis, v_axis, width_ft, height_ft, size_px, px_per_ft = 50). Masks: white = void. Colour images: pink foam, dark void. Depth maps (`face_*_depth.png`): brighter = void runs deeper straight in from that face cell (full white = 20 ft for the side faces). Projections (`void_thickness_along_*.png`): white = void all the way through along that line of sight. `faces_net.png` is a cube net (top = +Z, middle row -X, -Y, +X, +Y, bottom = -Z).
- **Section images**: X sections seen from -X (right = -Y), Y from -Y (right = +X), Z from above (right = +X, up = +Y).
- **faces.json** (schema erosion-tile/3): per face `stored_axes`, `mask_rows` (strings of 0/1; +/-X faces are [y][z], +/-Y faces [x][z], +/-Z faces [x][y]; 1 = void), `mask_rows_6in` (the same on a fixed 6 inch grid, so tiles made at other cell sizes compare), `depth_cells` (voxels of void straight in from each face cell), `open_cells`, `open_area_ft2`, `edges` (the four border rows), `max_depth_ft`, `outline_uv_ft` (closed polylines in feet) and `plane`.
- **sections.json**: a list of `{axis, index, position_ft, seen_from, void_area_ft2, void_fraction, outline_uv_ft}`.
- **tile.json** keys: `schema`, `id`, `name`, `exported`, `engine_version`, `units`, `coordinate_system`, `tile_ft`, `cell_ft`, `grid`, `frame_exported`, `last_frame`, `config` (tile_w, tile_h, cell, steps, gravity, drain, n_frames, frame, smooth, seed, `sources` as JSON strings, `foam` object, min_void_ft3, min_foam_ft3, `weld`), and `metrics` (void_volume_ft3, tile_volume_ft3, void_fraction, foam_volume_ft3, void_pieces, largest_void_ft3, `void_components` with volume, bbox and open area per face, per-face `faces` {open_cells, open_area_ft2, open_fraction}, open_area_on_faces_ft2, void_bbox, void_z_range_ft, void_mesh_area_ft2, void_wall_area_ft2_estimate, foam_mesh_area_ft2).
- **The export carries no typology, category or descriptor.** The app must get those from the tile name (the recipe names follow `<category>_<n>_<typology>[_V2]`) or from the user.
- **tile id**: 16 hex characters, sha1 of the void voxels plus the normalised settings. Same tile, same id (re-exports keep it). Key the app's database on the id, not on the name (names repeat across the iterations).

Example, abridged, from a real export of `office_5_folded_undulating_work_surface_V2`:
```json
{ "schema": "erosion-tile/3", "id": "4d6c6e369adba1bc", "engine_version": "5f", "tile_ft": [20,20,20], "cell_ft": 0.5, "grid": [40,40,40], "frame_exported": 12,
  "config": { "gravity": 0.0, "steps": 170, "seed": 3, "weld": "xy", "foam": { "noise": 0.7, "scale": 3.2, "web": 0.4, "layers": false }, "sources": ["..."] },
  "metrics": { "void_volume_ft3": 2441.875, "void_fraction": 0.30523, "void_pieces": 1, "void_z_range_ft": [6.5, 20.0],
    "faces": { "-X": {"open_area_ft2": 92.25}, "+X": {"open_area_ft2": 92.25}, "-Y": {"open_area_ft2": 144.5}, "+Y": {"open_area_ft2": 144.5}, "-Z": {"open_area_ft2": 0.0}, "+Z": {"open_area_ft2": 50.75} } } }
```

## 4. The recipe (in the `_reference` folder, also the `recipe_text` output)

`recipe.json` (schema erosion-recipe/1) has: `name`, `engine_version`, `sim` (tile_w, tile_h, cell, steps, gravity, drain, n_frames, smooth, seed), `cleanup` (min_void_ft3, min_foam_ft3, weld), `foam`, `sources` (each: mode inject/pour/spray/line, `pt` or `pts` in feet, dose in ft3, spread in ft, start, duration, dir), `frame`, and `expect` (tile_id, void volume). The app does not need it to analyse a tile, but it is the tile's DNA: with it the exact tile can be rebuilt, edited, or (for a later generative step) varied. The engine's `MAX_SOURCES` is 24.

## 5. Conventions and algorithms the app must match

These are what the Grasshopper Aggregate component does. The app should reproduce them so its numbers agree with what the user sees in Rhino.
- **Opening**: a connected patch of void voxels on a face layer (voxel layer index 0 or n-1 along the axis). My gates counted an opening only if at least **8 ft2**; smaller windows (2.4 to 3 ft wide, about 6 ft2) are real but not counted as ports.
- **Transforms** (`transform_voxels`): `mirror` letters x/y/z flip the void array about the tile centre along that axis; `rot` = quarter turns about the vertical axis through the tile centre, done as `np.rot90(void, rot, axes=(0,1))` (one quarter turn maps a point (x,y) to (W - y, x)). Mirror is applied first, then rotation, then translation. `pos` is in tile units (a shift of 0.5 = 10 ft, must land on whole cells).
- **Patterns**: single; pair-repeat-x/y/z; pair-mirror-x/y/z; pair-rot90-x; pair-rot180-x; pair-shift-x (second tile at (1, 0.5, 0)); quad-repeat; quad-mirror; quad-pinwheel (rotations 0,1,2,3 in a 2 x 2); quad-brick; cube-repeat; cube-mirror (8 copies); or a custom list `[{"pos":[0,0,0]},{"pos":[1,0,0],"mirror":"x","rot":1}]`.
- **Joint score**: for every pair of copies that share a face, take the two touching face layers `fp` and `fq` (void = true) over their overlapping area: `matched = |fp AND fq|`, `dead = |fp OR fq| - matched` (openings that dead-end into foam), `iou = matched/(matched+dead)`, `foam_iou` for the solid parts. **Overall score = 100 * sum(matched) / sum(matched + dead)** over all joints; `None` if nothing opens onto any joint ('sealed'). 90 or more = interlocks, 60 to 90 = partial, below 60 = poor.
- **Components**: the number of connected void components in the assembly, the number that span at least two copies (circulation continues across a joint), versus components inside single copies.
- **Weld semantics** (why some scores are 100 by construction): a tile exported with `weld: "xy"` has identical opposite faces along X and Y, so repeat-x and repeat-y score 100; mirror joins are exact for every tile. Weld averages faces, so an opening present on only one of two opposite faces is thinned or removed: tiles whose openings sit on one side only (edge tiles) chain along one axis.
- **Fixed 6 inch grid**: measurements were meant to be made on a 6 inch grid whatever the export cell size (use `mask_rows_6in`).

## 6. The 15 tiles: three iterations, and expected numbers (test vectors)

There are three sets. **Set 1** (`tile_recipes_15.zip`, names like `gathering_4_room_in_volume`) was judged from PNGs only and never run in Rhino. **The saved set** (`tile_recipes_15_v2.zip`, spec `15_tile_spec_v2.md`, names like `gathering_1_amphitheater_bowl`; my file names say 'v2' but the user calls it the saved set) was run in Rhino and saved by the user. **V2** (this iteration, `recipes_V2_natural_set.zip`, spec `tile_spec_V2_natural_set.md`, every name ends `_V2`) is a natural-erosion set. Different iterations can share a typology but never a tile id.

Expected results for the V2 set (from a headless run of the same engine; the app's own analysis of the exported folder should reproduce these within rounding). Interlock = the Aggregate score (0 to 100).

| Tile | Category, typology (literal names from the PDF) | Tile id | Void % | Faces reached | Repeat-x | Repeat-y | Quad-repeat | Mirror-x | Weld |
|---|---|---|---|---|---|---|---|---|---|
| G1 `gathering_1_stepped_amphitheater_V2` | Gathering, Stepped amphitheater | `e886a120b169aa85` | 24.9 | 5 | 100 | 100 | 100 | 100 | xy |
| G2 `gathering_2_void_field_gathering_V2` | Gathering, Void-field gathering | `fa31a860b3347674` | 24.9 | 5 | 100 | 100 | 100 | 100 | xy |
| G3 `gathering_3_inserted_horizontal_plate_V2` | Gathering, Inserted horizontal plate | `783dd981cce69bdb` | 38.8 | 5 | 100 | 100 | 100 | 100 | xy |
| G4 `gathering_4_contained_room_within_volume_V2` | Gathering, Contained room-within-volume | `2091ebf6efd48ce0` | 18.1 | 4 | 100 | 100 | 100 | 100 | xy |
| G5 `gathering_5_linear_edge_gallery_V2` | Gathering, Linear edge gallery | `3e2aa542987f0d32` | 23.4 | 5 | 100 | 0 | 19 | 100 | x |
| O1 `office_1_open_hall_workspace_V2` | Office, Open hall workspace | `f715d1c4acd3a969` | 26.0 | 5 | 100 | 100 | 100 | 100 | xy |
| O2 `office_2_cascaded_terraced_plates_V2` | Office, Cascaded / terraced plates | `2d7cf83e908b1e60` | 38.8 | 5 | 100 | 2 | 53 | 100 | x |
| O3 `office_3_flat_deep_plan_plate_V2` | Office, Flat deep-plan plate | `429a5bb55dbea539` | 35.4 | 5 | 100 | 100 | 100 | 100 | xy |
| O4 `office_4_void_edge_workspace_V2` | Office, Void-edge workspace | `80c1312bc55283b7` | 36.6 | 4 | 0 | 100 | 45 | - | y |
| O5 `office_5_folded_undulating_work_surface_V2` | Office, Folded / undulating work surface | `4d6c6e369adba1bc` | 30.5 | 5 | 100 | 100 | 100 | 100 | xy |
| L1 `lobby_1_vertical_void_lobby_V2` | Lobby, Vertical void lobby | `90ca902c1f285ef9` | 21.3 | 6 | 100 | 100 | 100 | 100 | xy |
| L2 `lobby_2_compressed_sequential_lobby_V2` | Lobby, Compressed sequential lobby | `74885866505fd988` | 27.8 | 5 | 0 | 100 | 82 | 100 | y |
| L3 `lobby_3_continuous_hall_lobby_V2` | Lobby, Continuous hall lobby | `df383b18aa6d3681` | 25.1 | 5 | 100 | 100 | 100 | 100 | xy |
| L4 `lobby_4_topographic_ground_field_lobby_V2` | Lobby, Topographic / ground-field lobby | `01d1e8295401a5cb` | 38.5 | 5 | 100 | 100 | 100 | 100 | xy |
| L5 `lobby_5_linear_gallery_lobby_V2` | Lobby, Linear gallery lobby | `568c0adfe962d587` | 28.4 | 5 | 100 | 6 | 60 | 100 | x |

Full 12-pattern interlock table for V2: see `tile_spec_V2_natural_set.md` section 5. The saved set's table is in `15_tile_spec_v2.md` section 6. Tile ids of the saved set (as recorded by the engine):

| Slot | Saved-set file name | Tile id | Void % |
|---|---|---|---|
| G1 | `gathering_1_amphitheater_bowl` | `cee844dc09d44846` | 16.4 |
| G2 | `gathering_2_void_field` | `d75aa7bd8eb9b768` | 27.4 |
| G3 | `gathering_3_inserted_horizontal_plate` | `abcc5bb10603c359` | 34.2 |
| G4 | `gathering_4_ring_hall_with_core` | `7d1fd24f3f2093f7` | 19.6 |
| G5 | `gathering_5_linear_edge_gallery` | `6c89102541338c17` | 15.6 |
| O1 | `office_1_nave_and_aisles` | `100225b5c1be14dc` | 26.5 |
| O2 | `office_2_cascaded_terraced_plates` | `13b2204c9fb1dcaa` | 36.3 |
| O3 | `office_3_flat_deep_plan_plate` | `4af1a66dd00a6e21` | 31.2 |
| O4 | `office_4_graduated_blade` | `1b3651f2c6190921` | 27.0 |
| O5 | `office_5_folded_plane` | `0338d40a5a7e1ad5` | 33.1 |
| L1 | `lobby_1_vertical_void` | `c0bfc5cbd78c6038` | 30.1 |
| L2 | `lobby_2_compressed_sequence` | `e283348eb70b0ab9` | 21.0 |
| L3 | `lobby_3_pierced_strata` | `8b61a2c5944b8977` | 34.0 |
| L4 | `lobby_4_two_level_ground_field` | `a9947c16c8131d43` | 44.0 |
| L5 | `lobby_5_linear_rising_gallery` | `a2f365e7bae1dfc4` | 25.1 |

The saved set's overall and per-tile numbers are in Project doc `15_tile_spec_v2.md`; it is the set the user has already saved, so it is likely the first data the app will see.

## 7. Descriptors per typology (from the Part 1 boards; NOT in the export files)

The team's 12 descriptors: carved, stepped, porous, continuous, resistant, threaded, graduated, non-hierarchical circulation, force-driven, light-filled, monumental, and **spatial density** (= 'compresses then releases'; the user confirmed these are the same). The professors set **6 descriptors as the minimum** to score; the user wants all 12 available with on/off checkboxes. The per-typology lists below were read off the orange lists on the Part 1 boards (Project images `Part 1_*.png`) and are what each tile was **designed** to carry; they are ground truth for checking the app, not measurements.

| Slot | Typology | Descriptors on the board |
|---|---|---|
| G1 | Gathering, Stepped amphitheater | carved, stepped, porous, threaded, graduated, force-driven, monumental |
| G2 | Gathering, Void-field gathering | carved, porous, threaded, graduated, force-driven, light-filled |
| G3 | Gathering, Inserted horizontal plate | carved, stepped, porous, resistant, threaded, force-driven, light-filled, monumental |
| G4 | Gathering, Contained room-within-volume | carved, porous, threaded, graduated, monumental, spatial density |
| G5 | Gathering, Linear edge gallery | carved, stepped, porous, threaded, non-hierarchical, light-filled, spatial density |
| O1 | Office, Open hall workspace | carved, porous, continuous, graduated, force-driven, spatial density |
| O2 | Office, Cascaded / terraced plates | carved, stepped, porous, threaded, graduated, spatial density |
| O3 | Office, Flat deep-plan plate | carved, porous, resistant, threaded, force-driven |
| O4 | Office, Void-edge workspace | carved, porous, graduated, monumental, spatial density |
| O5 | Office, Folded / undulating work surface | carved, porous, threaded, graduated, light-filled, monumental, spatial density |
| L1 | Lobby, Vertical void lobby | carved, porous, continuous, graduated, non-hierarchical, force-driven, light-filled |
| L2 | Lobby, Compressed sequential lobby | carved, porous, continuous, threaded, force-driven, light-filled, spatial density |
| L3 | Lobby, Continuous hall lobby | carved, resistant, threaded, force-driven |
| L4 | Lobby, Topographic / ground-field lobby | carved, porous, threaded, monumental |
| L5 | Lobby, Linear gallery lobby | carved, stepped, porous, threaded, graduated, non-hierarchical, spatial density |

### What the parked analysis code measured (reference, unverified in an app)
`claude/reference/parked_engine_5d_with_analysis.py` (Python) has `floor_analysis` (flat floor levels: patches within 1 ft of each other are one level), `find_portals` (openings on faces), `circulation_analysis` (routes between portals through the void, route length, width, loops, 'hub share'), `foam_analysis` (wall thickness), `void_components`, `descriptor_primitives` and `make_readout`. It measures on a fixed 6 inch grid from the void voxels plus the smoothed field. It was tested on shape tests only and was taken out of the Grasshopper script at the user's request. It is a starting point for the app's measurements, not a specification.
Numbers I used when designing (the same quantities the app may want): void fraction, number of void pieces, faces with an opening of at least 8 ft2, opening area per face, floor levels (count and heights), longest clear vertical drop and horizontal run, loops in circulation, and the overlap (intersection over union) between two tiles over all 16 rotations and flips.

## 8. Facts about the tiles that affect analysis

- The V2 tiles use rough foam, so surfaces are lumpy; a thin wall (under about 1.5 ft) or a 4 to 9 ft3 fragment on a face is noise, not design. Small face fragments are weld seams and join their neighbour's copy.
- Some tiles are sealed on purpose (G4, the contained room, reaches only 4 faces via two squeezing routes).
- Edge tiles chain along one axis only (G5, O2, L5 along X; O4, L2 along Y); the others repeat along both X and Y. Repeat along Z scores near 0 for almost every tile because floors and roofs are solid on purpose.
- Rotation (pinwheel) scores are low for asymmetric tiles; the assignment tests repeat, mirror and shift, so the app should report all of them.
- The tile is a foam block with void carved out of it; 'mass, void and floor plates need not fill the cell' in the assignment is satisfied by the openings continuing across the joint.
- A lobby tile may be two or three increments tall per the assignment. The engine supports `tile_h` other than 20 (it builds a taller grid), but none of the 45 recipes so far uses it, and the Aggregate component has only been tested on 20 ft cubes.

## 9. Not verified, and open questions

- The `.3dm` writer was tested against a fake Rhino API; the user has saved tiles from Rhino, so check that the real `.3dm` files opened.
- The GLB and the manifest were validated by my own scripts, not yet loaded in three.js.
- The Versur workflow was never seen. The Assignment 1 Part 3 matrix is not in the Project.
- The user's Grasshopper file and Rhino version details are theirs; the scripts are Rhino 8 Python 3 components (`# r: numpy, scipy, scikit-image` on the first line).
- Whether the app should call the Python engine (it runs headless with a small stub in about 1 to 2 seconds per tile, without Rhino except for meshes) or only read exported folders is undecided; the plan so far is to read exported folders.

## 10. Reference files saved in the Project

- `claude/HANDOFF_evaluation_assembly_program.md` (this doc)
- `claude/tile_spec_V2_natural_set.md`, `claude/15_tile_spec_v2.md`, `claude/15_tile_spec.md` (tile cards: logic, measured facts, levers)
- `claude/reference/erosion_engine_5f.py` (the engine, including the exact export code: `export_bundle`, the manifest and tile.json writers)
- `claude/reference/erosion_aggregate.py` (joint scoring, patterns, transforms)
- `claude/reference/parked_engine_5d_with_analysis.py` (the parked descriptor measurements)

## 11. What the user should bring to the app chat

Two or three complete `_analysis` folders (for example one of each category) to use as sample data; the team's Assignment 1 Part 3 matrix; which descriptors and criteria to score; what the program should do (they will say); and a note on whether the app should also take screenshots for a vision-model reading.
