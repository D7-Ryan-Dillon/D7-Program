// The generator. It grows ONE arrangement from an entrance outwards: every new piece attaches to an opening of a piece
// already placed and must make a walkable joint there, so the result is always a single connected building (the
// connected rule is built in, not checked afterwards). Choices are scored on the always-on goals (joint quality, a
// connected route, a readable sequence) plus the user's priorities and the chosen shape, and picked with a seeded random
// nudge so the same seed and settings give the same result.
//
// Interlocking: a piece is placed against an OPENING on the container surface of a piece already there. That surface need not
// be a face of the bounding box: the wall of a notch, a recess or a step carries openings too, and a candidate is built by laying
// one of the new piece's own openings (any orientation, mirror, lateral anchor and floor level) on the slot's plane, so
// the new piece's box may overlap the old one's when their cells fit (lib/arrange/collision.ts). A candidate is kept only when
// no material collides or fills a carved space, the rules and limits hold, and a person could walk from a floor that is already
// reachable from the entrance into the new piece's main floor (lib/arrange/walk.ts).
//
// The same candidate machinery serves "suggest next", "fill the gap" and "auto replace" (lib/arrange/suggest.ts).

import type { ParsedTile } from "@/lib/types";
import { boundsOfBoxes, boxesOverlap, contactsBetween, placeBox, toCell, toFt, type PlacedBox } from "./geometry";
import { placementFree } from "./collision";
import { groupByPair, jointFromContacts } from "./joints";
import { analyzeLayout, boxesFor, exposedPatches, type Exposed, type Layout } from "./layout";
import { categoryOf, FACE_AXIS, getFacts, getOriented, isPlaceable, OPPOSITE } from "./orient";
import { getOcc, getWalk } from "./occupancy";
import { ruleBetween, ruleValue, supportFraction } from "./program";
import { mulberry32 } from "./rng";
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
  /** wall-clock budget for one Generate (ms): the search stops and keeps the best so far. Default 6000. */
  budgetMs?: number;
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
  /** the pieces it touches */
  neighbors: PlacedBox[];
}

const RELAX = [1, 0.75, 0.5, 0];
const STOREY_CELLS = 20; // 10 ft
const TOP_K = 3;
const ATTEMPTS = 700;

/** Why candidates were turned down (all steps of a run), to say what is stopping the search. */
export interface Rejections {
  tried: number;
  noOpening: number;
  collided: number;
  site: number;
  limits: number;
  rule: number;
  noRoute: number;
  weak: number;
  accepted: number;
}
export const newRejections = (): Rejections => ({ tried: 0, noOpening: 0, collided: 0, site: 0, limits: 0, rule: 0, noRoute: 0, weak: 0, accepted: 0 });

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
  /** floors (piece#zone) a person can reach from the entrance in the arrangement as it stands; null = not known (no check) */
  reached: Set<string> | null;
  /** the arrangement as it stands, read (null when the reach was not asked for) */
  layout: Layout | null;
}

export function stateOf(pieces: Piece[], ctx: GenContext, withReach = true, entranceId: string | null = null): State {
  const boxes = boxesFor(pieces, ctx.tileById);
  const copies = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const b of boxes) {
    copies.set(b.piece.tileId, (copies.get(b.piece.tileId) ?? 0) + 1);
    cats.set(categoryOf(b.tile), (cats.get(categoryOf(b.tile)) ?? 0) + 1);
  }
  let reached: Set<string> | null = null;
  let exposed: Exposed[];
  let layout: Layout | null = null;
  if (withReach && boxes.length) {
    layout = analyzeLayout({ pieces, entranceId, names: {}, ratings: {} }, ctx.tileById, ctx.rules);
    reached = layout.reachedZones;
    exposed = layout.exposed;
  } else exposed = exposedPatches(boxes);
  return { pieces, boxes, exposed, copies, cats, reached, layout };
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

/** How a new piece's opening is laid on the slot's opening: centre to centre, low edge to low edge, or high edge to high edge. */
const anchor = (code: number, slotLo: number, slotHi: number, slotC: number, myLo: number, myHi: number, myC: number): number => (code === 1 ? slotLo - myLo : code === 2 ? slotHi - myHi : slotC - myC);

/** Builds one candidate placement of `tile` (orientation rot / mirror) against `slot`, or null when it does not work. `align` (0-8) picks the lateral anchors, `levelPick` the vertical choice. */
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
  align = 0,
  why?: Rejections,
): Candidate | null {
  if (why) why.tried++;
  const parent = st.boxes.find((b) => b.piece.id === slot.pieceId);
  if (!parent) return null;
  const o = getOriented(tile, rot, mirror, 1);
  const occ = getOcc(o);
  const myFace = OPPOSITE[slot.face];
  const myOpenings = occ.features[myFace];
  if (!myOpenings.length) {
    if (why) why.noOpening++;
    return null;
  }
  const q = myOpenings[Math.min(patchPick, myOpenings.length - 1)];
  const dims = o.dims;
  const axis = FACE_AXIS[slot.face];
  const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const min: [number, number, number] = [0, 0, 0];
  // along the axis: the new piece's opening plane lies on the slot's plane (a box face of either piece, or the wall of a notch)
  min[axis] = slot.plane - q.plane;
  const sp = slot.patch;
  min[o1] = Math.round(parent.min[o1] + anchor(align % 3, sp.u0, sp.u1, sp.cu, q.u0, q.u1, q.cu));
  min[o2] = Math.round(parent.min[o2] + anchor(Math.floor(align / 3) % 3, sp.v0, sp.v1, sp.cv, q.v0, q.v1, q.cv));
  if (levelPick !== null && axis !== 2) {
    // vertical choices beyond "opening to opening": a storey up or down (floor 1 meets floor 2), or any floor of this piece to any floor of the neighbour
    const facts = getFacts(tile, rot, mirror, 1);
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
  if (!inSite(ctx.site, min, max)) {
    if (why) why.site++;
    return null;
  }
  const piece: Piece = { id: "candidate", tileId: tile.id, pos: [toFt(min[0]), toFt(min[1]), toFt(min[2])], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
  const box = placeBox(piece, tile);
  // the cells decide, not the boxes: boxes may overlap where the shapes nest
  if (!placementFree(box, st.boxes)) {
    if (why) why.collided++;
    return null;
  }
  const all = boundsOfBoxes([...st.boxes, box])!;
  const l = ctx.rules.limits;
  if ((l.maxHeightFt > 0 && toFt(all.max[2] - all.min[2]) > l.maxHeightFt + 1e-6) || (l.maxFootprintFt > 0 && Math.max(toFt(all.max[0] - all.min[0]), toFt(all.max[1] - all.min[1])) > l.maxFootprintFt + 1e-6)) {
    if (why) why.limits++;
    return null;
  }

  const tol = toleranceFt(ctx.rules);
  const withMe = [...st.boxes, box];
  // the joint with the piece it attaches to comes first: most candidates fail there, and the rest of the neighbours are only read for those that do not
  const parentContacts = contactsBetween(box, parent);
  if (!parentContacts.length) return null;
  const primary = jointFromContacts(parentContacts, withMe, tol);
  if (ruleBetween(ctx.rules, tile, parent.tile, primary.axis === 2) === "never") {
    if (why) why.rule++;
    return null;
  }
  // a walkable route from a floor that can already be reached into the new piece's own main floor (not into a pocket of it)
  const wk = getWalk(box.occ);
  const route = primary.connect.crossings.some((x) => {
    const mine = x.aId === "candidate" ? x.zoneA : x.bId === "candidate" ? x.zoneB : -1;
    const theirs = x.aId === "candidate" ? `${x.bId}#${x.zoneB}` : `${x.aId}#${x.zoneA}`;
    return mine === wk.main && (!st.reached || st.reached.has(theirs));
  });
  if (!route) {
    if (why) why.noRoute++;
    return null;
  }
  if ((primary.score ?? 0) < minScore) {
    if (why) why.weak++;
    return null;
  }
  const neighbors: PlacedBox[] = [parent];
  const joints: Joint[] = [primary];
  const contacts = [];
  for (const b of st.boxes) {
    if (b === parent || box.max[0] < b.min[0] || b.max[0] < box.min[0] || box.max[1] < b.min[1] || b.max[1] < box.min[1] || box.max[2] < b.min[2] || b.max[2] < box.min[2]) continue;
    const cs = contactsBetween(box, b);
    if (!cs.length) continue;
    neighbors.push(b);
    contacts.push(...cs);
  }
  for (const g of groupByPair(contacts)) {
    const j = jointFromContacts(g, withMe, tol);
    const other = st.boxes.find((b) => b.piece.id === (j.aId === "candidate" ? j.bId : j.aId))!;
    if (ruleBetween(ctx.rules, tile, other.tile, j.axis === 2) === "never") {
      if (why) why.rule++;
      return null;
    }
    joints.push(j);
  }
  if (why) why.accepted++;
  return { piece, box, primary, joints, slot, score: 0, parts: {}, neighbors };
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
  const mine = exposedPatches([...c.neighbors, c.box]).filter((e) => e.pieceId === "candidate");
  const sideFaces = new Set(mine.filter((e) => FACE_AXIS[e.face] !== 2).map((e) => e.face));
  parts.daylight = clamp01(mine.filter((e) => FACE_AXIS[e.face] !== 2).length / 3) * 0.6 + clamp01(sideFaces.size / 3) * 0.2 + (mine.some((e) => e.face === "z+") ? 0.2 : 0);
  const all = boundsOfBoxes([...st.boxes, c.box])!;
  const volBox = (all.max[0] - all.min[0]) * (all.max[1] - all.min[1]) * (all.max[2] - all.min[2]);
  // the cells really occupied (nested pieces share boxes: counting boxes would count the empty notches twice)
  let vol = 0;
  for (const b of [...st.boxes, c.box]) vol += b.occ.inside;
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
  parts.knit = clamp01((c.neighbors.length - 1) / 2);
  // tuck: how much the bounding box has to grow to take the piece (a piece out on its own makes a long thin reach)
  const before = boundsOfBoxes(st.boxes)!;
  const volBefore = (before.max[0] - before.min[0]) * (before.max[1] - before.min[1]) * (before.max[2] - before.min[2]);
  const pieceVol = c.box.occ.inside;
  parts.tuck = 1 / (1 + Math.max(0, volBox - volBefore) / Math.max(1, pieceVol) / 1.5);
  // fit: how much of the new piece's own surface lies against something useful (matched openings and meeting structure), and how far it sits
  // inside its neighbours' bounding boxes (a nested fit); the overlap of boxes alone earns nothing, only the interface cells do
  const surfaceFt2 = Math.max(1, c.box.occ.faces * 0.25);
  const touching = c.joints.reduce((a, j) => a + j.connect.contactFt2, 0);
  const matched = c.joints.reduce((a, j) => a + j.connect.voidFt2, 0);
  let inside = 0;
  for (const b of c.neighbors) {
    const ox = Math.min(b.max[0], c.box.max[0]) - Math.max(b.min[0], c.box.min[0]);
    const oy = Math.min(b.max[1], c.box.max[1]) - Math.max(b.min[1], c.box.min[1]);
    const oz = Math.min(b.max[2], c.box.max[2]) - Math.max(b.min[2], c.box.min[2]);
    if (ox > 0 && oy > 0 && oz > 0) inside += ox * oy * oz;
  }
  const nestShare = clamp01(inside / Math.max(1, c.box.occ.dims[0] * c.box.occ.dims[1] * c.box.occ.dims[2]));
  parts.nesting = clamp01(0.55 * clamp01(touching / (surfaceFt2 * 0.5)) + 0.25 * clamp01(matched / 40) + 0.45 * nestShare);
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
    w(p.structure) * parts.structure +
    w(p.nesting ?? 50) * 1.4 * parts.nesting
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

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** One step: the candidates found in a random sample, the one picked (among the top few by score) first and the rest best first; empty when nothing fits. */
function step(ctx: GenContext, st: State, rng: () => number, minScore: number, total: number, why: Rejections, deadline: number): Candidate[] {
  const found: Candidate[] = [];
  for (let k = 0; k < ATTEMPTS && found.length < 60; k++) {
    if ((k & 31) === 31 && now() > deadline && found.length) break;
    const slot = pickSlot(st, rng);
    const tile = slot && pickTile(ctx, st, rng, total);
    if (!slot || !tile) break;
    const c = placeAgainst(ctx, st, slot, tile, Math.floor(rng() * 4), rng() < 0.5, Math.floor(rng() * 3), pickLevel(rng), minScore, Math.floor(rng() * 9), why);
    if (c) {
      c.score = scoreCandidate(ctx, st, c) + rng() * 0.15;
      found.push(c);
    }
  }
  if (!found.length) return [];
  found.sort((a, b) => b.score - a.score);
  // a seeded nudge among the best few, strongly favouring the best
  const pool = found.slice(0, TOP_K);
  const weights = pool.map((c) => Math.exp((c.score - pool[0].score) * 2.5));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  let pick = pool[0];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      pick = pool[i];
      break;
    }
  }
  return [pick, ...found.filter((c) => c !== pick)];
}

// ---- the whole run ---------------------------------------------------------------------------------------------------

export interface GenResult {
  doc: ArrangementDoc;
  notes: string[];
  score: number;
  /** one line on why this result */
  why: string;
  /** what the search turned down, over the whole run */
  rejections?: Rejections;
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

/** A sentence on what stopped the search: the most common reason candidates were turned down. */
export function explainRejections(r: Rejections, bank: ParsedTile[]): string {
  if (!r.tried) return "no opening was free to build on";
  const pct = (n: number) => `${Math.round((100 * n) / r.tried)}%`;
  const reasons: [string, number][] = [
    ["would collide with, or fill a room of, a piece already there", r.collided],
    ["had no opening of the right kind to meet", r.noOpening],
    ["met no walkable floor (no floor to stand on, too narrow or low, or a pocket)", r.noRoute],
    ["broke a program rule", r.rule],
    ["fell outside the site", r.site],
    ["went over a height or footprint limit", r.limits],
    ["joined too weakly", r.weak],
  ];
  reasons.sort((a, b) => b[1] - a[1]);
  const top = reasons.filter((x) => x[1] > 0).slice(0, 2).map(([t, n]) => `${pct(n)} ${t}`);
  return `${r.tried} placements tried across ${bank.length} tiles: ${top.join("; ") || "none fitted"}`;
}

function growOnce(ctx: GenContext, base: ArrangementDoc, target: number, seed: number, why: Rejections, deadline: number): { doc: ArrangementDoc; stopped: string | null } {
  const rng = mulberry32(seed);
  let doc = base;
  if (!doc.pieces.length) {
    const r = rootPiece(ctx, rng, doc);
    if (!r) return { doc, stopped: "no tile in the bank can be placed" };
    doc = { ...doc, pieces: [r], entranceId: r.id };
  }
  let stopped: string | null = null;
  while (doc.pieces.length < target) {
    if (now() > deadline) {
      stopped = `stopped at ${doc.pieces.length} of ${target}: the time allowed for one search ran out`;
      break;
    }
    const st = stateOf(doc.pieces, ctx, true, doc.entranceId);
    let chosen: Candidate | null = null;
    let next: ArrangementDoc | null = null;
    for (const f of RELAX) {
      const options = step(ctx, st, rng, ctx.settings.minScore * f, doc.pieces.length, why, deadline);
      // a new piece may take the clearance away from a route that was already there: keep the first option that leaves the arrangement valid
      for (const o of options.slice(0, 6)) {
        const trial: ArrangementDoc = { ...doc, pieces: [...doc.pieces, { ...o.piece, id: newPieceId(doc) }] };
        const l = analyzeLayout(trial, ctx.tileById, ctx.rules);
        if (l.overlaps.length === 0 && l.islands.length === 0 && l.unreachable.length <= (st.layout?.unreachable.length ?? 0)) {
          chosen = o;
          next = trial;
          break;
        }
        why.noRoute++;
      }
      if (chosen) break;
    }
    if (!chosen || !next) {
      stopped = `stopped at ${doc.pieces.length} of ${target}: nothing else fits within the rules`;
      break;
    }
    doc = next;
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
  const degree = new Map<string, number>(boxes.map((b) => [b.piece.id, 0]));
  for (const j of layout.joints) {
    degree.set(j.aId, (degree.get(j.aId) ?? 0) + 1);
    degree.set(j.bId, (degree.get(j.bId) ?? 0) + 1);
  }
  const leaves = [...degree.values()].filter((d) => d <= 1).length / Math.max(1, boxes.length);
  const meanDeg = [...degree.values()].reduce((a, d) => a + d, 0) / Math.max(1, boxes.length);
  const knit = 1.4 * Math.min(1, meanDeg / 3) - 2.4 * Math.max(0, leaves - 0.25);
  return 3 * meanJ + 2 * seq + 1.5 * shape + knit + (layout.islands.length === 0 ? 1 : -2) + (layout.unreachable.length === 0 ? 1 : -1) - 2 * layout.overlaps.length;
}

export function generateArrangement(ctx: GenContext, base: ArrangementDoc, opts: { target?: number; tries?: number } = {}): GenResult {
  const target = opts.target ?? ctx.settings.amount;
  const tries = opts.tries ?? 4;
  const why = newRejections();
  const budget = ctx.budgetMs ?? 6000;
  const t0 = now();
  let best: { doc: ArrangementDoc; stopped: string | null; score: number } | null = null;
  for (let t = 0; t < tries; t++) {
    // each try gets its share of what is left; the first try always gets to finish what it can
    const deadline = t0 + (budget * (t + 1)) / tries;
    const r = growOnce(ctx, base, target, ctx.settings.seed * 7919 + t * 104729 + 1, why, deadline);
    const score = assemblyScore(r.doc, ctx);
    if (!best || score > best.score) best = { ...r, score };
    if (now() > t0 + budget) break;
  }
  if (!best) return { doc: base, notes: ["nothing to generate"], score: 0, why: "" };
  const layout = analyzeLayout(best.doc, ctx.tileById, ctx.rules);
  const seq = buildSequence(layout, ctx.rules);
  const mean = layout.joints.filter((j) => j.score !== null);
  const avg = mean.length ? mean.reduce((a, j) => a + (j.score ?? 0), 0) / mean.length : 0;
  const notes: string[] = [];
  if (best.stopped) {
    notes.push(best.stopped);
    notes.push(`The tile bank could not satisfy the constraints for the rest: ${explainRejections(why, ctx.bank)}.`);
  }
  const nestedCount = layout.nested.length;
  const whyLine = `${best.doc.pieces.length} pieces, ${ctx.settings.shape} shape, a route of ${seq.steps.length} spaces from the entrance, joints average ${avg.toFixed(0)}${nestedCount ? `, ${nestedCount} nested fit${nestedCount === 1 ? "" : "s"}` : ""}.`;
  return { doc: { ...best.doc, entranceId: best.doc.entranceId ?? layout.entranceId }, notes, score: best.score, why: whyLine, rejections: why };
}

/** Removes the branch that grew past each bad joint (and everything only reachable through it, except locked pieces), then regrows. */
export function regenerateMarked(ctx: GenContext, doc: ArrangementDoc, badJointIds: Set<string>, target: number): GenResult {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const root = layout.entranceId ?? doc.pieces[0]?.id;
  const adj = new Map<string, string[]>();
  for (const b of layout.boxes) adj.set(b.piece.id, []);
  for (const j of layout.joints) {
    adj.get(j.aId)!.push(j.bId);
    adj.get(j.bId)!.push(j.aId);
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

export { boxesOverlap };
