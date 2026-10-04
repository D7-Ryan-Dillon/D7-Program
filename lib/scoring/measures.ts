// Everything the twelve descriptors read, gathered once per tile: its spaces (levels, rooms, route, light, openings), its
// structure, its metrics and the recipe settings. Spaces and structure come from lib/tiles (the engine's own data, or the
// browser's measurement of the voxels -- the same numbers either way), so a tile from the Sections builder is read exactly
// like one from Grasshopper.

import { computePrimitives, type ScoringPrimitives } from "@/lib/scoring/primitives";
import type { ParsedTile } from "@/lib/types";
import type { LevelInfo, OpeningEntry, ProfileInfo, RoomInfo, RouteInfo, SpacesData, StructureInfo } from "@/lib/tiles/types";

export interface SourceFacts {
  mode: string;
  dose: number;
  plateMode: string;
  cut: boolean;
}

export interface Measures {
  tile: ParsedTile;
  spaces: SpacesData;
  structure: StructureInfo;
  prim: ScoringPrimitives;
  cell: number;
  tileVolumeFt3: number;
  voidPct: number;
  voidFt3: number;
  voidPieces: number;
  largestVoidFt3: number;
  singlePiecePct: number;
  levels: LevelInfo[];
  rooms: RoomInfo[];
  route: RouteInfo | null;
  routes: RouteInfo[];
  profile: ProfileInfo | null;
  /** the six faces, with their opening counts and areas */
  openings: Record<string, OpeningEntry>;
  /** openings on the four side faces, largest first */
  sideAreas: number[];
  openingCount: number;
  facesReached: string[];
  openAreaFt2: number;
  /** the void's own skin (smooth mesh when the engine measured it, else the voxel walls) */
  skinFt2: number;
  /** open area as a share of that skin, 0..1 */
  porosity: number;
  tallest: { room: RoomInfo | null; clearFt: number; widthFt: number; ratio: number };
  sources: SourceFacts[];
  hasRecipe: boolean;
  /** mean plate resistance from the recipe's plate groups (1 = like the foam) */
  plateResistance: number | null;
}

const SIDE = ["-X", "+X", "-Y", "+Y"];

function readSources(tile: ParsedTile): SourceFacts[] {
  const out: SourceFacts[] = [];
  for (const item of tile.config.sources ?? []) {
    try {
      const d = JSON.parse(item);
      out.push({ mode: typeof d.mode === "string" ? d.mode : "inject", dose: typeof d.dose === "number" ? d.dose : 0, plateMode: typeof d.plate_mode === "string" ? d.plate_mode.toLowerCase() : "pool", cut: !!d.cut });
    } catch {
      // a malformed entry only costs the reading one source
    }
  }
  return out;
}

/** Null when the tile has no voxel data to read (nothing was measured, so nothing can be scored). */
export function measuresFor(tile: ParsedTile): Measures | null {
  const spaces = tile.spaces;
  const structure = tile.structure;
  if (!spaces || !structure) return null;
  const prim = computePrimitives(tile);
  const m = tile.metrics;
  const rooms = spaces.rooms;
  const levels = spaces.levels;

  const openings = spaces.openings;
  const sideAreas = SIDE.flatMap((f) => openings[f]?.areas_ft2 ?? []).sort((a, b) => b - a);
  const openingCount = Object.values(openings).reduce((a, o) => a + o.count, 0);
  const facesReached = Object.keys(openings).filter((f) => (m.faces?.[f]?.open_area_ft2 ?? openings[f].total_ft2) >= 8);
  const openAreaFt2 = Object.values(openings).reduce((a, o) => a + o.total_ft2, 0);
  const skinFt2 = (m.void_mesh_area_ft2 && m.void_mesh_area_ft2 > 0 ? m.void_mesh_area_ft2 : (m.voxel_wall_area_ft2 ?? 0)) || 1;

  // a room's height is its typical clear height (a shaft: its full height), the same figure its name gives
  const heightOf = (r: RoomInfo) => (r.kind === "shaft" ? r.clear_height_ft.max : r.clear_height_ft.mean);
  let tallestRoom: RoomInfo | null = null;
  for (const r of rooms) if (!tallestRoom || heightOf(r) > heightOf(tallestRoom)) tallestRoom = r;
  const clearFt = tallestRoom ? heightOf(tallestRoom) : levels.reduce((a, l) => Math.max(a, l.clear_height_ft.mean), 0);
  const widthFt = tallestRoom ? Math.max(Math.min(tallestRoom.extent_ft[0], tallestRoom.extent_ft[1]), tile.cellFt) : Math.min(tile.tileFt[0], tile.tileFt[1]);

  const res = (tile.config.plates ?? []).map((g) => g.resistance).filter((v): v is number => typeof v === "number");
  const sources = readSources(tile);
  return {
    tile,
    spaces,
    structure,
    prim,
    cell: tile.cellFt,
    tileVolumeFt3: m.tile_volume_ft3 ?? tile.tileFt[0] * tile.tileFt[1] * tile.tileFt[2],
    voidPct: m.void_fraction * 100,
    voidFt3: m.void_volume_ft3,
    voidPieces: m.void_pieces ?? 1,
    largestVoidFt3: m.largest_void_ft3 ?? m.void_volume_ft3,
    singlePiecePct: prim.singlePieceFractionPct,
    levels,
    rooms,
    route: spaces.main_route,
    routes: spaces.routes,
    profile: spaces.profile,
    openings,
    sideAreas,
    openingCount,
    facesReached,
    openAreaFt2,
    skinFt2,
    porosity: openAreaFt2 / skinFt2,
    tallest: { room: tallestRoom, clearFt, widthFt, ratio: clearFt / Math.max(widthFt, 0.5) },
    sources,
    hasRecipe: sources.length > 0,
    plateResistance: res.length ? res.reduce((a, b) => a + b, 0) / res.length : null,
  };
}
