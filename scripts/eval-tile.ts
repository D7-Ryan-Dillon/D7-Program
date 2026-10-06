// Reads tiles of the V4 set with the app's own code: where a person can stand and walk (the shared walking rules), which floors join, which openings on the
// container surface have a floor and clearance behind them, how much of the carved space is usable, and the matrix measurements.
//   npx tsx scripts/eval-tile.ts <name>...        from the engine export folders (C:/tmp/tiles4 or $V4_EXPORTS)
//   npx tsx scripts/eval-tile.ts --fixtures       the committed fixtures, every tile of the set
// Writes <export>/<name>/eval/standing.u8 and zone.i32 so engine/tiles/v4/view_walk.py can draw the walkable floors over the sections.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arrangeKernel, getOcc, getWalk } from "../lib/arrange/occupancy";
import { getOriented } from "../lib/arrange/orient";
import { usableSpace } from "../lib/scoring/usable";
import { evaluateTile } from "../lib/scoring/matrixEval";
import { EXPORTS, loadExport, loadFixture, V4_ORDER } from "./v4/load";
import type { ParsedTile } from "../lib/types";

export interface Port {
  face: string;
  plane: number;
  u: [number, number];
  z: [number, number];
  areaFt2: number;
  /** the floors (zone ids) with a standing place just inside the opening */
  zones: number[];
  /** a standing place at the opening that belongs to the tile's main floor */
  main: boolean;
  /** the floor height there, ft (lowest standing place inside) */
  floorFt: number | null;
  clearWidthFt: number;
  clearHeightFt: number;
}

export function readTile(t: ParsedTile) {
  const o = getOriented(t, 0, false);
  const occ = getOcc(o);
  const wk = getWalk(occ);
  const [nx, ny, nz] = occ.dims;
  const cell = 0.5;
  const k = arrangeKernel();
  const zones = wk.zones.map((z) => {
    let zmin = nz;
    let zmax = -1;
    let x0 = nx, x1 = -1, y0 = ny, y1 = -1;
    for (let i = 0; i < wk.zone.length; i++) if (wk.zone[i] === z.id) {
      const zz = i % nz;
      const yy = ((i - zz) / nz) % ny;
      const xx = ((i - zz) / nz - yy) / ny;
      zmin = Math.min(zmin, zz);
      zmax = Math.max(zmax, zz);
      x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy);
    }
    return { id: z.id, cells: z.cells, areaFt2: z.areaFt2, significant: z.significant, floorFt: [zmin * cell, (zmax + 1) * cell] as [number, number], x: [x0 * cell, (x1 + 1) * cell] as [number, number], y: [y0 * cell, (y1 + 1) * cell] as [number, number] };
  });
  // the openings on the container surface, and what stands behind each
  const ports: Port[] = [];
  for (const face of ["x-", "x+", "y-", "y+", "z-", "z+"] as const) {
    for (const f of occ.features[face]) {
      const found = new Set<number>();
      let lowest = nz;
      for (const i of f.idx) {
        const z = i % nz;
        const y = ((i - z) / nz) % ny;
        const x = ((i - z) / nz - y) / ny;
        for (let dx = -3; dx <= 3; dx++)
          for (let dy = -3; dy <= 3; dy++) {
            const X = x + dx;
            const Y = y + dy;
            if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
            for (let Z = Math.max(1, z - k.head); Z <= z; Z++) {
              const q = (X * ny + Y) * nz + Z;
              if (wk.stand[q] && wk.zones[wk.zone[q]].significant) {
                found.add(wk.zone[q]);
                lowest = Math.min(lowest, Z);
              }
            }
          }
      }
      // clear width and height of the opening itself (its bounding box in the face layer)
      const axis = face[0] === "x" ? 0 : face[0] === "y" ? 1 : 2;
      const vAxisIsZ = axis !== 2;
      ports.push({
        face,
        plane: f.plane * cell,
        u: [f.u0 * cell, f.u1 * cell],
        z: vAxisIsZ ? [f.v0 * cell, f.v1 * cell] : [0, 0],
        areaFt2: f.cells * cell * cell,
        zones: [...found],
        main: wk.main >= 0 && found.has(wk.main),
        floorFt: found.size ? lowest * cell : null,
        clearWidthFt: (f.u1 - f.u0) * cell,
        clearHeightFt: vAxisIsZ ? (f.v1 - f.v0) * cell : 0,
      });
    }
  }
  return { occ, wk, zones, ports, dims: occ.dims };
}

function report(t: ParsedTile, dumpTo?: string) {
  const r = readTile(t);
  const u = usableSpace(t);
  const e = evaluateTile(t);
  const [nx, ny, nz] = r.dims;
  console.log(`\n=== ${t.name}  ${nx / 2} x ${ny / 2} x ${nz / 2} ft  container ${(100 * r.occ.inside / (nx * ny * nz)).toFixed(0)}% of its box  void ${(100 * r.occ.voidCells / r.occ.inside).toFixed(0)}% of the container`);
  console.log(`walking floors: ${r.zones.filter((z) => z.significant).length} real (${r.zones.length} incl. pockets); main = ${r.wk.main}`);
  for (const z of r.zones.filter((q) => process.env.V4_ALL || q.significant).sort((a, b) => b.cells - a.cells).slice(0, 8)) console.log(`   zone ${z.id}: ${z.areaFt2.toFixed(0)} ft2, floors ${z.floorFt[0].toFixed(1)}-${z.floorFt[1].toFixed(1)} ft, x ${z.x[0]}-${z.x[1]}, y ${z.y[0]}-${z.y[1]}${z.id === r.wk.main ? "  (main)" : ""}`);
  console.log(`usable: ${(100 * u.usableFt2 / Math.max(1, u.floorFt2)).toFixed(0)}% of ${u.floorFt2.toFixed(0)} ft2 of floor reached on foot from a ground opening; cut off ${u.cutOffFt2.toFixed(0)} ft2, too tight ${u.tightFt2.toFixed(0)} ft2; zones ${u.zonesReached}/${u.zones}; levels ${u.levelsReached}/${u.levelsTotal}; reachable void ${(100 * u.reachableVoidFt3 / Math.max(1, u.voidFt3)).toFixed(0)}%`);
  console.log("openings on the container surface (a port needs a floor behind it):");
  for (const p of r.ports.filter((q) => q.areaFt2 >= 12 && q.face[0] !== "z").sort((a, b) => a.face.localeCompare(b.face) || a.z[0] - b.z[0] || a.u[0] - b.u[0])) {
    console.log(`   ${p.face} plane ${p.plane.toFixed(1)}  ${p.face[0] === "z" ? "" : `u ${p.u[0].toFixed(1)}-${p.u[1].toFixed(1)}  z ${p.z[0].toFixed(1)}-${p.z[1].toFixed(1)}  `}${p.areaFt2.toFixed(0)} ft2  ${p.zones.length ? `floor ${p.floorFt!.toFixed(1)} ft, zones ${p.zones.join(",")}${p.main ? " (main floor)" : ""}` : "NO FLOOR/CLEARANCE BEHIND IT"}`);
  }
  for (const p of r.ports.filter((q) => q.areaFt2 >= 12 && q.face[0] === "z")) console.log(`   ${p.face} plane ${p.plane.toFixed(1)} ${p.areaFt2.toFixed(0)} ft2 (a ${p.face === "z+" ? "roof" : "floor"} opening)`);
  const line = e.results.map((x) => `${x.criterion.name.split(" ")[0]} ${x.measure.status === "unavailable" ? "n/a" : x.measure.headline.slice(0, 34)}`);
  console.log("matrix: " + line.join(" | "));
  if (dumpTo) {
    mkdirSync(dumpTo, { recursive: true });
    writeFileSync(join(dumpTo, "standing.u8"), r.wk.stand);
    writeFileSync(join(dumpTo, "zone.i32"), Buffer.from(r.wk.zone.buffer, r.wk.zone.byteOffset, r.wk.zone.byteLength));
    writeFileSync(join(dumpTo, "zones.json"), JSON.stringify({ main: r.wk.main, zones: r.zones }));
  }
}

if (process.argv[1]?.endsWith("eval-tile.ts")) {
  const args = process.argv.slice(2);
  if (args[0] === "--fixtures") {
    for (const n of V4_ORDER) {
      const t = loadFixture(n);
      if (t) report(t);
    }
  } else {
    for (const n of args) {
      const t = loadExport(n.includes("_v4") ? n : n);
      if (!t) {
        console.log(`no export for ${n} in ${EXPORTS}`);
        continue;
      }
      report(t, join(EXPORTS, n, "eval"));
      void existsSync;
    }
  }
}
