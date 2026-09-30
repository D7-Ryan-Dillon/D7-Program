// Connected-component decomposition of a (transformed) tile face's void
// layer -- a "branch" is one maximal 4-connected run of open cells: a
// physically distinct opening on that face, as opposed to the face's total
// open area collapsed into one open/closed bit. This is what lets several
// neighbours attach to the same face at their own distinct openings instead
// of only ever growing one flush plane per face (a literal reading of
// "branch and stuff in different ways").
//
// Unlike lib/scoring/faceBranches.ts (which reads faces.json's fixed-6"
// mask for cross-tile-comparable descriptor scoring), this operates directly
// on the tile's own native-resolution voxel grid, already mirrored/rotated
// for this placement -- the same array lib/arrange/joints.ts scores against,
// so a branch's cells are pixel-exact with what actually got matched.

import type { FaceName } from "@/lib/types";
import type { Grid3 } from "./transforms";

const MIN_BRANCH_CELLS = 6; // a handful of cells is voxelization noise, not a real opening

export interface FaceBranch {
  /** Centroid in this (transformed) instance's own local grid-cell coordinates. */
  centroidCell: [number, number, number];
  areaCells: number;
}

/** Row/col dims and how to read back a 3D grid coordinate from (row, col) on
 * a given face -- mirrors faceLayer()'s own flattening exactly. */
function faceGeometry(face: FaceName, grid: Grid3): { rows: number; cols: number; toCell: (row: number, col: number) => [number, number, number] } {
  const [nx, ny, nz] = grid;
  if (face === "-X" || face === "+X") {
    const x = face === "-X" ? 0 : nx - 1;
    return { rows: ny, cols: nz, toCell: (row, col) => [x, row, col] };
  }
  if (face === "-Y" || face === "+Y") {
    const y = face === "-Y" ? 0 : ny - 1;
    return { rows: nx, cols: nz, toCell: (row, col) => [row, y, col] };
  }
  const z = face === "-Z" ? 0 : nz - 1;
  return { rows: nx, cols: ny, toCell: (row, col) => [row, col, z] };
}

/** All real (non-noise) branches on one already-extracted face layer, largest first. */
export function computeBranches(layer: Uint8Array, face: FaceName, grid: Grid3): FaceBranch[] {
  const { rows, cols, toCell } = faceGeometry(face, grid);
  const at = (r: number, c: number) => layer[r * cols + c];
  const visited = new Uint8Array(rows * cols);
  const branches: FaceBranch[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(r, c) || visited[r * cols + c]) continue;
      const stack: [number, number][] = [[r, c]];
      visited[r * cols + c] = 1;
      let count = 0;
      let rSum = 0;
      let cSum = 0;
      while (stack.length) {
        const [cr, cc] = stack.pop()!;
        count++;
        rSum += cr;
        cSum += cc;
        const neighbors: [number, number][] = [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (visited[nr * cols + nc] || !at(nr, nc)) continue;
          visited[nr * cols + nc] = 1;
          stack.push([nr, nc]);
        }
      }
      if (count >= MIN_BRANCH_CELLS) {
        branches.push({ centroidCell: toCell(rSum / count, cSum / count), areaCells: count });
      }
    }
  }
  return branches.sort((a, b) => b.areaCells - a.areaCells);
}
