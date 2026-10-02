import { supabase } from "@/lib/supabase/client";
import type { ParsedTile, TileVoxels } from "@/lib/types";
import type { SavedCube } from "@/lib/sections/savedCubes";

const VOXEL_KEYS = ["void", "voidSmooth", "material", "softness"] as const;
const BUCKET = "tile-assets";
const uploadedTiles = new Set<string>();

type StoredTile = Omit<ParsedTile, "glbUrl" | "voxels"> & {
  assets: { glb: string; voxels: Partial<Record<keyof TileVoxels, string>> };
};

/** Uploads one tile's binary assets (glb + voxel arrays) to Storage and returns
 * a JSON-safe record of the tile, referencing those assets by path instead of
 * carrying them inline. `code` scopes the paths so projects never collide. */
async function storeTile(code: string, tile: ParsedTile): Promise<StoredTile> {
  const glbPath = `${code}/${tile.id}/model.glb`;
  // Settings changes autosave far more often than tiles change, and a tile's
  // assets never change under the same id -- so upload each tile once per
  // session and just re-reference it after that.
  if (uploadedTiles.has(glbPath)) {
    const paths: Partial<Record<keyof TileVoxels, string>> = {};
    for (const key of VOXEL_KEYS) if (tile.voxels[key]) paths[key] = `${code}/${tile.id}/voxels/${key}.bin`;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping these two from the stored copy is the point
    const { glbUrl: _g, voxels: _v, ...same } = tile;
    return { ...same, assets: { glb: glbPath, voxels: paths } };
  }
  const glbBytes = await fetch(tile.glbUrl).then((r) => r.arrayBuffer());
  const glbUpload = await supabase.storage.from(BUCKET).upload(glbPath, glbBytes, {
    contentType: "model/gltf-binary",
    upsert: true,
  });
  if (glbUpload.error) throw glbUpload.error;

  const voxelPaths: Partial<Record<keyof TileVoxels, string>> = {};
  for (const key of VOXEL_KEYS) {
    const bytes = tile.voxels[key];
    if (!bytes) continue;
    const path = `${code}/${tile.id}/voxels/${key}.bin`;
    const upload = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (upload.error) throw upload.error;
    voxelPaths[key] = path;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping these two from the stored copy is the point
  const { glbUrl, voxels, ...rest } = tile;
  uploadedTiles.add(glbPath);
  return { ...rest, assets: { glb: glbPath, voxels: voxelPaths } };
}

/** Downloads one stored tile's assets back into the in-app ParsedTile shape --
 * the inverse of storeTile. */
async function hydrateTile(stored: StoredTile): Promise<ParsedTile> {
  const { assets, ...rest } = stored;
  uploadedTiles.add(assets.glb);

  const glbDownload = await supabase.storage.from(BUCKET).download(assets.glb);
  if (glbDownload.error || !glbDownload.data) throw glbDownload.error ?? new Error(`Missing asset: ${assets.glb}`);
  const glbUrl = URL.createObjectURL(glbDownload.data);

  const voxels: TileVoxels = {};
  for (const [key, path] of Object.entries(assets.voxels) as [keyof TileVoxels, string | undefined][]) {
    if (!path) continue;
    const download = await supabase.storage.from(BUCKET).download(path);
    if (download.error || !download.data) continue;
    voxels[key] = new Uint8Array(await download.data.arrayBuffer());
  }

  return { ...rest, glbUrl, voxels };
}

/** Uploads every tile's assets and upserts the project row for `code`. Only
 * the Viewer's tile bank is persisted for now -- Arrange's generated
 * composition is cheap to regrow from the tiles and is still being reworked,
 * so it isn't synced yet (see HANDOFF.md). */
export async function saveProject(code: string, tiles: ParsedTile[], cubes: SavedCube[] = [], ui: Record<string, unknown> = {}): Promise<void> {
  const storedTiles = await Promise.all(tiles.map((tile) => storeTile(code, tile)));
  const { error } = await supabase
    .from("projects")
    .upsert({ code, state: { tiles: storedTiles, cubes, ui }, updated_at: new Date().toISOString() }, { onConflict: "code" });
  if (error) throw error;
}

/** Returns the tiles (and the cube builder's saved pieces) saved under `code`, or null if that code has never been saved. */
export async function loadProject(code: string): Promise<{ tiles: ParsedTile[]; cubes: SavedCube[]; ui: Record<string, unknown> } | null> {
  const { data, error } = await supabase.from("projects").select("state").eq("code", code).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const state = data.state as { tiles?: StoredTile[]; cubes?: SavedCube[]; ui?: Record<string, unknown> } | null;
  const storedTiles = (state?.tiles ?? []) as StoredTile[];
  return { tiles: await Promise.all(storedTiles.map(hydrateTile)), cubes: state?.cubes ?? [], ui: state?.ui ?? {} };
}
