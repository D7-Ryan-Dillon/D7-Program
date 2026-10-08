// Converts saved projects to the compact storage format the app now writes: gzipped voxel files, each tile's data in its own gzipped file, a slim project row.
//   node scripts/migrate-storage.mjs <backup-dir> code1 code2 ...
// Safe order: the row is backed up, every new file is uploaded, the row is rewritten, and only then are the old uncompressed files and the files of tiles the row no
// longer lists removed. A project already in the new format is left as it is (its orphan files are still cleared). Reads .env.local like projects.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const B = sb.storage.from("tile-assets");
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function listFiles(prefix) {
  const out = [];
  const walk = async (dir) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await B.list(dir, { limit: 100, offset });
      if (error) throw error;
      await Promise.all(data.map(async (e) => (e.id === null ? walk(`${dir}/${e.name}`) : out.push({ path: `${dir}/${e.name}`, size: e.metadata?.size ?? 0 }))));
      if (data.length < 100) break;
    }
  };
  await walk(prefix);
  return out;
}

async function put(path, bytes, type) {
  for (let a = 0; a < 3; a++) {
    const { error } = await B.upload(path, bytes, { contentType: type, upsert: true });
    if (!error) return;
    if (a === 2) throw new Error(`upload ${path}: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
  }
}

async function migrate(code, backupDir) {
  const { data: row, error } = await sb.from("projects").select("code, state").eq("code", code).maybeSingle();
  if (error) throw error;
  if (!row) return console.log(`${code}: no row, skipped`);
  writeFileSync(join(backupDir, `${code}.row.json`), JSON.stringify(row.state));
  const tiles = row.state.tiles ?? [];
  const before = (await listFiles(code)).reduce((a, f) => a + f.size, 0);
  const oldFiles = [];
  const next = [];
  let converted = 0;
  for (const rec of tiles) {
    const a = rec.assets;
    const dir = a.glb.slice(0, a.glb.lastIndexOf("/"));
    const newVox = Object.values(a.voxels).every((p) => p.endsWith(".gz"));
    if (a.meta && newVox) {
      next.push(rec);
      continue;
    }
    const voxels = {};
    for (const [key, path] of Object.entries(a.voxels)) {
      if (path.endsWith(".gz")) {
        voxels[key] = path;
        continue;
      }
      const dl = await B.download(path);
      if (dl.error && /not found/i.test(dl.error.message)) {
        // the file was never uploaded: the app skipped such arrays when loading, so the record drops it
        console.log(`  ${code}: ${rec.name}: ${path} is missing, left out`);
        continue;
      }
      if (dl.error || !dl.data) throw new Error(`download ${path}: ${dl.error?.message}`);
      const raw = new Uint8Array(await dl.data.arrayBuffer());
      const gz = `${path}.gz`;
      await put(gz, gzipSync(raw), "application/octet-stream");
      voxels[key] = gz;
      oldFiles.push(path);
    }
    let meta = a.meta;
    if (!meta) {
      // eslint-disable-next-line no-unused-vars
      const { assets, ...fields } = rec;
      meta = `${dir}/meta.json.gz`;
      await put(meta, gzipSync(Buffer.from(JSON.stringify(fields))), "application/gzip");
    }
    next.push({ id: rec.id, name: rec.name, assets: { glb: a.glb, parts: a.parts, meta, voxels } });
    converted++;
    process.stdout.write(`  ${code}: ${rec.name} converted\n`);
  }
  if (converted) {
    const state = { ...row.state, tiles: next };
    const up = await sb.from("projects").update({ state, updated_at: new Date().toISOString() }).eq("code", code).select("code");
    if (up.error || !up.data?.length) throw new Error(`row ${code}: ${up.error?.message ?? "no row updated"}`);
  }
  // only now: the old files and the files of tiles the row no longer lists
  const keep = new Set(next.map((r) => r.assets.glb.split("/")[1]));
  const all = await listFiles(code);
  const drop = all.filter((f) => oldFiles.includes(f.path) || !keep.has(f.path.split("/")[1])).map((f) => f.path);
  for (let i = 0; i < drop.length; i += 100) {
    const { error: e } = await B.remove(drop.slice(i, i + 100));
    if (e) throw e;
  }
  const after = (await listFiles(code)).reduce((a, f) => a + f.size, 0);
  console.log(`${code}: ${tiles.length} tiles, ${converted} converted, ${drop.length} files removed, ${mb(before)} -> ${mb(after)}`);
}

const [backupDir, ...codes] = process.argv.slice(2);
mkdirSync(backupDir, { recursive: true });
for (const c of codes) await migrate(c, backupDir);
