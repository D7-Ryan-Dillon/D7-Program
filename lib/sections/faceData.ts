// Builds the per-face data a converted tile needs for Analysis scoring --
// mask_rows_6in (lib/scoring/faceBranches.ts) and open_area_ft2
// (lib/scoring/primitives.ts) -- for both box and hex-prism shapes.
//
// Scope note: depth_cells/max_depth_ft/outline_uv_ft/plane exist on a real
// Grasshopper export's faces.json (mostly to drive its rendered face
// images), but nothing in this app's scoring reads them -- only mask_rows
// (/_6in) and open_area_ft2 do. Per the "data only, no rendered images"
// call for converted tiles, those fields are left out rather than
// fabricated; FaceEntry already types them optional.

import type { FaceEntry, FaceMetric, FaceName, TileShape } from "@/lib/types";
import type { SectionTrace } from "./volumeField";
import { faceMask } from "./volumeField";
import { SECTION_CELL_FT } from "./voxelize";

export interface FaceLayout {
  rows: number;
  cols: number;
  /** Reads one cell of the (box) voxel grid for this face's local (row, col). */
  at: (row: number, col: number) => [number, number, number];
}

/** Box-face layouts, matching lib/arrange/transforms.ts's faceLayer exactly
 * (same grid, same convention) -- the two are independent implementations
 * on purpose (lib/arrange is Arrange-tab-only and explicitly not touched by
 * this work), but they must agree on what "the +X face" means. Exported for
 * lib/sections/exportAnalysis.ts's depth-scan, which needs the same
 * per-face (row, col) -> voxel mapping but walking inward from the face
 * rather than just reading its own layer. */
export function boxFaceLayout(face: FaceName, grid: [number, number, number]): FaceLayout {
  const [nx, ny, nz] = grid;
  if (face === "-X" || face === "+X") {
    const x = face === "-X" ? 0 : nx - 1;
    return { rows: ny, cols: nz, at: (row, col) => [x, row, col] };
  }
  if (face === "-Y" || face === "+Y") {
    const y = face === "-Y" ? 0 : ny - 1;
    return { rows: nx, cols: nz, at: (row, col) => [row, y, col] };
  }
  // "-Z"/"+Z" (box) and "bottom"/"top" (hex-prism, see voxelize.ts's axis
  // remap -- a hex-prism's top/bottom are genuinely a Z-layer here too).
  const z = face === "-Z" || face === "bottom" ? 0 : nz - 1;
  return { rows: nx, cols: ny, at: (row, col) => [row, col, z] };
}

function maskRowsFromVoxels(voidVoxels: Uint8Array, grid: [number, number, number], layout: FaceLayout): string[] {
  const [, ny, nz] = grid;
  const rows: string[] = [];
  for (let r = 0; r < layout.rows; r++) {
    let row = "";
    for (let c = 0; c < layout.cols; c++) {
      const [x, y, z] = layout.at(r, c);
      row += voidVoxels[(x * ny + y) * nz + z] ? "1" : "0";
    }
    rows.push(row);
  }
  return rows;
}

/** Nearest-neighbor resample of a square binary mask -- used only for a
 * hex-prism's 6 angled side faces, whose real cross-section can't be read
 * as a simple axis-aligned slice of this app's axis-aligned voxel grid, so
 * the side's own originally-drawn 2D trace mask is reused directly instead
 * of re-deriving it (more faithful anyway: it's the exact drawn shape, not
 * a lossy voxelize+remesh round trip of it). */
function resampleMask(source: Uint8Array, sourceSize: number, targetSize: number): string[] {
  const rows: string[] = [];
  for (let r = 0; r < targetSize; r++) {
    const sr = Math.min(sourceSize - 1, Math.floor((r * sourceSize) / targetSize));
    let row = "";
    for (let c = 0; c < targetSize; c++) {
      const sc = Math.min(sourceSize - 1, Math.floor((c * sourceSize) / targetSize));
      row += source[sr * sourceSize + sc] ? "1" : "0";
    }
    rows.push(row);
  }
  return rows;
}

function countOpen(rows: string[]): number {
  let n = 0;
  for (const row of rows) for (const ch of row) if (ch === "1") n++;
  return n;
}

/** Builds {mask_rows(_6in), open_cells, open_area_ft2} for every face of a
 * tile, box or hex-prism alike, plus the matching TileMetrics.faces summary
 * (open_area_ft2 only, what lib/scoring/primitives.ts actually reads). This
 * app's own cell size (SECTION_CELL_FT, 0.5 ft) already *is* 6 inches, so
 * mask_rows and mask_rows_6in are identical here -- there's no separate
 * "native resolution" to preserve the way a Grasshopper export sometimes
 * has. `sideTraces` supplies each hex side's own originally-drawn 2D trace
 * (ignored for a box tile, which has no "side" faces). */
export function computeFaceData(
  shape: TileShape,
  faceNames: FaceName[],
  voidVoxels: Uint8Array,
  grid: [number, number, number],
  sideTraces: Partial<Record<FaceName, SectionTrace>>,
): { faces: Partial<Record<FaceName, FaceEntry>>; faceMetrics: Partial<Record<FaceName, FaceMetric>> } {
  const faces: Partial<Record<FaceName, FaceEntry>> = {};
  const faceMetrics: Partial<Record<FaceName, FaceMetric>> = {};
  const cellAreaFt2 = SECTION_CELL_FT * SECTION_CELL_FT;

  for (const face of faceNames) {
    const isHexSide = shape.kind === "hex-prism" && face.startsWith("side");
    let rows: string[];
    if (isHexSide) {
      const trace = sideTraces[face];
      const targetSize = Math.round(20 / SECTION_CELL_FT); // a hex side is 20 ft wide at this app's default size
      if (!trace) {
        rows = Array.from({ length: targetSize }, () => "0".repeat(targetSize));
      } else {
        // faceMask's 1 = drawn mass; a face's *void* mask (what mask_rows
        // means everywhere else) is the inverse.
        const mass = faceMask(trace, 112);
        const voidMask = mass.map((v) => (v ? 0 : 1));
        rows = resampleMask(voidMask, 112, targetSize);
      }
    } else {
      rows = maskRowsFromVoxels(voidVoxels, grid, boxFaceLayout(face, grid));
    }
    const openCells = countOpen(rows);
    const openAreaFt2 = openCells * cellAreaFt2;
    faces[face] = { mask_rows: rows, mask_rows_6in: rows, open_cells: openCells, open_area_ft2: openAreaFt2 };
    faceMetrics[face] = { open_cells: openCells, open_area_ft2: openAreaFt2 };
  }

  return { faces, faceMetrics };
}
