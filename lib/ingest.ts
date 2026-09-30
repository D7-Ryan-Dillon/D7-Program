import JSZip from "jszip";
import type { FacesJson, GuessedIdentity, ParsedTile, SectionsJson, TileJson, TileVoxels } from "@/lib/types";

/** A lazily-readable virtual file, regardless of whether it came from a real
 * directory drop, an <input webkitdirectory> FileList, or a .zip archive. */
interface VirtualFile {
  path: string; // forward-slash, relative to whatever root it was dropped at
  bytes: () => Promise<ArrayBuffer>;
}

const CATEGORY_NAMES = ["gathering", "office", "lobby"] as const;

function guessIdentity(name: string): GuessedIdentity {
  const stripped = name.replace(/_v\d+$/i, "");
  const parts = stripped.split("_");
  const category = CATEGORY_NAMES.find((c) => c === parts[0]?.toLowerCase());
  if (!category) return {};
  // drop the category token and the numeric slot right after it (e.g. "gathering", "1")
  const rest = parts.slice(1);
  if (rest.length && /^\d+$/.test(rest[0])) rest.shift();
  const typology = rest.join(" ").trim() || undefined;
  return { category, typology };
}

function findRootDir(files: VirtualFile[]): string {
  const tileJson = files.find((f) => f.path.toLowerCase().endsWith("tile.json"));
  if (!tileJson) {
    throw new Error(
      "Couldn't find tile.json anywhere in what was dropped. Make sure you're dropping a tile's *_analysis folder (or a zip of it).",
    );
  }
  const idx = tileJson.path.lastIndexOf("/");
  return idx === -1 ? "" : tileJson.path.slice(0, idx);
}

function relativeTo(root: string, path: string): string {
  if (!root) return path;
  return path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

async function readText(file: VirtualFile | undefined): Promise<string | undefined> {
  if (!file) return undefined;
  return new TextDecoder().decode(await file.bytes());
}

async function readJson<T>(file: VirtualFile | undefined): Promise<T | undefined> {
  const text = await readText(file);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function buildTile(files: VirtualFile[]): Promise<ParsedTile> {
  const root = findRootDir(files);
  const byRelPath = new Map<string, VirtualFile>();
  for (const f of files) {
    byRelPath.set(relativeTo(root, f.path).toLowerCase(), f);
  }

  const tileJson = await readJson<TileJson>(byRelPath.get("tile.json"));
  if (!tileJson) throw new Error("tile.json was found but could not be parsed as JSON.");

  const glbEntry = files.find((f) => f.path.toLowerCase().endsWith(".glb"));
  if (!glbEntry) {
    throw new Error("No .glb model file found under model/ -- the _analysis folder looks incomplete.");
  }
  const glbBytes = await glbEntry.bytes();
  const glbUrl = URL.createObjectURL(new Blob([glbBytes], { type: "model/gltf-binary" }));

  const voxels: TileVoxels = {};
  const voxelFile = async (name: string) => {
    const f = byRelPath.get(`voxels/${name}`);
    if (!f) return undefined;
    return new Uint8Array(await f.bytes());
  };
  voxels.void = await voxelFile("void.u8");
  voxels.voidSmooth = await voxelFile("void_smooth.u8");
  voxels.material = await voxelFile("material.u8");
  voxels.softness = await voxelFile("softness.u8");

  const faces = await readJson<FacesJson>(byRelPath.get("data/faces.json"));
  const sections = await readJson<SectionsJson>(byRelPath.get("data/sections.json"));
  const manifestRaw = await readJson<unknown>(byRelPath.get("manifest.json"));

  // Optional: a sibling _reference/recipe.json, if the user dropped a parent
  // folder that happens to contain both _analysis and _reference.
  const recipeFile = files.find((f) => f.path.toLowerCase().endsWith("recipe.json"));
  const recipeText = await readText(recipeFile);

  return {
    id: tileJson.id,
    name: tileJson.name,
    sourceFolderName: root || tileJson.name,
    schema: tileJson.schema,
    engineVersion: tileJson.engine_version,
    tileFt: tileJson.tile_ft,
    cellFt: tileJson.cell_ft,
    grid: tileJson.grid,
    frameExported: tileJson.frame_exported,
    lastFrame: tileJson.last_frame,
    config: tileJson.config,
    metrics: tileJson.metrics,
    glbUrl,
    voxels,
    faces,
    sections,
    manifestRaw,
    guessed: guessIdentity(tileJson.name),
    recipeText,
  };
}

export interface IngestResult {
  tiles: ParsedTile[];
  errors: string[];
}

/** Splits a flat file list into one group per tile.json found, so a single
 * folder pick (or drop) containing several tiles' _analysis folders yields
 * one tile per subfolder instead of one merged (and likely broken) tile. */
function splitByTileRoot(files: VirtualFile[]): VirtualFile[][] {
  const roots = files
    .filter((f) => f.path.toLowerCase().endsWith("tile.json"))
    .map((f) => {
      const idx = f.path.lastIndexOf("/");
      return idx === -1 ? "" : f.path.slice(0, idx);
    });
  if (roots.length <= 1) return [files];

  // Longest-prefix first, so a file lands under its nearest tile.json root.
  const sortedRoots = [...new Set(roots)].sort((a, b) => b.length - a.length);
  const groups = new Map<string, VirtualFile[]>(sortedRoots.map((r) => [r, []]));
  for (const f of files) {
    const root = sortedRoots.find((r) => r === "" || f.path === r || f.path.startsWith(r + "/"));
    if (root !== undefined) groups.get(root)!.push(f);
  }
  return Array.from(groups.values()).filter((g) => g.length);
}

async function buildTilesFromGroups(groups: VirtualFile[][]): Promise<IngestResult> {
  const settled = await Promise.allSettled(groups.map(buildTile));
  const tiles: ParsedTile[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") tiles.push(r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { tiles, errors };
}

/** input type="file" webkitdirectory -- FileList entries already carry webkitRelativePath.
 * Splits on tile.json so picking a parent folder full of tile folders loads all of them. */
export async function ingestFromFileList(fileList: FileList): Promise<IngestResult> {
  const files: VirtualFile[] = Array.from(fileList).map((file) => ({
    path: (file.webkitRelativePath || file.name).replace(/\\/g, "/"),
    bytes: () => file.arrayBuffer(),
  }));
  return buildTilesFromGroups(splitByTileRoot(files));
}

/** A single dropped .zip file (either "Choose .zip" or a drag-drop of the zip itself). */
export async function ingestFromZipFile(zipFile: File): Promise<ParsedTile> {
  const zip = await JSZip.loadAsync(zipFile);
  const files: VirtualFile[] = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    files.push({
      path: relPath.replace(/\\/g, "/"),
      bytes: () => entry.async("arraybuffer"),
    });
  });
  return buildTile(files);
}

/** "Choose .zip" with multiple files selected at once -- each zip is its own tile. */
export async function ingestFromZipFiles(fileList: FileList | File[]): Promise<IngestResult> {
  const settled = await Promise.allSettled(Array.from(fileList).map(ingestFromZipFile));
  const tiles: ParsedTile[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") tiles.push(r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { tiles, errors };
}

/** DataTransferItemList from a drag-and-drop of one or more folders and/or .zip files at once. */
export async function ingestFromDataTransferItems(items: DataTransferItemList): Promise<IngestResult> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  const zipEntries = entries.filter((e) => e.isFile && e.name.toLowerCase().endsWith(".zip"));
  const dirEntries = entries.filter((e) => !zipEntries.includes(e));

  const zipFiles = await Promise.all(
    zipEntries.map((e) => new Promise<File>((resolve, reject) => (e as FileSystemFileEntry).file(resolve, reject))),
  );

  const dirFiles: VirtualFile[] = [];

  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      dirFiles.push({ path: `${prefix}${entry.name}`, bytes: () => file.arrayBuffer() });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const children: FileSystemEntry[] = await new Promise((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        const readBatch = () => {
          reader.readEntries((batch) => {
            if (batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            readBatch();
          }, reject);
        };
        readBatch();
      });
      for (const child of children) {
        await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }

  for (const entry of dirEntries) {
    await walk(entry, "");
  }

  const [zipResult, dirResult] = await Promise.all([
    ingestFromZipFiles(zipFiles),
    dirFiles.length ? buildTilesFromGroups(splitByTileRoot(dirFiles)) : Promise.resolve<IngestResult>({ tiles: [], errors: [] }),
  ]);

  const tiles = [...zipResult.tiles, ...dirResult.tiles];
  const errors = [...zipResult.errors, ...dirResult.errors];
  if (!tiles.length && !errors.length) {
    errors.push("Nothing recognizable was dropped -- drop a tile's _analysis folder, or a .zip of it.");
  }
  return { tiles, errors };
}
