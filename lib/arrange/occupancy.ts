// What a placed tile occupies, cell by cell. A tile's voxels say three different things, and Arrange keeps them apart:
//
//   OUT    outside the tile's container (mask = 0). Not the tile's: another tile may occupy it. A notch, a step, the empty
//          side of an L. For an ordinary cube tile there is none.
//   SOLID  material inside the container: foam, floor plates, support branches (mask = 1, void = 0).
//   VOID   a carved space inside the container (mask = 1, void = 1): a room, a passage, a shaft, a doorway.
//
// Two tiles may share a bounding box as long as no cell is claimed by both (see collision.ts). Everything that follows --
// contacts, joints, walkable routes, the composite -- reads these classes, never the bounding box.
//
// Also here, cached per tile orientation: the container's surface (where a tile can touch something) and its openings
// (void cells on that surface) grouped into features, which the generator and the snapper use to find fits; and the
// walkable floor of the tile read on its own (standing cells and the zones they form).

import { FACE_AXIS, FACE_KEYS, FACE_SIGN, type Dims, type FaceKey, type Oriented, type Patch } from "./orient";
import { floodZones, kernelFor, OUT, SOLID, standingAtWith, standingCells, VOID, type Kernel } from "@/lib/walking";
import { ARRANGE_CELL } from "./types";

export { OUT, SOLID, VOID };

/** An opening on the tile's container surface: void cells whose outward neighbour is outside the container, in one plane. */
export interface Feature extends Patch {
  face: FaceKey;
  /** the plane the opening sits on, in cells from the tile's low corner along the face's axis (0 / dims for a box face; anything for a notch or step) */
  plane: number;
  /** local indices of the cells */
  idx: Int32Array;
}

export interface Occ {
  dims: Dims;
  /** OUT / SOLID / VOID per cell, same layout as Oriented.void */
  cls: Uint8Array;
  /** cells inside the container that have a face-neighbour outside it (or beyond the box) */
  surface: Int32Array;
  /** per surface cell: bit f set when the neighbour in direction FACE_KEYS[f] is outside the container */
  surfDirs: Uint8Array;
  solidCells: number;
  voidCells: number;
  /** cells inside the container */
  inside: number;
  /** cell faces on the container's surface (a cube of n cells a side has 6 n n) */
  faces: number;
  features: Record<FaceKey, Feature[]>;
}

const MIN_FEATURE_CELLS = Math.round(4 / (ARRANGE_CELL * ARRANGE_CELL)); // 4 ft2

const occCache = new WeakMap<Oriented, Occ>();

export function getOcc(o: Oriented): Occ {
  const hit = occCache.get(o);
  if (hit) return hit;
  const [nx, ny, nz] = o.dims;
  const n = nx * ny * nz;
  const cls = new Uint8Array(n);
  let solidCells = 0;
  let voidCells = 0;
  for (let i = 0; i < n; i++) {
    if (o.mask && !o.mask[i]) continue;
    if (o.void[i]) {
      cls[i] = VOID;
      voidCells++;
    } else {
      cls[i] = SOLID;
      solidCells++;
    }
  }
  const surface: number[] = [];
  const dirs: number[] = [];
  const outside = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz || cls[(x * ny + y) * nz + z] === OUT;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (!cls[i]) continue;
        let m = 0;
        if (outside(x - 1, y, z)) m |= 1;
        if (outside(x + 1, y, z)) m |= 2;
        if (outside(x, y - 1, z)) m |= 4;
        if (outside(x, y + 1, z)) m |= 8;
        if (outside(x, y, z - 1)) m |= 16;
        if (outside(x, y, z + 1)) m |= 32;
        if (m) {
          surface.push(i);
          dirs.push(m);
        }
      }
  const occ: Occ = {
    dims: o.dims,
    cls,
    surface: Int32Array.from(surface),
    surfDirs: Uint8Array.from(dirs),
    solidCells,
    voidCells,
    inside: solidCells + voidCells,
    faces: dirs.reduce((a, m) => a + ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1) + ((m >> 5) & 1)), 0),
    features: { "x-": [], "x+": [], "y-": [], "y+": [], "z-": [], "z+": [] },
  };
  buildFeatures(occ);
  occCache.set(o, occ);
  return occ;
}

function buildFeatures(occ: Occ) {
  const [nx, ny, nz] = occ.dims;
  const groups = new Map<number, number[]>();
  for (let s = 0; s < occ.surface.length; s++) {
    const i = occ.surface[s];
    if (occ.cls[i] !== VOID) continue;
    const z = i % nz;
    const y = ((i - z) / nz) % ny;
    const x = ((i - z) / nz - y) / ny;
    const m = occ.surfDirs[s];
    for (let f = 0; f < 6; f++) {
      if (!(m & (1 << f))) continue;
      const axis = f >> 1;
      const plane = (axis === 0 ? x : axis === 1 ? y : z) + (f & 1);
      const k = f * 4096 + plane;
      const g = groups.get(k);
      if (g) g.push(i);
      else groups.set(k, [i]);
    }
  }
  for (const [k, cells] of groups) {
    const f = Math.floor(k / 4096);
    const plane = k - f * 4096;
    const face = FACE_KEYS[f];
    const axis = FACE_AXIS[face];
    const w = axis === 0 ? ny : nx;
    const h = axis === 2 ? ny : nz;
    const uv = (i: number): [number, number] => {
      const z = i % nz;
      const y = ((i - z) / nz) % ny;
      const x = ((i - z) / nz - y) / ny;
      return axis === 0 ? [y, z] : axis === 1 ? [x, z] : [x, y];
    };
    const at = new Map<number, number>(); // u * h + v -> local index
    for (const i of cells) {
      const [u, v] = uv(i);
      at.set(u * h + v, i);
    }
    const seen = new Set<number>();
    for (const start of at.keys()) {
      if (seen.has(start)) continue;
      const stack = [start];
      seen.add(start);
      const members: number[] = [];
      let u0 = w, u1 = -1, v0 = h, v1 = -1, su = 0, sv = 0;
      while (stack.length) {
        const key = stack.pop()!;
        const u = Math.floor(key / h);
        const v = key - u * h;
        members.push(at.get(key)!);
        su += u;
        sv += v;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
        for (const nk of [key - h, key + h, key - 1, key + 1]) {
          if (!at.has(nk) || seen.has(nk)) continue;
          // stay inside the layer: +-1 in v must not wrap into the next u
          const nu = Math.floor(nk / h);
          if ((nk === key - 1 || nk === key + 1) && nu !== u) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
      if (members.length < MIN_FEATURE_CELLS) continue;
      const n = members.length;
      occ.features[face].push({ face, plane, idx: Int32Array.from(members), u0, u1: u1 + 1, v0, v1: v1 + 1, cu: su / n + 0.5, cv: sv / n + 0.5, cells: n });
    }
  }
  for (const f of FACE_KEYS) occ.features[f].sort((a, b) => b.cells - a.cells);
}

export const classAtLocal = (occ: Occ, x: number, y: number, z: number): number => {
  const [nx, ny, nz] = occ.dims;
  if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return OUT;
  return occ.cls[(x * ny + y) * nz + z];
};

export { FACE_SIGN };

// ---- the walkable floor of a tile on its own -------------------------------------------------------------------------------------------
// The rules (headroom, clear width, one step, the smallest space) are the program's one walking model: lib/walking.ts. Arrange reads them in
// its own 0.5 ft cells.

export { applyWalk, DEFAULT_WALK, WALK, walkKey } from "@/lib/walking";

/** The shared rules in Arrange's cells (re-read after the rules change: the kernel is cached per rule set). */
export const arrangeKernel = (): Kernel => kernelFor(ARRANGE_CELL);

export interface Zone {
  id: number;
  /** standing cells (about one per 0.25 ft2 of floor) */
  cells: number;
  areaFt2: number;
  significant: boolean;
}

export interface Walk {
  /** 1 where a person can stand (read inside this tile alone: floor, headroom and width are all its own) */
  stand: Uint8Array;
  /** zone id per cell (-1 = not a standing cell); cells of one zone can be walked between */
  zone: Int32Array;
  zones: Zone[];
  /** the biggest zone (the tile's own circulation), -1 when it has no walkable floor */
  main: number;
}

let walkCache = new WeakMap<Occ, Walk>();
let walkCacheKey = "";

/** Can someone stand in this cell, given a way of asking what is in any cell. */
export function standingAt(cell: (x: number, y: number, z: number) => number, x: number, y: number, z: number): boolean {
  return standingAtWith(arrangeKernel(), cell, x, y, z);
}

export function getWalk(occ: Occ): Walk {
  const k = arrangeKernel();
  if (walkCacheKey !== k.key) {
    walkCache = new WeakMap();
    walkCacheKey = k.key;
  }
  const hit = walkCache.get(occ);
  if (hit) return hit;
  const stand = standingCells(occ.dims, occ.cls, k);
  const { zone, cells } = floodZones(occ.dims, stand, k);
  const zones: Zone[] = cells.map((n, id) => ({ id, cells: n, areaFt2: n * ARRANGE_CELL * ARRANGE_CELL, significant: n >= k.minZoneCells }));
  let main = -1;
  for (const z of zones) if (z.significant && (main < 0 || z.cells > zones[main].cells)) main = z.id;
  const walk: Walk = { stand, zone, zones, main };
  walkCache.set(occ, walk);
  return walk;
}
