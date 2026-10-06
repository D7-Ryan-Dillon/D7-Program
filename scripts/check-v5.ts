// The V5 tile set's assembly evidence (engine/tiles/v5, docs/TILE_SET_V5.md): the same checks as scripts/check-v4.ts, run on the committed fixtures-v5.   npm run check:v5
process.env.TILESET = "v5";
void import("./check-v4");
