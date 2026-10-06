// For every pair of tiles, how well they meet: the best joint score of the second tile beside the first (over its eight
// orientations and a few ways of lining the openings and floors up). Click a cell in the Arrange tab to add that pair.

import type { ParsedTile } from "@/lib/types";
import { placeBox, toFt } from "./geometry";
import { placementFree } from "./collision";
import { jointBetween } from "./joints";
import { getOcc } from "./occupancy";
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

export function bestPair(a: ParsedTile, b: ParsedTile, connectorFt = 1.5): PairCell {
  const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
  const boxA = placeBox(pa, a);
  const fa = getFacts(a, 0, false, 1);
  // A's openings facing +x: the box face, and any notch or step wall that faces the same way
  const aOpenings = boxA.occ.features["x+"].slice(0, 2);
  let best: PairCell = { score: null, rotZ: 0, mirrorX: false, pos: [toFt(boxA.max[0]), 0, 0] };
  let bestV = -Infinity;
  for (let rot = 0; rot < 4; rot++)
    for (const mirror of [false, true]) {
      const fb = getFacts(b, rot, mirror, 1);
      const bOpenings = getOcc(fb.o).features["x-"].slice(0, 2);
      const spots: [number, number, number][] = [[boxA.max[0], 0, 0]];
      let first = true;
      for (const qa of aOpenings)
        for (const qb of bOpenings) {
          const x = boxA.min[0] + qa.plane - qb.plane;
          spots.push([x, Math.round(qa.cu - qb.cu), Math.round(qa.cv - qb.cv)]);
          // the biggest pair of openings is tried against every pair of floor levels, the others only centre to centre
          if (first) for (const lp of fa.levelsZ) for (const lq of fb.levelsZ) spots.push([x, Math.round(qa.cu - qb.cu), lp - lq]);
          first = false;
        }
      const seen = new Set<string>();
      for (const [x, dy, dz] of spots) {
        const k = `${x},${dy},${dz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const pb: Piece = { id: "b", tileId: b.id, pos: [toFt(x), toFt(dy), toFt(dz)], rotZ: rot, mirrorX: mirror, scale: 1, locked: false };
        const boxB = placeBox(pb, b);
        if (!placementFree(boxB, [boxA])) continue;
        const j = jointBetween(boxA, boxB, connectorFt);
        if (!j) continue;
        // a joint people can walk through beats one that only touches or lets the view through
        const v = (j.walkable ? 1000 : 0) + (j.score === null ? -0.5 : j.score);
        if (v > bestV) {
          bestV = v;
          best = { score: j.score, rotZ: rot, mirrorX: mirror, pos: pb.pos };
        }
        if (bestV >= 1099) return best; // a walkable joint that scores 99 or more cannot be beaten
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
