/**
 * Shapes of everything a tile's voxels are read as: levels, rooms, routes, daylight, openings, structure.
 * They mirror the JSON the Grasshopper engine writes (data/spaces.json, data/structure.json -- docs/DATA_FORMAT.md
 * section 13) key for key, so an engine tile is a plain JSON.parse and a Builder tile (lib/tiles/analyze.ts) produces
 * the very same objects. Lengths are feet, areas ft2, volumes ft3, in tile coordinates (origin at the low corner).
 */

export interface Stat3 {
  min: number;
  mean: number;
  max: number;
}

/** A floor (a void cell with foam directly below it) and the space above it. A ramp is one sloped level. */
export interface LevelInfo {
  id: number;
  name: string;
  z_ft: number;
  z_min_ft: number;
  z_max_ft: number;
  area_ft2: number;
  kind: "flat" | "sloped";
  /** first and last voxel layer of the floor */
  layers: [number, number];
  plate_ids: number[];
  clear_height_ft: Stat3;
  volume_above_ft3: number;
  sky_fraction: number;
  lit_fraction: number;
}

export type RoomKind = "shaft" | "gallery" | "terrace" | "hall" | "cave" | "low room" | "room";

export interface RoomInfo {
  id: number;
  kind: RoomKind;
  name: string;
  volume_ft3: number;
  cells: number;
  volume_share: number;
  floor_area_ft2: number;
  footprint_ft2: number;
  bbox_min_ft: number[];
  bbox_max_ft: number[];
  extent_ft: number[];
  clear_height_ft: Stat3;
  floor_z_ft: { min: number | null; max: number | null };
  sky_fraction: number;
  lit_fraction: number;
  light_distance_ft: number;
  open_below: boolean;
  faces_open_ft2: Record<string, number>;
  level_ids: number[];
  centroid_ft: number[];
}

export interface ConnectionInfo {
  id: number;
  rooms: [number, number];
  area_ft2: number;
  neck_ft: number;
  centre_ft: number[];
  orientation: "horizontal" | "vertical" | "mixed";
}

export interface GraphInfo {
  rooms: number;
  connections: number;
  components: number;
  loops: number;
  dead_ends: number;
  degree: number[];
  access_rooms: number[];
  neck_ft: { min: number | null; max: number | null };
  specks?: { count: number; volume_ft3: number };
}

/** The shortest way through the void between two side faces. */
export interface RouteInfo {
  from: string;
  to: string;
  length_ft: number;
  straight_ft: number;
  sinuosity: number;
  bends: number;
  rooms: number[];
  points_ft: number[][];
}

/** Void cross-section area along the main route's direction, counting only the rooms the route passes. */
export interface ProfileInfo {
  axis: "x" | "y";
  area_ft2: number[];
  min_ft2: number;
  max_ft2: number;
  median_ft2: number;
  ratio: number;
  squeezes: number;
}

export interface DaylightInfo {
  lit_floor_fraction: number;
  sky_floor_fraction: number;
  mean_light_distance_ft: number;
  floor_area_ft2: number;
  lit_within_ft: number;
}

export interface OpeningEntry {
  count: number;
  areas_ft2: number[];
  total_ft2: number;
}
export type OpeningsInfo = Record<string, OpeningEntry>;

export interface SpacesData {
  schema?: string;
  analysis_version: number;
  note?: string;
  params?: Record<string, number>;
  cell_ft?: number;
  levels: LevelInfo[];
  rooms: RoomInfo[];
  connections: ConnectionInfo[];
  graph: GraphInfo;
  routes: RouteInfo[];
  main_route: RouteInfo | null;
  profile: ProfileInfo | null;
  daylight: DaylightInfo;
  openings: OpeningsInfo;
}

export interface StructurePlate {
  id: number;
  cells: number;
  area_ft2: number;
  thickness_ft: number;
  piece: number;
  grounded: boolean;
  name?: string;
  slope_deg?: number;
  top_z_ft?: { min: number; max: number; mean: number };
  present?: boolean;
  support?: { contact_area_ft2?: number; longest_unsupported_span_ft?: number | null; struts_added?: number; supported?: boolean };
  clear_above_ft?: Stat3;
  clear_below_ft?: Stat3;
}

export interface StructureInfo {
  foam_ft3: number;
  foam_pieces: number;
  main_piece_share: number;
  pieces: { id: number; volume_ft3: number; grounded: boolean }[];
  floating_ft3: number;
  /** share of the foam thinner than each wall thickness (feet) */
  thin_share: Record<string, number>;
  overhang_area_ft2: number;
  overhang_share: number;
  bed_contact_ft2: number;
  foam_surface_ft2: number;
  plate_share: number;
  branches_ft3: number;
  plates: StructurePlate[];
}

export interface StructureData {
  schema?: string;
  analysis_version: number;
  note?: string;
  cell_ft?: number;
  structure: StructureInfo;
}

/** A floor plate as data/plates.json lists it (or as lib/tiles/plates.ts derives it from the plate cells). */
export interface PlateEntry {
  id: number;
  name: string;
  present: boolean;
  area_ft2: number;
  original_area_ft2?: number;
  thickness_ft: number;
  slope_deg: number;
  top_z_ft?: { min: number; max: number; mean: number };
  bottom_z_ft?: { min: number; max: number };
  space_above?: { clear_height_ft: Stat3; area_clear_8ft_ft2?: number };
  space_below?: { clear_height_ft: Stat3; area_clear_8ft_ft2?: number };
  openings?: { count: number; total_ft2: number };
  support?: { contact_area_ft2?: number; longest_unsupported_span_ft?: number | null; struts_added?: number; supported?: boolean };
  group?: number;
  kind?: string;
  resistance?: number;
  [key: string]: unknown;
}

/** category / typology / variant, written by the engine from the recipe (no more guessing from the file name when present). */
export interface TileMeta {
  category?: "gathering" | "office" | "lobby" | "assembly";
  typology?: string;
  variant?: string;
  slot?: number;
  /** an assembly: the program category of the tile each room came from, by room id (so public program above ground can be counted) */
  roomCategory?: Record<string, string>;
}

/** Everything lib/tiles/analyze.ts returns for one tile: the spaces, the structure, and the room each void cell belongs to. */
export interface TileAnalysis {
  spaces: SpacesData;
  structure: StructureInfo;
  /** room id per voxel (0 = foam or a speck too small to be a room), same layout as voxels.void */
  rooms: Uint8Array;
}
