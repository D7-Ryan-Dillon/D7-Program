// The candidate machinery behind "suggest next", "fill the gap" and "auto replace" (lib/arrange/suggest.ts): one new piece laid against an opening of a piece
// that is already there, checked (no collision, the rules, a walkable route from a floor that can be reached) and scored. The whole-building generator
// (lib/arrange/generate.ts) does not use it: it lays pieces on the 10 ft lattice and searches (lib/arrange/patterns.ts, lib/arrange/pairs.ts).

import type { ParsedTile } from "@/lib/types";
import { connectJoint } from "./connectors";
import { boundsOfBoxes, contactsBetween, placeBox, toFt, type PlacedBox } from "./geometry";
import { placementFree } from "./collision";
import { groupByPair, jointFromContacts } from "./joints";
import { analyzeLayout, boxesFor, exposedPatches, type Exposed, type Layout } from "./layout";
import { categoryOf, FACE_AXIS, getFacts, getOriented, OPPOSITE } from "./orient";
import { getOcc, getWalk } from "./occupancy";
import { ruleBetween, ruleValue, supportFraction } from "./program";
import { buildSequence } from "./whole";
import { connectorReachFt, type ArrangementDoc, type GenSettings, type Joint, type Piece, type Priorities, type ProgramRules, type Site } from "./types";

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

const STOREY_CELLS = 20; // 10 ft

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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
): Candidate | null {
  const parent = st.boxes.find((b) => b.piece.id === slot.pieceId);
  if (!parent) return null;
  const o = getOriented(tile, rot, mirror, 1);
  const occ = getOcc(o);
  const myFace = OPPOSITE[slot.face];
  const myOpenings = occ.features[myFace];
  if (!myOpenings.length) return null;
  const q = myOpenings.length ? myOpenings[Math.min(patchPick, myOpenings.length - 1)] : undefined;
  const dims = o.dims;
  const axis = FACE_AXIS[slot.face];
  const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const min: [number, number, number] = [0, 0, 0];
  if (q) {
    // along the axis: the new piece's opening plane lies on the slot's plane (a box face of either piece, or the wall of a notch)
    min[axis] = slot.plane - q.plane;
    const sp = slot.patch;
    min[o1] = Math.round(parent.min[o1] + anchor(align % 3, sp.u0, sp.u1, sp.cu, q.u0, q.u1, q.cu));
    min[o2] = Math.round(parent.min[o2] + anchor(Math.floor(align / 3) % 3, sp.v0, sp.v1, sp.cv, q.v0, q.v1, q.cv));
  }
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
    return null;
  }
  const piece: Piece = { id: "candidate", tileId: tile.id, pos: [toFt(min[0]), toFt(min[1]), toFt(min[2])], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
  const box = placeBox(piece, tile);
  // the cells decide, not the boxes: boxes may overlap where the shapes nest
  if (!placementFree(box, st.boxes)) {
    return null;
  }
  const all = boundsOfBoxes([...st.boxes, box])!;
  const l = ctx.rules.limits;
  if ((l.maxHeightFt > 0 && toFt(all.max[2] - all.min[2]) > l.maxHeightFt + 1e-6) || (l.maxFootprintFt > 0 && Math.max(toFt(all.max[0] - all.min[0]), toFt(all.max[1] - all.min[1])) > l.maxFootprintFt + 1e-6)) {
    return null;
  }

  const tol = connectorReachFt(ctx.rules);
  const withMe = [...st.boxes, box];
  // the joint with the piece it attaches to comes first: most candidates fail there, and the rest of the neighbours are only read for those that do not
  const parentContacts = contactsBetween(box, parent);
  if (!parentContacts.length) return null;
  const primary = jointFromContacts(parentContacts, withMe, tol);
  if (ruleBetween(ctx.rules, tile, parent.tile, primary.axis === 2) === "never") {
    return null;
  }
  // a walkable route from a floor that can already be reached into the new piece's own main floor (not into a pocket of it)
  const wk = getWalk(box.occ);
  let route = primary.connect.crossings.some((x) => {
    const mine = x.aId === "candidate" ? x.zoneA : x.bId === "candidate" ? x.zoneB : -1;
    const theirs = x.aId === "candidate" ? `${x.bId}#${x.zoneB}` : `${x.aId}#${x.zoneA}`;
    return mine === wk.main && (!st.reached || st.reached.has(theirs));
  });
  // floors a doorway apart: with connectors switched on, a stair or ramp built into the lower room may make the way (lib/arrange/connectors.ts)
  if (!route && ctx.rules.autoConnectors && primary.connect.kind === "connector") {
    const via = connectJoint(withMe, primary, ctx.rules);
    if (via) {
      const made = via.made[0];
      const cand = via.boxes.find((b) => b.piece.id === "candidate")!;
      const par = via.boxes.find((b) => b.piece.id === parent.piece.id)!;
      const cs = contactsBetween(cand, par);
      if (cs.length) {
        const j2 = jointFromContacts(cs, via.boxes, tol);
        const candMain = getWalk(cand.occ).main;
        route = j2.connect.crossings.some((x) => {
          const mine = x.aId === "candidate" ? x.zoneA : x.bId === "candidate" ? x.zoneB : -1;
          const theirsZone = x.aId === "candidate" ? x.zoneB : x.zoneA;
          const theirs = made.hostId === parent.piece.id ? `${parent.piece.id}#${made.hostZoneBefore}` : `${parent.piece.id}#${theirsZone}`;
          return mine === candMain && (!st.reached || st.reached.has(theirs));
        });
      }
    }
  }
  if (!route) {
    return null;
  }
  if ((primary.score ?? 0) < minScore) {
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
      return null;
    }
    joints.push(j);
  }
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
  // knit: a piece that touches several neighbours is part of the mass; a piece on one joint is a stub
  parts.knit = clamp01((c.neighbors.length - 1) / 2);
  // tuck: how much the bounding box has to grow to take the piece (a piece out on its own makes a long thin reach)
  const before = boundsOfBoxes(st.boxes)!;
  const volBefore = (before.max[0] - before.min[0]) * (before.max[1] - before.min[1]) * (before.max[2] - before.min[2]);
  const pieceVol = c.box.occ.inside;
  parts.tuck = 1 / (1 + Math.max(0, volBox - volBefore) / Math.max(1, pieceVol) / 1.5);
  const order = ctx.rules.sequenceOrder;
  const pa = order.indexOf(categoryOf(st.boxes.find((b) => b.piece.id === (c.primary.aId === "candidate" ? c.primary.bId : c.primary.aId))!.tile) as never);
  const na = order.indexOf(categoryOf(c.box.tile) as never);
  parts.sequence = pa < 0 || na < 0 ? 0.6 : na > pa ? 1 : na === pa ? 0.7 : 0.4;
  c.parts = parts;
  // joint quality, floors that meet floors, a connected route, a readable sequence and a knitted, supported mass are always on; the sliders add to them
  return (
    3 * parts.joint +
    2 * parts.floors +
    1.6 * parts.knit +
    1.3 * parts.tuck +
    1.5 * parts.sequence +
    parts.structure +
    w(p.program) * parts.program +
    w(p.compact) * 1.5 * parts.compactness +
    w(p.varied) * parts.variety +
    w(p.tall) * parts.vertical
  );
}

/** How good a finished arrangement is as a whole (used to keep the best of a few tries). */
export function assemblyScore(doc: ArrangementDoc, ctx: GenContext): number {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const js = layout.joints.filter((j) => j.score !== null);
  const meanJ = js.length ? js.reduce((a, j) => a + (j.score ?? 0), 0) / js.length / 100 : 0;
  const seq = buildSequence(layout, ctx.rules).quality / 100;
  const boxes = layout.boxes;
  const degree = new Map<string, number>(boxes.map((b) => [b.piece.id, 0]));
  for (const j of layout.joints) {
    degree.set(j.aId, (degree.get(j.aId) ?? 0) + 1);
    degree.set(j.bId, (degree.get(j.bId) ?? 0) + 1);
  }
  const leaves = [...degree.values()].filter((d) => d <= 1).length / Math.max(1, boxes.length);
  const meanDeg = [...degree.values()].reduce((a, d) => a + d, 0) / Math.max(1, boxes.length);
  const knit = 1.4 * Math.min(1, meanDeg / 3) - 2.4 * Math.max(0, leaves - 0.25);
  return 3 * meanJ + 2 * seq + knit + (layout.islands.length === 0 ? 1 : -2) + (layout.unreachable.length === 0 ? 1 : -1) - 2 * layout.overlaps.length;
}

