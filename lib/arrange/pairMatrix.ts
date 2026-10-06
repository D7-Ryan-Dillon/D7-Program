// For every pair of tiles, how well they meet: the best joint score of the second tile beside the first (over its eight
// orientations and a few ways of lining the openings and floors up). Click a cell in the Arrange tab to add that pair.

import type { ParsedTile } from "@/lib/types";
import { placeBox, toFt, type PlacedBox } from "./geometry";
import { placementFree } from "./collision";
import { jointBetween } from "./joints";
import { getOcc, getWalk } from "./occupancy";
import { getFacts, isPlaceable } from "./orient";
import type { Joint, Piece, Vec3 } from "./types";

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

export interface PairOptions {
  /** how the FIRST tile stands (default: unturned), so any of its faces can be the one the second tile meets */
  aRot?: number;
  aMirror?: boolean;
  /** how many of each face's biggest openings to line up (default 4) */
  openings?: number;
  /** try every pair of floor levels for every pair of openings (default: only for the biggest pair), so a ramp's upper landing can meet a floor of the other tile */
  allLevels?: boolean;
}

export interface PairCandidate {
  /** the second tile's piece, placed with the first at the origin */
  piece: Piece;
  box: PlacedBox;
  boxA: PlacedBox;
  joint: Joint;
}

/**
 * Every collision-free way the second tile can stand against the first's +x side (eight orientations) with a joint, found by lining up
 * its openings and floors with the first tile's. The joint is computed with the program's walking rules (lib/walking.ts).
 */
export function* pairCandidates(a: ParsedTile, b: ParsedTile, connectorFt = 1.5, opts: PairOptions = {}): Generator<PairCandidate> {
  const aRot = opts.aRot ?? 0;
  const aMirror = opts.aMirror ?? false;
  const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: aRot, mirrorX: aMirror, scale: 1, locked: false };
  const boxA = placeBox(pa, a);
  const fa = getFacts(a, aRot, aMirror, 1);
  // A's openings facing +x: the box face, and any notch or step wall that faces the same way
  const aOpenings = boxA.occ.features["x+"].slice(0, opts.openings ?? 4);
  for (let rot = 0; rot < 4; rot++)
    for (const mirror of [false, true]) {
      const fb = getFacts(b, rot, mirror, 1);
      const bOpenings = getOcc(fb.o).features["x-"].slice(0, opts.openings ?? 4);
      const spots: [number, number, number][] = [[boxA.max[0], 0, 0]];
      let first = true;
      for (const qa of aOpenings)
        for (const qb of bOpenings) {
          const x = boxA.min[0] + qa.plane - qb.plane;
          spots.push([x, Math.round(qa.cu - qb.cu), Math.round(qa.cv - qb.cv)]);
          // openings of different heights (eroded doorways are not all the same size): line the FLOORS up too (the bottoms of the two openings), and keep the two tiles at one level
          spots.push([x, Math.round(qa.cu - qb.cu), Math.round(qa.v0 - qb.v0)]);
          spots.push([x, Math.round(qa.cu - qb.cu), 0]);
          // the biggest pair of openings is tried against every pair of floor levels, the others only centre to centre
          if (first || opts.allLevels) for (const lp of fa.levelsZ) for (const lq of fb.levelsZ) spots.push([x, Math.round(qa.cu - qb.cu), lp - lq]);
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
        const joint = jointBetween(boxA, boxB, connectorFt);
        if (joint) yield { piece: pb, box: boxB, boxA, joint };
      }
    }
}

/** The ways the pair can stand, best first: walkable joints that join both MAIN floors, then other walkable joints, then the rest, each by score. */
export function rankPair(c: PairCandidate): number {
  const j = c.joint;
  const mainA = getWalk(c.boxA.occ).main;
  const mainB = getWalk(c.box.occ).main;
  const joinsMain = j.connect.crossings.some((x) => (x.aId === "a" ? x.zoneA === mainA && x.zoneB === mainB : x.zoneB === mainA && x.zoneA === mainB));
  // a joint people can walk through beats one that only touches or lets the view through; one that joins the two MAIN floors (the way the
  // Arrange tab judges a piece reachable) beats one that joins some other level of either, which would leave a piece's own floor cut off
  return (j.connect.walkable ? 1000 : 0) + (joinsMain ? 500 : 0) + (j.score === null ? -0.5 : j.score);
}

export function bestPair(a: ParsedTile, b: ParsedTile, connectorFt = 1.5, opts: PairOptions = {}): PairCell {
  const boxA = placeBox({ id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: opts.aRot ?? 0, mirrorX: opts.aMirror ?? false, scale: 1, locked: false }, a);
  let best: PairCell = { score: null, rotZ: 0, mirrorX: false, pos: [toFt(boxA.max[0]), 0, 0] };
  let bestV = -Infinity;
  for (const c of pairCandidates(a, b, connectorFt, opts)) {
    const v = rankPair(c);
    if (v > bestV) {
      bestV = v;
      best = { score: c.joint.score, rotZ: c.piece.rotZ, mirrorX: c.piece.mirrorX, pos: c.piece.pos };
    }
    if (bestV >= 1599) return best; // a walkable joint between the main floors that scores 99 or more cannot be beaten
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
