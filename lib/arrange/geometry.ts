// Where pieces are: each piece is a box of whole cells. Boxes may not overlap; two boxes that touch across a plane
// make a contact (a joint is a scored contact).

import type { ParsedTile } from "@/lib/types";
import { getOriented, type Dims, type Oriented } from "./orient";
import { ARRANGE_CELL, type Piece, type Vec3 } from "./types";

export const toCell = (ft: number) => Math.round(ft / ARRANGE_CELL);
export const toFt = (cells: number) => cells * ARRANGE_CELL;
export const snapFt = (ft: number) => toFt(toCell(ft));
export const snapVec = (p: Vec3): Vec3 => [snapFt(p[0]), snapFt(p[1]), snapFt(p[2])];

export interface PlacedBox {
  piece: Piece;
  tile: ParsedTile;
  o: Oriented;
  /** cells, max exclusive */
  min: [number, number, number];
  max: [number, number, number];
}

export function placeBox(piece: Piece, tile: ParsedTile): PlacedBox {
  const o = getOriented(tile, piece.rotZ, piece.mirrorX, piece.scale);
  const min: [number, number, number] = [toCell(piece.pos[0]), toCell(piece.pos[1]), toCell(piece.pos[2])];
  return { piece, tile, o, min, max: [min[0] + o.dims[0], min[1] + o.dims[1], min[2] + o.dims[2]] };
}

export const sizeFt = (dims: Dims): Vec3 => [toFt(dims[0]), toFt(dims[1]), toFt(dims[2])];

export function boxesOverlap(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }): boolean {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

export function findOverlaps(boxes: PlacedBox[]): [PlacedBox, PlacedBox][] {
  const out: [PlacedBox, PlacedBox][] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i], boxes[j])) out.push([boxes[i], boxes[j]]);
  return out;
}

/** Two boxes that touch across a plane. `a` is the lower side along `axis`. lo / hi are the contact rectangle's cells on the other two axes (ascending: for x: y,z; for y: x,z; for z: x,y). */
export interface Contact {
  a: PlacedBox;
  b: PlacedBox;
  axis: 0 | 1 | 2;
  /** cell coordinate of the plane (a.max[axis] === b.min[axis]) */
  plane: number;
  lo: [number, number];
  hi: [number, number];
}

const OTHER: Record<number, [number, number]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };

export function contactBetween(p: PlacedBox, q: PlacedBox): Contact | null {
  for (const axis of [0, 1, 2] as const) {
    let a = p;
    let b = q;
    if (p.max[axis] === q.min[axis]) {
      /* p is lower */
    } else if (q.max[axis] === p.min[axis]) {
      a = q;
      b = p;
    } else continue;
    const [o1, o2] = OTHER[axis];
    const lo: [number, number] = [Math.max(p.min[o1], q.min[o1]), Math.max(p.min[o2], q.min[o2])];
    const hi: [number, number] = [Math.min(p.max[o1], q.max[o1]), Math.min(p.max[o2], q.max[o2])];
    if (hi[0] > lo[0] && hi[1] > lo[1]) return { a, b, axis, plane: a.max[axis], lo, hi };
  }
  return null;
}

export function findContacts(boxes: PlacedBox[]): Contact[] {
  const out: Contact[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      // cheap reject: boxes further apart than touching
      const p = boxes[i];
      const q = boxes[j];
      if (p.max[0] < q.min[0] || q.max[0] < p.min[0] || p.max[1] < q.min[1] || q.max[1] < p.min[1] || p.max[2] < q.min[2] || q.max[2] < p.min[2]) continue;
      const c = contactBetween(p, q);
      if (c) out.push(c);
    }
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

/** A cheap signature of a piece's placement, for caches. */
export const pieceSig = (p: Piece) => `${p.tileId}:${p.rotZ}:${p.mirrorX ? 1 : 0}:${p.scale.toFixed(3)}:${p.pos.join(",")}`;
