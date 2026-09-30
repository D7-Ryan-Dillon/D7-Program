// Connected-component decomposition of a tile face's opening mask
// (faces.json's mask_rows_6in -- a fixed 6" grid, chosen by the exporter
// specifically so it's comparable between tiles regardless of native cell
// size; see HANDOFF section 5). A "branch" is one maximal 4-connected run of
// open cells: a physically distinct reach/opening on that face, as opposed
// to the face's total open area collapsed into one number. Used by the
// Porous and Non-hierarchical Circulation descriptors to count distinct
// openings, not just how much area is open in total.

import type { FaceName, ParsedTile } from "@/lib/types";

const CELL_FT = 0.5; // mask_rows_6in resolution
const CELL_AREA_FT2 = CELL_FT * CELL_FT;

// A lone cell or two is almost always voxelization noise at this
// resolution, not a real, usable opening -- small enough to keep genuinely
// distinct small openings, large enough to drop single/double-cell speckle.
const MIN_BRANCH_AREA_FT2 = 1.5;

export interface FaceBranch {
  areaFt2: number;
}

function floodFillBranches(rows: string[]): number[][] {
  const nRows = rows.length;
  const visited: boolean[][] = rows.map((r) => new Array(r.length).fill(false));
  const groups: number[][] = [];

  for (let r = 0; r < nRows; r++) {
    const line = rows[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== "1" || visited[r][c]) continue;
      const group: number[] = [];
      const stack: [number, number][] = [[r, c]];
      visited[r][c] = true;
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        group.push(1);
        const neighbors: [number, number][] = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nr >= nRows) continue;
          const nline = rows[nr];
          if (nc < 0 || nc >= nline.length) continue;
          if (visited[nr][nc] || nline[nc] !== "1") continue;
          visited[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      groups.push(group);
    }
  }
  return groups;
}

/** All real (non-noise) branches on one face of a tile, largest first. Empty
 * if the tile has no faces.json or that face's mask wasn't exported. */
export function computeFaceBranches(tile: ParsedTile, faceName: FaceName): FaceBranch[] {
  const rows = tile.faces?.faces?.[faceName]?.mask_rows_6in;
  if (!rows || !rows.length) return [];
  return floodFillBranches(rows)
    .map((cells) => ({ areaFt2: cells.length * CELL_AREA_FT2 }))
    .filter((b) => b.areaFt2 >= MIN_BRANCH_AREA_FT2)
    .sort((a, b) => b.areaFt2 - a.areaFt2);
}
