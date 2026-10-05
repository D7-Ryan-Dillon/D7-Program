// The generator. It grows ONE arrangement from an entrance outwards: every new piece attaches to an opening of a piece
// already placed and must make a walkable joint there, so the result is always a single connected building (the
// connected rule is built in, not checked afterwards). Choices are scored on the always-on goals (joint quality, a
// connected route, a readable sequence) plus the user's priorities and the chosen shape, and picked with a seeded random
// nudge so the same seed and settings give the same result.
//
// The same candidate machinery serves "suggest next", "fill the gap" and "auto replace" (lib/arrange/suggest.ts).

import type { ParsedTile } from "@/lib/types";
import { boundsOfBoxes, boxesOverlap, contactBetween, findContacts, placeBox, toCell, toFt, type PlacedBox } from "./geometry";
import { jointFromContact } from "./joints";
import { boxesFor, exposedPatches, type Exposed } from "./layout";
import { categoryOf, FACE_AXIS, FACE_SIGN, getFacts, isPlaceable, OPPOSITE, orientedDims } from "./orient";
import { ruleBetween, ruleValue, supportFraction } from "./program";
import { mulberry32 } from "./rng";
import { analyzeLayout } from "./layout";
import { buildSequence } from "./whole";
import { makePiece, newPieceId } from "./ops";
import { toleranceFt, type ArrangementDoc, type GenSettings, type Joint, type Piece, type Priorities, type ProgramRules, type ShapeKind, type Site, type Vec3 } from "./types";

export interface GenContext {
  tileById: Map<string, ParsedTile>;
  /** the tiles the generator may use */
  bank: ParsedTile[];
  rules: ProgramRules;
  priorities: Priorities;
  site: Site;
  settings: GenSettings;
}

export interface Candidate {
  piece: Piece;
  box: PlacedBox;
  /** the joint with the piece it attaches to */
  primary: Joint;
  joints: Joint[];
  /** the opening it attaches to */
  slot: Exposed;
  score: number;
  parts: Record<string, number>;
}

const RELAX = [1, 0.75, 0.5, 0];
const STOREY_CELLS = 20; // 10 ft
const TOP_K = 3;
const ATTEMPTS = 700;

// ---- shapes --------------------------------------------------------------------------------------------------------

const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const near = (d: number, scale: number) => 1 / (1 + Math.abs(d) / scale);

interface ShapeState {
  boxes: PlacedBox[];
  root: Vec3;
  centroid: Vec3;
  count: number;
  amount: number;
  contacts: number;
}

const centerOf = (b: { min: number[]; max: number[] }): Vec3 => [toFt((b.min[0] + b.max[0]) / 2), toFt((b.min[1] + b.max[1]) / 2), toFt((b.min[2] + b.max[2]) / 2)];

/** 0..1: how well a new piece at `c` fits the overall shape. */
export function shapeScore(shape: ShapeKind, dir: number, c: Vec3, s: ShapeState): number {
  const [dx, dy] = DIRS[((dir % 4) + 4) % 4];
  const rx = c[0] - s.root[0];
  const ry = c[1] - s.root[1];
  const rz = c[2] - s.root[2];
  const along = rx * dx + ry * dy;
  const lateral = -rx * dy + ry * dx;
  const horiz = Math.hypot(rx, ry);
  switch (shape) {
    case "compact":
      return near(Math.hypot(c[0] - s.centroid[0], c[1] - s.centroid[1], (c[2] - s.centroid[2]) * 1.5), 25);
    case "spineV":
      return 0.55 * near(horiz, 15) + 0.45 * clamp01(0.25 + rz / Math.max(20, s.amount * 6));
    case "spineH":
      return 0.65 * near(Math.abs(lateral) + Math.abs(rz), 14) + 0.35;
    case "courtyard": {
      const R = Math.min(60, Math.max(30, 14 + 3.2 * s.amount));
      const cx = s.root[0] + dx * R;
      const cy = s.root[1] + dy * R;
      return near(Math.hypot(c[0] - cx, c[1] - cy) - R, 12) * near(rz, 14);
    }
    case "stepped":
      return near(rz - Math.floor(along / 20) * 10, 8) * (along >= -10 ? 1 : 0.5);
    case "cascade":
      return near(rz + 0.25 * along, 6) * (along >= -10 ? 1 : 0.5);
    case "slab": {
      const layers = s.amount <= 6 ? 2 : 3;
      const cap = Math.max(1, Math.ceil(s.amount / layers));
      const target = Math.floor(s.count / cap) * 10;
      return 0.7 * near(rz - target, 6) + 0.3 * near(horiz, 40);
    }
    case "village": {
      const baseN = Math.ceil(s.amount * 0.4);
      if (s.count < baseN) return 0.7 * near(rz, 6) + 0.3 * near(horiz, 30);
      // towers: stack above existing pieces
      const over = s.boxes.some((b) => toFt(b.max[2]) <= c[2] + 0.1 && Math.abs(centerOf(b)[0] - c[0]) < 11 && Math.abs(centerOf(b)[1] - c[1]) < 11);
      return (over ? 0.75 : 0.2) + 0.25 * clamp01(rz / 30);
    }
    case "bridge": {
      if (s.count < Math.ceil(s.amount * 0.55)) {
        const R = Math.min(50, Math.max(28, 12 + 2.6 * s.amount));
        const cx = s.root[0] + dx * R;
        const cy = s.root[1] + dy * R;
        return near(Math.hypot(c[0] - cx, c[1] - cy) - R, 12) * near(rz, 8);
      }
      return s.contacts >= 2 ? 1 : 0.15 + 0.3 * clamp01(rz / 20);
    }
    default:
      return 0.5;
  }
}

// ---- candidates ----------------------------------------------------------------------------------------------------

const inSite = (site: Site, min: [number, number, number], max: [number, number, number]) => {
  if (!site.enabled) return true;
  return (
    toFt(min[0]) >= site.min[0] - 1e-6 &&
    toFt(min[1]) >= site.min[1] - 1e-6 &&
    toFt(max[0]) <= site.min[0] + site.size[0] + 1e-6 &&
    toFt(max[1]) <= site.min[1] + site.size[1] + 1e-6 &&
    (site.maxHeight <= 0 || toFt(max[2]) <= site.maxHeight + 1e-6)
  );
};

export interface State {
  pieces: Piece[];
  boxes: PlacedBox[];
  exposed: Exposed[];
  copies: Map<string, number>;
  cats: Map<string, number>;
}

export function stateOf(pieces: Piece[], ctx: GenContext): State {
  const boxes = boxesFor(pieces, ctx.tileById);
  const exposed = exposedPatches(boxes, findContacts(boxes));
  const copies = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const b of boxes) {
    copies.set(b.piece.tileId, (copies.get(b.piece.tileId) ?? 0) + 1);
    cats.set(categoryOf(b.tile), (cats.get(categoryOf(b.tile)) ?? 0) + 1);
  }
  return { pieces, boxes, exposed, copies, cats };
}

/** May another copy of this tile be added (copies, per-tile and per-category maxima, total)? */
export function allowedByCounts(tile: ParsedTile, st: State, ctx: GenContext, total: number): boolean {
  const c = ctx.rules.counts;
  if (c.maxCopies > 0 && (st.copies.get(tile.id) ?? 0) >= c.maxCopies) return false;
  const pt = c.perTile[tile.id];
  if (pt && pt.max > 0 && (st.copies.get(tile.id) ?? 0) >= pt.max) return false;
  const pc = c.perCategory[categoryOf(tile)];
  if (pc && pc.max > 0 && (st.cats.get(categoryOf(tile)) ?? 0) >= pc.max) return false;
  if (c.total.max > 0 && total >= c.total.max) return false;
  return true;
}

/** Builds one candidate placement of `tile` (orientation rot / mirror) against `slot`, or null when it does not work. */
export function placeAgainst(
  ctx: GenContext,
  st: State,
  slot: Exposed,
  tile: ParsedTile,
  rot: number,
  mirror: boolean,
  patchPick: number,
  levelPick: number | null,
  minScore: number,
): Candidate | null {
  const parent = st.boxes.find((b) => b.piece.id === slot.pieceId);
  if (!parent) return null;
  const facts = getFacts(tile, rot, mirror, 1);
  const myFace = OPPOSITE[slot.face];
  const myPatches = facts.patches[myFace];
  if (!myPatches.length) return null;
  const q = myPatches[Math.min(patchPick, myPatches.length - 1)];
  const dims = orientedDims(tile, rot, 1);
  const axis = FACE_AXIS[slot.face];
  const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const min: [number, number, number] = [0, 0, 0];
  min[axis] = FACE_SIGN[slot.face] > 0 ? parent.max[axis] : parent.min[axis] - dims[axis];
  min[o1] = Math.round(parent.min[o1] + slot.patch.cu - q.cu);
  min[o2] = Math.round(parent.min[o2] + slot.patch.cv - q.cv);
  if (levelPick !== null && axis !== 2) {
    // vertical choices beyond "opening centre to opening centre": a storey up or down (floor 1 meets floor 2), or any floor of this piece to any floor of the neighbour
    const code = levelPick & 7;
    if (code < 2) min[2] += code === 0 ? STOREY_CELLS : -STOREY_CELLS;
    else {
      const pf = getFacts(parent.tile, parent.piece.rotZ, parent.piece.mirrorX, parent.piece.scale);
      if (pf.levelsZ.length && facts.levelsZ.length) {
        const idx = levelPick >> 3;
        min[2] = parent.min[2] + pf.levelsZ[idx % pf.levelsZ.length] - facts.levelsZ[Math.floor(idx / pf.levelsZ.length) % facts.levelsZ.length];
      }
    }
  }
  const max: [number, number, number] = [min[0] + dims[0], min[1] + dims[1], min[2] + dims[2]];
  if (st.boxes.some((b) => boxesOverlap({ min, max }, b))) return null;
  if (!inSite(ctx.site, min, max)) return null;
  const piece: Piece = { id: "candidate", tileId: tile.id, pos: [toFt(min[0]), toFt(min[1]), toFt(min[2])], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
  const box = placeBox(piece, tile);
  const all = boundsOfBoxes([...st.boxes, box])!;
  const l = ctx.rules.limits;
  if (l.maxHeightFt > 0 && toFt(all.max[2] - all.min[2]) > l.maxHeightFt + 1e-6) return null;
  if (l.maxFootprintFt > 0 && Math.max(toFt(all.max[0] - all.min[0]), toFt(all.max[1] - all.min[1])) > l.maxFootprintFt + 1e-6) return null;

  const tol = toleranceFt(ctx.rules);
  const joints: Joint[] = [];
  let primary: Joint | null = null;
  for (const b of st.boxes) {
    const c = contactBetween(box, b);
    if (!c) continue;
    const j = jointFromContact(c, tol);
    const level = ruleBetween(ctx.rules, tile, b.tile, j.axis === 2);
    if (level === "never") return null;
    joints.push(j);
    if (b === parent) primary = j;
  }
  if (!primary || !primary.walkable || (primary.score ?? 0) < minScore) return null;
  return { piece, box, primary, joints, slot, score: 0, parts: {} };
}

/** The objective for one candidate (higher is better): always-on goals plus the user's priorities and the shape. */
export function scoreCandidate(ctx: GenContext, st: State, c: Candidate): number {
  const p = ctx.priorities;
  const w = (v: number) => (v / 100) * 2; // 50 -> 1
  const parts: Record<string, number> = {};
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  parts.joint = mean(c.joints.map((j) => j.score ?? 0)) / 100;
  parts.floors = mean(c.joints.map((j) => (j.parts.floors ?? 100))) / 100;
  parts.program = mean(c.joints.map((j) => (ruleValue(ruleBetween(ctx.rules, c.box.tile, st.boxes.find((b) => b.piece.id === (j.aId === "candidate" ? j.bId : j.aId))!.tile, j.axis === 2)) + 1) / 2));
  // openings of the new piece that face outside (not covered by a neighbour)
  const touching = st.boxes.map((b) => contactBetween(c.box, b)).filter((x): x is NonNullable<typeof x> => !!x);
  const mine = exposedPatches([c.box], touching);
  const sideFaces = new Set(mine.filter((e) => FACE_AXIS[e.face] !== 2).map((e) => e.face));
  parts.daylight = clamp01(mine.filter((e) => FACE_AXIS[e.face] !== 2).length / 3) * 0.6 + clamp01(sideFaces.size / 3) * 0.2 + (mine.some((e) => e.face === "z+") ? 0.2 : 0);
  const all = boundsOfBoxes([...st.boxes, c.box])!;
  const volBox = (all.max[0] - all.min[0]) * (all.max[1] - all.min[1]) * (all.max[2] - all.min[2]);
  let vol = 0;
  for (const b of [...st.boxes, c.box]) vol += (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  parts.compactness = vol / Math.max(1, volBox);
  parts.variety = 1 / (1 + (st.copies.get(c.box.tile.id) ?? 0));
  const zs = new Set(st.boxes.map((b) => b.min[2]));
  parts.vertical = zs.has(c.box.min[2]) ? 0.25 : 1;
  parts.openness = clamp01(mine.reduce((a, e) => a + e.patch.cells, 0) / 900);
  parts.structure = supportFraction({ boxes: [...st.boxes, c.box], bounds: all }, c.box.piece.id);
  const centroid: Vec3 = [0, 0, 0];
  for (const b of st.boxes) {
    const cb = centerOf(b);
    for (let k = 0; k < 3; k++) centroid[k] += cb[k] / st.boxes.length;
  }
  const root = centerOf(st.boxes[0]);
  // knit: a piece that touches several neighbours is part of the mass; a piece on one joint is a stub
  parts.knit = clamp01((touching.length - 1) / 2);
  // tuck: how much the bounding box has to grow to take the piece (a piece out on its own makes a long thin reach)
  const before = boundsOfBoxes(st.boxes)!;
  const volBefore = (before.max[0] - before.min[0]) * (before.max[1] - before.min[1]) * (before.max[2] - before.min[2]);
  const pieceVol = (c.box.max[0] - c.box.min[0]) * (c.box.max[1] - c.box.min[1]) * (c.box.max[2] - c.box.min[2]);
  parts.tuck = 1 / (1 + Math.max(0, volBox - volBefore) / Math.max(1, pieceVol) / 1.5);
  parts.shape = shapeScore(ctx.settings.shape, ctx.settings.direction, centerOf(c.box), { boxes: st.boxes, root, centroid, count: st.pieces.length, amount: ctx.settings.amount, contacts: c.joints.filter((j) => j.axis !== 2).length });
  const order = ctx.rules.sequenceOrder;
  const pa = order.indexOf(categoryOf(st.boxes.find((b) => b.piece.id === (c.primary.aId === "candidate" ? c.primary.bId : c.primary.aId))!.tile) as never);
  const na = order.indexOf(categoryOf(c.box.tile) as never);
  parts.sequence = pa < 0 || na < 0 ? 0.6 : na > pa ? 1 : na === pa ? 0.7 : 0.4;
  c.parts = parts;
  return (
    3 * parts.joint +
    1.6 * parts.knit +
    1.3 * parts.tuck +
    1.5 * parts.sequence +
    2.4 * parts.shape +
    2 * w(p.floors) * parts.floors +
    w(p.program) * parts.program +
    w(p.daylight) * parts.daylight +
    w(p.compactness) * 1.5 * parts.compactness +
    w(p.variety) * parts.variety +
    w(p.vertical) * parts.vertical +
    w(p.openness) * parts.openness +
    w(p.structure) * parts.structure
  );
}

/** Rooted at the piece list's first piece; tiles that carry a wanted minimum count are favoured. */
function pickTile(ctx: GenContext, st: State, rng: () => number, total: number): ParsedTile | null {
  const pool = ctx.bank.filter((t) => isPlaceable(t) && allowedByCounts(t, st, ctx, total));
  if (!pool.length) return null;
  const weights = pool.map((t) => {
    let wgt = 1 / (1 + (st.copies.get(t.id) ?? 0));
    const pc = ctx.rules.counts.perCategory[categoryOf(t)];
    if (pc && pc.min > 0 && (st.cats.get(categoryOf(t)) ?? 0) < pc.min) wgt *= 4;
    const pt = ctx.rules.counts.perTile[t.id];
    if (pt && pt.min > 0 && (st.copies.get(t.id) ?? 0) < pt.min) wgt *= 4;
    return wgt;
  });
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function pickSlot(st: State, rng: () => number): Exposed | null {
  if (!st.exposed.length) return null;
  let r = rng() * st.exposed.reduce((a, e) => a + e.patch.cells, 0);
  for (const e of st.exposed) {
    r -= e.patch.cells;
    if (r <= 0) return e;
  }
  return st.exposed[st.exposed.length - 1];
}

/** How the next piece is lifted against its neighbour: mostly opening to opening, often a storey up or down, sometimes any floor to any floor. */
function pickLevel(rng: () => number): number | null {
  const r = rng();
  if (r < 0.4) return null;
  if (r < 0.75) return rng() < 0.5 ? 0 : 1;
  return 2 + 8 * Math.floor(rng() * 40);
}

/** One step: the best candidate among a random sample (picked among the top few by score), or null when nothing fits. */
function step(ctx: GenContext, st: State, rng: () => number, minScore: number, total: number): Candidate | null {
  const found: Candidate[] = [];
  for (let k = 0; k < ATTEMPTS && found.length < 60; k++) {
    const slot = pickSlot(st, rng);
    const tile = slot && pickTile(ctx, st, rng, total);
    if (!slot || !tile) break;
    const c = placeAgainst(ctx, st, slot, tile, Math.floor(rng() * 4), rng() < 0.5, Math.floor(rng() * 3), pickLevel(rng), minScore);
    if (c) {
      c.score = scoreCandidate(ctx, st, c) + rng() * 0.15;
      found.push(c);
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  // a seeded nudge among the best few, strongly favouring the best
  const pool = found.slice(0, TOP_K);
  const weights = pool.map((c) => Math.exp((c.score - pool[0].score) * 2.5));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

// ---- the whole run ---------------------------------------------------------------------------------------------------

export interface GenResult {
  doc: ArrangementDoc;
  notes: string[];
  score: number;
  /** one line on why this result */
  why: string;
}

function rootPiece(ctx: GenContext, rng: () => number, doc: ArrangementDoc): Piece | null {
  const pool = ctx.bank.filter(isPlaceable);
  if (!pool.length) return null;
  const lobbies = pool.filter((t) => categoryOf(t) === "lobby");
  const from = lobbies.length ? lobbies : pool;
  const tile = from[Math.floor(rng() * from.length)];
  const min = ctx.site.enabled ? ([toCell(ctx.site.min[0] + ctx.site.size[0] / 2 - 10), toCell(ctx.site.min[1] + ctx.site.size[1] / 2 - 10), 0] as const) : ([0, 0, 0] as const);
  return makePiece(doc, tile.id, [toFt(min[0]), toFt(min[1]), toFt(min[2])], { rotZ: Math.floor(rng() * 4), mirrorX: rng() < 0.5 });
}

function growOnce(ctx: GenContext, base: ArrangementDoc, target: number, seed: number): { doc: ArrangementDoc; stopped: string | null } {
  const rng = mulberry32(seed);
  let doc = base;
  if (!doc.pieces.length) {
    const r = rootPiece(ctx, rng, doc);
    if (!r) return { doc, stopped: "no tile in the bank can be placed" };
    doc = { ...doc, pieces: [r] };
  }
  let stopped: string | null = null;
  while (doc.pieces.length < target) {
    const st = stateOf(doc.pieces, ctx);
    let chosen: Candidate | null = null;
    for (const f of RELAX) {
      chosen = step(ctx, st, rng, ctx.settings.minScore * f, doc.pieces.length);
      if (chosen) break;
    }
    if (!chosen) {
      stopped = `stopped at ${doc.pieces.length} of ${target}: nothing else fits within the rules`;
      break;
    }
    doc = { ...doc, pieces: [...doc.pieces, { ...chosen.piece, id: newPieceId(doc) }] };
  }
  return { doc, stopped };
}

/** How good a finished arrangement is as a whole (used to keep the best of a few tries). */
export function assemblyScore(doc: ArrangementDoc, ctx: GenContext): number {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const js = layout.joints.filter((j) => j.score !== null);
  const meanJ = js.length ? js.reduce((a, j) => a + (j.score ?? 0), 0) / js.length / 100 : 0;
  const seq = buildSequence(layout, ctx.rules).quality / 100;
  const boxes = layout.boxes;
  const st: State = { pieces: doc.pieces, boxes, exposed: layout.exposed, copies: new Map(), cats: new Map() };
  const root = centerOf(boxes[0]);
  const centroid: Vec3 = [0, 0, 0];
  for (const b of boxes) {
    const cb = centerOf(b);
    for (let k = 0; k < 3; k++) centroid[k] += cb[k] / boxes.length;
  }
  let shape = 0;
  boxes.forEach((b, i) => {
    shape += shapeScore(ctx.settings.shape, ctx.settings.direction, centerOf(b), { boxes: boxes.slice(0, i), root, centroid, count: i, amount: boxes.length, contacts: 0 });
  });
  shape /= boxes.length;
  void st;
  const degree = new Map<string, number>(boxes.map((b) => [b.piece.id, 0]));
  for (const c of layout.contacts) {
    degree.set(c.a.piece.id, (degree.get(c.a.piece.id) ?? 0) + 1);
    degree.set(c.b.piece.id, (degree.get(c.b.piece.id) ?? 0) + 1);
  }
  const leaves = [...degree.values()].filter((d) => d <= 1).length / Math.max(1, boxes.length);
  const meanDeg = [...degree.values()].reduce((a, d) => a + d, 0) / Math.max(1, boxes.length);
  const knit = 1.4 * Math.min(1, meanDeg / 3) - 2.4 * Math.max(0, leaves - 0.25);
  return 3 * meanJ + 2 * seq + 1.5 * shape + knit + (layout.islands.length === 0 ? 1 : -2) + (layout.unreachable.length === 0 ? 1 : -1);
}

export function generateArrangement(ctx: GenContext, base: ArrangementDoc, opts: { target?: number; tries?: number } = {}): GenResult {
  const target = opts.target ?? ctx.settings.amount;
  const tries = opts.tries ?? 4;
  let best: { doc: ArrangementDoc; stopped: string | null; score: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const r = growOnce(ctx, base, target, ctx.settings.seed * 7919 + t * 104729 + 1);
    const score = assemblyScore(r.doc, ctx);
    if (!best || score > best.score) best = { ...r, score };
  }
  if (!best) return { doc: base, notes: ["nothing to generate"], score: 0, why: "" };
  const layout = analyzeLayout(best.doc, ctx.tileById, ctx.rules);
  const seq = buildSequence(layout, ctx.rules);
  const mean = layout.joints.filter((j) => j.score !== null);
  const avg = mean.length ? mean.reduce((a, j) => a + (j.score ?? 0), 0) / mean.length : 0;
  const notes: string[] = [];
  if (best.stopped) notes.push(best.stopped);
  const why = `${best.doc.pieces.length} pieces, ${ctx.settings.shape} shape, a route of ${seq.steps.length} spaces from the entrance, joints average ${avg.toFixed(0)}.`;
  return { doc: { ...best.doc, entranceId: best.doc.entranceId ?? layout.entranceId }, notes, score: best.score, why };
}

/** Removes the branch that grew past each bad joint (and everything only reachable through it, except locked pieces), then regrows. */
export function regenerateMarked(ctx: GenContext, doc: ArrangementDoc, badJointIds: Set<string>, target: number): GenResult {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const root = layout.entranceId ?? doc.pieces[0]?.id;
  const adj = new Map<string, string[]>();
  for (const b of layout.boxes) adj.set(b.piece.id, []);
  for (const c of layout.contacts) {
    adj.get(c.a.piece.id)!.push(c.b.piece.id);
    adj.get(c.b.piece.id)!.push(c.a.piece.id);
  }
  const depth = new Map<string, number>([[root, 0]]);
  const children = new Map<string, string[]>();
  const queue = [root];
  for (let i = 0; i < queue.length; i++)
    for (const n of adj.get(queue[i]) ?? []) if (!depth.has(n)) {
      depth.set(n, depth.get(queue[i])! + 1);
      children.set(queue[i], [...(children.get(queue[i]) ?? []), n]);
      queue.push(n);
    }
  const locked = new Set(doc.pieces.filter((p) => p.locked).map((p) => p.id));
  const remove = new Set<string>();
  for (const j of layout.joints) {
    if (!badJointIds.has(j.id)) continue;
    const child = (depth.get(j.aId) ?? 0) > (depth.get(j.bId) ?? 0) ? j.aId : j.bId;
    const stack = [child];
    while (stack.length) {
      const id = stack.pop()!;
      if (remove.has(id) || id === root) continue;
      remove.add(id);
      for (const c of children.get(id) ?? []) stack.push(c);
    }
  }
  // locked pieces stay, and so does the path that holds them
  for (const id of locked) {
    for (let cur: string | undefined = id; cur && remove.has(cur); ) {
      remove.delete(cur);
      cur = [...children.entries()].find(([, kids]) => kids.includes(cur!))?.[0];
    }
  }
  const kept: ArrangementDoc = { ...doc, pieces: doc.pieces.filter((p) => !remove.has(p.id)), ratings: Object.fromEntries(Object.entries(doc.ratings).filter(([k]) => !badJointIds.has(k))) };
  return generateArrangement(ctx, kept, { target: Math.max(target, kept.pieces.length + 1), tries: 3 });
}
