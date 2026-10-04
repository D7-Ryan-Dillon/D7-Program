// The one place a loaded or built tile gets everything that is derived from its voxels. Whatever its source (a
// Grasshopper export, the Sections builder, an older saved project), a ParsedTile leaves here carrying levels, rooms,
// routes, daylight, openings, structure and plates -- read from the engine's own files when it had them, measured by
// lib/tiles/analyze.ts when it did not (the two agree: npm run check:parity).

import type { ParsedTile } from "@/lib/types";
import { HEX_APOTHEM } from "@/lib/sections/volumeField";
import { ANALYSIS_VERSION, analyzeTile } from "./analyze";
import { derivePlates } from "./plates";

/** Cells whose centre lies inside the hex prism the Sections builder draws (flats facing +-x, apothem HEX_APOTHEM of the half-width). */
export function hexMask(grid: [number, number, number], tileFt: [number, number, number], cell: number): Uint8Array {
  const [nx, ny, nz] = grid;
  const mask = new Uint8Array(nx * ny * nz);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const wx = (((x + 0.5) * cell) / tileFt[0]) * 2 - 1;
      const wz = (((y + 0.5) * cell) / tileFt[1]) * 2 - 1;
      let inside = true;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        if (Math.abs(wx * Math.cos(a) + wz * Math.sin(a)) > HEX_APOTHEM) inside = false;
      }
      if (inside) for (let z = 0; z < nz; z++) mask[(x * ny + y) * nz + z] = 1;
    }
  return mask;
}

/** True when the tile already carries a current analysis (so nothing has to be measured). */
export function hasCurrentAnalysis(tile: ParsedTile): boolean {
  return tile.spaces?.analysis_version === ANALYSIS_VERSION && !!tile.structure && !!tile.voxels.rooms;
}

/** Returns the tile with spaces / structure / plates / room voxels filled in where they are missing or out of date. */
export function ensureAnalysis(tile: ParsedTile): ParsedTile {
  const vd = tile.voxels.void;
  if (!vd) return tile;
  let next = tile;
  if (!hasCurrentAnalysis(tile)) {
    const hex = tile.shape?.kind === "hex-prism";
    const mask = tile.voxels.mask ?? (hex ? hexMask(tile.grid, tile.tileFt, tile.cellFt) : undefined);
    // outside a hex prism there is neither foam nor void: treat it as foam for the measurements
    let source = vd;
    if (hex && mask) {
      source = new Uint8Array(vd.length);
      for (let i = 0; i < vd.length; i++) source[i] = vd[i] && mask[i] ? 1 : 0;
    }
    const result = analyzeTile({ void: source, grid: tile.grid, cell: tile.cellFt, plates: tile.voxels.plates, struts: tile.voxels.struts, mask });
    next = { ...tile, spaces: result.spaces, structure: result.structure, voxels: { ...tile.voxels, rooms: result.rooms } };
  }
  if (!next.plates && next.voxels.plates) {
    next = { ...next, plates: derivePlates(vd, next.voxels.plates, next.grid, next.cellFt, next.structure) };
  }
  return next;
}
