// Do two placed pieces collide? Their bounding boxes are only the quick test; the real one reads the cells they occupy.
//
// Where the boxes overlap, every cell claimed by both is one of:
//   outside-container cell of one piece   nothing happens. A notch, step or the empty side of an L is not the piece's: the
//                                         other piece may fill it. This is what lets shaped tiles nest.
//   solid on solid                        a collision. Always rejected (foam, floor plates and support branches all count).
//   solid in a carved space               a piece's material inside the other's room, passage or shaft: its container
//                                         interior is consumed. REJECTED BY DEFAULT: an arrangement may not fill an
//                                         intended room, so a neighbour can never block the space a tile was carved for.
//   void on void                          two containers' interiors interpenetrate. Also rejected by default: rooms stay
//                                         as the tiles define them. (Composition still unions such cells correctly if a
//                                         policy ever allows them.)
// The policy is conservative on purpose: the only way two pieces may share a box region is through outside-container cells.

import { boxesOverlap, nearPairs, type PlacedBox } from "./geometry";
import { SOLID, VOID } from "./occupancy";
import type { Vec3 } from "./types";

export interface CollisionPolicy {
  /** material inside another piece's carved space */
  consume: "reject" | "allow";
  /** void cells claimed by two pieces */
  sharedVoid: "reject" | "allow";
}

export const CONSERVATIVE: CollisionPolicy = { consume: "reject", sharedVoid: "reject" };

export interface Collision {
  aId: string;
  bId: string;
  /** cells where both pieces have material */
  solid: number;
  /** cells where one piece's material is inside the other's carved space */
  consumed: number;
  /** cells where both have void */
  shared: number;
  /** the boxes overlap (a nested fit when nothing above is non-zero) */
  nested: boolean;
  /** a few offending cells, world cells */
  sample: [number, number, number][];
}

/** How the two pieces' cells overlap, or null when their boxes do not overlap at all. `stopAt`: give up counting once this many cells conflict. */
export function collide(p: PlacedBox, q: PlacedBox, stopAt = Infinity): Collision | null {
  if (!boxesOverlap(p, q)) return null;
  const x0 = Math.max(p.min[0], q.min[0]);
  const x1 = Math.min(p.max[0], q.max[0]);
  const y0 = Math.max(p.min[1], q.min[1]);
  const y1 = Math.min(p.max[1], q.max[1]);
  const z0 = Math.max(p.min[2], q.min[2]);
  const z1 = Math.min(p.max[2], q.max[2]);
  const [, pny, pnz] = p.occ.dims;
  const [, qny, qnz] = q.occ.dims;
  const pc = p.occ.cls;
  const qc = q.occ.cls;
  const out: Collision = { aId: p.piece.id, bId: q.piece.id, solid: 0, consumed: 0, shared: 0, nested: true, sample: [] };
  let conflicts = 0;
  for (let x = x0; x < x1; x++)
    for (let y = y0; y < y1; y++) {
      let pi = ((x - p.min[0]) * pny + (y - p.min[1])) * pnz + (z0 - p.min[2]);
      let qi = ((x - q.min[0]) * qny + (y - q.min[1])) * qnz + (z0 - q.min[2]);
      for (let z = z0; z < z1; z++, pi++, qi++) {
        const a = pc[pi];
        const b = qc[qi];
        if (!a || !b) continue;
        if (a === SOLID && b === SOLID) out.solid++;
        else if (a === VOID && b === VOID) out.shared++;
        else out.consumed++;
        if (out.sample.length < 8) out.sample.push([x, y, z]);
        if (++conflicts >= stopAt) return out;
      }
    }
  return out;
}

export const violates = (c: Collision | null, policy: CollisionPolicy = CONSERVATIVE): boolean =>
  !!c && (c.solid > 0 || (c.consumed > 0 && policy.consume === "reject") || (c.shared > 0 && policy.sharedVoid === "reject"));

/** Every pair of pieces that collide, with the counts (pairs that merely share a box region without claiming a cell are not here). */
export function findCollisions(boxes: PlacedBox[]): Collision[] {
  const out: Collision[] = [];
  for (const [i, j] of nearPairs(boxes, 0)) {
    const c = collide(boxes[i], boxes[j]);
    if (c && c.solid + c.consumed + c.shared > 0) out.push({ ...c, aId: boxes[i].piece.id, bId: boxes[j].piece.id });
  }
  return out;
}

/** Pairs whose boxes overlap but whose cells do not: a nested fit. */
export function findNested(boxes: PlacedBox[]): [string, string][] {
  const out: [string, string][] = [];
  for (const [i, j] of nearPairs(boxes, 0)) {
    const c = collide(boxes[i], boxes[j]);
    if (c && c.solid + c.consumed + c.shared === 0) out.push([boxes[i].piece.id, boxes[j].piece.id]);
  }
  return out;
}

/** May `box` stand where it is next to `others`? (Used by the generator, the snapper and every edit: one rule everywhere.) */
export function placementFree(box: PlacedBox, others: PlacedBox[], policy: CollisionPolicy = CONSERVATIVE): boolean {
  for (const o of others) {
    if (o.piece.id === box.piece.id) continue;
    if (!boxesOverlap(box, o)) continue;
    if (violates(collide(box, o, 1), policy)) return false;
  }
  return true;
}

export const describeCollision = (c: Collision, cellFt3: number): string => {
  const bits: string[] = [];
  if (c.solid) bits.push(`${(c.solid * cellFt3).toFixed(1)} ft3 of material collides`);
  if (c.consumed) bits.push(`${(c.consumed * cellFt3).toFixed(1)} ft3 of a carved space is filled`);
  if (c.shared) bits.push(`${(c.shared * cellFt3).toFixed(1)} ft3 of space is claimed twice`);
  return bits.join(", ");
};

export type { Vec3 };
