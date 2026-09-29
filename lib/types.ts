/**
 * Data shapes for the `<tile>_analysis` export bundle produced by the
 * Grasshopper erosion engine (schema "erosion-tile/3", engine "5f"). See
 * HANDOFF.md for the authoritative description of every field here -- these
 * types mirror the exported JSON key names (snake_case) directly rather than
 * remapping them, so parsing is a plain JSON.parse with no translation step.
 */

export type FaceName = "-X" | "+X" | "-Y" | "+Y" | "-Z" | "+Z";
export const FACE_NAMES: FaceName[] = ["-X", "+X", "-Y", "+Y", "-Z", "+Z"];

export interface FaceMetric {
  open_cells?: number;
  open_area_ft2: number;
  open_fraction?: number;
}

export interface VoidComponent {
  id?: number;
  volume_ft3?: number;
  bbox_min_ft?: number[];
  bbox_max_ft?: number[];
  touches_faces_open_area_ft2?: Partial<Record<FaceName, number>>;
}

export interface VoidBbox {
  min_ft: number[];
  max_ft: number[];
  centroid_ft: number[];
}

export interface VoidAreaProfile {
  x?: number[];
  y?: number[];
  z?: number[];
}

export interface TileMetrics {
  void_volume_ft3: number;
  tile_volume_ft3?: number;
  void_fraction: number;
  foam_volume_ft3?: number;
  void_pieces?: number;
  largest_void_ft3?: number;
  void_components?: VoidComponent[];
  faces: Partial<Record<FaceName, FaceMetric>>;
  open_area_on_faces_ft2?: number;
  void_bbox?: VoidBbox;
  void_z_range_ft?: [number, number];
  void_mesh_area_ft2?: number;
  void_wall_area_ft2_estimate?: number;
  foam_mesh_area_ft2?: number;
  voxel_wall_area_ft2?: number;
  floor_area_by_z_ft2?: number[];
  ceiling_area_by_z_ft2?: number[];
  floor_area_total_ft2?: number;
  void_area_profile_ft2?: VoidAreaProfile;
  /** the export has grown a few extra measurements over time -- keep anything not modeled above around too */
  [key: string]: unknown;
}

export interface TileFoamConfig {
  noise?: number;
  scale?: number;
  grain?: number;
  seed?: number;
  web?: number;
  web_open?: number;
  web_thickness?: number;
  layers?: boolean;
  layer_count?: number;
  layer_axis?: number;
  layer_thickness?: number;
  layer_strength?: number;
}

export interface TileConfig {
  tile_w?: number;
  tile_h?: number;
  cell?: number;
  steps?: number;
  gravity?: number;
  drain?: boolean;
  n_frames?: number;
  frame?: number;
  smooth?: number;
  seed?: number;
  sources?: string[];
  foam?: TileFoamConfig;
  min_void_ft3?: number;
  min_foam_ft3?: number;
  weld?: string;
}

export interface TileJson {
  schema: string;
  id: string;
  name: string;
  exported?: string;
  engine_version?: string;
  units?: string;
  coordinate_system?: string;
  tile_ft: [number, number, number];
  cell_ft: number;
  grid: [number, number, number];
  frame_exported?: number;
  last_frame?: number;
  config: TileConfig;
  metrics: TileMetrics;
}

export interface FaceEntry {
  stored_axes?: string[];
  mask_rows?: string[];
  mask_rows_6in?: string[];
  depth_cells?: number[][];
  open_cells?: number;
  open_area_ft2?: number;
  edges?: unknown;
  max_depth_ft?: number;
  outline_uv_ft?: number[][][];
  plane?: unknown;
}

/** data/faces.json -- note the per-face map is nested under `faces`, not the document root. */
export interface FacesJson {
  schema?: string;
  note?: string;
  cell_ft?: number;
  faces: Partial<Record<FaceName, FaceEntry>>;
}

export interface ImagePlane {
  seen_from: string;
  origin_ft: number[];
  u_axis: number[];
  v_axis: number[];
  width_ft: number;
  height_ft: number;
  size_px: [number, number];
  px_per_ft: number;
}

export interface SectionEntry {
  axis: "X" | "Y" | "Z";
  index: number;
  position_ft: number;
  seen_from?: string;
  void_area_ft2: number;
  void_fraction: number;
  outline_uv_ft?: number[][][];
  plane?: ImagePlane;
}

export interface SectionsJson {
  schema?: string;
  sections?: SectionEntry[];
}

export interface TileVoxels {
  void?: Uint8Array;
  voidSmooth?: Uint8Array;
  material?: Uint8Array;
  softness?: Uint8Array;
}

/** Guessed from the tile's file name, per HANDOFF section 3 -- the export carries no typology/category. */
export interface GuessedIdentity {
  category?: "gathering" | "office" | "lobby";
  typology?: string;
}

/**
 * The normalized, in-app representation of one loaded tile. This is what
 * every tab (Viewer / Analysis / Arrange) reads from -- built once by
 * lib/ingest.ts out of a dropped `_analysis` folder or zip.
 */
export interface ParsedTile {
  id: string;
  name: string;
  sourceFolderName: string;
  schema?: string;
  engineVersion?: string;
  tileFt: [number, number, number];
  cellFt: number;
  grid: [number, number, number];
  frameExported?: number;
  lastFrame?: number;
  config: TileConfig;
  metrics: TileMetrics;
  glbUrl: string;
  voxels: TileVoxels;
  faces?: FacesJson;
  sections?: SectionsJson;
  manifestRaw?: unknown;
  guessed: GuessedIdentity;
  /** Present only if a matching _reference/recipe.json was dropped in alongside the _analysis folder. */
  recipeText?: string;
}

export const GLB_TO_FEET_ROW_MAJOR: number[][] = [
  [3.28084, 0, 0, 0],
  [0, 0, -3.28084, 0],
  [0, 3.28084, 0, 0],
  [0, 0, 0, 1],
];
