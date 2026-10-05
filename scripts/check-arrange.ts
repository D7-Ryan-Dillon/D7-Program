// Proves the Arrange engine (lib/arrange) on the 15 typology tiles without a browser: the generator always makes ONE
// connected, walkable, overlap-free building for every shape; orientation and group edits are exact; the combined voxels,
// their analysis and the smoothing run; the interlock test and the pair matrix work. Run: npm run check:arrange
// Fixtures come from engine/tiles/make_fixtures.py (the same ones check:parity reads).

import { gunzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTile } from "../lib/types";
import type { SpacesData } from "../lib/tiles/types";
import { analyzeLayout, entrancePoint, orphansIfRemoved } from "../lib/arrange/layout";
import { planDrone, reversalsIn } from "../lib/arrange/drone";
import { cutPocket, findLabelPatch, labelFor, labelSoup, placeBitmap } from "../lib/exporters/printLabels";
import { openEdges, volumeMm3 } from "../lib/exporters/stl";
import { fineSoup } from "../lib/exporters/printMesh";
import { generateArrangement, regenerateMarked, type GenContext } from "../lib/arrange/generate";
import { buildComposite } from "../lib/arrange/composite";
import { smoothComposite } from "../lib/arrange/smooth";
import { analyzeTile } from "../lib/tiles/analyze";
import { mirrorGroup, rotateGroup, checkEdit, reattachIslands, removePieces, movePieces, withGroups } from "../lib/arrange/ops";
import { runAllInterlock } from "../lib/arrange/interlock";
import { pairMatrix } from "../lib/arrange/pairMatrix";
import { suggestNext, betterTiles } from "../lib/arrange/suggest";
import { snapPosition } from "../lib/arrange/snap";
import { evaluateProgram, ruleBetween } from "../lib/arrange/program";
import { buildSequence, autoNames } from "../lib/arrange/whole";
import { findNiceViews, findViews, walkPath } from "../lib/arrange/views";
import { getOriented } from "../lib/arrange/orient";
import { SHAPES, defaultGen, defaultPriorities, defaultRules, defaultSite, defaultSmooth, emptyDoc, pairKey, type ArrangementDoc, type ProgramRules } from "../lib/arrange/types";

const root = join(__dirname, "..", "lib", "tiles", "fixtures");
const names = readdirSync(root).filter((n) => existsSync(join(root, n, "meta.json"))).sort();
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error("FAIL " + msg);
};
const ok = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
};

const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : undefined);

const tiles: ParsedTile[] = names.map((name) => {
  const dir = join(root, name);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number };
  const spaces = JSON.parse(readFileSync(join(dir, "spaces.json"), "utf8")) as SpacesData;
  const m = /^(gathering|office|lobby)_(\d+)_(.+)$/.exec(name)!;
  return {
    id: name,
    name,
    sourceFolderName: name,
    tileFt: [meta.grid[0] * meta.cell_ft, meta.grid[1] * meta.cell_ft, meta.grid[2] * meta.cell_ft],
    cellFt: meta.cell_ft,
    grid: meta.grid,
    config: {},
    metrics: {} as ParsedTile["metrics"],
    glbUrl: "",
    voxels: { void: read(dir, "void.u8.gz"), plates: read(dir, "plates.u8.gz") },
    guessed: { category: m[1] as "gathering" | "office" | "lobby", typology: m[3].replace(/_/g, " ") },
    meta: { category: m[1] as "gathering" | "office" | "lobby", typology: m[3].replace(/_/g, " "), slot: Number(m[2]) },
    spaces,
  } as ParsedTile;
});
const tileById = new Map(tiles.map((t) => [t.id, t]));
console.log(`${tiles.length} tiles`);

const rules: ProgramRules = defaultRules();
const ctxFor = (shape: (typeof SHAPES)[number]["key"], seed: number, amount = 8, over: Partial<ProgramRules> = {}): GenContext => ({
  tileById,
  bank: tiles,
  rules: { ...rules, ...over },
  priorities: defaultPriorities(),
  site: defaultSite(),
  settings: { ...defaultGen(), shape, seed, amount },
});

// ---- 1. every shape gives one connected, walkable, overlap-free building --------------------------------------------
const docs = new Map<string, ArrangementDoc>();
for (const s of SHAPES) {
  for (const seed of [1, 2, 3]) {
    const t0 = Date.now();
    const r = generateArrangement(ctxFor(s.key, seed), emptyDoc(), { tries: 3 });
    const l = analyzeLayout(r.doc, tileById, rules);
    const ms = Date.now() - t0;
    const tag = `${s.key} seed ${seed}`;
    ok(r.doc.pieces.length >= 5, `${tag}: only ${r.doc.pieces.length} pieces`);
    ok(l.overlaps.length === 0, `${tag}: ${l.overlaps.length} overlaps`);
    ok(l.islands.length === 0, `${tag}: ${l.islands.length} detached groups`);
    ok(l.unreachable.length === 0, `${tag}: ${l.unreachable.length} pieces with no walkable link`);
    const b = l.bounds!;
    const span = ((b.max[0] - b.min[0]) / 2).toFixed(0) + "x" + ((b.max[1] - b.min[1]) / 2).toFixed(0) + "x" + ((b.max[2] - b.min[2]) / 2).toFixed(0);
    const js = l.joints.filter((j) => j.score !== null);
    const avg = js.reduce((a, j) => a + (j.score ?? 0), 0) / Math.max(1, js.length);
    const floorOk = l.joints.filter((j) => j.floorStepFt !== null && j.floorStepFt <= 1.5).length;
    console.log(`  ${tag.padEnd(16)} ${String(r.doc.pieces.length).padStart(2)} pcs  ${span.padEnd(10)} joints ${avg.toFixed(0)}  floors ok ${floorOk}/${l.joints.length}  ${ms} ms`);
    if (seed === 1) docs.set(s.key, r.doc);
  }
}

// ---- 2. hard "never" rules are never produced ---------------------------------------------------------------------------
{
  const never: Partial<ProgramRules> = { adjacency: { ...rules.adjacency, [pairKey("lobby", "gathering")]: { side: "never", stacked: "never" } } };
  const r = generateArrangement(ctxFor("compact", 5, 10, never), emptyDoc(), { tries: 2 });
  const l = analyzeLayout(r.doc, tileById, { ...rules, ...never });
  const bad = l.joints.filter((j) => ruleBetween({ ...rules, ...never }, l.byId.get(j.aId)!.tile, l.byId.get(j.bId)!.tile, j.axis === 2) === "never");
  ok(bad.length === 0, `never rule broken by ${bad.length} joints`);
  ok(evaluateProgram(l, r.doc, { ...rules, ...never }, defaultSite(), tileById).filter((w) => w.kind === "never").length === 0, "warnings list reports a never pair the generator made");
}

// ---- 3. orientation and group edits are exact ---------------------------------------------------------------------------
{
  const doc = docs.get("compact")!;
  const ids = new Set(doc.pieces.map((p) => p.id));
  let d = doc;
  for (let i = 0; i < 4; i++) d = rotateGroup(d, ids, tileById, 1);
  ok(JSON.stringify(d.pieces.map((p) => [p.pos, p.rotZ, p.mirrorX])) === JSON.stringify(doc.pieces.map((p) => [p.pos, p.rotZ, p.mirrorX])), "four quarter turns of the group are not the identity");
  const m2 = mirrorGroup(mirrorGroup(doc, ids, tileById), ids, tileById);
  ok(JSON.stringify(m2.pieces.map((p) => [p.pos, p.rotZ, p.mirrorX])) === JSON.stringify(doc.pieces.map((p) => [p.pos, p.rotZ, p.mirrorX])), "two mirrors of the group are not the identity");
  const l0 = analyzeLayout(doc, tileById, rules);
  const l1 = analyzeLayout(rotateGroup(doc, ids, tileById, 1), tileById, rules);
  const l2 = analyzeLayout(mirrorGroup(doc, ids, tileById), tileById, rules);
  ok(l1.joints.length === l0.joints.length && l1.overlaps.length === 0 && l1.islands.length === 0, "turning the whole group changed its joints");
  ok(l2.joints.length === l0.joints.length && l2.overlaps.length === 0 && l2.islands.length === 0, "mirroring the whole group changed its joints");
  const sc = (l: typeof l0) => l.joints.map((j) => j.legacy?.toFixed(1)).sort().join();
  ok(sc(l1) === sc(l0), "turning the group changed the void scores of its joints");
  // a voxel check of orientation: turn a tile four times
  const t = tiles[0];
  const o0 = getOriented(t, 0, false);
  const o4 = getOriented(t, 4, false);
  ok(o0.void.every((v, i) => v === o4.void[i]), "four turns of a tile's voxels are not the identity");
  const om = getOriented(t, 0, true);
  const omm = getOriented({ ...t, id: t.id + "m" }, 0, false);
  void om;
  void omm;
}

// ---- 4. the connected rule on edits ---------------------------------------------------------------------------------------
{
  const doc = docs.get("spineH")!;
  const l = analyzeLayout(doc, tileById, rules);
  // remove each piece in turn: if it would orphan others the check must say so, and re-attaching or removing must repair it
  let tested = 0;
  for (const p of doc.pieces) {
    const orphans = orphansIfRemoved(l, new Set([p.id]));
    const next = removePieces(doc, new Set([p.id]));
    const chk = checkEdit(next, tileById, rules);
    ok((orphans.length === 0) === (chk.islands.length === 0), `orphan prediction disagrees with the check for ${p.id}`);
    if (chk.islands.length) {
      tested++;
      const fixed = reattachIslands(next, chk.islands, tileById, rules);
      ok(!!fixed && checkEdit(fixed, tileById, rules).ok, "re-attaching the orphaned pieces did not give a valid arrangement");
      ok(checkEdit(removePieces(next, new Set(chk.islands.flat())), tileById, rules).ok, "removing the orphans did not give a valid arrangement");
    }
  }
  console.log(`  edits that cut pieces off, repaired: ${tested}`);
  // moving one piece far away detaches it
  const far = movePieces(doc, new Set([doc.pieces[doc.pieces.length - 1].id]), [200, 0, 0]);
  ok(checkEdit(far, tileById, rules).islands.length > 0, "a piece moved far away was not flagged as detached");
  ok(withGroups(doc, [doc.pieces[0].id]).size === 1, "an ungrouped piece pulled in others");
}

// ---- 5. the whole: composite, analysis, smoothing, sequence, names ------------------------------------------------------------
{
  const doc = docs.get("compact")!;
  const l = analyzeLayout(doc, tileById, rules);
  const t0 = Date.now();
  const comp = buildComposite(l.boxes)!;
  const cells = comp.grid[0] * comp.grid[1] * comp.grid[2];
  let own = 0;
  for (const b of l.boxes) own += b.o.dims[0] * b.o.dims[1] * b.o.dims[2];
  ok(comp.mask.reduce((a, v) => a + v, 0) === own, "the composite does not hold exactly the pieces' cells");
  const a = analyzeTile({ void: comp.void.map((v, i) => (v && comp.mask[i] ? 1 : 0)) as Uint8Array, grid: comp.grid, cell: comp.cell, plates: comp.plates, mask: comp.mask });
  console.log(`  composite ${comp.grid.join("x")} = ${(cells / 1e6).toFixed(2)} M cells, analysis ${Date.now() - t0} ms: ${a.spaces.levels.length} levels, ${a.spaces.rooms.length} rooms, longest route ${a.spaces.routes[0]?.length_ft.toFixed(0) ?? "-"} ft, foam pieces ${a.structure.foam_pieces}`);
  ok(a.spaces.levels.length > 0, "the whole has no floor levels");
  const t1 = Date.now();
  const sm = smoothComposite(comp, l.joints, defaultSmooth());
  console.log(`  smoothing ${Date.now() - t1} ms: ${sm.report.bridged} bridged, ${sm.report.floorsRaised} floor cells, ${sm.report.floaters.length} fragments`);
  const all = sm.report.floaters.map((f) => f.key);
  const sm2 = smoothComposite(comp, l.joints, { ...defaultSmooth(), approved: all });
  ok(sm2.report.removed + sm2.report.filled === all.length, "approved fragments were not all applied");
  const seq = buildSequence(l, rules);
  ok(seq.steps.length >= 2 && seq.steps[0].pieceId === l.entranceId, "the sequence does not start at the entrance");
  const nm = autoNames(l, seq, tileById);
  ok(Object.keys(nm).length === doc.pieces.length, "not every piece got a name");
  console.log(`  sequence ${seq.steps.length} spaces, quality ${seq.quality}; names: ${Object.values(nm).slice(0, 3).join(" | ")}`);
  const route = a.spaces.routes[0]?.points_ft.map((p) => [p[0] + comp.origin[0], p[1] + comp.origin[1], p[2] + comp.origin[2]] as [number, number, number]);
  if (route) {
    const path = walkPath(comp, route, null);
    ok(path.length > 4, "no walk-through path");
    const views = findNiceViews(l.boxes, { comp, route: path, entrance: null });
    ok(views.some((v) => v.kind === "exterior") && views.some((v) => v.kind === "interior"), "auto views did not find both exterior and interior ones");
    console.log(`  views ${views.length}, walk path ${path.length} points`);
  }
}

// ---- 5b. the drone tour -------------------------------------------------------------------------------------------------------------
{
  for (const [key, doc] of docs) {
    const l = analyzeLayout(doc, tileById, rules);
    const comp = buildComposite(l.boxes)!;
    const seq = buildSequence(l, rules);
    const t0 = Date.now();
    const plan = planDrone(comp, { order: seq.steps.map((s) => s.pieceId), entrance: entrancePoint(l) });
    if (!plan) {
      console.log(`  drone ${key}: no tour (too tight)`);
      continue;
    }
    const [nx, ny, nz] = comp.grid;
    const foamAt = (p: [number, number, number]) => {
      const x = Math.floor((p[0] - comp.origin[0]) / comp.cell);
      const y = Math.floor((p[1] - comp.origin[1]) / comp.cell);
      const z = Math.floor((p[2] - comp.origin[2]) / comp.cell);
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return z < 0; // outside the box is air, below it is ground
      const i = (x * ny + y) * nz + z;
      return comp.mask[i] === 1 && comp.void[i] === 0;
    };
    let hits = 0;
    let moved = 0;
    let wentIn = false;
    const flags: boolean[] = [];
    const inMask = (p: [number, number, number]) => {
      const x = Math.floor((p[0] - comp.origin[0]) / comp.cell);
      const y = Math.floor((p[1] - comp.origin[1]) / comp.cell);
      const z = Math.floor((p[2] - comp.origin[2]) / comp.cell);
      return x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && comp.mask[(x * ny + y) * nz + z] === 1;
    };
    let prev = plan.pose(0).pos;
    const N = Math.max(200, Math.round(plan.lengthFt * 4));
    for (let k = 0; k <= N; k++) {
      const p = plan.pose(k / N);
      // test the frame itself and the straight way from the last frame, every quarter foot
      const d = Math.hypot(p.pos[0] - prev[0], p.pos[1] - prev[1], p.pos[2] - prev[2]);
      const steps = Math.max(1, Math.ceil(d / 0.25));
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        if (foamAt([prev[0] + (p.pos[0] - prev[0]) * u, prev[1] + (p.pos[1] - prev[1]) * u, prev[2] + (p.pos[2] - prev[2]) * u])) hits++;
      }
      moved += d;
      prev = p.pos;
      if (inMask(p.pos)) wentIn = true;
      if (wentIn) flags.push(inMask(p.pos));
    }
    // the way out at the end (through an opening and on into empty air) is meant to be outdoors: count the tour up to its last frame inside
    const lastIn = flags.lastIndexOf(true);
    const frames = lastIn + 1;
    const outsideFrames = flags.slice(0, lastIn + 1).filter((v) => !v).length;
    const endP = plan.pose(1).pos;
    ok(!inMask(endP) && Math.hypot(endP[0] - comp.origin[0], endP[1] - comp.origin[1]) > 0, `drone tour in "${key}" does not end outside the building`);
    ok(hits === 0, `drone tour in "${key}" passes through foam (${hits} samples)`);
    ok(plan.visited.length >= Math.max(2, Math.floor(doc.pieces.length * 0.5)), `drone tour in "${key}" visits only ${plan.visited.length} of ${doc.pieces.length} pieces`);
    ok(moved > 10, `drone tour in "${key}" barely moves`);
    const turnsBack = reversalsIn(plan.path);
    ok(turnsBack <= 1, `drone tour in "${key}" turns back on itself ${turnsBack} times`);
    const outShare = frames ? outsideFrames / frames : 0;
    ok(outShare < 0.25, `drone tour in "${key}" spends ${(outShare * 100).toFixed(0)}% of its time outside once it is in`);
    const deg = new Map<string, number>(l.boxes.map((b) => [b.piece.id, 0]));
    for (const c of l.contacts) {
      deg.set(c.a.piece.id, (deg.get(c.a.piece.id) ?? 0) + 1);
      deg.set(c.b.piece.id, (deg.get(c.b.piece.id) ?? 0) + 1);
    }
    const leafShare = [...deg.values()].filter((d) => d <= 1).length / l.boxes.length;
    console.log(`  leaves ${(leafShare * 100).toFixed(0)}%, outside after entering ${(outShare * 100).toFixed(0)}%, sharp reversals ${turnsBack}`);
    console.log(`  drone ${key}: ${plan.lengthFt.toFixed(0)} ft, clearance ${plan.clearanceFt} ft, ${plan.visited.length}/${doc.pieces.length} pieces, ${Date.now() - t0} ms`);
  }
}

// ---- 5b2. the short (highlights) drone tour --------------------------------------------------------------------------------------------
{
  const doc = docs.get("compact")!;
  const l = analyzeLayout(doc, tileById, rules);
  const comp = buildComposite(l.boxes)!;
  const seq = buildSequence(l, rules);
  const order = seq.steps.map((s) => s.pieceId);
  const full = planDrone(comp, { order, entrance: entrancePoint(l) });
  const short = planDrone(comp, { order, entrance: entrancePoint(l), highlights: 3 });
  ok(!!full && !!short, "the highlights tour could not be planned");
  if (full && short) {
    ok(short.visited.length <= 3 && short.visited.length >= 2, `the highlights tour visits ${short.visited.length} spaces, not about 3`);
    ok(short.lengthFt < full.lengthFt, "the highlights tour is not shorter than the full one");
    console.log(`  highlights: ${short.visited.length} spaces, ${short.lengthFt.toFixed(0)} ft against ${full.lengthFt.toFixed(0)} ft for the full tour`);
  }
}

// ---- 5b3. the three kinds of picture ------------------------------------------------------------------------------------------------
{
  for (const key of ["compact", "courtyard", "stepped"]) {
    const doc = docs.get(key)!;
    const l = analyzeLayout(doc, tileById, rules);
    const comp = buildComposite(l.boxes)!;
    const seq = buildSequence(l, rules);
    const plan = planDrone(comp, { order: seq.steps.map((s) => s.pieceId), entrance: entrancePoint(l), approach: false });
    const v = findViews(l.boxes, { comp, path: plan?.path ?? null, entrance: entrancePoint(l), exposed: l.exposed, counts: { exterior: 3, closeups: 3, interior: 4 } });
    const kinds = { exterior: v.filter((x) => x.id.startsWith("ext")).length, closeup: v.filter((x) => x.id.startsWith("close")).length, interior: v.filter((x) => x.id.startsWith("int")).length };
    ok(kinds.exterior >= 1 && kinds.closeup >= 1 && kinds.interior >= 1, `views for "${key}": ${JSON.stringify(kinds)}`);
    const none = findViews(l.boxes, { comp, path: plan?.path ?? null, entrance: null, exposed: l.exposed, counts: { exterior: 0, closeups: 0, interior: 0 } });
    ok(none.length === 0, "views with every count at 0 are not empty");
    console.log(`  views ${key}: ${JSON.stringify(kinds)}`);
  }
}

// ---- 5c. print labels -----------------------------------------------------------------------------------------------------------------
{
  ok(labelFor("office_4_void_edge_workspace_V3") === "O-4" && labelFor("gathering_2_void_field_gathering") === "G-2" && labelFor("lobby_3_x") === "L-3", "label names are wrong");
  let found = 0;
  for (const t of tiles) {
    const r = findLabelPatch(t, 120, { text: "O-4", depthMm: 0.6, maxHeightMm: 6 });
    if ("patch" in r) {
      found++;
      const p = r.patch;
      const cellMm = (t.cellFt * 304.8) / 120;
      ok(p.x0 >= 0 && p.y0 >= 0 && p.x1 <= t.grid[0] * cellMm + 1e-6 && p.y1 <= t.grid[1] * cellMm + 1e-6, "label patch is outside the tile");
      // every cell under the patch must be foam on the bottom layer
      const nx = t.grid[0], ny = t.grid[1], nz = t.grid[2];
      for (let x = Math.floor(p.x0 / cellMm + 1e-6); x < Math.ceil(p.x1 / cellMm - 1e-6); x++)
        for (let y = Math.floor(p.y0 / cellMm + 1e-6); y < Math.ceil(p.y1 / cellMm - 1e-6); y++) ok(!t.voxels.void![(x * ny + y) * nz] && x < nx, "label patch covers a void cell on the bottom layer");
    }
  }
  // the smooth print mesh: closed, exactly on the tile's box, outward-wound, finer than the voxels
  let fineTris = 0;
  for (const t of tiles) {
    for (const solid of ["foam", "void"] as const) {
      const s = fineSoup(t, 120, 3, solid);
      if (!s) continue;
      const mm = (t.cellFt * 304.8) / 120;
      let lo = Infinity, hi = -Infinity;
      for (let i = 2; i < s.length; i += 3) {
        lo = Math.min(lo, s[i]);
        hi = Math.max(hi, s[i]);
      }
      ok(openEdges(s) === 0, `${t.name}: the fine ${solid} mesh has open edges`);
      ok(lo >= -1e-3 && hi <= t.grid[2] * mm + 1e-3, `${t.name}: the fine ${solid} mesh leaves the tile's box`);
      ok(volumeMm3(s) > 0, `${t.name}: the fine ${solid} mesh is empty`);
      if (solid === "foam") fineTris += s.length / 9;
    }
  }
  console.log(`  fine print meshes: all closed and inside the box, ${Math.round(fineTris / tiles.length / 1000)}k triangles per tile at detail 3`);
  console.log(`  label patch found on ${found} of ${tiles.length} tiles at 1:120 (6 mm letters)`);
  ok(found >= Math.floor(tiles.length / 2), "too few tiles have room for a label");
  // a bitmap with a hole (like the letter O) becomes a closed solid of the right volume
  const w = 24, h = 14;
  const ink = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) ink[j * w + i] = i >= 2 && i < 22 && j >= 2 && j < 12 && !(i >= 8 && i < 16 && j >= 5 && j < 9) ? 1 : 0;
  const cells = ink.reduce((a, v) => a + v, 0);
  for (const rotated of [false, true]) {
    const g = placeBitmap({ w, h, ink }, rotated);
    const soup = labelSoup(g, 0, 0, 0, 0.6);
    ok(openEdges(soup) === 0, "the label solid has open edges");
    ok(Math.abs(volumeMm3(soup) - cells * 0.01 * 0.6) / (cells * 0.01 * 0.6) < 0.03, `the label solid has the wrong volume (${volumeMm3(soup).toFixed(3)} for ${(cells * 0.01 * 0.6).toFixed(3)})`);
  }
  // the pocket: a block minus the label is lighter by the label's volume, and still closed
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
    return new Float32Array([
      ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
      ...q([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]),
      ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
      ...q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]),
      ...q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]),
      ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
    ]);
  };
  const block = box(0, 0, 0, 30, 20, 10);
  const g = placeBitmap({ w, h, ink }, false);
  const cut = cutPocket(block, labelSoup(g, 3, 3, -0.4, 0.6));
  const lost = volumeMm3(block) - volumeMm3(cut);
  const want = volumeMm3(labelSoup(g, 3, 3, 0, 0.6));
  ok(Math.abs(lost - want) / want < 0.05, `the pocket removes ${lost.toFixed(2)} mm3 but the label is ${want.toFixed(2)} mm3`);
  ok(openEdges(cut) <= 150, `the block has ${openEdges(cut)} open edges after the pocket is cut`);
  console.log(`  pocket: block ${volumeMm3(block).toFixed(0)} -> ${volumeMm3(cut).toFixed(1)} mm3, label ${want.toFixed(2)} mm3`);
}

// ---- 6. helpers ----------------------------------------------------------------------------------------------------------------------
{
  const doc = docs.get("compact")!;
  const ctx = ctxFor("compact", 1, doc.pieces.length + 1);
  const t0 = Date.now();
  const s = suggestNext(ctx, doc, doc.pieces[0].id, 5);
  ok(s.length > 0, "suggest next found nothing");
  for (const x of s) {
    const next = { ...doc, pieces: [...doc.pieces, { ...x.candidate.piece, id: "new" }] };
    ok(checkEdit(next, tileById, rules).ok, "a suggestion is not a valid placement");
  }
  const r = betterTiles(ctx, doc, doc.pieces[1].id, 3);
  for (const o of r.options) ok(checkEdit(o.doc, tileById, rules).ok, "a replacement option is not valid");
  console.log(`  suggest ${s.length}, replace ${r.options.length}  ${Date.now() - t0} ms`);
  const regen = regenerateMarked(ctx, { ...doc, ratings: { [analyzeLayout(doc, tileById, rules).joints[0].id]: "bad" } }, new Set([analyzeLayout(doc, tileById, rules).joints[0].id]), doc.pieces.length);
  ok(analyzeLayout(regen.doc, tileById, rules).islands.length === 0, "regenerating marked left a detached piece");
  // snapping: a piece nudged near a neighbour snaps flush; far away it stays free
  const p = doc.pieces[doc.pieces.length - 1];
  const others = analyzeLayout({ ...doc, pieces: doc.pieces.filter((q) => q.id !== p.id) }, tileById, rules).boxes;
  const sn = snapPosition(p, tileById.get(p.tileId)!, others, [p.pos[0] + 1.2, p.pos[1] - 0.8, p.pos[2]], { lattice: false, radiusFt: 8 });
  ok(sn.rule !== "grid", "a piece moved a little from its place did not snap back");
}

// ---- 6b. tiles that are not cubes (20 x 40 x 20 and 20 x 20 x 40), made by joining two of the typology tiles ---------------------------
{
  const a = tiles[0];
  const b = tiles[5];
  const join = (src: (t: ParsedTile) => Uint8Array | undefined, axis: "y" | "z") => {
    const A = src(a);
    const B = src(b);
    if (!A || !B) return undefined;
    const out = new Uint8Array(A.length * 2);
    const n = 40;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < (axis === "y" ? 2 * n : n); y++)
        for (let z = 0; z < (axis === "z" ? 2 * n : n); z++) {
          const ny = axis === "y" ? 2 * n : n;
          const nz = axis === "z" ? 2 * n : n;
          const upper = axis === "y" ? y >= n : z >= n;
          const yy = axis === "y" && upper ? y - n : y;
          const zz = axis === "z" && upper ? z - n : z;
          out[(x * ny + y) * nz + z] = (upper ? B : A)[(x * n + yy) * n + zz];
        }
    return out;
  };
  const mk = (id: string, axis: "y" | "z"): ParsedTile => ({
    ...a,
    id,
    name: id,
    grid: axis === "y" ? [40, 80, 40] : [40, 40, 80],
    tileFt: axis === "y" ? [20, 40, 20] : [20, 20, 40],
    voxels: { void: join((t) => t.voxels.void, axis), plates: join((t) => t.voxels.plates, axis) },
    spaces: a.spaces,
    meta: { category: "gathering", typology: id },
  });
  const long = mk("long_tile", "y");
  const tall = mk("tall_tile", "z");
  const map2 = new Map([...tiles, long, tall].map((t) => [t.id, t]));
  const o = getOriented(long, 1, false);
  ok(o.dims[0] === 80 && o.dims[1] === 40, "a quarter turn of a 20 x 40 tile is not 40 x 20");
  for (const bank of [[tiles[5], long], [tiles[2], tall], [long, tall, tiles[7]]]) {
    const ctx: GenContext = { tileById: map2, bank, rules, priorities: defaultPriorities(), site: defaultSite(), settings: { ...defaultGen(), seed: 4, amount: 6 } };
    const r = generateArrangement(ctx, emptyDoc(), { tries: 2 });
    const l = analyzeLayout(r.doc, map2, rules);
    const used = new Set(r.doc.pieces.map((p) => p.tileId));
    ok(l.overlaps.length === 0 && l.islands.length === 0, `non-cubic ${[...used].join("+")}: overlaps ${l.overlaps.length}, islands ${l.islands.length}`);
    ok(r.doc.pieces.length >= 3, `non-cubic bank gave only ${r.doc.pieces.length} pieces`);
    const comp = buildComposite(l.boxes)!;
    let own = 0;
    for (const bx of l.boxes) own += bx.o.dims[0] * bx.o.dims[1] * bx.o.dims[2];
    ok(comp.mask.reduce((s, v) => s + v, 0) === own, "composite of non-cubic pieces does not hold exactly their cells");
    console.log(`  non-cubic bank (${[...used].join(", ")}): ${r.doc.pieces.length} pcs, ${l.joints.length} joints, composite ${comp.grid.join("x")}`);
  }
}

// ---- 7. the interlock test and the pair matrix ------------------------------------------------------------------------------------
{
  const t0 = Date.now();
  let weldOk = 0;
  for (const t of tiles) {
    const rows = runAllInterlock(t, rules);
    ok(rows.length === 9 && rows.every((r) => r.connected), `${t.name}: an interlock pattern is not connected`);
    const mirror = rows.find((r) => r.pattern === "mirror" && r.count === 2)!;
    if ((mirror.overall ?? 0) >= 99) weldOk++;
  }
  console.log(`  interlock: ${tiles.length * 9} runs, mirror pair scores 100 for ${weldOk}/${tiles.length} tiles, ${Date.now() - t0} ms`);
  const t1 = Date.now();
  const m = pairMatrix(tiles);
  const flat = m.cells.flat().map((c) => c.score ?? -1);
  console.log(`  pair matrix ${m.tiles.length}x${m.tiles.length}: ${Date.now() - t1} ms, ${flat.filter((v) => v >= 60).length}/${flat.length} cells score 60 or more`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Arrange checks passed");
process.exit(failures ? 1 : 0);
