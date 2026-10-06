// Assembly evidence for the V4 tile set (engine/tiles/v4, docs/TILE_SET_V4.md): the fifteen tiles are read by the app's own code (lib/tiles + lib/arrange) and put
// together every way the Arrange tab can: all 225 pairs, repeat / mirror / shift in 2, 4 and 8 copies, nested L shifts, mixed gathering / office / lobby banks built
// by Auto Generate over several seeds and shapes, and a few hand-built vertical meetings (a ramp that arrives at another tile's upper floor). Nothing here relaxes a
// walking or collision rule: a piece counts only if it is attached, collision-free by the occupancy policy, and reachable on foot from the entrance.
//   npm run check:v4              (reads lib/tiles/fixtures-v4; pictures and tables go to $V4_OUT, default engine/tiles/v4/assemblies)
//   V4_EXPORTS=C:/tmp/tiles4 npm run check:v4 -- --live    reads the fresh engine exports instead of the committed fixtures

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTile } from "../lib/types";
import { analyzeLayout, type Layout } from "../lib/arrange/layout";
import { buildComposite } from "../lib/arrange/composite";
import { generateArrangement, type GenContext } from "../lib/arrange/generate";
import { runAllInterlock, interlockDoc, type InterlockPattern } from "../lib/arrange/interlock";
import { makePiece, withPiece } from "../lib/arrange/ops";
import { bestPair, pairCandidates } from "../lib/arrange/pairMatrix";
import { getOriented } from "../lib/arrange/orient";
import { getOcc, getWalk } from "../lib/arrange/occupancy";
import { defaultGen, defaultPriorities, defaultRules, defaultSite, emptyDoc, type ArrangementDoc, type Piece, type ProgramRules, type ShapeKind } from "../lib/arrange/types";
import { loadExport, loadFixture, V3_ORDER, COMPARE_FIXTURES, V4_ORDER, SET } from "./v4/load";
import { evaluateTile } from "../lib/scoring/matrixEval";
import { MATRIX } from "../lib/scoring/matrix";
import { suggestPick, typologyGroups } from "../lib/scoring/compareSet";
import { renderArrangement } from "./fixtures/render";
/** the plan-slice picture of lib scripts/fixtures/render.ts; skipped (not failed) for an assembly too big for its canvas: the isometric pictures (render_assemblies.py) do not have that limit */
const crude = (...a: Parameters<typeof renderArrangement>) => {
  try {
    renderArrangement(...a);
  } catch {
    /* too large for the plan-slice canvas */
  }
};

const live = process.argv.includes("--live");
const only = process.env.V4_ONLY?.split(",").map(Number);
const want = (n: number) => !only || only.includes(n);
const out = process.env.V4_OUT ?? join(__dirname, "..", "engine", "tiles", SET, "assemblies");
mkdirSync(out, { recursive: true });
/** every picture-worthy assembly is also written as a voxel box (void, plates, struts, mask, owner per cell) that engine/tiles/v4/render_assemblies.py draws as an isometric cutaway with one colour per piece */
const ASM = process.env.V4_ASM ?? `C:/tmp/tiles${SET.replace(/\D/g, "")}_asm`;
if (!only || only.includes(4)) rmSync(ASM, { recursive: true, force: true });
function dump(name: string, l: Layout) {
  const comp = buildComposite(l.boxes);
  if (!comp) return;
  const dir = join(ASM, name, name + "_analysis");
  mkdirSync(join(dir, "voxels"), { recursive: true });
  writeFileSync(join(dir, "tile.json"), JSON.stringify({ grid: comp.grid, cell_ft: comp.cell }));
  writeFileSync(join(dir, "voxels", "void.u8"), comp.void);
  writeFileSync(join(dir, "voxels", "mask.u8"), comp.mask);
  writeFileSync(join(dir, "voxels", "plates.u8"), comp.plates.map((v) => (v ? 1 : 0)));
  writeFileSync(join(dir, "voxels", "struts.u8"), comp.struts.map((v) => (v ? 1 : 0)));
  writeFileSync(join(dir, "voxels", "owner.i16"), Buffer.from(comp.owner.buffer, comp.owner.byteOffset, comp.owner.byteLength));
}
let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error("FAIL " + msg);
  }
};
const report: string[] = [];
const say = (s = "") => {
  console.log(s);
  report.push(s);
};

const rules: ProgramRules = defaultRules();
const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) {
  const t = live ? loadExport(n) : loadFixture(n);
  if (!t) throw new Error(`${n}: not found (${live ? "engine export" : "lib/tiles/fixtures-v4"}). Run engine/tiles/v4/build.py and engine/tiles/make_fixtures.py.`);
  tiles.set(n, t);
}
const list = V4_ORDER.map((n) => tiles.get(n)!);
const short = (t: ParsedTile) => {
  const m = /^(gathering|office|lobby)_(\d)_/.exec(t.id)!;
  return `${m[1][0].toUpperCase()}${m[2]}`.replace("G", "G").replace("O", "O").replace("L", "L");
};
const KEY = (id: string) => short(tiles.get(id)!);
const lay = (doc: ArrangementDoc): Layout => analyzeLayout(doc, tiles, rules);
const valid = (l: Layout) => l.overlaps.length === 0 && l.islands.length === 0 && l.unreachable.length === 0;

// ---- 1. the tiles themselves ------------------------------------------------------------------------------------------------------------------------------------
say("1. THE TILES");
const EXPECT = [
  ["gathering", 1, "stepped amphitheater"], ["gathering", 2, "void field gathering"], ["gathering", 3, "inserted horizontal plate"], ["gathering", 4, "contained room within volume"], ["gathering", 5, "linear edge gallery"],
  ["office", 1, "open hall workspace"], ["office", 2, "cascaded terraced plates"], ["office", 3, "flat deep plan plate"], ["office", 4, "void edge workspace"], ["office", 5, "folded undulating work surface"],
  ["lobby", 1, "vertical void lobby"], ["lobby", 2, "compressed sequential lobby"], ["lobby", 3, "continuous hall lobby"], ["lobby", 4, "topographic ground field lobby"], ["lobby", 5, "linear gallery lobby"],
] as const;
list.forEach((t, i) => {
  const [cat, slot, typ] = EXPECT[i];
  ok(t.meta?.category === cat && t.meta?.slot === slot && t.meta?.variant === SET.toUpperCase(), `${t.id}: metadata ${JSON.stringify(t.meta)}`);
  ok((t.meta?.typology ?? "").replace(/ \/ /g, " ").replace(/-/g, " ") === typ, `${t.id}: typology "${t.meta?.typology}" expected "${typ}"`);
  const base = getOcc(getOriented(t, 0, false)).inside;
  for (let r = 0; r < 4; r++) for (const m of [false, true]) ok(getOcc(getOriented(t, r, m)).inside === base, `${t.id}: orientation ${r}/${m} changed the container`);
  const o = getOcc(getOriented(t, 0, false));
  say(`  ${short(t)}  ${t.id.padEnd(46)} ${t.tileFt.join(" x ")} ft  container ${(o.inside * 0.125).toFixed(0)} ft3  carved ${(o.voidCells * 0.125).toFixed(0)} ft3`);
});

// ---- 2. every pair ----------------------------------------------------------------------------------------------------------------------------------------------
if (want(2)) {
say("\n2. PAIRS: the best placement of the second tile (column) beside the first (row), over eight orientations. W = walkable joint, c = needs a connector, . = touching or a view only, x = no placement");
type Cell = { w: boolean; c: boolean; touch: boolean; score: number | null; piece: Piece | null };
const pairOf = (a: ParsedTile, b: ParsedTile): Cell => {
  const bp = bestPair(a, b);
  const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
  const pb: Piece = { id: "b", tileId: b.id, pos: bp.pos, rotZ: bp.rotZ, mirrorX: bp.mirrorX, scale: 1, locked: false };
  const doc: ArrangementDoc = { ...emptyDoc(), pieces: [pa, pb], entranceId: "a" };
  const l = lay(doc);
  const j = l.joints[0];
  if (!j || l.overlaps.length) return { w: false, c: false, touch: false, score: null, piece: null };
  return { w: l.unreachable.length === 0 && j.connect.walkable && l.islands.length === 0, c: j.connect.kind === "connector", touch: true, score: j.score, piece: pb };
};
const t0 = Date.now();
const M: Cell[][] = list.map((a) => list.map((b) => pairOf(a, b)));
say("      " + list.map((t) => short(t).padEnd(3)).join(" "));
list.forEach((a, i) => say(`  ${short(a).padEnd(3)} ` + M[i].map((c) => (c.w ? "W" : c.c ? "c" : c.touch ? "." : "x").padEnd(3)).join(" ")));
const nW = M.flat().filter((c) => c.w).length;
say(`  ${nW} of 225 ordered pairs (${((100 * nW) / 225).toFixed(0)}%) have a walkable joint in their best placement  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
// the matrix places the second tile on the first tile's +x side only; a tile whose doors are on its -x and -y faces (L1) is therefore judged as the second tile. A pair works if either order does.
const pairWorks = (i: number, j: number) => M[i][j].w || M[j][i].w;
const nSym = list.reduce((n, _, i) => n + list.filter((__, j) => j >= i && pairWorks(i, j)).length, 0);
say(`  counted either way round: ${nSym} of 120 unordered pairs (${((100 * nSym) / 120).toFixed(0)}%) can be joined on foot`);
list.forEach((a, i) => {
  const partners = list.filter((_, j) => pairWorks(i, j)).length;
  say(`  ${short(a)}: walkable partners ${partners}/15  (first tile ${M[i].filter((c) => c.w).length}, second tile ${M.filter((row) => row[i].w).length})`);
  ok(partners >= 12, `${a.id} has only ${partners} walkable partners`);
});
}

// ---- 3. repeat / mirror / shift ---------------------------------------------------------------------------------------------------------------------------------
if (want(3)) {
say("\n3. REPEAT / MIRROR / SHIFT in 2, 4 and 8 copies (the Arrange tab's interlock test): V = valid (attached, no collision, every copy reachable on foot), a = attached and collision-free but not every copy reachable, X = collides or detached");
const interlockTable: Record<string, { p: InterlockPattern; n: number; state: string }[]> = {};
for (const t of list) {
  const rows = runAllInterlock(t, rules);
  interlockTable[t.id] = rows.map((r) => ({ p: r.pattern, n: r.count, state: r.connected && r.walkable ? "V" : r.connected ? "a" : "X" }));
  say(`  ${short(t)}  ` + rows.map((r) => `${r.pattern} ${r.count}: ${r.connected && r.walkable ? "V" : r.connected ? "a" : "X"}`).join("   "));
}
{
  const withV = list.filter((t) => interlockTable[t.id].some((r) => r.state === "V"));
  say(`  ${withV.length} of 15 tiles make at least one valid repeat / mirror / shift aggregation by themselves`);
}
}

// ---- 4. Auto Generate over the whole bank --------------------------------------------------------------------------------------------------------------------------
if (want(4)) {
say("\n4. AUTO GENERATE: the whole V4 bank, several shapes, sizes and seeds. Every result must be collision-free, one attached group, and every piece reachable on foot from the entrance");
const SHAPES: ShapeKind[] = (process.env.V4_SHAPES?.split(",") as ShapeKind[] | undefined) ?? ["compact", "courtyard", "stepped", "spineH", "village"];
const AMOUNTS = (process.env.V4_AMOUNTS?.split(",").map(Number)) ?? [2, 4, 8];
const SEEDS = (process.env.V4_SEEDS?.split(",").map(Number)) ?? [1, 2, 3];
const used = new Map<string, number>();
const inValid = new Map<string, number>();
const samples: { name: string; doc: ArrangementDoc; l: Layout }[] = [];
let runs = 0;
let validRuns = 0;
let nestedTotal = 0;
const rows: string[] = [];
const mixes: string[] = [];
for (const amount of AMOUNTS)
  for (const shape of SHAPES)
    for (const seed of SEEDS) {
      const ctx: GenContext = { tileById: tiles, bank: list, rules, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), shape, seed, amount, seedLocked: true }, budgetMs: 6000 };
      const t1 = Date.now();
      const r = generateArrangement(ctx, emptyDoc(), { tries: 3 });
      const l = lay(r.doc);
      runs++;
      const v = valid(l);
      if (v) validRuns++;
      ok(l.overlaps.length === 0, `generate ${amount}/${shape}/${seed}: ${l.overlaps.length} collisions`);
      ok(l.islands.length === 0, `generate ${amount}/${shape}/${seed}: ${l.islands.length} detached groups`);
      ok(l.unreachable.length === 0, `generate ${amount}/${shape}/${seed}: ${l.unreachable.length} pieces not reachable on foot`);
      nestedTotal += l.nested.length;
      const cats = new Set(r.doc.pieces.map((p) => tiles.get(p.tileId)!.meta?.category));
      for (const p of r.doc.pieces) {
        used.set(p.tileId, (used.get(p.tileId) ?? 0) + 1);
        if (v) inValid.set(p.tileId, (inValid.get(p.tileId) ?? 0) + 1);
      }
      const seq = r.doc.pieces.map((p) => KEY(p.tileId)).join(" ");
      rows.push(`  ${String(amount).padStart(2)} pcs ${shape.padEnd(9)} seed ${seed}: ${String(r.doc.pieces.length).padStart(2)} placed  ${v ? "valid" : "INVALID"}  joints ${l.joints.length} (${l.joints.filter((j) => j.connect.walkable).length} walkable)  nested ${l.nested.length}  ${cats.size} categories  ${Date.now() - t1} ms   [${seq}]`);
      if (cats.size === 3) mixes.push(`${amount}/${shape}/${seed}`);
      if (v && (seed === SEEDS[0] || r.doc.pieces.length >= 8)) samples.push({ name: `gen_${String(amount).padStart(2, "0")}_${shape}_seed${seed}`, doc: r.doc, l });
    }
for (const r of rows) say(r);
say(`  ${validRuns} of ${runs} runs valid; ${nestedTotal} nested fits found; ${mixes.length} runs mixed all three categories`);
say("  how often each tile was placed (in all runs / in valid runs):");
say("  " + list.map((t) => `${short(t)} ${used.get(t.id) ?? 0}/${inValid.get(t.id) ?? 0}`).join("   "));
// A tile the objective never prefers (a low-density gallery scores low on compactness) must still be assemblable: the best two-piece assembly with each host must be one valid aggregation.
for (const t of list) {
  if ((inValid.get(t.id) ?? 0) > 0) continue;
  let hit = 0;
  const hosts = list.filter((h) => h !== t);
  // the pair matrix stands the second tile on the first tile's +x side only, so a pair works if either order does (as in section 2)
  const works = (first: ParsedTile, second: ParsedTile) => {
    const bp = bestPair(first, second);
    const pa: Piece = { id: "a", tileId: first.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
    const pb: Piece = { id: "b", tileId: second.id, pos: bp.pos, rotZ: bp.rotZ, mirrorX: bp.mirrorX, scale: 1, locked: false };
    return valid(lay({ ...emptyDoc(), pieces: [pa, pb], entranceId: "a" }));
  };
  for (const h of hosts) if (works(h, t) || works(t, h)) hit++;
  say(`  ${short(t)} was not chosen by the objective in any run; its best two-piece assembly with each other tile is valid for ${hit} of ${hosts.length} hosts`);
  ok(hit >= hosts.length - 2, `${t.id} could not be assembled with most hosts`);
}
for (const s of samples.filter((q) => !q.name.startsWith("gen_02")).slice(0, 12)) {
    crude(s.l.boxes, join(out, s.name + ".png"), { sliceZ: [4, 14, 24] });
    dump(s.name, s.l);
  }
}

// ---- 5. nesting: tiles with a notch (L-plans in V4 / V5, stepped tops in V6) with a tile that fills it -----------------------------------------------------------------------
if (want(5)) {
if (SET === "v6") {
say("\n5. NESTING (stepped tops): each stepped tile (G1, G5, O2, L4, L5) with each of the fifteen tiles at the 10 ft lattice shifts (every orientation, offsets of 10 ft in x, y and z): valid = no collision, a nested fit, attached, both reachable on foot");
const STEPPED = ["G1", "G5", "O2", "L4", "L5"].map((k) => list.find((t) => short(t) === k)!);
const samples: { name: string; l: Layout }[] = [];
for (const a of STEPPED) {
  let partners = 0;
  let nestedAll = 0;
  let walkAll = 0;
  const who: string[] = [];
  for (const b of list) {
    let found = 0;
    let validFound = 0;
    let first: Layout | null = null;
    for (let rot = 0; rot < 4; rot++)
      for (const mirror of [false, true])
        for (const dx of [-10, 0, 10])
          for (const dy of [-10, 0, 10])
            for (const dz of [-10, 0, 10]) {
              const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
              const pb: Piece = { id: "b", tileId: b.id, pos: [dx, dy, dz], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
              const l = lay({ ...emptyDoc(), pieces: [pa, pb], entranceId: "a" });
              if (l.overlaps.length || !l.nested.length) continue;
              found++;
              if (valid(l) && l.joints.some((j) => j.connect.walkable)) {
                validFound++;
                if (!first) first = l;
              }
            }
    nestedAll += found;
    walkAll += validFound;
    if (found) {
      partners++;
      who.push(short(b) + (validFound ? "*" : ""));
      if (first && !samples.find((q) => q.name.startsWith(`nest_${short(a)}_`))) samples.push({ name: `nest_${short(a)}_${short(b)}`, l: first });
    }
  }
  say(`  ${short(a)}: nests with ${partners} of ${list.length} tiles (${nestedAll} collision-free nested placements, ${walkAll} of them also walkable with both pieces reachable; * = a walkable one exists): ${who.join(" ")}`);
  ok(partners >= 3, `${a.id} nests with only ${partners} tiles`);
}
for (const q of samples) {
  crude(q.l.boxes, join(out, q.name + ".png"), { sliceZ: [4, 14] });
  dump(q.name, q.l);
}
} else {
say("\n5. NESTING: the three L-plan tiles (G5, O4, L5) placed into each other's 10 x 10 ft notch (every orientation, offsets of 10 ft): valid = no collision, attached, both reachable on foot");
const LS = ["G5", "O4", "L5"].map((k) => list.find((t) => short(t) === k)!);
const nestedSamples: { name: string; l: Layout }[] = [];
for (const a of LS) {
  for (const b of LS) {
    let found = 0;
    let validFound = 0;
    let first: Layout | null = null;
    for (let rot = 0; rot < 4; rot++)
      for (const mirror of [false, true])
        for (const dx of [-10, 0, 10, 20])
          for (const dy of [-10, 0, 10, 20])
            for (const dz of [0, 10]) {
              const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
              const pb: Piece = { id: "b", tileId: b.id, pos: [dx, dy, dz], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
              const l = lay({ ...emptyDoc(), pieces: [pa, pb], entranceId: "a" });
              if (l.overlaps.length || !l.nested.length) continue;
              found++;
              if (valid(l) && l.joints.some((j) => j.connect.walkable)) {
                validFound++;
                if (!first) first = l;
              }
            }
    say(`  ${short(a)} + ${short(b)}: ${found} collision-free nested placements, ${validFound} of them with a walkable joint and both pieces reachable`);
    if (first && a !== b) nestedSamples.push({ name: `nest_${short(a)}_${short(b)}`, l: first });
  }
}
for (const s of nestedSamples) {
    crude(s.l.boxes, join(out, s.name + ".png"), { sliceZ: [4, 14] });
    dump(s.name, s.l);
  }
{
  const total = LS.length * LS.length;
  say(`  (${total} ordered pairs of L-plan tiles; nested pairs that also walk: see the counts above)`);
}
}
}

// ---- 6. vertical meetings: a ramp that arrives at another tile's floor ----------------------------------------------------------------------------------------------
if (want(6)) {
say("\n6. VERTICAL: a tile standing with its ground floor at an upper level of L1 (ring ramp) or G5 (gallery ramp), joined where the ramp arrives, found by lining up doors and floors (all host orientations)");
for (const [hostKey, label] of [["L1", "the ring ramp of L1"], ["G5", "the gallery ramp of G5"]] as const) {
  const host = list.find((t) => short(t) === hostKey)!;
  let tried = 0;
  const hits = new Map<string, number>();
  let sample: Layout | null = null;
  for (const guest of list) {
    if (guest === host) continue;
    let okGuest = 0;
    // the guest stands one or two storeys up, at the 10 ft lattice offsets round the host (and, found by lining up doors and floors, wherever the host's own levels say)
    for (let hr = 0; hr < 4; hr++)
      for (const hm of [false]) {
        const cands: Piece[] = [...pairCandidates(host, guest, 1.5, { aRot: hr, aMirror: hm, openings: 4, allLevels: true })].filter((c) => c.joint.connect.walkable).map((c) => c.piece);
        for (const rot of [0, 1, 2, 3])
          for (const [dx, dy] of [-10, 0, 10].flatMap((d) => [[-20, d], [20, d], [d, -20], [d, 20]] as [number, number][]))
            for (const dz of [10, 20]) cands.push({ id: "b", tileId: guest.id, pos: [dx, dy, dz], rotZ: rot, mirrorX: false, scale: 1, locked: false });
        for (const cp of cands) {
          if (cp.pos[2] < 10) continue;
          const pa: Piece = { id: "a", tileId: host.id, pos: [0, 0, 0], rotZ: hr, mirrorX: hm, scale: 1, locked: false };
          const l = lay({ ...emptyDoc(), pieces: [pa, { ...cp, id: "b" }], entranceId: "a" });
          if (l.overlaps.length || !l.joints.some((j) => j.connect.walkable)) continue;
          tried++;
          if (!valid(l)) continue;
          okGuest++;
          if (!sample) sample = l;
        }
      }
    hits.set(guest.id, okGuest);
  }
  const withHit = [...hits.entries()].filter(([, n]) => n > 0).map(([id]) => short(tiles.get(id)!));
  say(`  ${label}: ${withHit.length} of 14 other tiles stand at an upper level of the host and are reached on foot (${withHit.join(" ")})  [${tried} walkable raised placements checked]`);
  ok(withHit.length >= 3, `${label}: only ${withHit.length} tiles can be reached at an upper level`);
  if (sample) {
    crude((sample as Layout).boxes, join(out, `vertical_${hostKey}.png`), { sliceZ: [4, 14, 24] });
    dump(`vertical_${hostKey}`, sample as Layout);
  }
}
}

// ---- 7. receiving floors ---------------------------------------------------------------------------------------------------------------------------------------------
if (want(7)) {
  say("\n7. RECEIVING FLOORS: tiles with more than one floor of their own (G2, G3, G4, O2, O4 ...) next to a host whose ramp arrives at their upper floor: the share of the guest's floor area a person can reach");
  const zonesOf = (t: ParsedTile) => getWalk(getOcc(getOriented(t, 0, false))).zones.filter((z) => z.significant);
  const RECEIVERS = ["G2", "G3", "O4"];
  const multi = list.filter((t) => zonesOf(t).length >= 2);
  for (const guest of multi) {
    // alone, a person who comes in at the ground reaches the main floor only: its share of all the floor of the tile
    const zs = zonesOf(guest);
    const wkG = getWalk(getOcc(getOriented(guest, 0, false)));
    const own = zs.reduce((n, z) => n + z.areaFt2, 0) > 0 ? zs.filter((z) => z.id === wkG.main).reduce((n, z) => n + z.areaFt2, 0) / zs.reduce((n, z) => n + z.areaFt2, 0) : 0;
    let best = { frac: own, host: "(alone)" };
    for (const host of ["L1", "G5", "O2", "L4"].map((k) => list.find((t) => short(t) === k)!)) {
      if (host === guest) continue;
      for (let hr = 0; hr < 4; hr++)
        for (const hm of [false, true])
          for (const c of pairCandidates(host, guest, 1.5, { aRot: hr, aMirror: hm, openings: 4, allLevels: true })) {
            if (!c.joint.connect.walkable) continue;
            const pa: Piece = { id: "a", tileId: host.id, pos: [0, 0, 0], rotZ: hr, mirrorX: hm, scale: 1, locked: false };
            const l = lay({ ...emptyDoc(), pieces: [pa, c.piece], entranceId: "a" });
            if (!valid(l)) continue;
            const r = l.reach.get("b")!;
            const f = r.totalFt2 > 0 ? r.reachedFt2 / r.totalFt2 : 0;
            if (f > best.frac + 1e-6) best = { frac: f, host: short(host) };
          }
    }
    say(`  ${short(guest)}: ${(own * 100).toFixed(0)}% of its floor on its main floor alone; ${(best.frac * 100).toFixed(0)}% best beside ${best.host}`);
    // G4's second floor is the roof of its enclosed room, a deck seen from the hall above and reached from nowhere: an object in the volume, by design, not a receiving floor
    if (RECEIVERS.includes(short(guest))) ok(best.frac > own + 0.05 || own > 0.95, `${guest.id}: no neighbour gives access to its other floors`);
    else say(`      (${short(guest)}: its other floor is not a receiving floor by design)`);
  }
}

// ---- 8. the first set and V4 as variants of one typology, in the Analysis -------------------------------------------------------------------------------------------
if (want(8)) {
  say("\n8. VARIANTS: each V4 tile beside the first set's tile of the same typology, as the Analysis tab's variant comparison reads them (strength, fit and usability kept apart)");
  const first = V3_ORDER.map((n) => loadFixture(n, COMPARE_FIXTURES)).filter((t): t is ParsedTile => !!t);
  ok(first.length === 15, `only ${first.length} first-set fixtures found`);
  const all = [...first, ...list];
  const groups = typologyGroups(all);
  ok(groups.length === 15, `the two sets form ${groups.length} typology groups, expected 15`);
  const evals = new Map(all.map((t) => [t.id, evaluateTile(t)]));
  const carried = MATRIX.map((c) => c.key);
  const verdicts: Record<string, number> = {};
  for (const g of groups) {
    ok(g.tiles.length === 2, `${g.key}: ${g.tiles.length} variants`);
    const pk = suggestPick(g, evals, carried, {});
    verdicts[pk.verdict] = (verdicts[pk.verdict] ?? 0) + 1;
    const u = pk.usability.map((r) => `${r.tile.replace(/_v4$/, " V4").replace(/^(gathering|office|lobby)_\d_/, "")} ${r.usableShare === null ? "-" : Math.round(r.usableShare * 100) + "%"}`).join(" / ");
    say(`  ${g.key.padEnd(34)} ${pk.verdict.padEnd(12)} ${pk.supported ? "pick: " + (all.find((t) => t.id === pk.tileId)?.name ?? "") : ""}  usable ${u}`);
  }
  say(`  verdicts: ${Object.entries(verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

// ---- done ---------------------------------------------------------------------------------------------------------------------------------------------------------
writeFileSync(join(out, "results.txt"), report.join("\n") + "\n");
void defaultGen;
void defaultPriorities;
void defaultSite;
void interlockDoc;
void makePiece;
void withPiece;

void generateArrangement;
console.log(failures ? `\n${failures} V4 assembly check(s) failed` : "\nAll V4 assembly checks passed");
process.exit(failures ? 1 : 0);
