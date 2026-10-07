// Checks the whole-building generator (lib/arrange/generate.ts) on the project's fifteen tiles, with the program's own analysis reading every result:
// every shape builds the pieces asked for, the sliders change the building, branching works, re-running varies, Grow more keeps what is there, a stop ends the search with
// nothing changed, the program's counts are obeyed, and no result has a stranded floor plate, a dead-end stair, a collision or a piece nobody can reach.
//   npm run check:generate      (the first run works out how the tiles fit together and is the slowest; later runs are quick)

import type { ParsedTile } from "../lib/types";
import { analyzeLayout } from "../lib/arrange/layout";
import { auditBuilding, generateArrangement, generateAsync, type GenContext, type GenResult } from "../lib/arrange/generate";
import { defaultGen, defaultPriorities, defaultRules, defaultSite, emptyDoc, SHAPES, type ArrangementDoc, type Priorities, type ProgramRules, type ShapeKind } from "../lib/arrange/types";
import { loadFixture, TILE_ORDER } from "./tiles/load";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error("FAIL " + msg);
  }
};

const list = TILE_ORDER.map((n) => {
  const t = loadFixture(n);
  if (!t) throw new Error(`${n}: not found in lib/tiles/fixtures`);
  return t;
});
const tiles = new Map<string, ParsedTile>(list.map((t) => [t.id, t]));
const short = (id: string) => {
  const m = /^(gathering|office|lobby)_(\d)_/.exec(id)!;
  return `${m[1][0].toUpperCase()}${m[2]}`;
};

function make(shape: ShapeKind, seed: number, amount: number, pr: Partial<Priorities> = {}, branching = false, rules: ProgramRules = defaultRules()): GenContext {
  return { tileById: tiles, bank: list, rules, priorities: { ...defaultPriorities(), ...pr }, site: defaultSite(), settings: { ...defaultGen(), shape, seed, amount, seedLocked: true, branching } };
}

interface Read {
  r: GenResult;
  levels: number;
  heightFt: number;
  stacked: number;
  mix: string;
  distinct: number;
}

/** Runs one generation and checks the promises that hold for every result. */
function build(label: string, ctx: GenContext, base: ArrangementDoc = { ...emptyDoc(), entranceId: null }, target?: number): Read {
  const t0 = Date.now();
  const r = generateArrangement(ctx, base, target ? { target } : {});
  const l = analyzeLayout(r.doc, tiles, ctx.rules);
  const audit = auditBuilding(l, new Set(base.pieces.map((p) => p.id)));
  ok(l.overlaps.length === 0, `${label}: ${l.overlaps.length} collisions`);
  ok(l.islands.length === 0, `${label}: ${l.islands.length} detached groups`);
  ok(l.unreachable.length === 0, `${label}: ${l.unreachable.length} pieces nobody can reach on foot`);
  ok(audit.stranded === 0, `${label}: ${audit.stranded} floor plates nobody can reach`);
  ok(audit.deadEnds === 0, `${label}: ${audit.deadEnds} stairs or ramps that end nowhere`);
  const zs = new Set(l.boxes.map((b) => b.min[2]));
  const lo = Math.min(...l.boxes.map((b) => b.min[2]));
  const hi = Math.max(...l.boxes.map((b) => b.max[2]));
  let stacked = 0;
  for (let i = 0; i < l.boxes.length; i++) for (let j = i + 1; j < l.boxes.length; j++) {
    const a = l.boxes[i];
    const b = l.boxes[j];
    if (a.min[0] === b.min[0] && a.min[1] === b.min[1] && Math.abs(a.min[2] - b.min[2]) >= 40) stacked++;
  }
  const read: Read = { r, levels: zs.size, heightFt: (hi - lo) * 0.5, stacked, mix: r.doc.pieces.map((p) => short(p.tileId)).sort().join(" "), distinct: new Set(r.doc.pieces.map((p) => p.tileId)).size };
  console.log(`  ${label.padEnd(34)} ${String(r.doc.pieces.length).padStart(2)} pieces  ${read.levels} levels  ${read.heightFt.toFixed(0).padStart(3)} ft  stacked ${stacked}  ${read.distinct} tiles  ${((Date.now() - t0) / 1000).toFixed(1)} s${r.notes.length ? "  (" + r.notes[0].slice(0, 70) + ")" : ""}`);
  return read;
}

const N = 6;
console.log("1. EVERY SHAPE builds the pieces asked for, with every rule kept");
for (const s of SHAPES) {
  const x = build(s.label, make(s.key, 1, N));
  ok(x.r.doc.pieces.length === N, `${s.label}: ${x.r.doc.pieces.length} of ${N} pieces`);
  ok(!!x.r.report, `${s.label}: no report of what was asked and what it came out as`);
}

console.log("\n2. THE SLIDERS change the building");
const flat = build("Tower, Tall 0", make("spineV", 1, N, { tall: 0 }));
const tallT = build("Tower, Tall 95", make("spineV", 1, N, { tall: 95 }));
ok(tallT.heightFt >= flat.heightFt + 20, `Tall 95 makes a tower ${tallT.heightFt} ft tall against ${flat.heightFt} ft at Tall 0`);
ok(tallT.stacked >= 1, "a tall tower has pieces stacked above each other");
const terFlat = build("Terraced, Tall 0", make("stepped", 1, N, { tall: 0 }));
const terTall = build("Terraced, Tall 80", make("stepped", 1, N, { tall: 80 }));
ok(terFlat.levels === 1, `Terraced at Tall 0 should be one level, is ${terFlat.levels}`);
ok(terTall.levels >= 2, `Terraced at Tall 80 should climb, has ${terTall.levels} level(s)`);
const rep = build("Compact, Varied 100", make("compact", 1, N, { varied: 100, tall: 0 }));
const same = build("Compact, Varied 0", make("compact", 1, N, { varied: 0, tall: 0 }));
ok(rep.distinct >= same.distinct, `Varied 100 uses ${rep.distinct} different tiles, Varied 0 uses ${same.distinct}`);
ok(rep.distinct >= N - 1, `Varied 100 should use nearly every piece a different tile: ${rep.distinct} of ${N}`);

console.log("\nthe tall kinds of building really go up (12 pieces, Tall 100)");
{
  const g = (x: Read) => x.r.report!.got;
  const tower = build("Tower", make("spineV", 1, 12, { tall: 100 }));
  ok(tower.heightFt >= 110, `a Tower of 12 pieces should be 110 ft or more tall, is ${tower.heightFt} ft`);
  ok(Math.max(g(tower).widthFt, g(tower).depthFt) <= 60, `a Tower should stand on a small footprint, is ${g(tower).widthFt} x ${g(tower).depthFt} ft`);
  ok(tower.levels >= 10, `a Tower should climb with almost every piece: ${tower.levels} levels`);
  const compact = build("Compact", make("compact", 1, 12, { tall: 100 }));
  ok(compact.heightFt >= Math.max(g(compact).widthFt, g(compact).depthFt), `a Compact building at Tall 100 should be taller than it is wide: ${compact.heightFt} ft against ${g(compact).widthFt} x ${g(compact).depthFt} ft`);
  const village = build("Village", make("village", 1, 12, { tall: 100 }));
  ok(village.heightFt >= 50, `a Village at Tall 100 should have towers, is ${village.heightFt} ft tall`);
  const bridge = build("Bridge", make("bridge", 1, 12, { tall: 100 }));
  ok(bridge.heightFt >= 50, `a Bridge at Tall 100 should have a raised span, is ${bridge.heightFt} ft tall`);
}

console.log("\n3. BRANCHING wings grow out of the shape");
const plain = build("Tower, no wings", make("spineV", 2, N + 2, { tall: 95 }, false));
const wings = build("Tower, with wings", make("spineV", 2, N + 2, { tall: 95 }, true));
ok(plain.r.doc.pieces.length === N + 2 && wings.r.doc.pieces.length === N + 2, "both towers should have all their pieces");

console.log("\n4. RE-RUNNING varies the building (new seeds, same settings)");
const mixes = new Set<string>();
for (const seed of [11, 22, 33, 44]) mixes.add(build(`Compact, seed ${seed}`, make("compact", seed, N)).mix);
ok(mixes.size >= 3, `four seeds gave only ${mixes.size} different sets of tiles`);

console.log("\n5. GROW MORE keeps what is there");
{
  const first = build("a building of 4", make("compact", 3, 4));
  const grown = build("grown to 6", make("compact", 3, 4), first.r.doc, 6);
  const keptIds = new Set(first.r.doc.pieces.map((p) => p.id));
  const kept = grown.r.doc.pieces.filter((p) => keptIds.has(p.id));
  ok(kept.length === first.r.doc.pieces.length, "grown: the pieces already there were changed or lost");
  ok(grown.r.doc.pieces.length === 6, `grown: ${grown.r.doc.pieces.length} of 6 pieces`);
}

console.log("\n6. THE PROGRAM's counts are obeyed");
{
  const rules = defaultRules();
  rules.counts.maxCopies = 1;
  const x = build("each tile at most once", make("compact", 5, N, {}, false, rules), undefined, undefined);
  ok(x.distinct === x.r.doc.pieces.length, "with one copy of each tile allowed, a tile was repeated");
}

console.log("\n7. STOP ends the search with nothing changed");
void (async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await generateAsync(make("spineV", 1, N), { ...emptyDoc(), entranceId: null }, {}, undefined, ac.signal);
  ok(r === null, "a stopped search should return nothing");
  console.log(failures ? `\n${failures} generator check(s) failed` : "\nAll generator checks passed");
  process.exit(failures ? 1 : 0);
})();
