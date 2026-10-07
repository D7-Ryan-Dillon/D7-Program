// How two tiles meet, worked out once and remembered. The whole-building generator (lib/arrange/generate.ts) lays tiles on a lattice, so the same few
// questions come up thousands of times: "tile A in this orientation, tile B in that one, B this far from A: do they collide, and can a person walk across?"
// The answer depends only on those four things, so it is computed with the program's own joint code and kept. Everything here reads the same cells and
// the same walking rules as the rest of Arrange; nothing is approximated.

import type { ParsedTile } from "@/lib/types";
import { placeBox, toFt } from "./geometry";
import { placementFree } from "./collision";
import { jointBetween } from "./joints";
import { arrangeKernel, getOcc, getWalk } from "./occupancy";
import { FACE_KEYS, getOriented, type FaceKey } from "./orient";
import { ARRANGE_CELL, type Piece } from "./types";

/** One tile standing one way: the unit the generator chooses. */
export interface LState {
  /** tile id | quarter turns | mirrored */
  id: string;
  tile: ParsedTile;
  rot: number;
  mirror: boolean;
  /** the box, cells */
  dims: [number, number, number];
}

/** The state of a tile turned `rot` quarter turns, mirrored or not. */
export const stateFor = (tile: ParsedTile, rot: number, mirror: boolean): LState => {
  const r = ((rot % 4) + 4) % 4;
  return { id: `${tile.id}|${r}|${mirror ? 1 : 0}`, tile, rot: r, mirror, dims: getOriented(tile, r, mirror, 1).dims };
};

export const statesOf = (tile: ParsedTile): LState[] => {
  const out: LState[] = [];
  for (let rot = 0; rot < 4; rot++) for (const mirror of [false, true]) out.push(stateFor(tile, rot, mirror));
  return out;
};

/** A floor that counts as a space, in the tile's own frame. */
export interface FloorSpan {
  zone: number;
  /** lowest and highest standing height, ft above the tile's floor line (its low corner) */
  loFt: number;
  hiFt: number;
  areaFt2: number;
}

export interface StateFacts {
  floors: FloorSpan[];
  main: number;
  /** the biggest floor climbs at least this far, ft: a stair or ramp lives in this tile */
  climbFt: number;
  /** the opening area facing each side, ft2 (the roof as "z+") */
  openFt2: Record<FaceKey, number>;
}

const factsCache = new Map<string, StateFacts>();
const faceCache = new Map<string, Map<number, number[]>>();

/** The standing places (floor counts as a space) in the layer of cells against one side face, by position along the face: u (y for an x face, x for a y face) -> heights z, cells. */
function faceStand(s: LState, face: "x-" | "x+" | "y-" | "y+"): Map<number, number[]> {
  const key = `${s.id}|${face}|${arrangeKernel().key}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const o = getOriented(s.tile, s.rot, s.mirror, 1);
  const wk = getWalk(getOcc(o));
  const [nx, ny, nz] = o.dims;
  const out = new Map<number, number[]>();
  const xFace = face[0] === "x";
  const layer = face[1] === "+" ? (xFace ? nx : ny) - 1 : 0;
  for (let u = 0; u < (xFace ? ny : nx); u++)
    for (let z = 0; z < nz; z++) {
      const i = xFace ? (layer * ny + u) * nz + z : (u * ny + layer) * nz + z;
      if (!wk.stand[i] || !wk.zones[wk.zone[i]].significant) continue;
      (out.get(u) ?? out.set(u, []).get(u)!).push(z);
    }
  if (faceCache.size > 4000) faceCache.clear();
  faceCache.set(key, out);
  return out;
}

/**
 * A necessary condition for a walkable crossing, cheap: somewhere along the two facing walls there is a standing place on each side, level within one step. It
 * never rejects a pair that could cross; most pairs that cannot are turned away here, before the joint is worked out.
 */
export function mayCross(a: LState, b: LState, d: [number, number, number]): boolean {
  const step = arrangeKernel().step;
  const [fa, fb, lat]: ["x-" | "x+" | "y-" | "y+", "x-" | "x+" | "y-" | "y+", number] = d[0] > 0 ? ["x+", "x-", d[1]] : d[0] < 0 ? ["x-", "x+", d[1]] : d[1] > 0 ? ["y+", "y-", d[0]] : ["y-", "y+", d[0]];
  const A = faceStand(a, fa);
  const B = faceStand(b, fb);
  for (const [u, zas] of A) {
    const zbs = B.get(u - lat);
    if (!zbs) continue;
    for (const za of zas) for (const zb of zbs) if (Math.abs(za - (zb + d[2])) <= step) return true;
  }
  return false;
}

export function factsOf(s: LState): StateFacts {
  const hit = factsCache.get(s.id);
  if (hit) return hit;
  const o = getOriented(s.tile, s.rot, s.mirror, 1);
  const occ = getOcc(o);
  const wk = getWalk(occ);
  const [nx, ny, nz] = o.dims;
  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const zone = wk.zone[(x * ny + y) * nz + z];
        if (zone < 0) continue;
        if (!(lo.has(zone) && lo.get(zone)! <= z)) lo.set(zone, z);
        if (!(hi.has(zone) && hi.get(zone)! >= z)) hi.set(zone, z);
      }
  const floors: FloorSpan[] = wk.zones.filter((z) => z.significant).map((z) => ({ zone: z.id, loFt: (lo.get(z.id) ?? 0) * ARRANGE_CELL, hiFt: (hi.get(z.id) ?? 0) * ARRANGE_CELL, areaFt2: z.areaFt2 }));
  const openFt2 = {} as Record<FaceKey, number>;
  for (const f of FACE_KEYS) openFt2[f] = occ.features[f].reduce((a, x) => a + x.cells, 0) * ARRANGE_CELL * ARRANGE_CELL;
  const main = floors.find((f) => f.zone === wk.main);
  const facts = { floors, main: wk.main, climbFt: main ? main.hiFt - main.loFt : 0, openFt2 };
  factsCache.set(s.id, facts);
  return facts;
}

export interface Crossing {
  /** the floor (zone) of the first tile and of the second that the route joins */
  za: number;
  zb: number;
  /** the height of the crossing, ft in each tile's own frame (above its low corner) */
  ya: number;
  yb: number;
}

export interface PairInfo {
  /** no collision, nothing filling a carved space */
  free: boolean;
  touching: boolean;
  kind: "walkable" | "connector" | "void" | "contact" | null;
  /** the joint's score, 0-100 (void against void, floors meeting, foam against foam, route ends meeting) */
  score: number;
  /** open space meets open space over this much, ft2 */
  voidFt2: number;
  crossings: Crossing[];
}

const NONE: PairInfo = { free: true, touching: false, kind: null, score: 0, voidFt2: 0, crossings: [] };
const BAD: PairInfo = { free: false, touching: false, kind: null, score: 0, voidFt2: 0, crossings: [] };

const cache = new Map<string, PairInfo>();
let cacheKey = "";

const flip = (p: PairInfo): PairInfo => ({ ...p, crossings: p.crossings.map((c) => ({ za: c.zb, zb: c.za, ya: c.yb, yb: c.ya })) });

/**
 * B stands `d` cells (x, y, z of its low corner) from A's low corner. Joints are the same either way round, so the pair is worked out once with the lower
 * one first and turned back for the other order.
 */
export function pairInfo(a: LState, b: LState, d: [number, number, number], tolFt: number): PairInfo {
  const k = arrangeKernel().key;
  if (k !== cacheKey) {
    cache.clear();
    cacheKey = k;
  }
  const swap = d[0] < 0 || (d[0] === 0 && (d[1] < 0 || (d[1] === 0 && d[2] < 0)));
  if (swap) return flip(pairInfo(b, a, [-d[0], -d[1], -d[2]], tolFt));
  const key = `${a.id}>${b.id}@${d.join(",")}|${tolFt}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pa: Piece = { id: "a", tileId: a.tile.id, pos: [0, 0, 0], rotZ: a.rot, mirrorX: a.mirror, scale: 1, locked: false };
  const pb: Piece = { id: "b", tileId: b.tile.id, pos: [toFt(d[0]), toFt(d[1]), toFt(d[2])], rotZ: b.rot, mirrorX: b.mirror, scale: 1, locked: false };
  const ba = placeBox(pa, a.tile);
  const bb = placeBox(pb, b.tile);
  let out: PairInfo;
  if (!placementFree(bb, [ba])) out = BAD;
  else {
    const j = jointBetween(ba, bb, tolFt);
    if (!j) out = NONE;
    else {
      const crossings: Crossing[] = j.connect.crossings.map((x) => {
        const aFirst = x.aId === "a";
        const yWorld = x.floor * ARRANGE_CELL;
        return { za: aFirst ? x.zoneA : x.zoneB, zb: aFirst ? x.zoneB : x.zoneA, ya: yWorld, yb: yWorld - toFt(d[2]) };
      });
      out = { free: true, touching: true, kind: j.connect.kind, score: j.score ?? 0, voidFt2: j.connect.voidFt2, crossings };
    }
  }
  if (cache.size > 400_000) cache.clear();
  cache.set(key, out);
  return out;
}

export interface Partner {
  s: LState;
  info: PairInfo;
}

const partnerCache = new Map<string, Partner[]>();
let partnerKey = "";

/**
 * Every tile standing that can be beside `a` at offset `d` with a walkable crossing between floors (no collision), out of `states`. Worked out once per tile,
 * orientation and offset and remembered: this list is the generator's whole idea of "what fits here".
 */
export function partnersOf(a: LState, d: [number, number, number], states: LState[], bankSig: string, tolFt: number): Partner[] {
  const k = arrangeKernel().key;
  if (k !== partnerKey) {
    partnerCache.clear();
    partnerKey = k;
  }
  const key = `${a.id}@${d.join(",")}|${bankSig}|${tolFt}`;
  const hit = partnerCache.get(key);
  if (hit) return hit;
  const fa = factsOf(a);
  const out: Partner[] = [];
  const [face, opp]: [FaceKey, FaceKey] = d[0] > 0 ? ["x+", "x-"] : d[0] < 0 ? ["x-", "x+"] : d[1] > 0 ? ["y+", "y-"] : ["y-", "y+"];
  if (fa.openFt2[face] > 4)
    for (const s of states) {
      // a route needs an opening on both faces; this saves working out the joint for most of the bank
      if (factsOf(s).openFt2[opp] <= 4 || !mayCross(a, s, d)) continue;
      const info = pairInfo(a, s, d, tolFt);
      if (info.free && info.kind === "walkable") out.push({ s, info });
    }
  if (partnerCache.size > 200_000) partnerCache.clear();
  partnerCache.set(key, out);
  return out;
}

/**
 * The floors of the entrance tile that open to the outside: the zones with a standing place near a side opening that nothing covers (`free`: x+, x-, y+, y-),
 * else its main floor. The same rule as the layout's own way in (lib/arrange/layout.ts), so the search and the final reading agree on where the walk starts.
 */
const entryCache = new Map<string, number[]>();

export function entryZones(s: LState, free: [boolean, boolean, boolean, boolean]): number[] {
  const ck = `${s.id}|${free.map((x) => (x ? 1 : 0)).join("")}|${arrangeKernel().key}`;
  const hit = entryCache.get(ck);
  if (hit) return hit;
  const out = entryZonesUncached(s, free);
  if (entryCache.size > 4000) entryCache.clear();
  entryCache.set(ck, out);
  return out;
}

function entryZonesUncached(s: LState, free: [boolean, boolean, boolean, boolean]): number[] {
  const o = getOriented(s.tile, s.rot, s.mirror, 1);
  const occ = getOcc(o);
  const wk = getWalk(occ);
  if (wk.main < 0) return [];
  const [nx, ny, nz] = o.dims;
  const head = arrangeKernel().head;
  const found = new Set<number>();
  (["x+", "x-", "y+", "y-"] as FaceKey[]).forEach((face, fi) => {
    if (!free[fi]) return;
    for (const f of occ.features[face])
      for (const i of f.idx) {
        const z = i % nz;
        const y = ((i - z) / nz) % ny;
        const x = ((i - z) / nz - y) / ny;
        for (let dx = -3; dx <= 3; dx++)
          for (let dy = -3; dy <= 3; dy++) {
            const X = x + dx;
            const Y = y + dy;
            if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
            for (let Z = Math.max(1, z - head); Z <= z; Z++) {
              const k = (X * ny + Y) * nz + Z;
              if (wk.stand[k] && wk.zones[wk.zone[k]].significant) found.add(wk.zone[k]);
            }
          }
      }
  });
  return found.size ? [...found] : [wk.main];
}
