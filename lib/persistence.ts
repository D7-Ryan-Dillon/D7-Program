import { supabase } from "@/lib/supabase/client";
import type { ParsedTile, TileVoxels } from "@/lib/types";
import type { SavedCube } from "@/lib/sections/savedCubes";
import { ensureAnalysis } from "@/lib/tiles/pipeline";

const VOXEL_KEYS = ["void", "voidSmooth", "material", "softness", "plates", "struts", "mask", "rooms"] as const;
const BUCKET = "tile-assets";
/** how many tiles are stored / fetched at once (each tile also sends its own files side by side) */
const TILE_POOL = 2;
const UPLOAD_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ATTEMPTS = 3;

type Assets = {
  glb: string;
  parts?: string;
  /** the tile's data other than the meshes and the voxels (spaces, structure, sections...), gzipped JSON */
  meta?: string;
  /** a path ending in .gz holds gzipped bytes; a path ending in .bin holds raw bytes (how older saves stored them) */
  voxels: Partial<Record<keyof TileVoxels, string>>;
};

/**
 * What the project row holds for a tile. Saves made by this version keep only the id, the name and where the files are (the row stays a few hundred bytes a tile, so
 * the database never times out on it). Older saves carry the whole tile inline besides `assets`; both are read.
 */
type StoredTile = Partial<Omit<ParsedTile, "glbUrl" | "partsUrl" | "voxels">> & { id: string; name: string; assets: Assets };

/** One thing that went wrong while saving or loading a tile, in words the user can act on. */
export interface TileFailure {
  tileId: string;
  tileName: string;
  /** what was being done, e.g. "uploading the void voxels" */
  step: string;
  message: string;
}

export interface SaveReport {
  saved: number;
  failures: TileFailure[];
  /** the database row could not be written (nothing of this save is recorded) */
  rowError?: string;
}

// ---- small helpers ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Plain-language reading of the errors Supabase gives, keeping the original text after it. */
function explain(err: unknown): string {
  const raw = messageOf(err);
  const low = raw.toLowerCase();
  if (low.includes("statement timeout")) return `the database took too long to write (${raw})`;
  if (low.includes("exceeded the maximum") || low.includes("payload too large") || low.includes("entity too large") || low.includes("quota")) return `over a size limit or the storage quota (${raw})`;
  if (low.includes("timed out") || low.includes("timeout")) return `the connection was too slow (${raw})`;
  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("load failed")) return `the connection dropped (${raw})`;
  return raw;
}

const isLimit = (err: unknown) => /exceeded the maximum|payload too large|entity too large|quota/i.test(messageOf(err));

function withTimeout<T>(p: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s ${what}`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Runs `fn`, trying again (after a short wait) when it fails, except when retrying cannot help. */
async function retrying<T>(what: string, fn: () => PromiseLike<T>, timeoutMs: number): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, what);
    } catch (err) {
      last = err;
      if (isLimit(err)) break;
      if (attempt < ATTEMPTS - 1) await sleep(1000 * (attempt + 1));
    }
  }
  throw last;
}

/** Runs the jobs `size` at a time. */
async function pool<T, R>(items: T[], size: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await job(items[i]);
      }
    }),
  );
  return out;
}

const canGzip = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
const gzip = (bytes: Uint8Array) => pipeBytes(bytes, new CompressionStream("gzip"));
const gunzip = (bytes: Uint8Array) => pipeBytes(bytes, new DecompressionStream("gzip"));

/** A cheap fingerprint of a string, to tell whether a tile's data changed since it was last stored. */
function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${s.length}:${(h >>> 0).toString(16)}`;
}

// ---- what was stored when, to store only what changed ----

interface Known {
  glbUrl: string;
  partsUrl?: string;
  voxels: TileVoxels;
  metaPrint: string;
  stored: StoredTile;
}
/** per project code, per tile id: what the database holds for it (as last loaded or last stored) and the in-memory tile it came from */
const known = new Map<string, Map<string, Known>>();
const knownFor = (code: string) => {
  let m = known.get(code);
  if (!m) known.set(code, (m = new Map()));
  return m;
};

/** Everything of a tile except its meshes and voxels, as JSON text. */
function metaOf(tile: ParsedTile): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping these from the stored copy is the point
  const { glbUrl, partsUrl, voxels, ...rest } = tile;
  return JSON.stringify(rest);
}

// ---- storing one tile ----

class StepError extends Error {
  constructor(
    readonly step: string,
    cause: unknown,
  ) {
    super(explain(cause));
  }
}

async function upload(path: string, body: Uint8Array | ArrayBuffer, contentType: string, step: string): Promise<void> {
  try {
    await retrying(
      step,
      async () => {
        const r = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
        if (r.error) throw r.error;
      },
      UPLOAD_TIMEOUT_MS,
    );
  } catch (err) {
    throw new StepError(step, err);
  }
}

async function fetchBytes(url: string, step: string): Promise<ArrayBuffer> {
  try {
    return await retrying(step, () => fetch(url).then((r) => r.arrayBuffer()), UPLOAD_TIMEOUT_MS);
  } catch (err) {
    throw new StepError(step, err);
  }
}

const VOXEL_LABEL: Record<string, string> = { void: "the void", voidSmooth: "the smooth void", material: "the material", softness: "the softness", plates: "the floor plates", struts: "the struts", mask: "the mask", rooms: "the rooms" };

/**
 * Stores what changed of one tile and returns the record for the project row. A tile whose meshes and voxels are those already stored only has its data (name, spaces...)
 * rewritten when that changed; voxels go up gzipped (they shrink about a hundred times), meshes as they are. Throws a StepError naming the file that failed.
 */
async function storeTile(code: string, tile: ParsedTile): Promise<StoredTile> {
  const prev = knownFor(code).get(tile.id);
  const sameAssets = !!prev && prev.glbUrl === tile.glbUrl && prev.partsUrl === tile.partsUrl && prev.voxels === tile.voxels;
  const metaJson = metaOf(tile);
  const metaPrint = fingerprint(metaJson);
  const dir = `${code}/${tile.id}`;

  let assets: Assets;
  if (sameAssets && prev) {
    assets = { ...prev.stored.assets };
  } else {
    const glbPath = `${dir}/model.glb`;
    const jobs: Promise<void>[] = [];
    jobs.push(fetchBytes(tile.glbUrl, "reading the model").then((b) => upload(glbPath, b, "model/gltf-binary", "uploading the model")));
    let partsPath: string | undefined;
    if (tile.partsUrl) {
      partsPath = `${dir}/parts.glb`;
      const url = tile.partsUrl;
      jobs.push(fetchBytes(url, "reading the model parts").then((b) => upload(partsPath!, b, "model/gltf-binary", "uploading the model parts")));
    }
    const voxelPaths: Partial<Record<keyof TileVoxels, string>> = {};
    const zip = canGzip();
    for (const key of VOXEL_KEYS) {
      const bytes = tile.voxels[key];
      if (!bytes) continue;
      const path = `${dir}/voxels/${key}.bin${zip ? ".gz" : ""}`;
      voxelPaths[key] = path;
      jobs.push(
        (async () => {
          let body: Uint8Array = bytes;
          if (zip) {
            try {
              body = await gzip(bytes);
            } catch (err) {
              throw new StepError(`compressing ${VOXEL_LABEL[key] ?? key}`, err);
            }
          }
          await upload(path, body, "application/octet-stream", `uploading ${VOXEL_LABEL[key] ?? key} (${(body.length / 1048576).toFixed(1)} MB)`);
        })(),
      );
    }
    // run them side by side, but report the first failure by name
    const settled = await Promise.allSettled(jobs);
    const bad = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (bad) throw bad.reason;
    assets = { glb: glbPath, parts: partsPath, voxels: voxelPaths };
  }

  if (!(sameAssets && prev && prev.metaPrint === metaPrint && assets.meta)) {
    const metaPath = `${dir}/meta.json.gz`;
    const bytes = new TextEncoder().encode(metaJson);
    if (canGzip()) await upload(metaPath, await gzip(bytes), "application/gzip", "uploading the tile's data");
    else {
      // no compression in this browser: keep the data in the row as before
      const stored: StoredTile = { ...(JSON.parse(metaJson) as Partial<ParsedTile>), id: tile.id, name: tile.name, assets };
      remember(code, tile, stored, metaPrint);
      return stored;
    }
    assets = { ...assets, meta: metaPath };
  }
  const stored: StoredTile = { id: tile.id, name: tile.name, assets };
  remember(code, tile, stored, metaPrint);
  return stored;
}

function remember(code: string, tile: ParsedTile, stored: StoredTile, metaPrint: string) {
  knownFor(code).set(tile.id, { glbUrl: tile.glbUrl, partsUrl: tile.partsUrl, voxels: tile.voxels, metaPrint, stored });
}

// ---- the project row ----

/**
 * Stores every changed tile (a couple at a time, each file retried) and writes the project row. A tile that cannot be stored does not stop the others: the row keeps
 * the last good version of it (or leaves it out if it was never stored) and the report names what failed and why. `removed`: ids of tiles deleted from the project,
 * whose files are cleared once the row no longer lists them.
 */
export async function saveProject(code: string, tiles: ParsedTile[], cubes: SavedCube[] = [], ui: Record<string, unknown> = {}, removed: string[] = []): Promise<SaveReport> {
  const failures: TileFailure[] = [];
  const records = await pool(tiles, TILE_POOL, async (tile): Promise<StoredTile | null> => {
    try {
      return await storeTile(code, tile);
    } catch (err) {
      failures.push({ tileId: tile.id, tileName: tile.name, step: err instanceof StepError ? err.step : "saving the tile", message: err instanceof StepError ? err.message : explain(err) });
      return knownFor(code).get(tile.id)?.stored ?? null;
    }
  });
  const here = new Set(tiles.map((t) => t.id));
  const gone = new Set(removed);
  // tiles in the saved project that were never loaded here (they failed to load) stay as they are
  const carried = [...knownFor(code).values()].map((k) => k.stored).filter((s) => !here.has(s.id) && !gone.has(s.id));
  const stored = [...records.filter((r): r is StoredTile => !!r), ...carried];

  try {
    await retrying(
      "writing the project",
      async () => {
        const { error } = await supabase.from("projects").upsert({ code, state: { tiles: stored, cubes, ui }, updated_at: new Date().toISOString() }, { onConflict: "code" });
        if (error) throw error;
      },
      UPLOAD_TIMEOUT_MS,
    );
  } catch (err) {
    return { saved: 0, failures, rowError: explain(err) };
  }
  for (const id of removed) {
    knownFor(code).delete(id);
    void deleteTileFiles(code, id);
  }
  return { saved: stored.length, failures };
}

/** Deletes every file stored for one tile (best effort: a file left behind only wastes space). */
async function deleteTileFiles(code: string, id: string): Promise<void> {
  try {
    const paths: string[] = [];
    const walk = async (dir: string) => {
      const { data } = await supabase.storage.from(BUCKET).list(dir, { limit: 100 });
      for (const e of data ?? []) {
        if (e.id === null) await walk(`${dir}/${e.name}`);
        else paths.push(`${dir}/${e.name}`);
      }
    };
    await walk(`${code}/${id}`);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  } catch (err) {
    console.warn("[persistence] could not clear the files of a removed tile:", err);
  }
}

/** The settings of a project (every tab's remembered state: arrangements, boards, views...) live in a small row of their own, `<code>~ui`.
 * Tiles carry hundreds of kilobytes each and change rarely; settings change on every click, so saving them separately keeps each
 * autosave to a few kilobytes instead of re-sending every tile (which could run into the database's statement timeout). */
const uiCode = (code: string) => `${code}~ui`;

export async function saveUi(code: string, ui: Record<string, unknown>): Promise<void> {
  try {
    await retrying(
      "writing the settings",
      async () => {
        const { error } = await supabase.from("projects").upsert({ code: uiCode(code), state: { ui }, updated_at: new Date().toISOString() }, { onConflict: "code" });
        if (error) throw error;
      },
      UPLOAD_TIMEOUT_MS,
    );
  } catch (err) {
    throw new Error(`the settings could not be written: ${explain(err)}`);
  }
}

// ---- loading ----

async function download(path: string, step: string): Promise<Uint8Array> {
  try {
    const blob = await retrying(
      step,
      async () => {
        const r = await supabase.storage.from(BUCKET).download(path);
        if (r.error || !r.data) throw r.error ?? new Error(`missing file ${path}`);
        return r.data;
      },
      DOWNLOAD_TIMEOUT_MS,
    );
    return new Uint8Array(await blob.arrayBuffer());
  } catch (err) {
    throw new StepError(step, err);
  }
}

/** Downloads one stored tile's files back into the in-app ParsedTile shape -- the inverse of storeTile. */
async function hydrateTile(code: string, stored: StoredTile): Promise<ParsedTile> {
  const { assets } = stored;
  const [glbBytes, partsBytes, metaBytes, voxelEntries] = await Promise.all([
    download(assets.glb, "downloading the model"),
    assets.parts ? download(assets.parts, "downloading the model parts").catch(() => null) : Promise.resolve(null),
    assets.meta ? download(assets.meta, "downloading the tile's data").then((b) => gunzip(b)) : Promise.resolve(null),
    Promise.all(
      (Object.entries(assets.voxels) as [keyof TileVoxels, string | undefined][]).map(async ([key, path]) => {
        if (!path) return null;
        try {
          const raw = await download(path, `downloading ${VOXEL_LABEL[key] ?? key}`);
          return [key, path.endsWith(".gz") ? await gunzip(raw) : raw] as const;
        } catch {
          return null; // a missing voxel array leaves that array out, as before
        }
      }),
    ),
  ]);
  const glbUrl = URL.createObjectURL(new Blob([glbBytes as BlobPart], { type: "model/gltf-binary" }));
  const partsUrl = partsBytes ? URL.createObjectURL(new Blob([partsBytes as BlobPart], { type: "model/gltf-binary" })) : undefined;
  const voxels: TileVoxels = {};
  for (const e of voxelEntries) if (e) voxels[e[0]] = e[1];

  const rest = (metaBytes ? { ...stored, ...(JSON.parse(new TextDecoder().decode(metaBytes)) as Partial<ParsedTile>) } : stored) as StoredTile;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the record's file list is not part of the tile
  const { assets: _a, ...fields } = rest;
  // a project saved before a tile was read as spaces gets that now
  const tile = ensureAnalysis({ ...(fields as Omit<ParsedTile, "glbUrl" | "partsUrl" | "voxels">), glbUrl, partsUrl, voxels });
  knownFor(code).set(tile.id, { glbUrl: tile.glbUrl, partsUrl: tile.partsUrl, voxels: tile.voxels, metaPrint: "", stored });
  return tile;
}

export interface LoadedProject {
  tiles: ParsedTile[];
  cubes: SavedCube[];
  ui: Record<string, unknown>;
  /** tiles that could not be downloaded (they stay in the saved project untouched) */
  failures: TileFailure[];
}

/** Returns the tiles (and the cube builder's saved pieces) saved under `code`, or null if that code has never been saved. */
export async function loadProject(code: string): Promise<LoadedProject | null> {
  known.delete(code);
  const { data: rows, error } = await supabase.from("projects").select("code, state, updated_at").in("code", [code, uiCode(code)]);
  if (error) throw new Error(explain(error));
  const main = rows?.find((r) => r.code === code);
  const side = rows?.find((r) => r.code === uiCode(code));
  if (!main && !side) return null;
  const state = (main?.state ?? null) as { tiles?: StoredTile[]; cubes?: SavedCube[]; ui?: Record<string, unknown> } | null;
  const storedTiles = (state?.tiles ?? []) as StoredTile[];
  // the settings row wins unless an older version of the app (which keeps settings inside the main row) saved more recently
  const sideNewer = !!side && (!main || new Date(side.updated_at).getTime() >= new Date(main.updated_at).getTime());
  const ui = sideNewer ? ((side!.state as { ui?: Record<string, unknown> } | null)?.ui ?? {}) : (state?.ui ?? {});

  // a tile that cannot be fetched is reported, and stays in the project as stored
  const failures: TileFailure[] = [];
  const m = knownFor(code);
  const results = await pool(storedTiles, TILE_POOL, async (stored) => {
    try {
      return await hydrateTile(code, stored);
    } catch (err) {
      m.set(stored.id, { glbUrl: "", voxels: {}, metaPrint: "", stored });
      failures.push({ tileId: stored.id, tileName: stored.name ?? stored.id, step: err instanceof StepError ? err.step : "loading the tile", message: err instanceof StepError ? err.message : explain(err) });
      return null;
    }
  });
  return { tiles: results.filter((t): t is ParsedTile => !!t), cubes: state?.cubes ?? [], ui, failures };
}
