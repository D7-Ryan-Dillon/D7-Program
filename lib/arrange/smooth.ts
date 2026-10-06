// Smooth and seal, version 2, on the combined voxels (the old fuse in lib/exporters/csgFuse.ts is untouched and stays as
// the "legacy" smooth). Three steps, always reported and always reversible (it works on a copy):
//   1. fuse near-misses  openings that miss each other across a joint by up to the tolerance are bridged into one
//                        passage; floors that meet within the tolerance are brought to one height
//   2. floaters          foam fragments that are not part of the main mass, and tiny sealed pockets, are FOUND and listed;
//                        only the ones the user approves are removed (nothing disappears silently)
//   3. the mesh          is cut from the result by the same smoothing as the rest of the arrangement

import { label6 } from "@/lib/tiles/grid";
import type { Composite } from "./composite";
import type { Joint, SmoothSettings, Vec3 } from "./types";

export interface Floater {
  key: string;
  kind: "foam" | "pocket";
  volumeFt3: number;
  /** feet, in the arrangement's world coordinates */
  centroid: Vec3;
  min: Vec3;
  max: Vec3;
  cells: Int32Array;
}

export interface SmoothReport {
  bridged: number;
  floorsRaised: number;
  floaters: Floater[];
  removed: number;
  filled: number;
}

export interface SmoothResult {
  comp: Composite;
  report: SmoothReport;
}

function clone(c: Composite): Composite {
  return { ...c, void: c.void.slice(), plates: c.plates.slice(), struts: c.struts.slice() };
}

/** Every flat piece of every joint (a joint may meet in several patches, each a few rectangles): where two pieces really touch. */
const jointFaces = (joints: Joint[]) => joints.flatMap((j) => j.patches.flatMap((p) => p.rects.map((r) => ({ axis: p.axis, min: r.min, max: r.max }))));

export function smoothComposite(source: Composite, joints: Joint[], settings: SmoothSettings): SmoothResult {
  const comp = clone(source);
  const [nx, ny, nz] = comp.grid;
  const cell = comp.cell;
  const idx = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  const inGrid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;
  const isVoid = (x: number, y: number, z: number) => inGrid(x, y, z) && comp.void[idx(x, y, z)] === 1 && comp.mask[idx(x, y, z)] === 1;
  const r = Math.max(1, Math.round(settings.toleranceFt / cell));
  const report: SmoothReport = { bridged: 0, floorsRaised: 0, floaters: [], removed: 0, filled: 0 };
  const org = [Math.round(comp.origin[0] / cell), Math.round(comp.origin[1] / cell), Math.round(comp.origin[2] / cell)];

  for (const j of jointFaces(joints)) {
    const axis = j.axis;
    const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const plane = Math.round(j.min[axis] / cell) - org[axis];
    const lo = [Math.round(j.min[o1] / cell) - org[o1], Math.round(j.min[o2] / cell) - org[o2]];
    const hi = [Math.round(j.max[o1] / cell) - org[o1], Math.round(j.max[o2] / cell) - org[o2]];
    const at = (a: number, u: number, v: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0];
      p[axis] = a;
      p[o1] = u;
      p[o2] = v;
      return p;
    };
    // 1. bridge foam across the plane where there is void on both sides within the tolerance
    const bridge: number[] = [];
    for (let u = lo[0]; u < hi[0]; u++)
      for (let v = lo[1]; v < hi[1]; v++)
        for (let a = plane - r; a < plane + r; a++) {
          const [x, y, z] = at(a, u, v);
          if (!inGrid(x, y, z)) continue;
          const i = idx(x, y, z);
          if (!comp.mask[i] || comp.void[i] || comp.plates[i]) continue;
          let below = false;
          let above = false;
          for (let da = -r; da <= r && !(below && above); da++)
            for (let du = -r; du <= r && !(below && above); du++)
              for (let dv = -r; dv <= r; dv++) {
                const [px, py, pz] = at(a + da, u + du, v + dv);
                if (!isVoid(px, py, pz)) continue;
                if (a + da < plane) below = true;
                else above = true;
                if (below && above) break;
              }
          if (below && above) bridge.push(i);
        }
    for (const i of bridge) comp.void[i] = 1;
    report.bridged += bridge.length;

    // 2. floors: where two floors meet within the tolerance, raise the lower one to the higher
    if (axis !== 2) {
      for (let u = lo[0]; u < hi[0]; u++) {
        const col = (a: number) => {
          const runs: [number, number][] = [];
          let s = -1;
          for (let v = lo[1]; v <= hi[1]; v++) {
            const [x, y, z] = at(a, u, v);
            const on = v < hi[1] && isVoid(x, y, z);
            if (on && s < 0) s = v;
            else if (!on && s >= 0) {
              runs.push([s, v]);
              s = -1;
            }
          }
          return runs;
        };
        const ra = col(plane - 1);
        const rb = col(plane);
        for (const a of ra)
          for (const b of rb) {
            if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) < 2) continue;
            const step = Math.abs(a[0] - b[0]);
            if (step === 0 || step > r) continue;
            const lowSide = a[0] < b[0] ? -1 : 1;
            const from = Math.min(a[0], b[0]);
            const to = Math.max(a[0], b[0]);
            for (let k = 0; k < r; k++) {
              const ax = lowSide < 0 ? plane - 1 - k : plane + k;
              for (let v = from; v < to; v++) {
                const [x, y, z] = at(ax, u, v);
                if (!inGrid(x, y, z)) continue;
                const i = idx(x, y, z);
                if (comp.mask[i] && comp.void[i]) {
                  comp.void[i] = 0;
                  report.floorsRaised++;
                }
              }
            }
          }
      }
    }
  }

  // 3. floaters: foam that is not part of the biggest piece, and sealed pockets
  const cellFt3 = cell ** 3;
  const world = (x: number, y: number, z: number): Vec3 => [comp.origin[0] + (x + 0.5) * cell, comp.origin[1] + (y + 0.5) * cell, comp.origin[2] + (z + 0.5) * cell];
  const collect = (labels: Int32Array, count: number, keep: (size: number, k: number) => boolean, kind: "foam" | "pocket", skip: number) => {
    const sizes = new Array<number>(count + 1).fill(0);
    const lo = Array.from({ length: count + 1 }, () => [1e9, 1e9, 1e9]);
    const hi = Array.from({ length: count + 1 }, () => [-1, -1, -1]);
    const sum = Array.from({ length: count + 1 }, () => [0, 0, 0]);
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) {
          const l = labels[idx(x, y, z)];
          if (!l) continue;
          sizes[l]++;
          const p = [x, y, z];
          for (let a = 0; a < 3; a++) {
            if (p[a] < lo[l][a]) lo[l][a] = p[a];
            if (p[a] > hi[l][a]) hi[l][a] = p[a];
            sum[l][a] += p[a];
          }
        }
    const out: Floater[] = [];
    for (let l = 1; l <= count; l++) {
      if (l === skip || !sizes[l] || !keep(sizes[l], l)) continue;
      const cx = Math.round(sum[l][0] / sizes[l]);
      const cy = Math.round(sum[l][1] / sizes[l]);
      const cz = Math.round(sum[l][2] / sizes[l]);
      const cells: number[] = [];
      for (let x = lo[l][0]; x <= hi[l][0]; x++) for (let y = lo[l][1]; y <= hi[l][1]; y++) for (let z = lo[l][2]; z <= hi[l][2]; z++) if (labels[idx(x, y, z)] === l) cells.push(idx(x, y, z));
      out.push({
        key: `${kind === "foam" ? "f" : "p"}:${cx}_${cy}_${cz}_${sizes[l]}`,
        kind,
        volumeFt3: sizes[l] * cellFt3,
        centroid: world(cx, cy, cz),
        min: [comp.origin[0] + lo[l][0] * cell, comp.origin[1] + lo[l][1] * cell, comp.origin[2] + lo[l][2] * cell],
        max: [comp.origin[0] + (hi[l][0] + 1) * cell, comp.origin[1] + (hi[l][1] + 1) * cell, comp.origin[2] + (hi[l][2] + 1) * cell],
        cells: Int32Array.from(cells),
      });
    }
    return out;
  };

  const foam = new Uint8Array(comp.void.length);
  for (let i = 0; i < foam.length; i++) foam[i] = comp.mask[i] && !comp.void[i] ? 1 : 0;
  const fl = label6(foam, comp.grid);
  let main = 0;
  let mainSize = 0;
  const fsize = new Array<number>(fl.count + 1).fill(0);
  for (let i = 0; i < fl.labels.length; i++) if (fl.labels[i]) fsize[fl.labels[i]]++;
  for (let l = 1; l <= fl.count; l++) if (fsize[l] > mainSize) {
    mainSize = fsize[l];
    main = l;
  }
  const foamLimit = settings.minFoamFt3 > 0 ? settings.minFoamFt3 / cellFt3 : Infinity;
  const foamFloaters = collect(fl.labels, fl.count, (size) => size < foamLimit, "foam", main);

  const vd = new Uint8Array(comp.void.length);
  for (let i = 0; i < vd.length; i++) vd[i] = comp.mask[i] && comp.void[i] ? 1 : 0;
  const vl = label6(vd, comp.grid);
  const open = new Uint8Array(vl.count + 1);
  const sx = ny * nz;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = idx(x, y, z);
        const l = vl.labels[i];
        if (!l || open[l]) continue;
        const edge = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
        const nb = [x > 0 ? i - sx : -1, x < nx - 1 ? i + sx : -1, y > 0 ? i - nz : -1, y < ny - 1 ? i + nz : -1, z > 0 ? i - 1 : -1, z < nz - 1 ? i + 1 : -1];
        if (edge || nb.some((m) => m >= 0 && !comp.mask[m])) open[l] = 1;
      }
  const pocketLimit = settings.minVoidFt3 / cellFt3;
  const pockets = collect(vl.labels, vl.count, (size, l) => !open[l] && size < pocketLimit, "pocket", -1);

  const approved = new Set(settings.approved);
  for (const f of foamFloaters) {
    if (!approved.has(f.key)) continue;
    for (const i of f.cells) {
      comp.void[i] = 1;
      comp.plates[i] = 0;
      comp.struts[i] = 0;
    }
    report.removed++;
  }
  for (const p of pockets) {
    if (!approved.has(p.key)) continue;
    for (const i of p.cells) comp.void[i] = 0;
    report.filled++;
  }
  report.floaters = [...foamFloaters, ...pockets];
  return { comp, report };
}
