// For every pair of tiles, how well they meet: the best joint score of the second tile beside the first (over its eight
// orientations and a few ways of lining the openings and floors up). Click a cell in the Arrange tab to add that pair.

import type { ParsedTile } from "@/lib/types";
import { contactBetween, placeBox, toFt } from "./geometry";
import { jointFromContact } from "./joints";
import { getFacts, isPlaceable } from "./orient";
import type { Piece, Vec3 } from "./types";

export interface PairCell {
  score: number | null;
  /** how to place the second tile relative to the first (the first stands at the origin, unturned) */
  rotZ: number;
  mirrorX: boolean;
  pos: Vec3;
}

export interface PairMatrix {
  tiles: ParsedTile[];
  cells: PairCell[][];
}

export function bestPair(a: ParsedTile, b: ParsedTile, tolFt = 1.5): PairCell {
  const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
  const boxA = placeBox(pa, a);
  const fa = getFacts(a, 0, false, 1);
  let best: PairCell = { score: null, rotZ: 0, mirrorX: false, pos: [toFt(boxA.max[0]), 0, 0] };
  let bestV = -1;
  for (let rot = 0; rot < 4; rot++)
    for (const mirror of [false, true]) {
      const fb = getFacts(b, rot, mirror, 1);
      const offsets: [number, number][] = [[0, 0]];
      const pa0 = fa.patches["x+"][0];
      const pb0 = fb.patches["x-"][0];
      if (pa0 && pb0) offsets.push([Math.round(pa0.cu - pb0.cu), Math.round(pa0.cv - pb0.cv)]);
      for (const lp of fa.levelsZ) for (const lq of fb.levelsZ) offsets.push([0, lp - lq]);
      for (const [dy, dz] of offsets) {
        const pb: Piece = { id: "b", tileId: b.id, pos: [toFt(boxA.max[0]), toFt(dy), toFt(dz)], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
        const boxB = placeBox(pb, b);
        const c = contactBetween(boxA, boxB);
        if (!c) continue;
        const j = jointFromContact(c, tolFt);
        const v = j.score === null ? -0.5 : j.score;
        if (v > bestV) {
          bestV = v;
          best = { score: j.score, rotZ: rot, mirrorX: mirror, pos: pb.pos };
        }
      }
    }
  return best;
}

export function pairMatrix(tiles: ParsedTile[]): PairMatrix {
  // assemblies are whole buildings, not parts: they are left out of the matrix
  const list = tiles.filter((t) => isPlaceable(t) && t.meta?.category !== "assembly");
  return { tiles: list, cells: list.map((a) => list.map((b) => bestPair(a, b))) };
}

/** Colour for a score: soft pink for good down to dark grey for poor, in the app's palette. */
export function scoreColor(score: number | null): string {
  if (score === null) return "#1c1c1c";
  const t = Math.max(0, Math.min(1, score / 100));
  // dark grey -> orange -> soft pink
  if (t < 0.6) {
    const u = t / 0.6;
    return `rgb(${Math.round(40 + (219 - 40) * u)},${Math.round(40 + (114 - 40) * u)},${Math.round(40 + (40 - 40) * u)})`;
  }
  const u = (t - 0.6) / 0.4;
  return `rgb(${Math.round(219 + (232 - 219) * u)},${Math.round(114 + (166 - 114) * u)},${Math.round(40 + (200 - 40) * u)})`;
}
