// Debug helper: why does the generator turn a tile down?   TILESET=v5 npx tsx scripts/dbg-gen.ts G5
// For every host tile (alone, unturned) and every slot, tries the tile in all orientations / anchors / levels and counts the reasons.
import type { ParsedTile } from "../lib/types";
import { defaultGen, defaultPriorities, defaultRules, defaultSite } from "../lib/arrange/types";
import { newRejections, placeAgainst, stateOf, type GenContext } from "../lib/arrange/generate";
import { makePiece } from "../lib/arrange/ops";
import { loadFixture, V4_ORDER } from "./v4/load";

const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) tiles.set(n, loadFixture(n)!);
const list = [...tiles.values()];
const key = process.argv[2];
const mine = list.find((t) => t.id.startsWith({ G: "gathering", O: "office", L: "lobby" }[key[0]]! + "_" + key[1]))!;
const ctx: GenContext = { tileById: tiles, bank: list, rules: defaultRules(), priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), shape: "compact", seed: 1, amount: 4, seedLocked: true }, budgetMs: 6000 };
const total = newRejections();
for (const host of list) {
  const st = stateOf([makePiece({ pieces: [] } as never, host.id, [0, 0, 0], {})], ctx);
  const w = newRejections();
  for (const slot of st.exposed)
    for (let rot = 0; rot < 4; rot++)
      for (const mirror of [false, true])
        for (let patch = 0; patch < 3; patch++)
          for (let align = 0; align < 9; align++)
            for (const lv of [null, 0, 1, 2]) placeAgainst(ctx, st, slot, mine, rot, mirror, patch, lv, 40, align, w);
  console.log(`${mine.id} against ${host.id.slice(0, 28).padEnd(28)} slots ${String(st.exposed.length).padStart(2)}  ` + JSON.stringify(w));
  for (const k of Object.keys(w) as (keyof typeof w)[]) total[k] += w[k];
}
console.log("TOTAL", JSON.stringify(total));
