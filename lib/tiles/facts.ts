// What an assembly needs to know about a tile's edges, ready for the Arrange overhaul. NOT imported by Arrange: this round
// leaves Arrange untouched. It only gathers, for any tile and any quarter-turn / mirror, the layers each face carries and the
// floors it has, so the new Arrange can decide joints by more than void-on-void (floor continuity, foam on foam).
//
//   void     1 = an opening (what joints are scored on today)
//   foam     1 = foam that is not a plate
//   plate    1 = a floor plate (a floor that should meet the neighbour's floor)
//   outside  1 = outside the tile's container (non-cube tiles only; absent for a cube)
//
// Rows are the engine's stored order: X faces [y][z], Y faces [x][z], Z faces [x][y], one string per row.

import type { FaceName, ParsedTile } from "@/lib/types";
import type { LevelInfo } from "@/lib/tiles/types";

export interface FaceLayers {
  void: string[];
  foam: string[];
  plate: string[];
  outside?: string[];
}

export interface TileFacts {
  faces: Partial<Record<FaceName, FaceLayers>>;
  levels: LevelInfo[];
  /** a plain box (the only envelope today's Arrange handles) */
  isCube: boolean;
  cellFt: number;
  tileFt: [number, number, number];
}

const blank = (rows: string[] | undefined) => (rows ?? []).map((r) => "0".repeat(r.length));

/** The layers of every face as the tile stands (no transform). */
export function tileFacts(tile: ParsedTile): TileFacts {
  const faces: TileFacts["faces"] = {};
  for (const [name, entry] of Object.entries(tile.faces?.faces ?? {})) {
    if (!entry?.mask_rows) continue;
    faces[name] = {
      void: entry.mask_rows,
      foam: entry.foam_mask_rows ?? entry.mask_rows.map((r) => [...r].map((c) => (c === "1" ? "0" : "1")).join("")),
      plate: entry.plate_mask_rows ?? blank(entry.mask_rows),
      outside: entry.outside_mask_rows,
    };
  }
  return { faces, levels: tile.spaces?.levels ?? [], isCube: tile.shape?.kind !== "hex-prism" && !tile.voxels.mask, cellFt: tile.cellFt, tileFt: tile.tileFt };
}

/** Which of the tile's own faces ends up where, for a tile mirrored in X first (optional) and then turned `quarterTurns` (0-3) about Z: the face name in
 * the assembly -> the tile's own face name. Only the name; a consumer still reads that face's rows reversed or transposed as the move requires. */
export function faceSource(after: FaceName, quarterTurns: number, mirrorX: boolean): FaceName {
  // a quarter turn about Z (counter-clockwise from above) takes +X to +Y, +Y to -X, -X to -Y, -Y to +X; Z faces stay
  const ring: FaceName[] = ["+X", "+Y", "-X", "-Y"];
  let name = after;
  const i = ring.indexOf(name);
  if (i >= 0) name = ring[(i - (((quarterTurns % 4) + 4) % 4) + 4) % 4];
  if (mirrorX) name = name === "+X" ? "-X" : name === "-X" ? "+X" : name;
  return name;
}
