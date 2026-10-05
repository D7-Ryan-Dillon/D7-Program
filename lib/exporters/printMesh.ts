// A clean, high-detail print mesh of a tile's foam (or void), made from its voxels instead of taken from the engine's GLB.
//
// The engine cuts its meshes from a 40 x 40 x 40 field, so each facet is a whole cell (1.3 mm at 1:120): in a slicer that reads as
// a faceted, stair-stepped surface. Here the same smooth field (`void_smooth`, or the voxels blurred when a tile has none) is
// upsampled with cubic interpolation to `detail` times as many samples along every axis, the surface is taken through it
// (surface nets), and a light Taubin smoothing removes what is left of the grid. The box faces stay exactly flat and exactly on
// the tile's bounds, so the underside still sits on the plate and blocks still butt together.
//
// Millimetres, Z up, the tile's low corner at the origin: the frame of lib/exporters/stl.ts.

import type { ParsedTile } from "@/lib/types";
import { blurField, surfaceNets } from "@/lib/arrange/surfaceNets";

export type Detail = 2 | 3 | 4;
/** the most samples the fine grid may have, so a big assembly cannot run the page out of memory */
const MAX_SAMPLES = 9_000_000;

/** Catmull-Rom weights for a position `t` (0..1) between the middle two of four samples. */
const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** One axis made `f` times finer. Fine sample j sits at (j + 0.5) / f of a coarse cell, i.e. coarse-index coordinate (j + 0.5) / f - 0.5; the ends repeat their edge value. */
function upsampleAxis(src: Float32Array, dims: [number, number, number], axis: 0 | 1 | 2, f: number): { data: Float32Array; dims: [number, number, number] } {
  const [nx, ny, nz] = dims;
  const n = dims[axis];
  const out: [number, number, number] = [...dims];
  out[axis] = n * f;
  const dst = new Float32Array(out[0] * out[1] * out[2]);
  const sStride = [ny * nz, nz, 1];
  const dStride = [out[1] * out[2], out[2], 1];
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;
  // the four taps and the fraction for every fine sample along the axis
  const taps = new Int32Array(n * f * 4);
  const frac = new Float32Array(n * f);
  for (let j = 0; j < n * f; j++) {
    const c = (j + 0.5) / f - 0.5;
    const i1 = Math.floor(c);
    frac[j] = c - i1;
    for (let k = 0; k < 4; k++) taps[j * 4 + k] = Math.max(0, Math.min(n - 1, i1 - 1 + k));
  }
  for (let u = 0; u < dims[a1]; u++)
    for (let v = 0; v < dims[a2]; v++) {
      const sBase = u * sStride[a1] + v * sStride[a2];
      const dBase = u * dStride[a1] + v * dStride[a2];
      for (let j = 0; j < n * f; j++) {
        const t = j * 4;
        const val = cubic(src[sBase + taps[t] * sStride[axis]], src[sBase + taps[t + 1] * sStride[axis]], src[sBase + taps[t + 2] * sStride[axis]], src[sBase + taps[t + 3] * sStride[axis]], frac[j]);
        dst[dBase + j * dStride[axis]] = val;
      }
    }
  void nx;
  return { data: dst, dims: out };
}

/** The solid's field, 0..255, inside high: foam is 255 - void_smooth, the void is void_smooth. */
function solidField(tile: ParsedTile, solid: "foam" | "void"): Float32Array | null {
  const [nx, ny, nz] = tile.grid;
  const n = nx * ny * nz;
  const smooth = tile.voxels.voidSmooth;
  const bin = tile.voxels.void;
  if (!smooth && !bin) return null;
  let voidness: Float32Array;
  if (smooth && smooth.length === n) {
    voidness = Float32Array.from(smooth);
  } else if (bin && bin.length === n) {
    // no smooth field: blur the 0/1 voxels
    const b = blurField(bin, tile.grid, 0, 2);
    voidness = b.field.map((v) => v * 255);
  } else return null;
  const mask = tile.voxels.mask;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inside = !mask || mask[i] ? 1 : 0;
    // outside the tile's envelope there is no solid of either kind
    out[i] = inside ? (solid === "foam" ? 255 - voidness[i] : voidness[i]) : 0;
  }
  return out;
}

/**
 * The foam (or void) of a tile as a triangle soup in millimetres, with outward-facing triangles; null when the tile has no voxels.
 * `detail` is how many times finer than the voxels the surface is sampled (2, 3 or 4).
 */
export function fineSoup(tile: ParsedTile, ratio: number, detail: Detail, solid: "foam" | "void" = "foam"): Float32Array | null {
  const m = fineMesh(tile, ratio, detail, solid);
  if (!m) return null;
  const { positions: P, indices: idx } = m;
  const soup = new Float32Array(idx.length * 3);
  for (let t = 0; t < idx.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const v = idx[t + c];
      soup[t * 3 + c * 3] = P[v * 3];
      soup[t * 3 + c * 3 + 1] = P[v * 3 + 1];
      soup[t * 3 + c * 3 + 2] = P[v * 3 + 2];
    }
  return soup;
}

/**
 * The same smooth surface as an indexed mesh (shared vertices, so smooth shading works), outward-wound. Units follow `ratio`: millimetres
 * at a print scale; pass 304.8 to get feet.
 */
export function fineMesh(tile: ParsedTile, ratio: number, detail: Detail, solid: "foam" | "void" = "foam"): { positions: Float32Array; indices: Uint32Array } | null {
  const base = solidField(tile, solid);
  if (!base) return null;
  const [nx, ny, nz] = tile.grid;
  // never more samples than the page can hold
  const f = Math.max(1, Math.min(detail, Math.floor(Math.cbrt(MAX_SAMPLES / (nx * ny * nz)))));
  let field = base;
  let dims: [number, number, number] = [nx, ny, nz];
  for (const axis of [0, 1, 2] as const) {
    const r = upsampleAxis(field, dims, axis, f);
    field = r.data;
    dims = r.dims;
  }
  // one empty cell all round closes the surface exactly on the tile's faces
  const pad = 1;
  const pd: [number, number, number] = [dims[0] + 2 * pad, dims[1] + 2 * pad, dims[2] + 2 * pad];
  const padded = new Float32Array(pd[0] * pd[1] * pd[2]);
  for (let x = 0; x < dims[0]; x++)
    for (let y = 0; y < dims[1]; y++) {
      const s = (x * dims[1] + y) * dims[2];
      padded.set(field.subarray(s, s + dims[2]), ((x + pad) * pd[1] + (y + pad)) * pd[2] + pad);
    }
  const mesh = surfaceNets(padded, pd, 127.5);
  if (!mesh.indices.length) return null;

  // grid units -> millimetres (fine sample j is at (j + 0.5) / f cells), snapping what sits on a face of the box onto it
  const cellMm = (tile.cellFt * 304.8) / ratio;
  const size = [nx * cellMm, ny * cellMm, nz * cellMm];
  const nv = mesh.positions.length / 3;
  const P = new Float32Array(mesh.positions.length);
  const fixed = new Uint8Array(nv);
  for (let v = 0; v < nv; v++)
    for (let k = 0; k < 3; k++) {
      let c = ((mesh.positions[v * 3 + k] - pad + 0.5) / f) * cellMm;
      if (c < 0.75 * (cellMm / f)) {
        c = 0;
        fixed[v] = 1;
      } else if (c > size[k] - 0.75 * (cellMm / f)) {
        c = size[k];
        fixed[v] = 1;
      }
      P[v * 3 + k] = c;
    }

  // Taubin smoothing (shrink then re-inflate): the grid's last ripples go, the volume stays, the faces stay put
  const idx = mesh.indices;
  const deg = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) deg[idx[i] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const fill = new Uint32Array(nv);
  const nbr = new Uint32Array(deg[nv]);
  for (let t = 0; t < idx.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k];
      const b = idx[t + ((k + 1) % 3)];
      const c = idx[t + ((k + 2) % 3)];
      nbr[deg[a] + fill[a]++] = b;
      nbr[deg[a] + fill[a]++] = c;
    }
  const Q = new Float32Array(P.length);
  const pass = (lambda: number) => {
    for (let v = 0; v < nv; v++) {
      const s = deg[v];
      const e = deg[v] + fill[v];
      if (fixed[v] || e === s) {
        Q[v * 3] = P[v * 3];
        Q[v * 3 + 1] = P[v * 3 + 1];
        Q[v * 3 + 2] = P[v * 3 + 2];
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (let i = s; i < e; i++) {
        const w = nbr[i];
        ax += P[w * 3];
        ay += P[w * 3 + 1];
        az += P[w * 3 + 2];
      }
      const m = e - s;
      Q[v * 3] = P[v * 3] + lambda * (ax / m - P[v * 3]);
      Q[v * 3 + 1] = P[v * 3 + 1] + lambda * (ay / m - P[v * 3 + 1]);
      Q[v * 3 + 2] = P[v * 3 + 2] + lambda * (az / m - P[v * 3 + 2]);
    }
    P.set(Q);
  };
  for (let it = 0; it < 3; it++) {
    pass(0.5);
    pass(-0.53);
  }

  // wound outward: the signed volume must be positive
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    vol += (P[a * 3] * (P[b * 3 + 1] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3 + 1]) - P[a * 3 + 1] * (P[b * 3] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3]) + P[a * 3 + 2] * (P[b * 3] * P[c * 3 + 1] - P[b * 3 + 1] * P[c * 3])) / 6;
  }
  const out = new Uint32Array(idx);
  if (vol < 0)
    for (let t = 0; t < out.length; t += 3) {
      const x = out[t + 1];
      out[t + 1] = out[t + 2];
      out[t + 2] = x;
    }
  return { positions: P, indices: out };
}
