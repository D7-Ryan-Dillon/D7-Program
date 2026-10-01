// Builds a sections.json-equivalent (X/Y/Z slice void area/fraction) for a
// converted tile, the same shape a Grasshopper export's data/sections.json
// has -- data only, no rendered slice images (see HANDOFF section 3's
// `images/sections/` -- nothing reads those programmatically either).
// Nothing in current scoring reads this; it exists for review today and
// for the Arrange rework the project owner wants to use it in later.

import type { SectionEntry, SectionsJson } from "@/lib/types";
import { SECTION_CELL_FT } from "./voxelize";

const DEFAULT_SECTION_COUNT = 9; // matches the Grasshopper exporter's own default (HANDOFF section 3)

function sliceVoidAreaFt2(voidVoxels: Uint8Array, grid: [number, number, number], axis: "X" | "Y" | "Z", index: number): number {
  const [nx, ny, nz] = grid;
  let open = 0;
  if (axis === "X") {
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) if (voidVoxels[(index * ny + y) * nz + z]) open++;
  } else if (axis === "Y") {
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) if (voidVoxels[(x * ny + index) * nz + z]) open++;
  } else {
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) if (voidVoxels[(x * ny + y) * nz + index]) open++;
  }
  return open * SECTION_CELL_FT * SECTION_CELL_FT;
}

/** Evenly-spaced slices along one axis, same convention as the Grasshopper
 * exporter (position_ft counted from the tile's own low corner). */
function sectionsForAxis(voidVoxels: Uint8Array, grid: [number, number, number], tileFt: [number, number, number], axis: "X" | "Y" | "Z", count: number): SectionEntry[] {
  const axisIndex = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  const n = grid[axisIndex];
  const tileAreaFt2 =
    axis === "X" ? tileFt[1] * tileFt[2] : axis === "Y" ? tileFt[0] * tileFt[2] : tileFt[0] * tileFt[1];
  const sections: SectionEntry[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.min(n - 1, Math.round(((i + 0.5) / count) * n));
    const voidAreaFt2 = sliceVoidAreaFt2(voidVoxels, grid, axis, index);
    sections.push({
      axis,
      index: i,
      position_ft: (index + 0.5) * SECTION_CELL_FT,
      void_area_ft2: voidAreaFt2,
      void_fraction: tileAreaFt2 > 0 ? voidAreaFt2 / tileAreaFt2 : 0,
    });
  }
  return sections;
}

export function computeSectionsData(
  voidVoxels: Uint8Array,
  grid: [number, number, number],
  tileFt: [number, number, number],
  count = DEFAULT_SECTION_COUNT,
): SectionsJson {
  return {
    schema: "section-field-tile/1",
    sections: [
      ...sectionsForAxis(voidVoxels, grid, tileFt, "X", count),
      ...sectionsForAxis(voidVoxels, grid, tileFt, "Y", count),
      ...sectionsForAxis(voidVoxels, grid, tileFt, "Z", count),
    ],
  };
}

/** The dense, full-resolution version of the same per-slice void area --
 * one value per grid layer, not just DEFAULT_SECTION_COUNT samples -- which
 * is what TileMetrics.void_area_profile_ft2 actually is and what
 * lib/scoring/primitives.ts's axisProfileStats needs for a meaningful
 * compression/smoothness read. */
export function computeVoidAreaProfiles(voidVoxels: Uint8Array, grid: [number, number, number]): { x: number[]; y: number[]; z: number[] } {
  const [nx, ny, nz] = grid;
  const x = Array.from({ length: nx }, (_, i) => sliceVoidAreaFt2(voidVoxels, grid, "X", i));
  const y = Array.from({ length: ny }, (_, i) => sliceVoidAreaFt2(voidVoxels, grid, "Y", i));
  const z = Array.from({ length: nz }, (_, i) => sliceVoidAreaFt2(voidVoxels, grid, "Z", i));
  return { x, y, z };
}
