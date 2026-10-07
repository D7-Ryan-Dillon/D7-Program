// Proves lib/tiles/analyze.ts (the browser's reading of a tile) agrees with the Grasshopper engine's own analysis
// (data/spaces.json, data/structure.json) on the 15 typology tiles. Run: npm run check:parity
// Fixtures come from engine/tiles/make_fixtures.py (lib/tiles/fixtures: the first set; lib/tiles/fixtures-v4: the V4 set, with masks for its L-shaped and single-storey tiles). Exit code 1 if anything that matters disagrees.

import { gunzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { analyzeTile } from "../lib/tiles/analyze";
import type { SpacesData, StructureData } from "../lib/tiles/types";

const roots = ["fixtures", "fixtures-v4", "fixtures-v5", "fixtures-v6", "fixtures-v7"].map((d) => join(__dirname, "..", "lib", "tiles", d)).filter((r) => existsSync(r));
const names = roots.flatMap((r) => readdirSync(r).filter((n) => existsSync(join(r, n, "meta.json"))).map((n) => join(r, n)));
if (!names.length) {
  console.error("No fixtures found in lib/tiles/fixtures. Run engine/tiles/make_fixtures.py first.");
  process.exit(1);
}

const TOL = 0.0025;
let failures = 0;
let warnings = 0;

function read(dir: string, file: string): Uint8Array | null {
  const p = join(dir, file);
  return existsSync(p) ? new Uint8Array(gunzipSync(readFileSync(p))) : null;
}

type Json = unknown;
function compare(a: Json, b: Json, path: string, out: string[]) {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > TOL * Math.max(1, Math.abs(a))) out.push(`${path}: engine ${a} vs app ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: engine has ${a.length} entries, app ${b.length}`);
      return;
    }
    a.forEach((v, i) => compare(v, b[i], `${path}[${i}]`, out));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    for (const k of ka) {
      if (!(k in (b as object))) out.push(`${path}.${k}: missing in app`);
      else compare((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], `${path}.${k}`, out);
    }
    return;
  }
  if (a !== b) out.push(`${path}: engine ${JSON.stringify(a)} vs app ${JSON.stringify(b)}`);
}

for (const dir of names) {
  const name = basename(dir) + (dir.includes("fixtures-v4") ? " (v4)" : dir.includes("fixtures-v5") ? " (v5)" : dir.includes("fixtures-v6") ? " (v6)" : dir.includes("fixtures-v7") ? " (v7)" : "");
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number };
  const engineSpaces = JSON.parse(readFileSync(join(dir, "spaces.json"), "utf8")) as SpacesData;
  const engineStructure = JSON.parse(readFileSync(join(dir, "structure.json"), "utf8")) as StructureData;
  const vd = read(dir, "void.u8.gz");
  if (!vd) throw new Error(`${name}: void.u8.gz missing`);
  const t0 = Date.now();
  const result = analyzeTile({ void: vd, grid: meta.grid, cell: meta.cell_ft, plates: read(dir, "plates.u8.gz"), struts: read(dir, "struts.u8.gz"), mask: read(dir, "mask.u8.gz") ?? undefined });
  const ms = Date.now() - t0;

  const hard: string[] = [];
  const soft: string[] = [];
  // everything that decides a descriptor must match
  for (const key of ["levels", "rooms", "connections", "graph", "daylight", "openings"] as const) compare(engineSpaces[key], result.spaces[key], key, hard);
  const { plates: enginePlates, ...engineRest } = engineStructure.structure;
  const { plates: appPlates, ...appRest } = result.structure;
  compare(engineRest, appRest, "structure", hard);
  // plates: only what the voxels give (the engine adds what it knows analytically: name, slope, support, ...)
  if (enginePlates.length !== appPlates.length) hard.push(`structure.plates: engine ${enginePlates.length}, app ${appPlates.length}`);
  else
    enginePlates.forEach((p, i) => {
      for (const k of ["id", "cells", "area_ft2", "thickness_ft", "piece", "grounded"] as const) compare(p[k], appPlates[i][k], `structure.plates[${i}].${k}`, hard);
    });
  // routes: lengths must match; the exact path through a tie (bends, rooms passed, points) may differ, so those are only reported
  const er = engineSpaces.routes;
  const ar = result.spaces.routes;
  if (er.length !== ar.length) hard.push(`routes: engine ${er.length}, app ${ar.length}`);
  else
    er.forEach((r, i) => {
      for (const k of ["from", "to", "length_ft", "straight_ft", "sinuosity"] as const) compare(r[k], ar[i][k], `routes[${i}].${k}`, hard);
      for (const k of ["bends", "rooms"] as const) compare(r[k], ar[i][k], `routes[${i}].${k}`, soft);
    });
  const em = engineSpaces.main_route;
  const am = result.spaces.main_route;
  if ((em === null) !== (am === null)) hard.push("main_route: present in one only");
  else if (em && am) {
    compare(em.length_ft, am.length_ft, "main_route.length_ft", hard);
    compare(em.from + em.to, am.from + am.to, "main_route.faces", hard);
  }
  if (engineSpaces.profile && result.spaces.profile) compare(engineSpaces.profile, result.spaces.profile, "profile", soft);

  failures += hard.length;
  warnings += soft.length;
  console.log(`${hard.length ? "FAIL" : "ok  "} ${name}  (${ms} ms)  ${result.spaces.rooms.length} rooms, ${result.spaces.levels.length} levels` + (soft.length ? `  [${soft.length} path-tie notes]` : ""));
  for (const line of hard.slice(0, 8)) console.log("      " + line);
  if (hard.length > 8) console.log(`      ... and ${hard.length - 8} more`);
}
console.log(failures ? `\n${failures} disagreement(s) between the app and the engine.` : `\nThe app's analysis matches the engine on all ${names.length} tiles${warnings ? ` (${warnings} path-tie notes only)` : ""}.`);
process.exit(failures ? 1 : 0);
