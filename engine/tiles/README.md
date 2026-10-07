# The fifteen tiles as engine 7 recipes

Fifteen tiles, three categories by five typologies from `Assignemnt_02_ProtoArchitecturalSpaces.pdf`, each a 20 x 20 x 20 ft cube named `<category>_<n>_<typology>_v7`. Each is a self-contained `erosion-recipe/2` recipe: paste it into the engine's `recipe` panel in Grasshopper (or type the file path) and the engine builds exactly that tile, ending with `RECIPE CHECK: OK`. No Rhino geometry is needed. The foam is the printed module, the voids are the spaces.

**Everything about the set lives in [`v7/`](v7/README.md)** (the recipes `defs7.py`, the build, verify, picture and package scripts, the recipe files and previews) and in [`../../docs/TILE_SET_V7.md`](../../docs/TILE_SET_V7.md) (what each tile is, the measured results, the limits). **How an AI session writes and checks them is [`../../docs/RECIPE_WRITER.md`](../../docs/RECIPE_WRITER.md)**; read it before changing a tile. The committed voxels and the engine's own measurements are `lib/tiles/fixtures/`.

This folder holds the two shared helper modules the recipes are written with:
- `kit.py`: the recipe format and plain helpers (`box`, `slab`, `plate_group`, sources, `recipe`).
- `organic.py`: the language the tiles are written in (`vein`, `chamber`, `passage`, `through_shaft`, `shell`, `street`, `column`, `blob`, `port`; warped plates are stored as compact height grids, the recipe shape type `field`).
- `make_fixtures.py`: copies the voxels and the engine's own analysis from an export folder into the app's parity fixtures (`python make_fixtures.py C:/tmp/tiles7 ../../lib/tiles/fixtures`, then `npm run check:parity`; it clears the output folder first, so check that nothing stale is left).

## What the tiles are
Spatial prototypes, not floor plans: each reads as its typology from the **section and the sequence of spaces**, and each reads as an eroded form (a mass that acetone has worked on), not as a built object. Voids are soft passages that swell and pinch and overlapping chambers; plates are strata (warped, curved-edged floors, retained as protected foam); the typology is carried by the idea (a bowl whose terraces are contour lines, a field of separate voids, a tongue of rock ending in a bitten edge, a kernel with a room in it, a gallery along an edge, a hall on a few pillars, floors cantilevered from alternating walls, two broad floors with light wells, floors wrapping a funnel void, a rippled floor, a chimney with a stair, compress-release-compress, a nave with terraces, a landscape floor, a street of rock that climbs).

## How they interlock
A 20 ft lattice cell: ground slab top at 2 ft, a mid datum at 12 ft, two storeys of about 8 ft; the top face is open to the roof plate (the next tile's ground slab sits on it). Every side face has a standard opening with a floor behind it (`port`, and `lport`, a low one that reaches the ground floor), so tiles meet across a joint whatever is behind it. Tiles that repeat along an axis are welded on it (`weld`); a mirror join is exact for every tile. Floors that reach 12 ft, stairs and ramps are described per tile in `docs/TILE_SET_V7.md`.

## Limits
A pasted recipe must stay under about 32,000 characters (a Grasshopper panel cuts longer text, which shows as `recipe is not valid JSON`), which is why warped plates are `field` shapes; the engine takes at most 24 sources per recipe (`verify.py` checks both). Not verified: running the recipes in Rhino itself and the `.3dm` export (everything is verified headless with Rhino's own Python and the same engine code).
