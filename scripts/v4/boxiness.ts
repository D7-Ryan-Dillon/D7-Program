// How boxy is a tile? Three plain measures, read from the committed fixtures, for two sets side by side (default: V4 and V5).   npx tsx scripts/v4/boxiness.ts [setA setB]
//   envelope        the share of the 20 x 20 x H bounding box that the container fills (a box fills 100%)
//   flat faces      the share of the six faces of the bounding box that the container reaches (a box reaches every cell of every face: 100%); eroded skins fall away from the faces
//   built surface   the share of the room surface (every face between a void cell and material) that belongs to a retained plate or branch rather than to eroded foam, split into the
//                   part that stands (walls, piers, frames, lintels: normals along x or y) and the part that lies (floors and undersides: normals along z). Floors are expected; standing
//                   plate is what reads as built.
//   straight run    the longest straight, axis-aligned edge of the container's bounding-box silhouette on the mid sections (ft): a box shows 20 ft on every one.
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "lib", "tiles");
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["v4", "v5"];
const BASE = [
  "gathering_1_stepped_amphitheater", "gathering_2_void_field_gathering", "gathering_3_inserted_horizontal_plate", "gathering_4_contained_room_within_volume", "gathering_5_linear_edge_gallery",
  "office_1_open_hall_workspace", "office_2_cascaded_terraced_plates", "office_3_flat_deep_plan_plate", "office_4_void_edge_workspace", "office_5_folded_undulating_work_surface",
  "lobby_1_vertical_void_lobby", "lobby_2_compressed_sequential_lobby", "lobby_3_continuous_hall_lobby", "lobby_4_topographic_ground_field_lobby", "lobby_5_linear_gallery_lobby",
];
const rd = (dir: string, f: string): Uint8Array | null => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : null);

function measure(dir: string) {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number] };
  const [nx, ny, nz] = meta.grid;
  const n = nx * ny * nz;
  const vd = rd(dir, "void.u8.gz")!;
  const pl = rd(dir, "plates.u8.gz");
  const st = rd(dir, "struts.u8.gz");
  const mk = rd(dir, "mask.u8.gz") ?? new Uint8Array(n).fill(1);
  const I = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  let inside = 0;
  for (let i = 0; i < n; i++) inside += mk[i] ? 1 : 0;
  // faces of the bounding box reached by the container
  let reached = 0, total = 0;
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { total += 2; reached += (mk[I(0, y, z)] ? 1 : 0) + (mk[I(nx - 1, y, z)] ? 1 : 0); }
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { total += 2; reached += (mk[I(x, 0, z)] ? 1 : 0) + (mk[I(x, ny - 1, z)] ? 1 : 0); }
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { total += 2; reached += (mk[I(x, y, 0)] ? 1 : 0) + (mk[I(x, y, nz - 1)] ? 1 : 0); }
  // room surface
  let standing = 0, lying = 0, foam = 0;
  const hard = (i: number) => !!(pl && pl[i]) || !!(st && st[i]);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = I(x, y, z);
        if (!mk[i] || !vd[i]) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const j = I(X, Y, Z);
          if (!mk[j] || vd[j]) continue;
          if (hard(j) && !(pl && pl[j] && dz === -1 && false)) {
            if (dz !== 0) lying++;
            else standing++;
          } else foam++;
        }
      }
  const surf = standing + lying + foam || 1;
  // longest straight edge on the three mid sections (a straight run of the container's outline along an axis, counted in cells of a profile)
  const longest = (get: (u: number, v: number) => boolean, nu: number, nv: number) => {
    let best = 0;
    for (let v = 0; v < nv; v++) { // an outline edge along u at row v: a run of cells inside whose row above (v+1) is outside
      let run = 0;
      for (let u = 0; u < nu; u++) { if (get(u, v) && !(v + 1 < nv && get(u, v + 1))) { run++; best = Math.max(best, run); } else run = 0; }
    }
    return best * 0.5;
  };
  const mx = nx >> 1, my = ny >> 1, mz = nz >> 1;
  const g1 = (u: number, v: number) => !!mk[I(u, my, v)], g2 = (u: number, v: number) => !!mk[I(mx, u, v)], g3 = (u: number, v: number) => !!mk[I(u, v, mz)];
  const runs = [longest(g1, nx, nz), longest((u, v) => g1(v, u), nz, nx), longest(g2, ny, nz), longest((u, v) => g2(v, u), nz, ny), longest(g3, nx, ny), longest((u, v) => g3(v, u), ny, nx)];
  return { fill: inside / n, faces: reached / total, standing: standing / surf, lying: lying / surf, run: Math.max(...runs) };
}

const pc = (v: number) => `${(100 * v).toFixed(0)}%`;
const rows: string[] = [];
const sums: Record<string, number[]> = {};
for (const s of sets) sums[s] = [0, 0, 0, 0, 0];
for (const b of BASE) {
  const cells: string[] = [];
  for (const s of sets) {
    const dir = join(root, `fixtures-${s}`, `${b}_${s}`);
    if (!existsSync(join(dir, "meta.json"))) { cells.push("-", "-", "-", "-", "-"); continue; }
    const m = measure(dir);
    cells.push(pc(m.fill), pc(m.faces), pc(m.standing), pc(m.lying), `${m.run.toFixed(0)} ft`);
    [m.fill, m.faces, m.standing, m.lying, m.run].forEach((v, k) => (sums[s][k] += v));
  }
  rows.push(`| ${b.replace(/_/g, " ")} | ${cells.join(" | ")} |`);
}
const head = sets.map((s) => `${s.toUpperCase()} envelope | ${s.toUpperCase()} flat faces | ${s.toUpperCase()} standing plate | ${s.toUpperCase()} lying plate | ${s.toUpperCase()} straight run`).join(" | ");
const mean = sets.flatMap((s) => [pc(sums[s][0] / 15), pc(sums[s][1] / 15), pc(sums[s][2] / 15), pc(sums[s][3] / 15), `${(sums[s][4] / 15).toFixed(0)} ft`]).join(" | ");
console.log(`| tile | ${head} |`);
console.log(`|---|${sets.flatMap(() => ["---", "---", "---", "---", "---"]).join("|")}|`);
console.log(rows.join("\n"));
console.log(`| **mean of 15** | ${mean} |`);
