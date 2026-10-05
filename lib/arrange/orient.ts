// A tile as it stands in an arrangement: its voxels mirrored in X, turned in quarter turns about the vertical axis and
// (optionally) scaled, plus what a joint or a snap needs to know about it -- the openings on each face and its floor
// heights. Everything is cached per tile and orientation, so moving pieces around costs nothing.
//
// Voxel layout everywhere: C order, z fastest, index = (x * ny + y) * nz + z; 1 = void (an open space), 0 = foam.
// A quarter turn is np.rot90(void, 1, axes=(0, 1)) of the engine (docs/DATA_FORMAT.md section 5), generalised to boxes:
// new[x, y, z] = old[y, ny - 1 - x, z], counter-clockwise seen from above, and the new box is ny wide and nx deep.

import type { ParsedTile } from "@/lib/types";
import { ARRANGE_CELL } from "./types";

export type Dims = [number, number, number];

export interface Oriented {
  dims: Dims;
  void: Uint8Array;
  plates: Uint8Array | null;
  struts: Uint8Array | null;
  /** 1 = inside the tile's envelope (null: all of it) */
  mask: Uint8Array | null;
}

export type FaceKey = "x-" | "x+" | "y-" | "y+" | "z-" | "z+";
export const FACE_KEYS: FaceKey[] = ["x-", "x+", "y-", "y+", "z-", "z+"];
export const OPPOSITE: Record<FaceKey, FaceKey> = { "x-": "x+", "x+": "x-", "y-": "y+", "y+": "y-", "z-": "z+", "z+": "z-" };
export const FACE_AXIS: Record<FaceKey, 0 | 1 | 2> = { "x-": 0, "x+": 0, "y-": 1, "y+": 1, "z-": 2, "z+": 2 };
export const FACE_SIGN: Record<FaceKey, -1 | 1> = { "x-": -1, "x+": 1, "y-": -1, "y+": 1, "z-": -1, "z+": 1 };

/** A connected opening on one face: bounds and centroid in the face layer's own (u, v) cells. */
export interface Patch {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  cu: number;
  cv: number;
  cells: number;
}

export interface OrientedFacts {
  o: Oriented;
  /** openings of 4 ft2 or more on each face, biggest first */
  patches: Record<FaceKey, Patch[]>;
  /** the height (cells above the box's floor) of every floor level the tile has */
  levelsZ: number[];
}

const MIN_PATCH_CELLS = Math.round(4 / (ARRANGE_CELL * ARRANGE_CELL));

function mirrorX(src: Uint8Array, [nx, ny, nz]: Dims): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) out.set(src.subarray(((nx - 1 - x) * ny + y) * nz, ((nx - 1 - x) * ny + y) * nz + nz), (x * ny + y) * nz);
  return out;
}

function turn(src: Uint8Array, [nx, ny, nz]: Dims): { data: Uint8Array; dims: Dims } {
  const out = new Uint8Array(src.length);
  // new box: ny wide (x), nx deep (y); new[x, y, z] = old[y, ny - 1 - x, z]
  for (let x = 0; x < ny; x++) for (let y = 0; y < nx; y++) out.set(src.subarray((y * ny + (ny - 1 - x)) * nz, (y * ny + (ny - 1 - x)) * nz + nz), (x * nx + y) * nz);
  return { data: out, dims: [ny, nx, nz] };
}

function resample(src: Uint8Array, [nx, ny, nz]: Dims, s: number): { data: Uint8Array; dims: Dims } {
  const dims: Dims = [Math.max(1, Math.round(nx * s)), Math.max(1, Math.round(ny * s)), Math.max(1, Math.round(nz * s))];
  const out = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const map = (i: number, n: number, m: number) => Math.min(n - 1, Math.floor(((i + 0.5) * n) / m));
  for (let x = 0; x < dims[0]; x++) {
    const sx = map(x, nx, dims[0]);
    for (let y = 0; y < dims[1]; y++) {
      const sy = map(y, ny, dims[1]);
      for (let z = 0; z < dims[2]; z++) out[(x * dims[1] + y) * dims[2] + z] = src[(sx * ny + sy) * nz + map(z, nz, dims[2])];
    }
  }
  return { data: out, dims };
}

function transformArray(src: Uint8Array, dims: Dims, rot: number, mirror: boolean, scale: number): { data: Uint8Array; dims: Dims } {
  let data = src;
  let d: Dims = dims;
  if (mirror) data = mirrorX(data, d);
  for (let i = 0; i < (((rot % 4) + 4) % 4); i++) {
    const t = turn(data, d);
    data = t.data;
    d = t.dims;
  }
  if (Math.abs(scale - 1) > 1e-6) {
    const r = resample(data, d, scale);
    data = r.data;
    d = r.dims;
  }
  return { data, dims: d };
}

const orientedCache = new Map<string, Oriented>();
const factsCache = new Map<string, OrientedFacts>();
const key = (tile: ParsedTile, rot: number, mirror: boolean, scale: number) => `${tile.id}|${((rot % 4) + 4) % 4}|${mirror ? 1 : 0}|${scale.toFixed(3)}`;

/** True when this tile can be placed: a box of whole cells of the standard size with its voxels. */
export function isPlaceable(tile: ParsedTile): boolean {
  return !!tile.voxels.void && Math.abs(tile.cellFt - ARRANGE_CELL) < 1e-6 && tile.shape?.kind !== "hex-prism";
}

export function getOriented(tile: ParsedTile, rot: number, mirror: boolean, scale = 1): Oriented {
  const k = key(tile, rot, mirror, scale);
  const hit = orientedCache.get(k);
  if (hit) return hit;
  const vd = tile.voxels.void;
  if (!vd) throw new Error(`${tile.name} has no voxels`);
  const t = transformArray(vd, tile.grid, rot, mirror, scale);
  const opt = (a: Uint8Array | undefined) => (a ? transformArray(a, tile.grid, rot, mirror, scale).data : null);
  const out: Oriented = { dims: t.dims, void: t.data, plates: opt(tile.voxels.plates), struts: opt(tile.voxels.struts), mask: opt(tile.voxels.mask) };
  orientedCache.set(k, out);
  return out;
}

export const orientedDims = (tile: ParsedTile, rot: number, scale = 1): Dims => {
  const [nx, ny, nz] = tile.grid;
  const [a, b] = ((rot % 4) + 4) % 4 % 2 === 1 ? [ny, nx] : [nx, ny];
  return [Math.max(1, Math.round(a * scale)), Math.max(1, Math.round(b * scale)), Math.max(1, Math.round(nz * scale))];
};

/** The void cells of one face of an oriented tile as a (w x h) layer, u * h + v, with its size. Face layers: x faces (u=y, v=z), y faces (u=x, v=z), z faces (u=x, v=y). */
export function faceLayer(o: Oriented, face: FaceKey): { w: number; h: number; data: Uint8Array } {
  const [nx, ny, nz] = o.dims;
  const axis = FACE_AXIS[face];
  const at = FACE_SIGN[face] < 0 ? 0 : o.dims[axis] - 1;
  const inside = (i: number) => (o.mask ? o.mask[i] !== 0 : true);
  if (axis === 0) {
    const data = new Uint8Array(ny * nz);
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
      const i = (at * ny + y) * nz + z;
      data[y * nz + z] = o.void[i] && inside(i) ? 1 : 0;
    }
    return { w: ny, h: nz, data };
  }
  if (axis === 1) {
    const data = new Uint8Array(nx * nz);
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
      const i = (x * ny + at) * nz + z;
      data[x * nz + z] = o.void[i] && inside(i) ? 1 : 0;
    }
    return { w: nx, h: nz, data };
  }
  const data = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
    const i = (x * ny + y) * nz + at;
    data[x * ny + y] = o.void[i] && inside(i) ? 1 : 0;
  }
  return { w: nx, h: ny, data };
}

/** Connected (4-neighbour) patches of a 2D layer, biggest first. */
export function layerPatches(layer: { w: number; h: number; data: Uint8Array }, minCells = MIN_PATCH_CELLS): Patch[] {
  const { w, h, data } = layer;
  const seen = new Uint8Array(w * h);
  const out: Patch[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!data[s] || seen[s]) continue;
    let u0 = w, u1 = -1, v0 = h, v1 = -1, su = 0, sv = 0, n = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const u = (i / h) | 0;
      const v = i - u * h;
      n++;
      su += u;
      sv += v;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
      if (u > 0 && data[i - h] && !seen[i - h]) { seen[i - h] = 1; stack.push(i - h); }
      if (u < w - 1 && data[i + h] && !seen[i + h]) { seen[i + h] = 1; stack.push(i + h); }
      if (v > 0 && data[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (v < h - 1 && data[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    }
    if (n >= minCells) out.push({ u0, u1: u1 + 1, v0, v1: v1 + 1, cu: su / n + 0.5, cv: sv / n + 0.5, cells: n });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

export function getFacts(tile: ParsedTile, rot: number, mirror: boolean, scale = 1): OrientedFacts {
  const k = key(tile, rot, mirror, scale);
  const hit = factsCache.get(k);
  if (hit) return hit;
  const o = getOriented(tile, rot, mirror, scale);
  const patches = {} as Record<FaceKey, Patch[]>;
  for (const f of FACE_KEYS) patches[f] = layerPatches(faceLayer(o, f));
  const levelsZ = (tile.spaces?.levels ?? []).map((l) => Math.round((l.z_ft / ARRANGE_CELL) * scale));
  const facts = { o, patches, levelsZ: [...new Set(levelsZ)].sort((a, b) => a - b) };
  factsCache.set(k, facts);
  return facts;
}

/** The tile's program category (an arrangement saved as a tile is "other": it is already a whole). */
export function categoryOf(tile: ParsedTile): "gathering" | "office" | "lobby" | "other" {
  const m = tile.meta?.category;
  if (m === "gathering" || m === "office" || m === "lobby") return m;
  return tile.guessed.category ?? "other";
}
