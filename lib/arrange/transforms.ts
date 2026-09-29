import type { FaceName } from "@/lib/types";

export type Grid3 = [number, number, number];

/**
 * Voxel transform conventions, exactly per HANDOFF.md section 5
 * (`transform_voxels`): mirror letters flip the void array about the tile
 * centre along that axis; rot is quarter turns about the vertical axis
 * through the tile centre, `np.rot90(void, rot, axes=(0,1))`. Mirror is
 * applied first, then rotation. Arrays are C-order, z fastest:
 * index = (x*ny + y)*nz + z.
 */
export function mirrorAxis(src: Uint8Array, grid: Grid3, axis: 0 | 1 | 2): Uint8Array {
  const [nx, ny, nz] = grid;
  const out = new Uint8Array(src.length);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const sx = axis === 0 ? nx - 1 - x : x;
        const sy = axis === 1 ? ny - 1 - y : y;
        const sz = axis === 2 ? nz - 1 - z : z;
        out[(x * ny + y) * nz + z] = src[(sx * ny + sy) * nz + sz];
      }
    }
  }
  return out;
}

/** One quarter turn about Z: new[x,y,z] = old[y, nx-1-x, z] (matches np.rot90(..., axes=(0,1))). Requires nx === ny. */
export function rotate90Z(src: Uint8Array, grid: Grid3): Uint8Array {
  const [nx, ny, nz] = grid;
  const out = new Uint8Array(src.length);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        out[(x * ny + y) * nz + z] = src[(y * ny + (nx - 1 - x)) * nz + z];
      }
    }
  }
  return out;
}

export function applyTransform(src: Uint8Array, grid: Grid3, mirror: string, rot: number): Uint8Array {
  let g = src;
  for (const ch of mirror.toLowerCase()) {
    if (ch === "x") g = mirrorAxis(g, grid, 0);
    else if (ch === "y") g = mirrorAxis(g, grid, 1);
    else if (ch === "z") g = mirrorAxis(g, grid, 2);
  }
  const k = ((Math.round(rot) % 4) + 4) % 4;
  for (let i = 0; i < k; i++) g = rotate90Z(g, grid);
  return g;
}

/** Extracts one face's boundary layer from an already-transformed grid, as a flat 0/1 array. */
export function faceLayer(g: Uint8Array, grid: Grid3, face: FaceName): Uint8Array {
  const [nx, ny, nz] = grid;
  if (face === "-X" || face === "+X") {
    const x = face === "-X" ? 0 : nx - 1;
    const out = new Uint8Array(ny * nz);
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) out[y * nz + z] = g[(x * ny + y) * nz + z];
    return out;
  }
  if (face === "-Y" || face === "+Y") {
    const y = face === "-Y" ? 0 : ny - 1;
    const out = new Uint8Array(nx * nz);
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) out[x * nz + z] = g[(x * ny + y) * nz + z];
    return out;
  }
  const z = face === "-Z" ? 0 : nz - 1;
  const out = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) out[x * ny + y] = g[(x * ny + y) * nz + z];
  return out;
}

export const OPPOSITE_FACE: Record<FaceName, FaceName> = {
  "+X": "-X", "-X": "+X", "+Y": "-Y", "-Y": "+Y", "+Z": "-Z", "-Z": "+Z",
};

export const FACE_DELTA: Record<FaceName, [number, number, number]> = {
  "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1],
};

function countOpen(layer: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < layer.length; i++) if (layer[i]) n++;
  return n;
}

/** A face counts as "open" using the project's own convention (HANDOFF section 5): at least 8 ft2. */
export function isFaceOpen(layer: Uint8Array, cellFt: number): boolean {
  const minCells = 8 / (cellFt * cellFt);
  return countOpen(layer) >= minCells;
}
