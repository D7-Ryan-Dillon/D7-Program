// Debug helper: best candidate score of every guest tile against one host, with the parts of the objective.   TILESET=v5 npx tsx scripts/dbg-score.ts L4
import type { ParsedTile } from "../lib/types";
import { defaultGen, defaultPriorities, defaultRules, defaultSite } from "../lib/arrange/types";
import { placeAgainst, scoreCandidate, stateOf, type Candidate, type GenContext } from "../lib/arrange/generate";
import { makePiece } from "../lib/arrange/ops";
import { loadFixture, V4_ORDER } from "./v4/load";

const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) tiles.set(n, loadFixture(n)!);
const list = [...tiles.values()];
const find = (key: string) => list.find((t) => t.id.startsWith({ G: "gathering", O: "office", L: "lobby" }[key[0]]! + "_" + key[1]))!;
const host = find(process.argv[2]);
const ctx: GenContext = { tileById: tiles, bank: list, rules: defaultRules(), priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), shape: "compact", seed: 1, amount: 4, seedLocked: true }, budgetMs: 6000 };
const st = stateOf([makePiece({ pieces: [] } as never, host.id, [0, 0, 0], {})], ctx);
for (const g of list) {
  let best: Candidate | null = null, bs = -1e9, n = 0, sum = 0;
  for (const slot of st.exposed)
    for (let rot = 0; rot < 4; rot++)
      for (const mirror of [false, true])
        for (let patch = 0; patch < 3; patch++)
          for (let align = 0; align < 9; align++)
            for (const lv of [null, 0, 1, 2]) {
              const c = placeAgainst(ctx, st, slot, g, rot, mirror, patch, lv, 40, align);
              if (!c) continue;
              const s = scoreCandidate(ctx, st, c);
              n++; sum += s;
              if (s > bs) { bs = s; best = c; }
            }
  console.log(`${g.id.slice(0, 22).padEnd(22)} accepted ${String(n).padStart(5)}  mean ${(sum / Math.max(1, n)).toFixed(2)}  best ${bs.toFixed(2)}  ` + (best ? Object.entries(best.parts).map(([k, v]) => `${k.slice(0, 4)} ${v.toFixed(2)}`).join(" ") : ""));
}
