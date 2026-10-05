// A smooth surface through a voxel field (naive surface nets): one vertex per cell the surface passes through, placed
// at the average of its edge crossings, joined into quads across every sign-changing edge. Works on any box of voxels
// (three's MarchingCubes only does cubes), and is what turns an arrangement's combined voxels into one smooth mesh.

import type { Dims } from "./orient";

export interface MeshData {
  /** x, y, z triples in grid units (a vertex at grid point i is at voxel i's centre) */
  positions: Float32Array;
  indices: Uint32Array;
}

/** Smooths a 0/1 voxel array into a 0..1 field with `passes` rounds of a [1 2 1] / 4 blur along each axis, padded by `pad` empty cells on every side so closed surfaces close. */
export function blurField(voxels: ArrayLike<number>, [nx, ny, nz]: Dims, pad: number, passes: number): { field: Float32Array; dims: Dims } {
  const dims: Dims = [nx + 2 * pad, ny + 2 * pad, nz + 2 * pad];
  const [px, py, pz] = dims;
  let a = new Float32Array(px * py * pz);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) a[((x + pad) * py + (y + pad)) * pz + z + pad] = voxels[(x * ny + y) * nz + z] ? 1 : 0;
  let b = new Float32Array(a.length);
  const strides = [py * pz, pz, 1];
  for (let pass = 0; pass < passes; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const s = strides[axis];
      const n = dims[axis];
      for (let i = 0; i < a.length; i++) {
        const c = axis === 0 ? ((i / strides[0]) | 0) : axis === 1 ? (((i / strides[1]) | 0) % py) : i % pz;
        const lo = c > 0 ? a[i - s] : a[i];
        const hi = c < n - 1 ? a[i + s] : a[i];
        b[i] = 0.25 * lo + 0.5 * a[i] + 0.25 * hi;
      }
      const t = a;
      a = b;
      b = t;
    }
  }
  return { field: a, dims };
}

export function surfaceNets(field: Float32Array, [nx, ny, nz]: Dims, iso = 0.5): MeshData {
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(Math.max(0, cx * cy * cz)).fill(-1);
  const positions: number[] = [];
  const idx = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  const cidx = (x: number, y: number, z: number) => (x * cy + y) * cz + z;
  const corner = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const vals = new Float32Array(8);
  let count = 0;
  for (let x = 0; x < cx; x++)
    for (let y = 0; y < cy; y++)
      for (let z = 0; z < cz; z++) {
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const v = field[idx(x + corner[k][0], y + corner[k][1], z + corner[k][2])];
          vals[k] = v;
          if (v >= iso) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const ia = (mask >> a) & 1;
          const ib = (mask >> b) & 1;
          if (ia === ib) continue;
          const t = (iso - vals[a]) / (vals[b] - vals[a]);
          sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
          sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
          sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
          n++;
        }
        cellVert[cidx(x, y, z)] = count++;
        positions.push(x + sx / n, y + sy / n, z + sz / n);
      }
  const tris: number[] = [];
  const dimsArr = [nx, ny, nz];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const inside = field[idx(x, y, z)] >= iso;
        const p = [x, y, z];
        for (let axis = 0; axis < 3; axis++) {
          const q = [x, y, z];
          q[axis]++;
          if (q[axis] >= dimsArr[axis]) continue;
          if (inside === field[idx(q[0], q[1], q[2])] >= iso) continue;
          const a = (axis + 1) % 3;
          const b = (axis + 2) % 3;
          if (p[a] < 1 || p[b] < 1 || p[a] > dimsArr[a] - 2 || p[b] > dimsArr[b] - 2) continue;
          const cell = (da: number, db: number) => {
            const c = [p[0], p[1], p[2]];
            c[a] += da;
            c[b] += db;
            return cellVert[cidx(c[0], c[1], c[2])];
          };
          const v00 = cell(-1, -1);
          const v10 = cell(0, -1);
          const v11 = cell(0, 0);
          const v01 = cell(-1, 0);
          if (v00 < 0 || v10 < 0 || v11 < 0 || v01 < 0) continue;
          if (inside) tris.push(v00, v10, v11, v00, v11, v01);
          else tris.push(v00, v11, v10, v00, v01, v11);
        }
      }
  return { positions: new Float32Array(positions), indices: new Uint32Array(tris) };
}
