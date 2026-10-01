// Samples a lofted VolumeField onto this app's own voxel grid convention
// (HANDOFF.md section 3: 0.5 ft cells, Z up, origin at the tile's low
// corner, C-order with z fastest) so a Section-Field-origin tile is
// indistinguishable, as data, from a Grasshopper-exported one.

import type { TileVoxels } from "@/lib/types";
import { sampleVolumeField, type VolumeField } from "./volumeField";

// Every generated tile -- box or hex-prism alike -- defaults to the same
// bounding box as a Grasshopper tile, so the two interoperate (same grid
// size, same real-world scale) without Arrange needing to special-case
// where a tile came from.
export const SECTION_TILE_FT: [number, number, number] = [20, 20, 20];
export const SECTION_CELL_FT = 0.5;
export const SECTION_GRID: [number, number, number] = [40, 40, 40];
// A hex-prism's flat-to-flat width and height both match the cube's own
// 20 ft edge -- "the same size", just a different footprint.
export const SECTION_HEX_APOTHEM_FT = SECTION_TILE_FT[0] / 2;
export const SECTION_HEX_HEIGHT_FT = SECTION_TILE_FT[2];

/** Samples `volume` onto SECTION_GRID, producing this app's standard void/
 * material/void-smooth channels (positive field = foam, negative = void --
 * see volumeField.ts). There's no real "softness" data for a lofted shape
 * (that's a physical erosion-simulation property), so that channel is left
 * unset rather than inventing a value for it.
 *
 * Axis note: volumeField's local space is Y-up (its "top"/"bottom" faces
 * read along local Y -- see its coordinates() function), matching how
 * three.js/GLB normally model a cube. This app's voxel grid is Z-up feet
 * (HANDOFF section 5), so the vertical axis is remapped here: our grid Z
 * becomes the field's local Y, and our grid Y becomes the field's local Z.
 */
export function voxelizeVolumeField(volume: VolumeField): TileVoxels {
  const [nx, ny, nz] = SECTION_GRID;
  const count = nx * ny * nz;
  const voidChannel = new Uint8Array(count);
  const material = new Uint8Array(count);
  const voidSmooth = new Uint8Array(count);

  for (let x = 0; x < nx; x++) {
    const worldX = (2 * (x + 0.5)) / nx - 1;
    for (let y = 0; y < ny; y++) {
      // Our horizontal Y -> the field's local Z.
      const worldZLocal = (2 * (y + 0.5)) / ny - 1;
      for (let z = 0; z < nz; z++) {
        // Our vertical Z -> the field's local (up) Y.
        const worldYLocal = (2 * (z + 0.5)) / nz - 1;
        const value = sampleVolumeField(volume.field, volume.resolution, worldX, worldYLocal, worldZLocal);
        const i = (x * ny + y) * nz + z;
        voidChannel[i] = value < 0 ? 1 : 0;
        material[i] = Math.round(255 * Math.max(0, Math.min(1, (value + 1) / 2)));
        voidSmooth[i] = Math.round(255 * Math.max(0, Math.min(1, (1 - value) / 2)));
      }
    }
  }

  return { void: voidChannel, material, voidSmooth };
}
