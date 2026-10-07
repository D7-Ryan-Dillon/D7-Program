// The V7 tile set (the first set, kept, with small changes: engine/tiles/v7, docs/TILE_SET_V7.md): the same checks as scripts/check-v4.ts, run on the committed fixtures-v7.   npm run check:v7
process.env.TILESET = "v7";
void import("./check-v4");
