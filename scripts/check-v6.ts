// The V6 tile set's assembly evidence (engine/tiles/v6, docs/TILE_SET_V6.md): the same checks as scripts/check-v4.ts, run on the committed fixtures-v6.   npm run check:v6
process.env.TILESET = "v6";
void import("./check-v4");
