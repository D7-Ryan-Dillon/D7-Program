// Post-process for a lofted VolumeField: delete small floating foam pieces,
// shave off extremely thin branches, and fill small sealed void pockets --
// the same specks the Grasshopper engine's `cleanup_material()`
// (engine/erosion_engine_5f.py: min_foam / min_void) removes from a finished
// erosion, plus a thin-branch pass that engine doesn't have.
//
// Works directly on the signed field (positive = foam, see volumeField.ts)
// before any meshing or voxelizing, so the preview mesh, the saved tile's
// voxels and its exported OBJ/_analysis all agree. volumeField.ts itself is
// untouched -- this only ever reads its output and returns a new field.
//
// Like the engine, anything touching a tile face is never treated as
// "floating"/"sealed": it may carry on into the neighbouring tile.

import type { VolumeField } from "./volumeField";

export interface CleanupSettings {
  /** Floating foam pieces smaller than this (ft^3) are deleted. 0 = off. */
  minPieceFt3: number;
  /** Foam thinner than this (ft) is shaved off wherever it sticks out of a
   * thicker mass (a morphological opening, so a thin branch goes but the
   * mass it grew from keeps its shape). 0 = off. */
  minBranchFt: number;
  /** Fully enclosed void pockets smaller than this (ft^3) are filled in
   * with foam. 0 = off. */
  minPocketFt3: number;
}

export const defaultCleanup: CleanupSettings = { minPieceFt3: 0, minBranchFt: 0, minPocketFt3: 0 };

export function isCleanupActive(c: CleanupSettings | undefined): boolean {
  return !!c && (c.minPieceFt3 > 0 || c.minBranchFt > 0 || c.minPocketFt3 > 0);
}

export interface CleanupStats {
  pieces: number;
  piecesFt3: number;
  branchFt3: number;
  pockets: number;
  pocketsFt3: number;
}

const EDGE = 2; // first/last tile node (index 2 .. n-3), see volumeField.ts: nodes 0-1 and n-2..n-1 are a forced-void margin

/** Squared Euclidean distance transform (Felzenszwalb & Huttenlocher), 3D:
 * the squared distance from every node to its nearest `feature` node.
 * Separable, so three cheap 1D passes. The array's ends are NOT treated as
 * features (distance just runs out), which is what lets the caller decide
 * how to treat the tile's own faces. */
function edtSquared(feature: Uint8Array, n: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(feature.length);
  for (let i = 0; i < f.length; i++) f[i] = feature[i] ? 0 : INF;

  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  const pass = (stride: number, outerA: number, outerB: number) => {
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const base = a * outerA + b * outerB;
        for (let q = 0; q < n; q++) line[q] = f[base + q * stride];
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < n; q++) {
          let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
          while (s <= z[k]) {
            k--;
            s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
          }
          k++;
          v[k] = q;
          z[k] = s;
          z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
          while (z[k + 1] < q) k++;
          out[q] = (q - v[k]) * (q - v[k]) + line[v[k]];
        }
        for (let q = 0; q < n; q++) f[base + q * stride] = out[q];
      }
  };
  pass(1, n * n, n); // along x
  pass(n, n * n, 1); // along y
  pass(n * n, n, 1); // along z
  return f;
}

interface Components {
  labels: Int32Array; // 0 = not in the mask, 1..count = component id
  sizes: number[]; // node count per component, index = id
  touchesFace: boolean[]; // index = id
}

/** 6-connected components of `mask`, restricted to the tile's own nodes
 * (EDGE..n-1-EDGE on every axis). */
function labelComponents(mask: Uint8Array, n: number): Components {
  const labels = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const touchesFace: boolean[] = [false];
  const hi = n - 1 - EDGE;
  const stack = new Int32Array(mask.length);
  const nn = n * n;
  for (let z0 = EDGE; z0 <= hi; z0++)
    for (let y0 = EDGE; y0 <= hi; y0++)
      for (let x0 = EDGE; x0 <= hi; x0++) {
        const start = z0 * nn + y0 * n + x0;
        if (!mask[start] || labels[start]) continue;
        const id = sizes.length;
        let size = 0;
        let touches = false;
        let sp = 0;
        stack[sp++] = start;
        labels[start] = id;
        while (sp) {
          const i = stack[--sp];
          size++;
          const x = i % n;
          const y = ((i / n) | 0) % n;
          const z = (i / nn) | 0;
          if (x === EDGE || x === hi || y === EDGE || y === hi || z === EDGE || z === hi) touches = true;
          const tryPush = (j: number, inside: boolean) => {
            if (inside && mask[j] && !labels[j]) {
              labels[j] = id;
              stack[sp++] = j;
            }
          };
          tryPush(i - 1, x > EDGE);
          tryPush(i + 1, x < hi);
          tryPush(i - n, y > EDGE);
          tryPush(i + n, y < hi);
          tryPush(i - nn, z > EDGE);
          tryPush(i + nn, z < hi);
        }
        sizes.push(size);
        touchesFace.push(touches);
      }
  return { labels, sizes, touchesFace };
}

/** Foam present at a node, with the tile's margin nodes replicating their
 * nearest in-tile neighbour -- so for the distance transform foam running
 * into a tile face keeps going, instead of the face acting as an edge that
 * would make every slab look thin right where it meets a face. */
function replicatedFoamMask(field: Float32Array, n: number): Uint8Array {
  const hi = n - 1 - EDGE;
  const clamp = (v: number) => (v < EDGE ? EDGE : v > hi ? hi : v);
  const out = new Uint8Array(field.length);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        out[z * n * n + y * n + x] = field[clamp(z) * n * n + clamp(y) * n + clamp(x)] > 0 ? 1 : 0;
      }
  return out;
}

/** Returns a cleaned copy of `volume` (never mutates the input) plus what
 * was removed. `tileFt` is the edge length the lofted tile spans, used only
 * to convert node counts into feet / cubic feet. */
export function cleanupVolumeField(volume: VolumeField, settings: CleanupSettings, tileFt = 20): { volume: VolumeField; stats: CleanupStats } {
  const stats: CleanupStats = { pieces: 0, piecesFt3: 0, branchFt3: 0, pockets: 0, pocketsFt3: 0 };
  if (!isCleanupActive(settings)) return { volume, stats };

  const n = volume.resolution;
  const field = new Float32Array(volume.field);
  const cellFt = tileFt / (n - 5); // field nodes EDGE..n-1-EDGE span the tile
  const nodeFt3 = cellFt * cellFt * cellFt;
  const hi = n - 1 - EDGE;
  const nn = n * n;
  const tileMask = (): Uint8Array => {
    const m = new Uint8Array(field.length);
    for (let z = EDGE; z <= hi; z++)
      for (let y = EDGE; y <= hi; y++)
        for (let x = EDGE; x <= hi; x++) {
          const i = z * nn + y * n + x;
          m[i] = field[i] > 0 ? 1 : 0;
        }
    return m;
  };
  // Sign-flip (keeping magnitude) rather than a hard +-1 so the surface left
  // behind stays smooth instead of stair-stepping.
  const flipTo = (i: number, positive: boolean) => {
    const mag = Math.max(Math.abs(field[i]), 0.05);
    field[i] = positive ? mag : -mag;
  };

  // 1) Thin branches: opening = erode by r, then dilate by r. Whatever the
  //    opening doesn't give back is thinner than 2r (or a thin sheet/branch).
  if (settings.minBranchFt > 0) {
    const r = settings.minBranchFt / 2 / cellFt;
    const r2 = r * r;
    const foam = replicatedFoamMask(field, n);
    const toBackground = new Uint8Array(foam.length);
    for (let i = 0; i < foam.length; i++) toBackground[i] = foam[i] ? 0 : 1;
    const dBg = edtSquared(toBackground, n);
    const eroded = new Uint8Array(foam.length);
    for (let i = 0; i < foam.length; i++) eroded[i] = foam[i] && dBg[i] > r2 ? 1 : 0;
    const dEroded = edtSquared(eroded, n);
    for (let z = EDGE; z <= hi; z++)
      for (let y = EDGE; y <= hi; y++)
        for (let x = EDGE; x <= hi; x++) {
          const i = z * nn + y * n + x;
          if (field[i] > 0 && dEroded[i] > r2) {
            flipTo(i, false);
            stats.branchFt3 += nodeFt3;
          }
        }
  }

  // 2) Sealed void pockets: filled with foam (the engine does this before
  //    the floating-foam pass too, so a filled pocket can't strand a piece).
  if (settings.minPocketFt3 > 0) {
    const inverse = tileMask();
    for (let i = 0; i < inverse.length; i++) inverse[i] = inverse[i] ? 0 : 1;
    // (labelComponents only ever visits tile nodes, so the margin is ignored.)
    const { labels, sizes, touchesFace } = labelComponents(inverse, n);
    const kill = sizes.map((s, id) => id > 0 && !touchesFace[id] && s * nodeFt3 < settings.minPocketFt3);
    for (let id = 1; id < kill.length; id++)
      if (kill[id]) {
        stats.pockets++;
        stats.pocketsFt3 += sizes[id] * nodeFt3;
      }
    if (stats.pockets)
      for (let i = 0; i < labels.length; i++) if (labels[i] && kill[labels[i]]) flipTo(i, true);
  }

  // 3) Floating foam pieces.
  if (settings.minPieceFt3 > 0) {
    const { labels, sizes, touchesFace } = labelComponents(tileMask(), n);
    const kill = sizes.map((s, id) => id > 0 && !touchesFace[id] && s * nodeFt3 < settings.minPieceFt3);
    for (let id = 1; id < kill.length; id++)
      if (kill[id]) {
        stats.pieces++;
        stats.piecesFt3 += sizes[id] * nodeFt3;
      }
    if (stats.pieces)
      for (let i = 0; i < labels.length; i++) if (labels[i] && kill[labels[i]]) flipTo(i, false);
  }

  return { volume: { ...volume, field }, stats };
}

/** Quick foam-volume readout for the builder UI (ft^3 of positive nodes
 * inside the tile) -- lets the cleanup sliders show a sensible upper bound. */
export function foamVolumeFt3(volume: VolumeField, tileFt = 20): number {
  const n = volume.resolution;
  const hi = n - 1 - EDGE;
  const cellFt = tileFt / (n - 5);
  let count = 0;
  for (let z = EDGE; z <= hi; z++)
    for (let y = EDGE; y <= hi; y++)
      for (let x = EDGE; x <= hi; x++) if (volume.field[z * n * n + y * n + x] > 0) count++;
  return count * cellFt * cellFt * cellFt;
}
