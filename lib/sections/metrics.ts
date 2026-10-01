// Aggregate TileMetrics for a converted tile -- void volume/fraction,
// connected void pieces, bounding box, and the per-layer profiles
// lib/scoring/primitives.ts reads directly (floor_area_by_z_ft2,
// void_area_profile_ft2). Pure voxel-grid arithmetic, no lofting/meshing
// concerns -- the same metrics a Grasshopper tile.json carries, computed
// here instead of by the erosion engine.

import type { FaceMetric, FaceName, TileMetrics } from "@/lib/types";
import { computeVoidAreaProfiles } from "./sectionsData";
import { SECTION_CELL_FT } from "./voxelize";

function floodFillVoidPieces(voidVoxels: Uint8Array, grid: [number, number, number]): { count: number; largestCells: number } {
  const [nx, ny, nz] = grid;
  const visited = new Uint8Array(voidVoxels.length);
  const index = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  let pieces = 0;
  let largest = 0;

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const start = index(x, y, z);
        if (!voidVoxels[start] || visited[start]) continue;
        pieces++;
        let size = 0;
        const stack: [number, number, number][] = [[x, y, z]];
        visited[start] = 1;
        while (stack.length) {
          const [cx, cy, cz] = stack.pop()!;
          size++;
          const neighbors: [number, number, number][] = [
            [cx - 1, cy, cz],
            [cx + 1, cy, cz],
            [cx, cy - 1, cz],
            [cx, cy + 1, cz],
            [cx, cy, cz - 1],
            [cx, cy, cz + 1],
          ];
          for (const [nx2, ny2, nz2] of neighbors) {
            if (nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz) continue;
            const i = index(nx2, ny2, nz2);
            if (!voidVoxels[i] || visited[i]) continue;
            visited[i] = 1;
            stack.push([nx2, ny2, nz2]);
          }
        }
        if (size > largest) largest = size;
      }
    }
  }
  return { count: pieces, largestCells: largest };
}

function voidBoundingBox(voidVoxels: Uint8Array, grid: [number, number, number]): { min_ft: number[]; max_ft: number[]; centroid_ft: number[] } | undefined {
  const [nx, ny, nz] = grid;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumX = 0, sumY = 0, sumZ = 0, n = 0;
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        if (!voidVoxels[(x * ny + y) * nz + z]) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        sumX += x; sumY += y; sumZ += z; n++;
      }
    }
  }
  if (!n) return undefined;
  const c = SECTION_CELL_FT;
  return {
    min_ft: [minX * c, minY * c, minZ * c],
    max_ft: [(maxX + 1) * c, (maxY + 1) * c, (maxZ + 1) * c],
    centroid_ft: [(sumX / n + 0.5) * c, (sumY / n + 0.5) * c, (sumZ / n + 0.5) * c],
  };
}

function floorAreaByZ(voidVoxels: Uint8Array, grid: [number, number, number]): number[] {
  const [nx, ny, nz] = grid;
  const cellAreaFt2 = SECTION_CELL_FT * SECTION_CELL_FT;
  const out: number[] = [];
  for (let z = 0; z < nz; z++) {
    let foamCells = 0;
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) if (!voidVoxels[(x * ny + y) * nz + z]) foamCells++;
    out.push(foamCells * cellAreaFt2);
  }
  return out;
}

export function computeTileMetrics(
  voidVoxels: Uint8Array,
  grid: [number, number, number],
  tileFt: [number, number, number],
  faceMetrics: Partial<Record<FaceName, FaceMetric>>,
): TileMetrics {
  const cellFt3 = SECTION_CELL_FT ** 3;
  const voidCells = voidVoxels.reduce((sum, v) => sum + v, 0);
  const voidVolumeFt3 = voidCells * cellFt3;
  const tileVolumeFt3 = tileFt[0] * tileFt[1] * tileFt[2];
  const { count: voidPieces, largestCells } = floodFillVoidPieces(voidVoxels, grid);
  const openAreaOnFacesFt2 = Object.values(faceMetrics).reduce((sum, f) => sum + (f?.open_area_ft2 ?? 0), 0);
  const voidBbox = voidBoundingBox(voidVoxels, grid);

  return {
    void_volume_ft3: voidVolumeFt3,
    tile_volume_ft3: tileVolumeFt3,
    void_fraction: tileVolumeFt3 > 0 ? voidVolumeFt3 / tileVolumeFt3 : 0,
    foam_volume_ft3: tileVolumeFt3 - voidVolumeFt3,
    void_pieces: voidPieces,
    largest_void_ft3: largestCells * cellFt3,
    faces: faceMetrics,
    open_area_on_faces_ft2: openAreaOnFacesFt2,
    floor_area_by_z_ft2: floorAreaByZ(voidVoxels, grid),
    void_area_profile_ft2: computeVoidAreaProfiles(voidVoxels, grid),
    void_bbox: voidBbox,
    void_z_range_ft: voidBbox ? [voidBbox.min_ft[2], voidBbox.max_ft[2]] : undefined,
  };
}
