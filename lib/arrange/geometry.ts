// Where pieces are. Each piece has a box of whole cells (its bounding box, used to reject quickly) and, inside it, the cells
// it really occupies (lib/arrange/occupancy.ts). Two pieces may share part of their boxes as long as no cell is claimed by
// both (lib/arrange/collision.ts). Two pieces are in contact where a cell of one is face to face with a cell of the other;
// that can happen on any surface of the container (a notch, a step), not only on the six faces of the box, and a pair can
// touch in several separate patches.

import type { ParsedTile } from "@/lib/types";
import { getOriented, type Dims, type Oriented } from "./orient";
import { getOcc, OUT, type Occ } from "./occupancy";
import { ARRANGE_CELL, type Piece, type Vec3 } from "./types";

export const toCell = (ft: number) => Math.round(ft / ARRANGE_CELL);
export const toFt = (cells: number) => cells * ARRANGE_CELL;
export const snapFt = (ft: number) => toFt(toCell(ft));
export const snapVec = (p: Vec3): Vec3 => [snapFt(p[0]), snapFt(p[1]), snapFt(p[2])];

export interface PlacedBox {
  piece: Piece;
  tile: ParsedTile;
  o: Oriented;
  /** what the piece occupies, cell by cell */
  occ: Occ;
  /** cells, max exclusive */
  min: [number, number, number];
  max: [number, number, number];
}

export function placeBox(piece: Piece, tile: ParsedTile): PlacedBox {
  const o = getOriented(tile, piece.rotZ, piece.mirrorX, piece.scale);
  const min: [number, number, number] = [toCell(piece.pos[0]), toCell(piece.pos[1]), toCell(piece.pos[2])];
  return { piece, tile, o, occ: getOcc(o), min, max: [min[0] + o.dims[0], min[1] + o.dims[1], min[2] + o.dims[2]] };
}

export const sizeFt = (dims: Dims): Vec3 => [toFt(dims[0]), toFt(dims[1]), toFt(dims[2])];

/** The bounding boxes overlap. This is only the quick test: pieces whose boxes overlap may still fit (see collision.ts). */
export function boxesOverlap(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }): boolean {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

/** Pairs (indices) of boxes that overlap or touch once each is grown by `pad` cells: a sweep along x, so many pieces stay cheap. */
export function nearPairs(boxes: { min: number[]; max: number[] }[], pad = 1): [number, number][] {
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i].min[0] - boxes[j].min[0]);
  const out: [number, number][] = [];
  for (let a = 0; a < order.length; a++) {
    const p = boxes[order[a]];
    for (let b = a + 1; b < order.length; b++) {
      const q = boxes[order[b]];
      if (q.min[0] > p.max[0] + pad) break;
      if (q.min[1] > p.max[1] + pad || p.min[1] > q.max[1] + pad || q.min[2] > p.max[2] + pad || p.min[2] > q.max[2] + pad || p.min[0] > q.max[0] + pad) continue;
      out.push(order[a] < order[b] ? [order[a], order[b]] : [order[b], order[a]]);
    }
  }
  return out;
}

/**
 * One patch where two pieces meet face to face. `a` is the lower side along `axis`. lo / hi bound the patch on the other two
 * axes (ascending: for x: y,z; for y: x,z; for z: x,y); `cells` marks which cells of that rectangle are really in contact.
 */
export interface Contact {
  a: PlacedBox;
  b: PlacedBox;
  axis: 0 | 1 | 2;
  /** cell coordinate of the plane (a's cells end there, b's begin) */
  plane: number;
  lo: [number, number];
  hi: [number, number];
  /** (hi0 - lo0) x (hi1 - lo1), index u * h + v: 1 where a cell of a faces a cell of b */
  cells: Uint8Array;
  /** how many cells are in contact */
  count: number;
}

export const OTHER_AXES: Record<number, [number, number]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };
/** Patches smaller than this (1 ft2) are corner kisses, not joints. */
export const MIN_CONTACT_CELLS = 4;

/** Every patch where p and q meet, found from the cells on p's container surface that face a cell of q. */
export function contactsBetween(p: PlacedBox, q: PlacedBox): Contact[] {
  if (p.max[0] < q.min[0] || q.max[0] < p.min[0] || p.max[1] < q.min[1] || q.max[1] < p.min[1] || p.max[2] < q.min[2] || q.max[2] < p.min[2]) return [];
  const [, ny, nz] = p.occ.dims;
  const [qx, qy, qz] = q.occ.dims;
  // one bucket per plane: faces keyed by axis, side and plane
  const groups = new Map<number, { axis: 0 | 1 | 2; plane: number; pLower: boolean; faces: [number, number][] }>();
  for (let s = 0; s < p.occ.surface.length; s++) {
    const i = p.occ.surface[s];
    const lz = i % nz;
    const ly = ((i - lz) / nz) % ny;
    const lx = ((i - lz) / nz - ly) / ny;
    const w: [number, number, number] = [p.min[0] + lx, p.min[1] + ly, p.min[2] + lz];
    const m = p.occ.surfDirs[s];
    for (let f = 0; f < 6; f++) {
      if (!(m & (1 << f))) continue;
      const axis = (f >> 1) as 0 | 1 | 2;
      const sign = f & 1 ? 1 : -1;
      const n: [number, number, number] = [w[0], w[1], w[2]];
      n[axis] += sign;
      const kx = n[0] - q.min[0];
      const ky = n[1] - q.min[1];
      const kz = n[2] - q.min[2];
      if (kx < 0 || ky < 0 || kz < 0 || kx >= qx || ky >= qy || kz >= qz) continue;
      if (q.occ.cls[(kx * qy + ky) * qz + kz] === OUT) continue;
      const plane = w[axis] + (sign > 0 ? 1 : 0);
      const key = (axis * 2 + (sign > 0 ? 1 : 0)) * 100000 + plane + 50000;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { axis, plane, pLower: sign > 0, faces: [] }));
      const [o1, o2] = OTHER_AXES[axis];
      g.faces.push([w[o1], w[o2]]);
    }
  }
  const out: Contact[] = [];
  for (const g of groups.values()) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const [u, v] of g.faces) {
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const w = u1 - u0 + 1;
    const h = v1 - v0 + 1;
    const mark = new Uint8Array(w * h);
    for (const [u, v] of g.faces) mark[(u - u0) * h + (v - v0)] = 1;
    const seen = new Uint8Array(w * h);
    for (let st = 0; st < w * h; st++) {
      if (!mark[st] || seen[st]) continue;
      const stack = [st];
      seen[st] = 1;
      const members: number[] = [];
      let cu0 = w, cu1 = -1, cv0 = h, cv1 = -1;
      while (stack.length) {
        const k = stack.pop()!;
        members.push(k);
        const u = (k / h) | 0;
        const v = k - u * h;
        if (u < cu0) cu0 = u;
        if (u > cu1) cu1 = u;
        if (v < cv0) cv0 = v;
        if (v > cv1) cv1 = v;
        if (u > 0 && mark[k - h] && !seen[k - h]) { seen[k - h] = 1; stack.push(k - h); }
        if (u < w - 1 && mark[k + h] && !seen[k + h]) { seen[k + h] = 1; stack.push(k + h); }
        if (v > 0 && mark[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
        if (v < h - 1 && mark[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
      }
      if (members.length < MIN_CONTACT_CELLS) continue;
      const cw = cu1 - cu0 + 1;
      const ch = cv1 - cv0 + 1;
      const cells = new Uint8Array(cw * ch);
      for (const k of members) {
        const u = (k / h) | 0;
        const v = k - u * h;
        cells[(u - cu0) * ch + (v - cv0)] = 1;
      }
      out.push({ a: g.pLower ? p : q, b: g.pLower ? q : p, axis: g.axis, plane: g.plane, lo: [u0 + cu0, v0 + cv0], hi: [u0 + cu1 + 1, v0 + cv1 + 1], cells, count: members.length });
    }
  }
  return out.sort((x, y) => y.count - x.count);
}

/** The biggest patch where p and q meet, or null. */
export const contactBetween = (p: PlacedBox, q: PlacedBox): Contact | null => contactsBetween(p, q)[0] ?? null;

export function findContacts(boxes: PlacedBox[]): Contact[] {
  const out: Contact[] = [];
  for (const [i, j] of nearPairs(boxes, 0)) out.push(...contactsBetween(boxes[i], boxes[j]));
  return out;
}

export function boundsOfBoxes(boxes: { min: number[]; max: number[] }[]): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!boxes.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < min[k]) min[k] = b.min[k];
      if (b.max[k] > max[k]) max[k] = b.max[k];
    }
  return { min, max };
}

/** The voxel of a placed box at a world cell, or -1 when outside it. */
export const localIndex = (b: PlacedBox, x: number, y: number, z: number): number => {
  const [nx, ny, nz] = b.o.dims;
  const lx = x - b.min[0];
  const ly = y - b.min[1];
  const lz = z - b.min[2];
  if (lx < 0 || ly < 0 || lz < 0 || lx >= nx || ly >= ny || lz >= nz) return -1;
  return (lx * ny + ly) * nz + lz;
};

/** What a placed box holds at a world cell: OUT (outside its container, or outside its box), SOLID or VOID. */
export const classAt = (b: PlacedBox, x: number, y: number, z: number): number => {
  const i = localIndex(b, x, y, z);
  return i < 0 ? OUT : b.occ.cls[i];
};

/** A cheap signature of a piece's placement, for caches. */
export const pieceSig = (p: Piece) => `${p.tileId}:${p.rotZ}:${p.mirrorX ? 1 : 0}:${p.scale.toFixed(3)}:${p.pos.join(",")}`;
