// A quick text section of a V4 tile with the standing places marked (for design debugging):
//   npx tsx scripts/v4/ascii.ts <name> <axis x|y|z> <at ft> [from..to ft across] [from..to ft up]
//   # foam   P plate   . void   S a place to stand (void with a floor and clearance)   (blank) outside the container
import { arrangeKernel, getOcc, getWalk } from "../../lib/arrange/occupancy";
import { getOriented } from "../../lib/arrange/orient";
import { loadExport } from "./load";

const [name, axis, atS, accS, upS] = process.argv.slice(2);
const t = loadExport(name)!;
const occ = getOcc(getOriented(t, 0, false));
const wk = getWalk(occ);
const [nx, ny, nz] = occ.dims;
const at = Math.floor(Number(atS) / 0.5);
const plates = t.voxels.plates;
const rng = (s: string | undefined, max: number): [number, number] => (s ? (s.split("..").map((v) => Math.floor(Number(v) / 0.5)) as [number, number]) : [0, max]);
const across = rng(accS, axis === "x" ? ny : nx);
const up = rng(upS, axis === "z" ? ny : nz);
const get = (a: number, b: number): [number, number, number] => (axis === "x" ? [at, a, b] : axis === "y" ? [a, at, b] : [a, b, at]);
void arrangeKernel;
for (let v = Math.min(up[1], axis === "z" ? ny : nz) - 1; v >= up[0]; v--) {
  let line = `${(v * 0.5).toFixed(1).padStart(5)} `;
  for (let a = across[0]; a < Math.min(across[1], axis === "x" ? ny : nx); a++) {
    const [x, y, z] = get(a, v);
    const i = (x * ny + y) * nz + z;
    const c = occ.cls[i];
    line += c === 0 ? " " : wk.stand[i] ? "S" : c === 2 ? "." : plates && plates[i] ? "P" : "#";
  }
  console.log(line);
}
console.log("      " + Array.from({ length: Math.min(across[1], axis === "x" ? ny : nx) - across[0] }, (_, k) => ((across[0] + k) % 10 === 0 ? String(((across[0] + k) * 0.5) | 0).slice(-1) : " ")).join(""));
