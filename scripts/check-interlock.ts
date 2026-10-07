// Proves that Arrange handles shaped (non-cubic) tiles that interlock: collisions are read from the cells the tiles occupy and not from
// their bounding boxes, contacts and joints are found on notch and step walls, a route needs a floor and clearance (an opening that
// merely lines up is not walkable), and the generator discovers nested placements by itself. Run: npm run check:interlock
// The tiles are synthetic (scripts/fixtures/shaped.ts) and are read by the app's own analysis. Pictures of what was built are written to
// $ARRANGE_OUT (default: <tmp>/arrange-out) so the results can be looked at as well as counted.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { ParsedTile } from "../lib/types";
import { analyzeLayout } from "../lib/arrange/layout";
import { collide } from "../lib/arrange/collision";
import { boxesOverlap, placeBox } from "../lib/arrange/geometry";
import { buildComposite, compositeToTile } from "../lib/arrange/composite";
import { buildRhinoZip } from "../lib/arrange/exportRhino";
import { generateArrangement, regenerateMarked, type GenContext } from "../lib/arrange/generate";
import { makePiece, mirrorGroup, movePieces, rotateGroup, withPiece, patchPieces } from "../lib/arrange/ops";
import { bestPair } from "../lib/arrange/pairMatrix";
import { runAllInterlock } from "../lib/arrange/interlock";
import { suggestNext } from "../lib/arrange/suggest";
import { smoothComposite } from "../lib/arrange/smooth";
import { snapPosition } from "../lib/arrange/snap";
import { evaluateProgram } from "../lib/arrange/program";
import { applyWalk, DEFAULT_WALK, getOcc, WALK } from "../lib/arrange/occupancy";
import { getOriented } from "../lib/arrange/orient";
import { defaultGen, defaultPriorities, defaultRules, defaultSite, defaultSmooth, emptyDoc, type ArrangementDoc, type Piece, type ProgramRules, type Vec3 } from "../lib/arrange/types";
import { L, block, cube, pocket, riser, shaft, step, tileOf, rampHall, type RampKind, type Vox } from "./fixtures/shaped";
import { cubeTall } from "./fixtures/shaped";
import { renderArrangement } from "./fixtures/render";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error("FAIL " + msg);
  }
};
const out = process.env.ARRANGE_OUT ?? join(tmpdir(), "arrange-out");
mkdirSync(out, { recursive: true });

const rules: ProgramRules = defaultRules();
const tiles = new Map<string, ParsedTile>();
const reg = (t: ParsedTile) => {
  tiles.set(t.id, t);
  return t;
};
const tL = reg(L());
const tCube = reg(cube());
const tStep = reg(step());
const tRiser = reg(riser());
const tBlock = reg(block());
const tLow = reg(cube("cube_low_doors", "office", { lowH: 8 }));
const tShaftLo = reg(shaft("shaft_lower", "lower"));
const tShaftUp = reg(shaft("shaft_upper", "upper"));
const tPocket = reg(pocket());

interface Put {
  tile: ParsedTile;
  /** feet */
  at: Vec3;
  rot?: number;
  mirror?: boolean;
}
const docOf = (items: Put[], entrance?: number): ArrangementDoc => {
  let doc = emptyDoc();
  const ids: string[] = [];
  for (const it of items) {
    const p = makePiece(doc, it.tile.id, it.at, { rotZ: it.rot ?? 0, mirrorX: it.mirror ?? false });
    ids.push(p.id);
    doc = withPiece(doc, p);
  }
  return { ...doc, entranceId: entrance !== undefined ? ids[entrance] : ids[0] };
};
const lay = (doc: ArrangementDoc, r: ProgramRules = rules) => analyzeLayout(doc, tiles, r);
const kind = (l: ReturnType<typeof lay>) => l.joints.map((j) => `${j.connect.kind}${j.connect.walkable ? "" : ` (${j.connect.why})`}`).join("; ");

// ---- 0. the data: container mask, outside cells, plates survive orientation -------------------------------------------------------
{
  const o = getOcc(getOriented(tL, 0, false));
  ok(o.inside === 40 * 40 * 20 - 20 * 20 * 20, `L holds ${o.inside} cells, not the L's ${40 * 40 * 20 - 20 * 20 * 20}`);
  // the exporter left void = 1 in the notch: it must still count as outside, never as a room
  const raw = tL.voxels.void!;
  let trapped = 0;
  for (let x = 20; x < 40; x++) for (let y = 20; y < 40; y++) for (let z = 0; z < 20; z++) trapped += raw[(x * 40 + y) * 20 + z];
  ok(trapped > 0, "the fixture should leave void in the notch (to test the mask)");
  ok(o.voidCells + o.solidCells === o.inside, "classes do not add up to the container");
  for (const rot of [0, 1, 2, 3])
    for (const mirror of [false, true]) {
      const t = getOcc(getOriented(tL, rot, mirror));
      ok(t.inside === o.inside && t.voidCells === o.voidCells && t.solidCells === o.solidCells, `turning/mirroring changed what L occupies (rot ${rot}, mirror ${mirror})`);
      ok(getOriented(tL, rot, mirror).plates!.reduce((a, v) => a + (v ? 1 : 0), 0) === getOriented(tL, 0, false).plates!.reduce((a, v) => a + (v ? 1 : 0), 0), "plates lost in orientation");
    }
  // a scaled tile keeps its mask (nearest-neighbour), so the notch stays outside
  const half = getOcc(getOriented(tL, 0, false, 0.5));
  ok(half.inside > 0 && half.inside < o.inside / 6, `a half-scale L holds ${half.inside} cells`);
  console.log(`  L: ${o.inside} cells inside its container, ${o.voidCells} carved, ${o.solidCells} material; openings ${(["x-", "x+", "y-", "y+"] as const).map((f) => `${f}:${o.features[f].map((p) => `${p.cells}@${p.plane}`).join("/")}`).join(" ")}`);
  ok(o.features["x+"].some((f) => f.plane === 20), "no opening was found on the notch wall (x = 20)");
}

// ---- 1. complementary L-shaped tiles: boxes overlap, solids do not --------------------------------------------------------------
const nestedDoc = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tCube, at: [10, 10, 0] }]);
{
  const l = lay(nestedDoc);
  const [a, b] = l.boxes;
  ok(boxesOverlap(a, b), "the L and the cube should share part of their bounding boxes");
  const c = collide(a, b)!;
  ok(c.solid === 0 && c.consumed === 0 && c.shared === 0, `the cube in the notch collides: ${JSON.stringify({ s: c.solid, c: c.consumed, v: c.shared })}`);
  ok(l.overlaps.length === 0, "a nested fit was rejected as an overlap");
  ok(l.nested.length === 1, "the nested fit was not reported");
  ok(l.islands.length === 0 && l.unreachable.length === 0, `nested pair: ${l.islands.length} islands, ${l.unreachable.length} unreachable`);
  ok(l.joints.length === 1, `expected one joint, got ${l.joints.length}`);
  const j = l.joints[0];
  ok(j.patches.length >= 2, `the L and the cube meet in ${j.patches.length} patch(es); the two notch walls should be two`);
  ok(j.patches.some((p) => p.axis === 0) && j.patches.some((p) => p.axis === 1), "the contact patches are not on an x wall and a y wall");
  ok(j.connect.walkable && j.connect.voidConnected, `the doorways line up and carry a route: ${kind(l)}`);
  ok(j.parts.floors === 100 && (j.floorStepFt ?? 9) === 0, `floors do not meet: ${j.parts.floors} / ${j.floorStepFt}`);
  ok((j.score ?? 0) >= 80, `the nested joint scores ${j.score}`);
  // the joint is drawn where the pieces touch: on the notch walls, not on the box faces
  const planes = new Set(j.patches.map((p) => p.plane));
  ok(planes.has(10), "no patch on the notch wall plane (10 ft)");
  ok(j.patches.every((p) => p.rects.every((r) => r.min.every((v, k) => v >= 0 && r.max[k] <= 20))), "a patch lies outside both pieces");
  // the doorways that now meet the cube are no longer open to the outside
  const lExposed = l.exposed.filter((e) => e.pieceId === l.boxes[0].piece.id);
  ok(!lExposed.some((e) => e.plane === 20 && e.face === "x+"), "an opening that is covered by the cube is still listed as open");
  ok(lExposed.some((e) => e.plane === 40), "the open arm ends are missing from the open list");
  // composition: material and carved space combine without double counting
  const comp = buildComposite(l.boxes)!;
  const maskCells = comp.mask.reduce((s, v) => s + v, 0);
  ok(maskCells === a.occ.inside + b.occ.inside, `composite holds ${maskCells} cells, the pieces ${a.occ.inside + b.occ.inside}`);
  ok(comp.grid[0] * comp.grid[1] * comp.grid[2] === 40 * 40 * 20 && maskCells === comp.mask.length, "the nested pair should fill its box exactly");
  const voidCells = comp.void.reduce((s, v, i) => s + (v && comp.mask[i] ? 1 : 0), 0);
  ok(voidCells === a.occ.voidCells + b.occ.voidCells, `composite carved space ${voidCells} vs ${a.occ.voidCells + b.occ.voidCells}`);
  // the L's notch trap (void = 1 outside the container) must not leak into the composite where the cube has material
  let leaked = 0;
  for (let x = 20; x < 40; x++) for (let y = 20; y < 40; y++) for (let z = 0; z < 2; z++) leaked += comp.void[(x * 40 + y) * 20 + z];
  ok(leaked === 0, "the outside of the L's container turned the cube's floor into void");
  console.log(`  nested L + cube: ${kind(l)}; joint ${j.score?.toFixed(0)}; ${j.patches.length} patches, contact ${j.connect.contactFt2.toFixed(0)} ft2, void ${j.connect.voidFt2.toFixed(0)} ft2; volume ${(maskCells * 0.125).toFixed(0)} ft3 (boxes alone would say ${((a.occ.dims[0] * a.occ.dims[1] * a.occ.dims[2] + b.occ.dims[0] * b.occ.dims[1] * b.occ.dims[2]) * 0.125).toFixed(0)})`);
  renderArrangement(l.boxes, join(out, "01_L_cube_nested.png"), { sliceZ: [8] });
}

// ---- 2. a stepped sectional fit with meeting floors ------------------------------------------------------------------------------------
{
  // the entrance is on the riser: only the step's upper floor can be walked to from it
  const doc = docOf([{ tile: tStep, at: [0, 0, 0] }, { tile: tRiser, at: [10, 0, 10] }], 1);
  const l = lay(doc);
  ok(boxesOverlap(l.boxes[0], l.boxes[1]), "the riser should share part of the step's bounding box");
  ok(l.overlaps.length === 0 && l.nested.length === 1, `stepped fit: ${l.overlaps.length} overlaps, ${l.nested.length} nested`);
  const j = l.joints[0];
  ok(!!j && j.connect.walkable && j.parts.floors === 100 && j.floorStepFt === 0, `stepped fit floors: ${j ? kind(l) : "no joint"} floors ${j?.parts.floors}`);
  ok(l.reach.get(l.boxes[1].piece.id)!.main, "the riser's floor is not reachable");
  // the step's lower storey has no stair to the upper one, so from the riser only the upper floor is reached: said, not hidden
  const reachStep = l.reach.get(l.boxes[0].piece.id)!;
  ok(reachStep.reachedFt2 > 0 && reachStep.reachedFt2 < reachStep.totalFt2, `the step's reach is ${reachStep.reachedFt2}/${reachStep.totalFt2}: the lower storey must be reported as not reachable`);
  ok(evaluateProgram(l, doc, rules, defaultSite(), tiles).some((w) => w.kind === "partial" || w.kind === "unreachable"), "no warning about the floor that cannot be reached");
  console.log(`  stepped fit: ${kind(l)}; floors ${j.parts.floors}, step ${j.floorStepFt} ft; the step piece's floor reached ${reachStep.reachedFt2.toFixed(0)} of ${reachStep.totalFt2.toFixed(0)} ft2`);
  renderArrangement(l.boxes, join(out, "02_stepped_fit.png"), { sliceZ: [11, 27] });
}

// ---- 3. a genuine solid collision is rejected --------------------------------------------------------------------------------------------
{
  const doc = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tCube, at: [5, 5, 0] }]);
  const l = lay(doc);
  ok(l.overlaps.length === 1, "a cube through the L's walls was accepted");
  ok(l.collisions[0].solid > 0, "the collision should be solid on solid");
  const w = evaluateProgram(l, doc, rules, defaultSite(), tiles).find((x) => x.kind === "overlap" && x.severity === "error");
  ok(!!w && /material collides/.test(w.message), `the warning does not say what collides: ${w?.message}`);
  // two ordinary cubes on top of each other
  const cubes = docOf([{ tile: tCube, at: [0, 0, 0] }, { tile: tCube, at: [5, 0, 0] }]);
  ok(lay(cubes).overlaps.length === 1, "two overlapping cubes were accepted");
  console.log(`  collisions: L + cube inside it -> ${w?.message}`);
}

// ---- 4. a neighbour that blocks a carved room or passage -----------------------------------------------------------------------------------
{
  // the block's material would stand in the L's doorway (a carved passage): rejected, because a neighbour may not fill a room
  const through = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tBlock, at: [9, 11, 0] }]);
  const l1 = lay(through);
  ok(l1.overlaps.length === 1 && l1.collisions[0].consumed > 0, `a block in a doorway: ${l1.overlaps.length} overlaps, consumed ${l1.collisions[0]?.consumed}`);
  const w = evaluateProgram(l1, through, rules, defaultSite(), tiles).find((x) => x.kind === "overlap" && x.severity === "error");
  ok(!!w && /carved space is filled/.test(w.message), `the warning does not say a room was filled: ${w?.message}`);
  // the block in the notch, flush against the doorways: legal (the notch is outside the L), but it seals them
  const flush = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tBlock, at: [10, 10, 0] }]);
  const l2 = lay(flush);
  ok(l2.overlaps.length === 0 && l2.nested.length === 1, "a block in the notch should be a valid nested fit");
  ok(l2.joints.length === 1 && !l2.joints[0].walkable && l2.joints[0].connect.kind === "contact", `a sealed doorway should be a touch, not a route: ${kind(l2)}`);
  ok(l2.unreachable.includes(l2.boxes[1].piece.id), "the block has no floor and should be reported as not reachable");
  console.log(`  blocked: block in a doorway -> ${w?.message}; block in the notch -> ${kind(l2)}`);
}

// ---- 5. openings with mismatched floors, or too little clearance ------------------------------------------------------------------------------------
{
  // floors half a foot apart: a single riser, walkable under the default tolerance
  const small = lay(docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tCube, at: [10, 10, 0.5] }]));
  ok(small.overlaps.length === 0 && small.joints[0]?.connect.walkable && small.joints[0].connect.stepFt === 0.5, `a 0.5 ft step should be walkable: ${kind(small)}`);
  // 1.5 ft apart: within the floor tolerance, but the L's doorway (7 ft) leaves only 5.5 ft of headroom above the raised floor
  const mid = lay(docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tCube, at: [10, 10, 1.5] }]));
  ok(!mid.joints[0].connect.walkable && /more than one step/.test(mid.joints[0].connect.why), `a floor 1.5 ft up is more than one step, whatever the doorway: ${kind(mid)}`);
  // 3 ft apart: a jump, not a step
  const raised = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tCube, at: [10, 10, 3] }]);
  const l = lay(raised);
  const j = l.joints[0];
  ok(!!j && j.connect.voidConnected && !j.connect.walkable && /more than one step/.test(j.connect.why), `floors 3 ft apart are a jump, not a route: ${kind(l)}`);
  // A BARE 3 ft JUMP IS NEVER WALKABLE, whatever the level tolerance says: "ramp" mode only changes what is reported
  const tall = reg(L("L_tall", "gathering", true, 26));
  const tallCube = reg(cubeTall());
  const jump = docOf([{ tile: tall, at: [0, 0, 0] }, { tile: tallCube, at: [10, 10, 3] }]);
  for (const [name, r] of [["exact", { ...rules, levelTolerance: "exact" as const }], ["riser", rules], ["ramp 4 ft", { ...rules, levelTolerance: "ramp" as const, rampRiseFt: 4 }], ["ramp 10 ft", { ...rules, levelTolerance: "ramp" as const, rampRiseFt: 10 }]] as const) {
    const lj = lay(jump, r);
    const c = lj.joints[0].connect;
    ok(!c.walkable && !lj.joints[0].walkable, `a bare 3 ft jump must not be walkable (${name} mode): ${kind(lj)}`);
    ok(lj.unreachable.includes(lj.boxes[1].piece.id), `the piece behind a bare 3 ft jump must not count as reachable (${name} mode)`);
    const w = evaluateProgram(lj, jump, r, defaultSite(), tiles);
    if (name.startsWith("ramp")) {
      // it is reported as needing a connector (a stair or ramp that is not there), never as a route
      ok(c.kind === "connector" && !!c.connector && Math.abs(c.connector.riseFt - 3) < 1e-6 && /connector/.test(c.why), `ramp mode should label the jump as needing a connector: ${kind(lj)}`);
      ok(w.some((x) => x.kind === "connector" && /not walkable/.test(x.message)), `no warning that a connector is needed: ${w.map((x) => x.kind).join(",")}`);
    } else ok(c.kind !== "connector", `${name} mode should not report connectors: ${kind(lj)}`);
  }
  // ...and Auto Generate never counts a connector toward reaching a piece: with ramp mode on, every piece it places has a walkable way in
  {
    const rr: ProgramRules = { ...rules, levelTolerance: "ramp", rampRiseFt: 10 };
    const ctx: GenContext = { tileById: tiles, bank: [tall, tallCube, tCube], rules: rr, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), amount: 5, seed: 3 } };
    const g = generateArrangement(ctx, emptyDoc());
    const lg = lay(g.doc, rr);
    ok(lg.unreachable.length === 0 && lg.joints.filter((q) => q.connect.kind === "connector").every((q) => lg.reachable.has(q.aId) && lg.reachable.has(q.bId) && lg.joints.some((o) => o.connect.walkable && (o.aId === q.aId || o.bId === q.aId))), "a generated arrangement relied on a connector that does not exist");
  }
  // actual supported stair or ramp geometry carries the same 3 ft rise: the floors are joined cell by cell by steps of 0.5 ft
  const cubeUp = reg(cubeTall("cube_up"));
  let hallDoc: ArrangementDoc = emptyDoc();
  const hallAt = (kindOf: RampKind, riseFt = 3) => {
    const hall = reg(rampHall(`hall_${kindOf}`, kindOf, riseFt));
    const doc = docOf([{ tile: hall, at: [0, 0, 0] }, { tile: cubeUp, at: [36, 2, riseFt] }]);
    hallDoc = doc;
    return lay(doc, { ...rules, levelTolerance: "ramp", rampRiseFt: 10 });
  };
  const upBy = (l: ReturnType<typeof lay>) => l.reachable.has(l.boxes[1].piece.id);
  for (const k of ["ramp", "stair"] as const) {
    const lh = hallAt(k);
    ok(lh.joints.length === 1 && lh.joints[0].connect.walkable && lh.joints[0].connect.stepFt === 0, `${k}: the doorway at the top should be a level crossing: ${kind(lh)}`);
    ok(upBy(lh) && lh.unreachable.length === 0, `${k}: a 3 ft rise over real ${k} geometry should be reachable from the entrance`);
    ok(lh.reach.get(lh.boxes[0].piece.id)!.reachedFt2 >= lh.reach.get(lh.boxes[0].piece.id)!.totalFt2 * 0.95, `${k}: the whole hall should be reachable: ${JSON.stringify(lh.reach.get(lh.boxes[0].piece.id))}`);
  }
  // the same rise as a sheer wall, a ramp with too little headroom, and a ramp with a riser missing: the doorway lines up, the route does not exist
  for (const [k, why] of [["sheer", /bare jump|more than one step|not reach|partial/], ["lowCeiling", /./], ["broken", /./]] as const) {
    const lh = hallAt(k);
    ok(!upBy(lh), `${k}: the piece beyond a broken route must not count as reachable from the entrance`);
    const wk = evaluateProgram(lh, hallDoc, rules, defaultSite(), tiles);
    ok(wk.some((x) => x.kind === "unreachable" || x.kind === "partial"), `${k}: no warning that the way is broken`);
    ok(lh.reach.get(lh.boxes[0].piece.id)!.reachedFt2 < lh.reach.get(lh.boxes[0].piece.id)!.totalFt2 * 0.95, `${k}: the hall's upper floor should be reported as cut off`);
    void why;
  }
  // small steps still pass: the shared step limit is the only way a height change is crossed, and widening it widens it for everyone (a 1 ft riser), never beyond
  {
    const two = (zFt: number) => lay(docOf([{ tile: tall, at: [0, 0, 0] }, { tile: tallCube, at: [10, 10, zFt] }]));
    applyWalk({ stepFt: 1 });
    const oneFoot = two(1);
    const threeFoot = two(3);
    applyWalk({ stepFt: DEFAULT_WALK.stepFt });
    ok(oneFoot.joints[0].connect.walkable && oneFoot.joints[0].connect.stepFt === 1, `with a 1 ft riser allowed, a 1 ft step is walkable: ${kind(oneFoot)}`);
    ok(!threeFoot.joints[0].connect.walkable, "with a 1 ft riser allowed, a 3 ft jump is still not walkable");
    ok(!two(1).joints[0].connect.walkable, "back at 0.5 ft the 1 ft step is a connector again (the cache must follow the rule)");
  }
  console.log(`  jumps: a bare 3 ft jump is never walkable (ramp mode reports a connector); a 3 ft ramp or stair is walked; a sheer wall, a ramp 5.5 ft high and a ramp with a riser missing are not; 0.5 ft steps and level floors still pass`);
  // doorways 4 ft high: the openings line up but nobody can pass
  const low = docOf([{ tile: tL, at: [0, 0, 0] }, { tile: tLow, at: [10, 10, 0] }]);
  const ll = lay(low);
  const jl = ll.joints[0];
  ok(!!jl && jl.connect.voidConnected && !jl.connect.walkable, `a 4 ft doorway carries a route: ${kind(ll)}`);
  ok(/too narrow or too low/.test(jl.connect.why), `the reason is not the clearance: ${jl.connect.why}`);
  console.log(`  low doorway: ${jl.connect.why}`);
}

// ---- 5b. connectors: a stair or ramp built into the lower room, only when asked for ---------------------------------------------------------------------------------
{
  const tall = reg(L("L_tall_c", "gathering", true, 26));
  const tallCube = reg(cubeTall("cube_tall_c"));
  const cr = (auto: boolean, over: Partial<ProgramRules> = {}): ProgramRules => ({ ...rules, levelTolerance: "ramp", rampRiseFt: 10, autoConnectors: auto, ...over });
  const at = (rise: number) => docOf([{ tile: tall, at: [0, 0, 0] }, { tile: tallCube, at: [10, 10, rise] }]);
  for (const rise of [1, 2, 3]) {
    const off = lay(at(rise), cr(false));
    ok(!off.joints[0].connect.walkable && off.joints[0].connect.kind === "connector" && off.connectors.length === 0, `connectors off: a ${rise} ft rise stays a connector report, never a route: ${kind(off)}`);
    const on = lay(at(rise), cr(true));
    const m = on.connectors[0];
    ok(!!m && on.joints[0].connect.walkable && on.joints[0].connect.stepFt === 0, `connectors on: a ${rise} ft rise is joined: ${kind(on)} / ${on.connectorFails.map((f) => f.why).join(";")}`);
    ok(on.unreachable.length === 0 && on.overlaps.length === 0, `a ${rise} ft connector leaves a piece unreachable or colliding`);
    ok(!!m && Math.abs(m.riseFt - rise) < 1e-6 && m.widthFt >= 2.5 && m.runFt >= (m.kind === "ramp" ? 4 : 2) * rise - 1e-6, `the ${rise} ft connector is too steep or narrow: ${JSON.stringify(m)}`);
  }
  // asked for one joint only (the rule off): the choice is kept in the document, undone by "off"
  {
    const base = at(2);
    const j0 = lay(base, cr(false)).joints[0];
    const one = lay({ ...base, connectors: { [j0.id]: { kind: "stair" } } }, cr(false));
    ok(one.connectors.length === 1 && one.connectors[0].kind === "stair" && one.connectors[0].auto === false && one.joints[0].connect.walkable, `a stair asked for at one joint: ${JSON.stringify(one.connectors)}`);
    const none = lay({ ...base, connectors: { [j0.id]: { kind: "auto", off: true } } }, cr(true));
    ok(none.connectors.length === 0 && !none.joints[0].connect.walkable, "a connector taken out at its joint is not built even with the rule on");
  }
  // no room: a 4 ft rise needs more floor than the L's arm has: reported honestly, never faked
  {
    const l4 = lay(at(4), cr(true));
    ok(l4.connectors.length === 0 && l4.connectorFails.length === 1 && l4.connectorFails[0].why.length > 10 && !l4.joints[0].connect.walkable, `a connector that does not fit is a plain report: ${JSON.stringify(l4.connectorFails)} / ${kind(l4)}`);
  }
  // the connector follows the pieces and the rule: no walkable joint appears from nothing, and a flat joint gets none
  {
    const flat = lay(at(0), cr(true));
    ok(flat.connectors.length === 0 && flat.joints[0].connect.walkable, `a level joint needs no connector: ${kind(flat)}`);
  }
  // Auto Generate with the rule on reaches pieces by connectors; every piece it places has a walkable way in (the same check the rule-off case passes)
  {
    const rr = cr(true);
    const ctx: GenContext = { tileById: tiles, bank: [tall, tallCube, tCube], rules: rr, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), amount: 5, seed: 3 } };
    const g = generateArrangement(ctx, emptyDoc());
    const lg = lay(g.doc, rr);
    ok(lg.unreachable.length === 0 && lg.overlaps.length === 0, `Auto Generate with connectors left ${lg.unreachable.length} unreachable and ${lg.overlaps.length} colliding`);
    console.log(`  connectors: 1, 2 and 3 ft rises are joined by a ramp or stair that the walking rules then read as a route; 4 ft does not fit (${l4Why()}); Auto Generate placed ${g.doc.pieces.length} pieces with ${lg.connectors.length} connector(s)`);
  }
}
function l4Why() {
  const rr: ProgramRules = { ...rules, levelTolerance: "ramp", rampRiseFt: 10, autoConnectors: true };
  const t = tiles.get("L_tall_c")!;
  const c = tiles.get("cube_tall_c")!;
  return lay(docOf([{ tile: t, at: [0, 0, 0] }, { tile: c, at: [10, 10, 4] }]), rr).connectorFails[0]?.why ?? "";
}

// ---- 6. a vertical void connection with no usable vertical route; a doorway into a pocket -------------------------------------------------------------------
{
  const stacked = docOf([{ tile: tShaftLo, at: [0, 0, 0] }, { tile: tShaftUp, at: [0, 0, 10] }]);
  const l = lay(stacked);
  const j = l.joints[0];
  ok(!!j && j.axis === 2 && j.connect.voidConnected && !j.connect.walkable && j.connect.kind === "void", `a shaft between stacked rooms: ${j ? kind(l) : "no joint"}`);
  ok(/horizontal plane/.test(j.connect.why), `the shaft's reason: ${j.connect.why}`);
  ok(l.unreachable.includes(l.boxes[1].piece.id), "the room above a shaft was counted as reachable");
  console.log(`  shaft: ${kind(l)}`);
  const closet = docOf([{ tile: tCube, at: [0, 0, 0] }, { tile: tPocket, at: [10, -1, 0] }]);
  const lc = lay(closet);
  const jc = lc.joints[0];
  ok(!!jc && jc.connect.voidConnected && !jc.connect.walkable && /pocket/.test(jc.connect.why), `a doorway into a closet: ${jc ? kind(lc) : "no joint"}`);
  ok(lc.unreachable.includes(lc.boxes[1].piece.id), "a tile entered only through a closet should not count as reachable");
  console.log(`  pocket: ${kind(lc)}`);
}

// ---- 7. rotated, mirrored and vertically shifted shaped tiles ----------------------------------------------------------------------------------------------
{
  const base = lay(nestedDoc);
  const ids = new Set(nestedDoc.pieces.map((p) => p.id));
  const same = (name: string, l: ReturnType<typeof lay>) => {
    ok(l.overlaps.length === 0 && l.nested.length === 1, `${name}: ${l.overlaps.length} overlaps, ${l.nested.length} nested`);
    ok(l.joints.length === 1 && l.joints[0].connect.walkable && l.joints[0].patches.length === base.joints[0].patches.length, `${name}: ${kind(l)} (${l.joints[0]?.patches.length} patches)`);
    ok(l.joints[0].score === base.joints[0].score, `${name}: the score changed (${l.joints[0].score} vs ${base.joints[0].score})`);
    ok(buildComposite(l.boxes)!.mask.reduce((s, v) => s + v, 0) === 40 * 40 * 20, `${name}: the composite lost cells`);
  };
  let d = nestedDoc;
  for (let k = 1; k <= 4; k++) {
    d = rotateGroup(d, ids, tiles, 1);
    same(`turn ${k}`, lay(d));
  }
  same("mirror", lay(mirrorGroup(nestedDoc, ids, tiles)));
  same("mirror + turn", lay(rotateGroup(mirrorGroup(nestedDoc, ids, tiles), ids, tiles, 3)));
  same("raised 5 ft", lay(movePieces(nestedDoc, ids, [0, 0, 5])));
  same("moved sideways", lay(movePieces(nestedDoc, ids, [37.5, -12.5, 0])));
  // each piece turned or mirrored on its own, fitting again: the cube and L in other orientations fit the same notch
  const other = patchPieces(nestedDoc, new Set([nestedDoc.pieces[1].id]), { rotZ: 2, mirrorX: true });
  const lo = lay(other);
  ok(lo.overlaps.length === 0, "the cube turned in its place collides with the L");
  console.log("  rotations, mirror and shifts: the nested fit, its joint score and the composite are unchanged");
}

// ---- 8. composite, tile and export round trips keep the shaped container -----------------------------------------------------------------------------
async function roundTrips() {
  const l = lay(nestedDoc);
  const comp = buildComposite(l.boxes)!;
  const tile = await compositeToTile(comp, l.boxes, { name: "assembly", doc: nestedDoc, withMeshes: false });
  ok(!!tile.voxels.mask && tile.voxels.mask.length === comp.mask.length && tile.voxels.mask.every((v, i) => v === comp.mask[i]), "the assembly tile lost its container mask");
  // an assembly whose own container is not a box: place it beside another and check it nests like any shaped tile
  tiles.set(tile.id, { ...tile, meta: { ...tile.meta, category: "gathering" } });
  const o = getOcc(getOriented(tiles.get(tile.id)!, 0, false));
  ok(o.inside === comp.mask.reduce((s, v) => s + v, 0), "the assembly tile does not occupy what its composite did");
  const vf = (tile.metrics as { void_fraction?: number }).void_fraction;
  const expect = comp.void.reduce((s, v, i) => s + (v && comp.mask[i] ? 1 : 0), 0) / comp.mask.reduce((s, v) => s + v, 0);
  ok(vf === undefined || Math.abs(vf - expect) < 0.01, `void fraction ${vf} should be ${expect.toFixed(3)}: empty notches must not count`);
  // the Rhino mass carries the exact mask
  const z = await JSZip.loadAsync(await (await buildRhinoZip(comp, "rt")).blob.arrayBuffer());
  const mass = JSON.parse(await z.file("rt.mass.json")!.async("string")) as { mask: string; shape: number[] };
  const bits = inflateSync(Buffer.from(mass.mask, "base64"));
  let same = bits.length === Math.ceil(comp.mask.length / 8);
  for (let i = 0; i < comp.mask.length && same; i++) if (((bits[i >> 3] >> (7 - (i & 7))) & 1) !== comp.mask[i]) same = false;
  ok(same, "the mass exported for Rhino does not carry the same container mask");
  // the smoothing keeps the container
  const sm = smoothComposite(comp, l.joints, defaultSmooth());
  ok(sm.comp.mask.every((v, i) => v === comp.mask[i]), "smoothing changed the container");
  console.log("  round trips: composite -> tile -> placed again, the Rhino mass and smoothing all keep the container exactly");
}

// ---- 9. snapping, suggestions, pair compatibility, the interlock test ----------------------------------------------------------------------------------------
function helpers() {
  const lonely = docOf([{ tile: tL, at: [0, 0, 0] }]);
  const ctx: GenContext = { tileById: tiles, bank: [tCube, tRiser, tBlock], rules, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), seed: 1, amount: 2 } };
  const s = suggestNext(ctx, lonely, lonely.pieces[0].id, 8);
  const lb = lay(lonely).boxes[0];
  ok(s.length > 0, "no suggestion for the L");
  ok(s.some((x) => boxesOverlap(x.candidate.box, lb)), "suggest next never offered the notch");
  ok(s.every((x) => lay({ ...lonely, pieces: [...lonely.pieces, { ...x.candidate.piece, id: "n" }] }).overlaps.length === 0), "a suggestion collides");
  console.log(`  suggest next beside the L: ${s.map((x) => `${x.tile.id}${boxesOverlap(x.candidate.box, lb) ? " (in the notch)" : ""}`).join(", ")}`);
  // the snapper pulls a cube dragged near the notch into it
  const cubePiece: Piece = { id: "d", tileId: tCube.id, pos: [11.5, 9, 0.5], rotZ: 0, mirrorX: false, scale: 1, locked: false };
  const sn = snapPosition(cubePiece, tCube, [lb], cubePiece.pos, { lattice: false, radiusFt: 4 });
  const snapped = placeBox({ ...cubePiece, pos: sn.pos }, tCube);
  ok(sn.rule !== "grid" && boxesOverlap(snapped, lb) && collide(snapped, lb)!.solid === 0, `a cube dragged near the notch snapped to ${sn.pos.join(",")} (${sn.rule})`);
  console.log(`  snapping: dragged to (11.5, 9, 0.5) -> ${sn.pos.join(", ")} (${sn.rule})`);
  const bp = bestPair(tL, tCube);
  ok(bp.score !== null && bp.score > 0, "pair compatibility found no joint for the L and the cube");
  const pbox = placeBox({ id: "p", tileId: tCube.id, pos: bp.pos, rotZ: bp.rotZ, mirrorX: bp.mirrorX, scale: 1, locked: false }, tCube);
  ok(boxesOverlap(pbox, lb), "the best pairing of the L and the cube should be the nested one");
  console.log(`  pair compatibility L + cube: ${bp.score?.toFixed(0)} at ${bp.pos.join(", ")}${boxesOverlap(pbox, lb) ? " (nested)" : ""}`);
  const rows = runAllInterlock(tL, rules);
  ok(rows.length === 9, "the interlock test did not run all nine patterns on the L");
  console.log(`  interlock test on the L: ${rows.map((r) => `${r.pattern}${r.count} ${r.overall?.toFixed(0) ?? "-"}${r.connected ? "" : "!"}`).join(" ")}`);
}

// ---- 10. automatic generation discovers the fits by itself ----------------------------------------------------------------------------------------------------
function generation() {
  const lobby = reg(L("L_lobby", "lobby"));
  const bank = [tL, lobby, tCube, reg(cube("cube_office2", "office")), tStep, tRiser];
  const shapes = ["compact", "courtyard", "stepped"] as const;
  let nestedTotal = 0;
  let runs = 0;
  const rows: string[] = [];
  const sample: { doc: ArrangementDoc; name: string }[] = [];
  for (const amount of [2, 4, 8]) {
    let nestedHere = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const shape = shapes[(seed + amount) % 3];
      const ctx: GenContext = { tileById: tiles, bank, rules, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), shape, seed, amount } };
      const t0 = Date.now();
      const r = generateArrangement(ctx, emptyDoc());
      const l = lay(r.doc);
      const tag = `${amount} pcs, ${shape}, seed ${seed}`;
      runs++;
      ok(l.overlaps.length === 0, `${tag}: ${l.overlaps.length} collisions`);
      ok(l.islands.length === 0, `${tag}: ${l.islands.length} detached groups`);
      ok(l.unreachable.length === 0, `${tag}: ${l.unreachable.length} pieces with no walkable route`);
      ok(r.doc.pieces.length >= Math.min(amount, 2) && (r.doc.pieces.length >= amount - 2 || r.notes.some((n) => /could not satisfy/.test(n))), `${tag}: only ${r.doc.pieces.length} pieces and no explanation`);
      const walkAll = l.boxes.length < 2 || [...l.reachable].length === l.boxes.length;
      ok(walkAll, `${tag}: not every piece is reachable`);
      nestedHere += l.nested.length;
      nestedTotal += l.nested.length;
      rows.push(`${tag.padEnd(34)} ${String(r.doc.pieces.length).padStart(2)} pcs  nested ${l.nested.length}  joints ${l.joints.length} (${l.joints.filter((j) => j.connect.walkable).length} walkable)  ${Date.now() - t0} ms`);
      if (seed <= 2) sample.push({ doc: r.doc, name: `10_generated_${amount}_${shape}_seed${seed}.png` });
    }
    if (amount >= 4) ok(nestedHere > 0, `${amount} pieces: none of five seeds found a nested fit by itself`);
  }
  for (const r of rows) console.log("  " + r);
  console.log(`  generation: ${nestedTotal} nested fits found by the generator across ${runs} runs without any position being supplied`);
  for (const s of sample) renderArrangement(lay(s.doc).boxes, join(out, s.name), { sliceZ: [8, 28] });
  // grow more with a locked piece, and regenerate a marked joint
  const ctx: GenContext = { tileById: tiles, bank, rules, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), seed: 7, amount: 4 } };
  const first = generateArrangement(ctx, emptyDoc());
  const locked = patchPieces(first.doc, new Set([first.doc.pieces[0].id]), { locked: true });
  const grown = generateArrangement(ctx, locked, { target: locked.pieces.length + 3 });
  const lg = lay(grown.doc);
  ok(grown.doc.pieces[0].id === locked.pieces[0].id && grown.doc.pieces[0].locked && JSON.stringify(grown.doc.pieces[0].pos) === JSON.stringify(locked.pieces[0].pos), "grow more moved a locked piece");
  ok(lg.overlaps.length === 0 && lg.islands.length === 0 && lg.unreachable.length === 0, "grow more left an invalid arrangement");
  const j0 = lay(grown.doc).joints[0];
  const re = regenerateMarked(ctx, { ...grown.doc, ratings: { [j0.id]: "bad" } }, new Set([j0.id]), grown.doc.pieces.length);
  const lre = lay(re.doc);
  ok(lre.overlaps.length === 0 && lre.islands.length === 0, "regenerating a marked joint left an invalid arrangement");
  console.log(`  grow more (a locked piece stays): ${first.doc.pieces.length} -> ${grown.doc.pieces.length} pieces; regenerate marked: ${re.doc.pieces.length} pieces`);
  // a bank that cannot be satisfied says so
  const bad: GenContext = { ...ctx, bank: [tBlock], settings: { ...ctx.settings, amount: 4 } };
  const rb = generateArrangement(bad, emptyDoc());
  ok(rb.doc.pieces.length === 1 && rb.notes.some((n) => /could not satisfy/.test(n)), `a bank of solid blocks should be reported as unable to build: ${rb.notes.join(" | ")}`);
  console.log(`  unsatisfiable bank: ${rb.notes.join(" | ")}`);
}

// ---- 11. real engine output: an L-shaped container exported by erosion_engine_7.py (engine/headless/tests/t_shaped_tile.py) ----------------------------------
async function engineOutput() {
  const dir = join(__dirname, "..", "lib", "tiles", "fixtures-engine", "shaped_L");
  if (!existsSync(join(dir, "mask.u8.gz"))) {
    console.log("  (no engine output found: run engine/headless/tests/t_shaped_tile.py to make it)");
    return;
  }
  const rd = (f: string) => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : null);
  const v: Vox = { dims: [40, 40, 20], void: rd("void.u8.gz")!, mask: rd("mask.u8.gz")!, plates: rd("plates.u8.gz") ?? new Uint8Array(40 * 40 * 20) };
  const tE = reg(tileOf({ id: "engine_L", category: "gathering", typology: "engine L" }, v));
  const o = getOcc(getOriented(tE, 0, false));
  ok(o.inside === 24000, `the engine's L holds ${o.inside} cells inside its container, expected 24000`);
  for (const rot of [0, 1, 2, 3]) for (const mirror of [false, true]) ok(getOcc(getOriented(tE, rot, mirror)).inside === 24000, "orienting the engine's L changed its container");
  // a plain cube (the size of the notch) placed in the notch: boxes overlap, cells do not
  const doc = docOf([{ tile: tE, at: [0, 0, 0] }, { tile: tBlock, at: [10, 10, 0] }]);
  const l = lay(doc);
  ok(l.overlaps.length === 0 && l.nested.length === 1, `engine L + block in its notch: ${l.overlaps.length} collisions, ${l.nested.length} nested`);
  const comp = buildComposite(l.boxes)!;
  ok(comp.mask.reduce((s, x) => s + x, 0) === 24000 + 8000, "the composite of the engine's L and a block does not hold exactly their cells");
  const tile = await compositeToTile(comp, l.boxes, { name: "engine_assembly", doc, withMeshes: false });
  ok(!!tile.voxels.mask && tile.voxels.mask.every((x, i) => x === comp.mask[i]), "the assembly of the engine's L lost its mask");
  console.log(`  engine output: the L exported by erosion_engine_7.py holds ${o.inside} cells, ${o.voidCells} carved; it nests with a block, orients, composes and round-trips like the fixtures`);
}

// ---- 12. two joints of one layout that share a plane, neighbours and cell count are still two joints ------------------------------------------------------------------
// (a 2 x 2 of one tile: the joints between the far pieces have the same plane, the same near pieces and the same size as the first pair's. The joint cache once keyed on those alone and
// handed the second pair the first pair's crossings, naming the wrong pieces: the far corner of a 2 x 2 was reported unreachable although both of its doors were open.)
function sameTileJoints() {
  const doc = docOf([{ tile: tCube, at: [0, 0, 0] }, { tile: tCube, at: [10, 0, 0] }, { tile: tCube, at: [0, 10, 0] }, { tile: tCube, at: [10, 10, 0] }]);
  const l = lay(doc);
  ok(l.joints.length === 4, `a 2 x 2 of cubes has ${l.joints.length} joints, expected 4`);
  for (const j of l.joints) ok(j.connect.crossings.length > 0 && j.connect.crossings.every((x) => [j.aId, j.bId].includes(x.aId) && [j.aId, j.bId].includes(x.bId)), `joint ${j.id} carries crossings of other pieces: ${j.connect.crossings.map((x) => x.aId + "~" + x.bId).join(", ")}`);
  ok(l.unreachable.length === 0 && l.reach.size === 4 && [...l.reach.values()].every((r) => r.main), "the far corner of a 2 x 2 of one tile is not reachable although every joint is open");
  console.log("  a 2 x 2 of one tile: four joints, each carries its own pair's crossings, every piece reachable");
}

void WALK;
(async () => {
  await roundTrips();
  await engineOutput();
  helpers();
  sameTileJoints();
  generation();
  console.log(`  pictures written to ${out}`);
  console.log(failures ? `\n${failures} interlock check(s) failed` : "\nAll interlock checks passed");
  process.exit(failures ? 1 : 0);
})();
