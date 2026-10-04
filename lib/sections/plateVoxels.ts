// Floor plates on the voxel grid. applyPlates (plates.ts) reports, per field node, how deep inside a slab it is and which
// plate that is; this samples that onto the same 40x40x40 grid voxelize.ts uses (same field position per voxel, so the
// plate cells line up with the tile's void/foam voxels) and keeps only the cells that are foam in the finished tile.

import { sampleVolumeField } from "./volumeField";
import { SECTION_GRID } from "./voxelize";

/** plates[i] = plate id (1..) where the voxel is inside a plate and is foam in the tile, else 0. Returns undefined when there is no plate cell. */
export function voxelizePlates(plateField: Float32Array, plateIds: Uint8Array, resolution: number, voidVoxels: Uint8Array): Uint8Array | undefined {
  const [nx, ny, nz] = SECTION_GRID;
  const n = resolution;
  const remap = (w: number) => ((n - 5) * w - 1) / (n - 4);
  const out = new Uint8Array(nx * ny * nz);
  let any = false;
  for (let x = 0; x < nx; x++) {
    const wx = remap((2 * (x + 0.5)) / nx - 1);
    for (let y = 0; y < ny; y++) {
      const wy = remap((2 * (y + 0.5)) / ny - 1);
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (voidVoxels[i]) continue;
        // our vertical Z is the field's local Y, our horizontal Y its local Z (see voxelize.ts)
        const wz = remap((2 * (z + 0.5)) / nz - 1);
        if (sampleVolumeField(plateField, n, wx, wz, wy) <= 0) continue;
        // which plate: the nearest node's (the field itself is blended, ids are not)
        const gx = Math.max(0, Math.min(n - 1, Math.round((wx * (n - 4) + n) / 2)));
        const gy = Math.max(0, Math.min(n - 1, Math.round((wz * (n - 4) + n) / 2)));
        const gz = Math.max(0, Math.min(n - 1, Math.round((wy * (n - 4) + n) / 2)));
        const id = plateIds[gz * n * n + gy * n + gx];
        if (id) {
          out[i] = id;
          any = true;
        }
      }
    }
  }
  return any ? out : undefined;
}
