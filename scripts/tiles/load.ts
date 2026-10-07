// Loads a tile of the project's set into the app's own types, from either an engine export (`<name>_analysis` folder: raw voxels) or the committed fixtures
// (`lib/tiles/fixtures/<name>/`: gzip voxels + meta.json). The analysis (levels, rooms, structure) is the app's, the same code the browser runs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { ensureAnalysis } from "../../lib/tiles/pipeline";
import type { ParsedTile } from "../../lib/types";

/** The tile set the scripts read: the fifteen tiles of the project (lib/tiles/fixtures). Their engine exports, when rebuilt, are in C:/tmp/tiles7 (or $TILE_EXPORTS). */
export const EXPORTS = process.env.TILE_EXPORTS ?? process.env.V4_EXPORTS ?? "C:/tmp/tiles7";
export const FIXTURES = join(__dirname, "..", "..", "lib", "tiles", "fixtures");

const rawOrGz = (dir: string, f: string): Uint8Array | undefined => {
  if (existsSync(join(dir, f))) return new Uint8Array(readFileSync(join(dir, f)));
  if (existsSync(join(dir, f + ".gz"))) return new Uint8Array(gunzipSync(readFileSync(join(dir, f + ".gz"))));
  return undefined;
};

/** From an engine export folder (C:/tmp/tiles4/<name>/<name>_analysis). */
export function loadExport(name: string, root = EXPORTS): ParsedTile | null {
  const base = join(root, name);
  if (!existsSync(base)) return null;
  const ana = readdirSync(base).find((d) => d.endsWith("_analysis"));
  if (!ana) return null;
  const dir = join(base, ana);
  const tj = JSON.parse(readFileSync(join(dir, "tile.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number; meta?: { category?: string; typology?: string; slot?: number; variant?: string } };
  const vox = join(dir, "voxels");
  return build(name, tj.grid, tj.cell_ft, tj.meta, { void: rawOrGz(vox, "void.u8"), plates: rawOrGz(vox, "plates.u8"), struts: rawOrGz(vox, "struts.u8"), mask: rawOrGz(vox, "mask.u8") });
}

/** From the committed fixtures. */
export function loadFixture(name: string, root = FIXTURES): ParsedTile | null {
  const dir = join(root, name);
  if (!existsSync(join(dir, "meta.json"))) return null;
  const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number; meta?: { category?: string; typology?: string; slot?: number; variant?: string }; config?: Record<string, unknown> };
  return build(name, m.grid, m.cell_ft, m.meta, { void: rawOrGz(dir, "void.u8"), plates: rawOrGz(dir, "plates.u8"), struts: rawOrGz(dir, "struts.u8"), mask: rawOrGz(dir, "mask.u8") }, m.config);
}

function build(name: string, grid: [number, number, number], cell: number, meta: { category?: string; typology?: string; slot?: number; variant?: string } | undefined, v: { void?: Uint8Array; plates?: Uint8Array; struts?: Uint8Array; mask?: Uint8Array }, config?: Record<string, unknown>): ParsedTile {
  const m = /^(gathering|office|lobby)_(\d+)_(.+?)(?:_v(\d+))?$/i.exec(name);
  const category = (meta?.category ?? m?.[1] ?? "gathering").toLowerCase();
  const typology = meta?.typology ?? m?.[3]?.replace(/_/g, " ");
  const tile = {
    id: name,
    name,
    sourceFolderName: name,
    schema: "erosion-tile/4",
    tileFt: [grid[0] * cell, grid[1] * cell, grid[2] * cell],
    cellFt: cell,
    grid,
    config: config ?? {},
    metrics: {},
    glbUrl: "",
    voxels: { void: v.void, plates: v.plates, struts: v.struts, mask: v.mask },
    guessed: { category },
    meta: { category, typology, slot: meta?.slot ?? (m ? Number(m[2]) : undefined), variant: meta?.variant ?? (m?.[4] ? `V${m[4]}` : undefined) },
  } as unknown as ParsedTile;
  return ensureAnalysis(tile);
}

/** The tiles' names in order (gathering, office, lobby; typologies 1 to 5). */
export const TILE_ORDER = [
  "gathering_1_stepped_amphitheater_v7",
  "gathering_2_void_field_gathering_v7",
  "gathering_3_inserted_horizontal_plate_v7",
  "gathering_4_contained_room_within_volume_v7",
  "gathering_5_linear_edge_gallery_v7",
  "office_1_open_hall_workspace_v7",
  "office_2_cascaded_terraced_plates_v7",
  "office_3_flat_deep_plan_plate_v7",
  "office_4_void_edge_workspace_v7",
  "office_5_folded_undulating_work_surface_v7",
  "lobby_1_vertical_void_lobby_v7",
  "lobby_2_compressed_sequential_lobby_v7",
  "lobby_3_continuous_hall_lobby_v7",
  "lobby_4_topographic_ground_field_lobby_v7",
  "lobby_5_linear_gallery_lobby_v7",
];
