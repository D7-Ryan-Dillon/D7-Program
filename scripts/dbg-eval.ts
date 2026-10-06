import { gunzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTile } from "../lib/types";
import { ensureAnalysis } from "../lib/tiles/pipeline";
import { evaluateTile } from "../lib/scoring/matrixEval";

const root = join(__dirname, "..", "lib", "tiles", "fixtures");
const names = readdirSync(root).filter((n) => existsSync(join(root, n, "meta.json"))).sort();
const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : undefined);
const only = process.argv[2];
for (const name of names) {
  if (only && !name.includes(only)) continue;
  const dir = join(root, name);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number };
  const m = /^(gathering|office|lobby)_(\d+)_(.+)$/.exec(name)!;
  let tile = { id: name, name, sourceFolderName: name, tileFt: [meta.grid[0] * meta.cell_ft, meta.grid[1] * meta.cell_ft, meta.grid[2] * meta.cell_ft], cellFt: meta.cell_ft, grid: meta.grid, config: {}, metrics: {}, glbUrl: "", voxels: { void: read(dir, "void.u8.gz"), plates: read(dir, "plates.u8.gz") }, guessed: { category: m[1] }, meta: { category: m[1], typology: m[3] } } as unknown as ParsedTile;
  tile = ensureAnalysis(tile);
  const t0 = Date.now();
  const ev = evaluateTile(tile);
  console.log(`\n== ${name} (${Date.now() - t0} ms)`);
  for (const r of ev.results) { console.log(`  ${r.criterion.name.padEnd(28)} [${r.measure.status.padEnd(11)}] ${r.measure.headline}`); if (r.measure.status === "unavailable") console.log("        ! " + r.interpretation.text); if (process.env.DETAIL && ["stepped","graduated","spatialDensity","nonHierarchical"].includes(r.key)) for (const x of r.measure.supporting) console.log(`        - ${x.label}: ${x.value}`); }
  console.log("   levels:", (tile.spaces?.levels ?? []).map((l) => `${l.z_ft}ft/${l.area_ft2.toFixed(0)}`).join(" "));
  const u = ev.usable;
  console.log(`  usable: void ${u.voidFt3.toFixed(0)} reach ${u.reachableVoidFt3.toFixed(0)} | floor ${u.floorFt2.toFixed(0)} usable ${u.usableFt2.toFixed(0)} cutoff ${u.cutOffFt2.toFixed(0)} tight ${u.tightFt2.toFixed(0)} | zones ${u.zonesReached}/${u.zones} | levels ${u.levelsReached}/${u.levelsTotal}`);
}
