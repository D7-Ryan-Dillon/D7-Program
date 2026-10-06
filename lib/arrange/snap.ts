// Smart snapping: the tidiness of a grid without being locked to one. Near another piece, a moved piece is offered
// positions in this order of strength:
//   flush      against a face of a neighbour (any face, any size of face)
//   openings   ...and slid sideways / up so the best-matching opening on each side lines up
//   floors     ...or slid up / down so a floor of this piece meets a floor of the neighbour (any level to any level)
//   grid       otherwise the nearest half-foot (or, in Lattice mode, the nearest 10 ft)
// Positions where the pieces would claim the same cells are never offered; boxes may overlap where the shapes nest
// (lib/arrange/collision.ts). "Flush" also means against a notch wall or a step, not only a face of the box.

import type { ParsedTile } from "@/lib/types";
import { placeBox, snapVec, toCell, toFt, type PlacedBox } from "./geometry";
import { placementFree } from "./collision";
import { getOcc } from "./occupancy";
import { getFacts, getOriented, orientedDims, type FaceKey } from "./orient";
import { ARRANGE_CELL, type Piece, type Site, type Vec3 } from "./types";

export type SnapRule = "flush" | "openings" | "floors" | "grid" | "lattice";

export interface SnapResult {
  pos: Vec3;
  rule: SnapRule;
  /** the piece it snapped against */
  touching: string | null;
}

export interface SnapOptions {
  lattice: boolean;
  /** how near (ft) a flush position must be to be offered */
  radiusFt: number;
  site?: Site;
}

const LATTICE_FT = 10;
const OPENINGS_BONUS_FT = 1.5;
const FLOORS_BONUS_FT = 1.0;

const faceOn = (axis: number, plus: boolean): FaceKey => (["x", "y", "z"][axis] + (plus ? "+" : "-")) as FaceKey;

/** Candidate positions flush against `q` for a piece of the given tile / orientation, near `want` (cells). */
export function flushCandidates(piece: Piece, tile: ParsedTile, q: PlacedBox, want: [number, number, number], radiusCells: number): { min: [number, number, number]; rule: SnapRule }[] {
  const dims = orientedDims(tile, piece.rotZ, piece.scale);
  const mine = getFacts(tile, piece.rotZ, piece.mirrorX, piece.scale);
  const theirs = getFacts(q.tile, q.piece.rotZ, q.piece.mirrorX, q.piece.scale);
  const out: { min: [number, number, number]; rule: SnapRule }[] = [];
  const myOcc = getOcc(getOriented(tile, piece.rotZ, piece.mirrorX, piece.scale));
  for (const axis of [0, 1, 2] as const) {
    for (const plus of [true, false]) {
      // the planes the two pieces can meet on along this axis: the box faces, and every opening plane of a notch or step of either piece
      const flushes = new Set<number>([plus ? q.max[axis] : q.min[axis] - dims[axis]]);
      for (const qf of q.occ.features[faceOn(axis, plus)].slice(0, 3)) for (const mf of myOcc.features[faceOn(axis, !plus)].slice(0, 3)) flushes.add(q.min[axis] + qf.plane - mf.plane);
      for (const flush of flushes) {
      if (Math.abs(want[axis] - flush) > radiusCells) continue;
      const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      const myFace = faceOn(axis, !plus);
      const qFace = faceOn(axis, plus);
      const lat = (o: number): { v: number; rule: SnapRule }[] => {
        const vals: { v: number; rule: SnapRule }[] = [];
        const lo = q.min[o] - dims[o] + 1;
        const hi = q.max[o] - 1;
        vals.push({ v: Math.min(hi, Math.max(lo, want[o])), rule: "flush" });
        vals.push({ v: q.min[o], rule: "flush" });
        vals.push({ v: q.max[o] - dims[o], rule: "flush" });
        vals.push({ v: Math.round((q.min[o] + q.max[o] - dims[o]) / 2), rule: "flush" });
        // opening alignment: the biggest opening on each facing face, centroid to centroid
        for (const mp of mine.patches[myFace].slice(0, 2))
          for (const qp of theirs.patches[qFace].slice(0, 2)) {
            const mc = o === o1 ? mp.cu : mp.cv;
            const qc = o === o1 ? qp.cu : qp.cv;
            vals.push({ v: Math.round(q.min[o] + qc - mc), rule: "openings" });
          }
        // floors: a floor of this piece at the height of a floor of the neighbour (side contacts only; o2 is z)
        if (axis !== 2 && o === 2)
          for (const lp of mine.levelsZ) for (const lq of theirs.levelsZ) vals.push({ v: q.min[2] + lq - lp, rule: "floors" });
        return vals;
      };
      const l1 = lat(o1);
      const l2 = lat(o2);
      for (const a of l1)
        for (const b of l2) {
          const min: [number, number, number] = [0, 0, 0];
          min[axis] = flush;
          min[o1] = a.v;
          min[o2] = b.v;
          // overlapping rectangles are needed for the two to touch at all
          if (a.v >= q.max[o1] || a.v + dims[o1] <= q.min[o1] || b.v >= q.max[o2] || b.v + dims[o2] <= q.min[o2]) continue;
          const rule: SnapRule = a.rule === "openings" || b.rule === "openings" ? "openings" : a.rule === "floors" || b.rule === "floors" ? "floors" : "flush";
          out.push({ min, rule });
        }
      }
    }
  }
  return out;
}

export function snapPosition(piece: Piece, tile: ParsedTile, others: PlacedBox[], proposed: Vec3, opts: SnapOptions): SnapResult {
  const grid = snapVec(proposed);
  if (opts.lattice) {
    const r = (v: number) => Math.round(v / LATTICE_FT) * LATTICE_FT;
    return { pos: [r(proposed[0]), r(proposed[1]), r(proposed[2])], rule: "lattice", touching: null };
  }
  const dims = orientedDims(tile, piece.rotZ, piece.scale);
  const want: [number, number, number] = [toCell(proposed[0]), toCell(proposed[1]), toCell(proposed[2])];
  const radiusCells = toCell(opts.radiusFt);
  const inside = (min: [number, number, number]): boolean => {
    const s = opts.site;
    if (!s?.enabled) return true;
    return min[0] >= toCell(s.min[0]) && min[1] >= toCell(s.min[1]) && min[0] + dims[0] <= toCell(s.min[0] + s.size[0]) && min[1] + dims[1] <= toCell(s.min[1] + s.size[1]);
  };
  const free = (min: [number, number, number]) => placementFree(placeBox({ ...piece, pos: [toFt(min[0]), toFt(min[1]), toFt(min[2])] }, tile), others);

  let best: SnapResult | null = null;
  let bestCost = Infinity;
  for (const q of others) {
    for (const c of flushCandidates(piece, tile, q, want, radiusCells)) {
      if (!free(c.min) || !inside(c.min)) continue;
      const d = Math.hypot(c.min[0] - want[0], c.min[1] - want[1], c.min[2] - want[2]) * ARRANGE_CELL;
      const bonus = c.rule === "openings" ? OPENINGS_BONUS_FT : c.rule === "floors" ? FLOORS_BONUS_FT : 0;
      const cost = d - bonus;
      if (cost < bestCost) {
        bestCost = cost;
        best = { pos: [toFt(c.min[0]), toFt(c.min[1]), toFt(c.min[2])], rule: c.rule, touching: q.piece.id };
      }
    }
  }
  if (best && bestCost <= opts.radiusFt) return best;
  return { pos: grid, rule: "grid", touching: null };
}

export const RULE_LABEL: Record<SnapRule, string> = {
  flush: "flush against a neighbour",
  openings: "openings lined up",
  floors: "floors meeting",
  grid: "free",
  lattice: "lattice",
};

