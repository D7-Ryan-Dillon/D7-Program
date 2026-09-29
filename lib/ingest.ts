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

/** input type="file" webkitdirectory -- FileList entries already carry webkitRelativePath. */
export async function ingestFromFileList(fileList: FileList): Promise<ParsedTile> {
  const files: VirtualFile[] = Array.from(fileList).map((file) => ({
    path: (file.webkitRelativePath || file.name).replace(/\\/g, "/"),
    bytes: () => file.arrayBuffer(),
  }));
  return buildTile(files);
}

/** A dropped .zip file (either "Choose .zip" or a drag-drop of the zip itself). */
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

/** DataTransferItemList from a drag-and-drop of a real folder on disk. */
export async function ingestFromDataTransferItems(items: DataTransferItemList): Promise<ParsedTile> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  // A single dropped .zip file goes through the zip path instead.
  if (entries.length === 1 && entries[0].isFile && entries[0].name.toLowerCase().endsWith(".zip")) {
    const file = await new Promise<File>((resolve, reject) => (entries[0] as FileSystemFileEntry).file(resolve, reject));
    return ingestFromZipFile(file);
  }

  const files: VirtualFile[] = [];

  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      files.push({ path: `${prefix}${entry.name}`, bytes: () => file.arrayBuffer() });
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

  for (const entry of entries) {
    await walk(entry, "");
  }

  return buildTile(files);
}
