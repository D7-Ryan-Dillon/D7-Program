// Reads a tile's voxels as architecture: levels (floors), rooms, the openings between them, the shortest ways through
// the void, daylight, face openings, and how the foam holds together and prints.
//
// This is the TypeScript twin of analyze_tile() in engine/erosion_engine_7.py -- same algorithms, same thresholds, same
// tie-breaking -- so a tile built in the browser (the Sections builder) is measured exactly like one exported from
// Grasshopper. docs/DATA_FORMAT.md section 13 is the specification; change the Python and this file together and run
// `npm run check:parity`, which compares the two on the 15 typology tiles.

import { componentSizes2d, edtSquared, faceLayer, label6, MinHeap, SIDE_FACES, VIEWS, type Grid } from "./grid";
import type {
  ConnectionInfo,
  DaylightInfo,
  GraphInfo,
  LevelInfo,
  OpeningsInfo,
  ProfileInfo,
  RoomInfo,
  RoomKind,
  RouteInfo,
  SpacesData,
  Stat3,
  StructureInfo,
  StructurePlate,
  TileAnalysis,
} from "./types";

export const ANALYSIS_VERSION = 1;
export const PARAMS = {
  quant: 4,
  room_h_ft: 2.0,
  min_room_ft3: 20.0,
  min_link_ft2: 8.0,
  min_link_neck_ft: 2.0,
  level_min_frac: 0.015,
  lit_ft: 6.0,
  lit_cap_ft: 20.0,
  opening_min_ft2: 4.0,
};
const ROUTE_STEP = 6;
const THIN_WALLS_FT = [1.0, 1.5, 2.0, 3.0];
const BIG = 1e9;

export interface AnalyzeInput {
  /** 1 = void, 0 = foam (plates and branches count as foam here) */
  void: Uint8Array;
  grid: Grid;
  cell: number;
  /** floor plate id per cell (0 = none) */
  plates?: Uint8Array | null;
  /** 1 = support branch */
  struts?: Uint8Array | null;
  /** 1 = inside the container (absent: the whole box) */
  mask?: Uint8Array | null;
}

// ------------------------------------------------------------------ small helpers
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Python's round(): halves go to the even number (so the names agree with the engine's). */
function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function stat3(values: number[]): Stat3 {
  if (!values.length) return { min: 0, mean: 0, max: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sum += v;
  }
  return { min: r3(lo), mean: r3(sum / values.length), max: r3(hi) };
}

/** min / mean / max clear height (ft) of floor cells, from their runs (cells), ignoring runs under 1 ft unless that is all there is. */
function clearStats(runCells: number[], cell: number): Stat3 {
  const h = runCells.map((v) => v * cell);
  const kept = h.filter((v) => v >= 1.0 - 1e-9);
  return stat3(kept.length ? kept : h);
}

// ------------------------------------------------------------------ what is above every cell, and light
interface Fields {
  clearTop: Uint8Array;
  runUp: Int32Array;
  ldist: Int16Array;
}

function verticalFields(vd: Uint8Array, grid: Grid): { clearTop: Uint8Array; runUp: Int32Array } {
  const [nx, ny, nz] = grid;
  const clearTop = new Uint8Array(vd.length);
  const runUp = new Int32Array(vd.length);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const base = (x * ny + y) * nz;
      let run = 0;
      let open = 1;
      for (let z = nz - 1; z >= 0; z--) {
        if (vd[base + z]) {
          run++;
          if (!open) clearTop[base + z] = 0;
          else clearTop[base + z] = 1;
        } else {
          run = 0;
          open = 0;
        }
        runUp[base + z] = run;
      }
    }
  return { clearTop, runUp };
}

/** Steps (cells) to the nearest light per void cell: open sky above, or a void cell on a side face, through the void of the same layer (8 neighbours). */
function lightDistance(vd: Uint8Array, clearTop: Uint8Array, grid: Grid, cell: number): Int16Array {
  const [nx, ny, nz] = grid;
  const cap = Math.max(1, pyRound(PARAMS.lit_cap_ft / cell));
  const out = new Int16Array(vd.length).fill(cap);
  const layerIdx = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  for (let z = 0; z < nz; z++) {
    let frontier: number[] = [];
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const i = layerIdx(x, y, z);
        if (!vd[i]) continue;
        const edge = x === 0 || y === 0 || x === nx - 1 || y === ny - 1;
        if (clearTop[i] || edge) {
          out[i] = 0;
          frontier.push(i);
        }
      }
    for (let it = 1; it < cap && frontier.length; it++) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = Math.floor(c / (ny * nz));
        const y = Math.floor((c - x * ny * nz) / nz);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
            const j = layerIdx(xx, yy, z);
            if (vd[j] && out[j] === cap) {
              out[j] = it;
              next.push(j);
            }
          }
      }
      frontier = next;
    }
  }
  return out;
}

// ------------------------------------------------------------------ levels
interface LevelsResult {
  levels: LevelInfo[];
  levelOfK: Map<number, number>;
  /** floor[(x * ny + y) * nz + z] = 1 when cell z is void with foam below it (z >= 1) */
  floor: Uint8Array;
}

function analyzeLevels(input: AnalyzeInput, mask: Uint8Array, f: Fields): LevelsResult {
  const { grid, cell } = input;
  const vd = input.void;
  const [nx, ny, nz] = grid;
  const floor = new Uint8Array(vd.length);
  const areaK = new Float64Array(nz);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 1; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (vd[i] && !vd[i - 1] && mask[i - 1]) {
          floor[i] = 1;
          areaK[z] += cell * cell;
        }
      }
  let planCols = 0;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      let any = false;
      for (let z = 0; z < nz && !any; z++) if (mask[(x * ny + y) * nz + z]) any = true;
      if (any) planCols++;
    }
  const thr = Math.max(2.0, PARAMS.level_min_frac * planCols * cell * cell);
  const groups: number[][] = [];
  for (let k = 1; k < nz; k++) {
    if (areaK[k] < thr) continue;
    const last = groups[groups.length - 1];
    if (last && k === last[last.length - 1] + 1) last.push(k);
    else groups.push([k]);
  }
  const litSteps = pyRound(PARAMS.lit_ft / cell);
  const levels: LevelInfo[] = [];
  const levelOfK = new Map<number, number>();
  groups.forEach((g, n) => {
    let areaSum = 0;
    let weighted = 0;
    for (const k of g) {
      areaSum += areaK[k];
      weighted += areaK[k] * (k * cell);
    }
    const zmean = weighted / areaSum;
    const zmin = g[0] * cell;
    const zmax = g[g.length - 1] * cell;
    const plateIds = new Set<number>();
    const runs: number[] = [];
    let nF = 0;
    let sky = 0;
    let lit = 0;
    for (const k of g)
      for (let x = 0; x < nx; x++)
        for (let y = 0; y < ny; y++) {
          const i = (x * ny + y) * nz + k;
          if (!floor[i]) continue;
          nF++;
          runs.push(f.runUp[i]);
          if (f.clearTop[i]) sky++;
          if (f.ldist[i] <= litSteps) lit++;
          if (input.plates && input.plates[i - 1] > 0) plateIds.add(input.plates[i - 1]);
        }
    let volSum = 0;
    for (const r of runs) volSum += r;
    const name = zmax - zmin >= 1.0 ? `the ramp from ${pyRound(zmin * 2) / 2} to ${pyRound(zmax * 2) / 2} ft` : `the ${pyRound(zmean * 2) / 2} ft floor`;
    levels.push({
      id: n + 1,
      name,
      z_ft: r3(zmean),
      z_min_ft: r3(zmin),
      z_max_ft: r3(zmax),
      area_ft2: r3(areaSum),
      kind: zmax - zmin >= 1.0 ? "sloped" : "flat",
      layers: [g[0], g[g.length - 1]],
      plate_ids: [...plateIds].sort((a, b) => a - b),
      clear_height_ft: clearStats(runs, cell),
      volume_above_ft3: r3(volSum * cell ** 3),
      sky_fraction: r4(sky / nF),
      lit_fraction: r4(lit / nF),
    });
    for (const k of g) levelOfK.set(k, n + 1);
  });
  return { levels, levelOfK, floor };
}

// ------------------------------------------------------------------ rooms (marker watershed on the distance field)
const DIRS6: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/** Distance from each void cell to the nearest foam cell centre, in quarter cells (integer); foam -1. */
function edtQ(vd: Uint8Array, grid: Grid): Int32Array {
  const q = new Int32Array(vd.length);
  let anyFoam = false;
  for (let i = 0; i < vd.length; i++) if (!vd[i]) anyFoam = true;
  if (!anyFoam) {
    for (let i = 0; i < vd.length; i++) q[i] = 1000000;
    return q;
  }
  const d2 = edtSquared(vd, grid);
  for (let i = 0; i < vd.length; i++) q[i] = vd[i] ? Math.round(Math.sqrt(Math.round(d2[i])) * PARAMS.quant) : -1;
  return q;
}

/** Peaks of the distance field with at least h of prominence (reconstruction by dilation of q - h under q), one label per plateau. */
function roomMarkers(q: Int32Array, vd: Uint8Array, grid: Grid, hq: number): Int32Array {
  const [nx, ny, nz] = grid;
  const n = vd.length;
  const syz = ny * nz;
  const rec = new Float64Array(n);
  for (let i = 0; i < n; i++) rec[i] = vd[i] ? q[i] - hq : -BIG;
  const neighbours = (c: number, out: number[]) => {
    out.length = 0;
    const x = Math.floor(c / syz);
    const y = Math.floor((c - x * syz) / nz);
    const z = c - x * syz - y * nz;
    if (x > 0 && vd[c - syz]) out.push(c - syz);
    if (x < nx - 1 && vd[c + syz]) out.push(c + syz);
    if (y > 0 && vd[c - nz]) out.push(c - nz);
    if (y < ny - 1 && vd[c + nz]) out.push(c + nz);
    if (z > 0 && vd[c - 1]) out.push(c - 1);
    if (z < nz - 1 && vd[c + 1]) out.push(c + 1);
  };
  const nb: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < n; c++) {
      if (!vd[c]) continue;
      neighbours(c, nb);
      let best = rec[c];
      for (const m of nb) if (rec[m] > best) best = rec[m];
      if (best > q[c]) best = q[c];
      if (best > rec[c]) {
        rec[c] = best;
        changed = true;
      }
    }
  }
  const markers = new Int32Array(n);
  const seen = new Uint8Array(n);
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!vd[s] || seen[s]) continue;
    const plateau: number[] = [];
    let isMax = true;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      plateau.push(c);
      neighbours(c, nb);
      for (const m of nb) {
        if (rec[m] > rec[c]) isMax = false;
        else if (rec[m] === rec[c] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    if (isMax) {
      count++;
      for (const c of plateau) markers[c] = count;
    }
  }
  // number the markers by the raster order of their first cell, as scipy's label does
  const remap = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (markers[i] && !remap.has(markers[i])) remap.set(markers[i], ++next);
  }
  for (let i = 0; i < n; i++) if (markers[i]) markers[i] = remap.get(markers[i])!;
  return markers;
}

/** Cells are claimed from the highest distance down, each by the room next to it (ties: lower cell index). */
function floodRooms(q: Int32Array, vd: Uint8Array, grid: Grid, markers: Int32Array): Int32Array {
  const [nx, ny, nz] = grid;
  const syz = ny * nz;
  const lab = Int32Array.from(markers);
  const heap = new MinHeap();
  for (let i = 0; i < lab.length; i++) if (lab[i]) heap.push(-q[i], i);
  while (heap.size) {
    const { id: c } = heap.pop();
    const lc = lab[c];
    const x = Math.floor(c / syz);
    const y = Math.floor((c - x * syz) / nz);
    const z = c - x * syz - y * nz;
    for (const [dx, dy, dz] of DIRS6) {
      const xx = x + dx;
      const yy = y + dy;
      const zz = z + dz;
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
      const m = (xx * ny + yy) * nz + zz;
      if (vd[m] && !lab[m]) {
        lab[m] = lc;
        heap.push(-q[m], m);
      }
    }
  }
  return lab;
}

interface Interface {
  n: number;
  nz: number;
  sum: [number, number, number];
  dmax: number;
}

/** Where two rooms touch: key "a,b" with a < b -> number of touching cell faces, vertical ones, summed positions (ft), widest distance-to-foam. */
function roomInterfaces(lab: Int32Array, q: Int32Array, grid: Grid, cell: number): Map<string, Interface> {
  const [nx, ny, nz] = grid;
  const out = new Map<string, Interface>();
  const distAt = (i: number) => (q[i] > 0 ? (q[i] / PARAMS.quant) * cell : 0);
  const visit = (i: number, j: number, ax: number, x: number, y: number, z: number) => {
    const a = lab[i];
    const b = lab[j];
    if (!a || !b || a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo},${hi}`;
    let e = out.get(key);
    if (!e) {
      e = { n: 0, nz: 0, sum: [0, 0, 0], dmax: 0 };
      out.set(key, e);
    }
    e.n++;
    if (ax === 2) e.nz++;
    const pos = [x + 0.5, y + 0.5, z + 0.5];
    pos[ax] += 0.5;
    e.sum[0] += pos[0] * cell;
    e.sum[1] += pos[1] * cell;
    e.sum[2] += pos[2] * cell;
    e.dmax = Math.max(e.dmax, Math.max(distAt(i), distAt(j)));
  };
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (x < nx - 1) visit(i, i + ny * nz, 0, x, y, z);
        if (y < ny - 1) visit(i, i + nz, 1, x, y, z);
        if (z < nz - 1) visit(i, i + 1, 2, x, y, z);
      }
  return out;
}

function labelRooms(vd: Uint8Array, grid: Grid, cell: number): { lab: Int32Array; q: Int32Array; specks: { count: number; volume_ft3: number } } {
  const q = edtQ(vd, grid);
  const hq = Math.max(1, pyRound((PARAMS.room_h_ft / cell) * PARAMS.quant));
  const lab = floodRooms(q, vd, grid, roomMarkers(q, vd, grid, hq));
  const minCells = Math.ceil(PARAMS.min_room_ft3 / cell ** 3);
  const counts = () => {
    let m = 0;
    for (let i = 0; i < lab.length; i++) if (lab[i] > m) m = lab[i];
    const c = new Int32Array(m + 1);
    for (let i = 0; i < lab.length; i++) c[lab[i]]++;
    return c;
  };
  // merge small rooms into the neighbour they share the most surface with
  for (;;) {
    const cnt = counts();
    const small: [number, number][] = [];
    for (let r = 1; r < cnt.length; r++) if (cnt[r] > 0 && cnt[r] < minCells) small.push([cnt[r], r]);
    if (!small.length) break;
    small.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const inter = roomInterfaces(lab, q, grid, cell);
    let merged = false;
    for (const [, r] of small) {
      const nbs: [number, number][] = [];
      for (const [key, v] of inter) {
        const [a, b] = key.split(",").map(Number);
        if (a === r || b === r) nbs.push([-v.n, a === r ? b : a]);
      }
      if (nbs.length) {
        nbs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const target = nbs[0][1];
        for (let i = 0; i < lab.length; i++) if (lab[i] === r) lab[i] = target;
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  // what is still smaller than a room is a speck of void, not a room
  const cnt = counts();
  let speckCells = 0;
  let speckCount = 0;
  const drop = new Uint8Array(cnt.length);
  for (let r = 1; r < cnt.length; r++)
    if (cnt[r] > 0 && cnt[r] < minCells) {
      drop[r] = 1;
      speckCells += cnt[r];
      speckCount++;
    }
  for (let i = 0; i < lab.length; i++) if (drop[lab[i]]) lab[i] = 0;
  // biggest room first (ties: the room that starts first in raster order)
  const vol = new Map<number, number>();
  const first = new Map<number, number>();
  for (let i = 0; i < lab.length; i++) {
    const r = lab[i];
    if (!r) continue;
    vol.set(r, (vol.get(r) ?? 0) + 1);
    if (!first.has(r)) first.set(r, i);
  }
  const order = [...vol.keys()].sort((a, b) => vol.get(b)! - vol.get(a)! || first.get(a)! - first.get(b)!);
  const remap = new Map<number, number>();
  order.forEach((r, n) => remap.set(r, n + 1));
  for (let i = 0; i < lab.length; i++) if (lab[i]) lab[i] = remap.get(lab[i])!;
  return { lab, q, specks: { count: speckCount, volume_ft3: r3(speckCells * cell ** 3) } };
}

function classifyRoom(ext: number[], clear: Stat3, sky: number, footprint: number): RoomKind {
  const lng = Math.max(ext[0], ext[1]);
  const wid = Math.max(Math.min(ext[0], ext[1]), 0.5);
  if (clear.max >= 12.0 && clear.max >= 2.0 * wid) return "shaft";
  if (lng >= 3.0 * wid && wid <= 10.0) return "gallery";
  if (sky >= 0.6) return "terrace";
  if (footprint >= 100.0 && clear.mean >= 8.0) return "hall";
  if (sky < 0.05 && clear.mean < 9.0) return "cave";
  if (clear.mean < 7.0) return "low room";
  return "room";
}

function analyzeRooms(
  input: AnalyzeInput,
  lv: LevelsResult,
  f: Fields,
  lab: Int32Array,
  roomCount: number,
): RoomInfo[] {
  const { grid, cell } = input;
  const vd = input.void;
  const [nx, ny, nz] = grid;
  const ca = cell * cell;
  const litSteps = pyRound(PARAMS.lit_ft / cell);
  type Acc = {
    cells: number;
    lo: number[];
    hi: number[];
    sum: number[];
    floorRuns: number[];
    sky: number;
    lit: number;
    ldSum: number;
    fz: Set<number>;
    cols: Set<number>;
    colHeight: Map<number, number>;
    faces: Record<string, number>;
    levels: Set<number>;
    openBelow: boolean;
  };
  const accs: Acc[] = [];
  for (let r = 0; r <= roomCount; r++)
    accs.push({ cells: 0, lo: [BIG, BIG, BIG], hi: [-BIG, -BIG, -BIG], sum: [0, 0, 0], floorRuns: [], sky: 0, lit: 0, ldSum: 0, fz: new Set(), cols: new Set(), colHeight: new Map(), faces: {}, levels: new Set(), openBelow: false });
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        const r = lab[i];
        if (!r) continue;
        const a = accs[r];
        a.cells++;
        const p = [x, y, z];
        for (let k = 0; k < 3; k++) {
          if (p[k] < a.lo[k]) a.lo[k] = p[k];
          if (p[k] > a.hi[k]) a.hi[k] = p[k];
          a.sum[k] += p[k];
        }
        const col = x * ny + y;
        a.cols.add(col);
        a.colHeight.set(col, (a.colHeight.get(col) ?? 0) + 1);
        if (z === 0) a.openBelow = true;
        if (lv.floor[i]) {
          a.floorRuns.push(f.runUp[i]);
          if (f.clearTop[i]) a.sky++;
          if (f.ldist[i] <= litSteps) a.lit++;
          a.ldSum += f.ldist[i];
          a.fz.add(z);
          const level = lv.levelOfK.get(z);
          if (level) a.levels.add(level);
        }
        if (x === 0) a.faces["-X"] = (a.faces["-X"] ?? 0) + ca;
        if (x === nx - 1) a.faces["+X"] = (a.faces["+X"] ?? 0) + ca;
        if (y === 0) a.faces["-Y"] = (a.faces["-Y"] ?? 0) + ca;
        if (y === ny - 1) a.faces["+Y"] = (a.faces["+Y"] ?? 0) + ca;
        if (z === 0) a.faces["-Z"] = (a.faces["-Z"] ?? 0) + ca;
        if (z === nz - 1) a.faces["+Z"] = (a.faces["+Z"] ?? 0) + ca;
      }
  let voidCells = 0;
  for (let i = 0; i < vd.length; i++) voidCells += vd[i];
  const total = voidCells * cell ** 3;
  const rooms: RoomInfo[] = [];
  for (let r = 1; r <= roomCount; r++) {
    const a = accs[r];
    const nFloor = a.floorRuns.length;
    const ext = [0, 1, 2].map((k) => (a.hi[k] + 1 - a.lo[k]) * cell);
    let clear: Stat3;
    let sky = 0;
    let litF = 0;
    let ldm = 0;
    if (nFloor) {
      clear = clearStats(a.floorRuns, cell);
      sky = a.sky / nFloor;
      litF = a.lit / nFloor;
      ldm = (a.ldSum / nFloor) * cell;
    } else {
      clear = clearStats([...a.colHeight.values()], cell);
    }
    const fzs = [...a.fz].map((k) => k * cell);
    const foot = a.cols.size * ca;
    const kind = classifyRoom(ext, clear, sky, foot);
    const faces: Record<string, number> = {};
    for (const view of VIEWS) if (a.faces[view]) faces[view] = r3(a.faces[view]);
    rooms.push({
      id: r,
      kind,
      name: "",
      volume_ft3: r3(a.cells * cell ** 3),
      cells: a.cells,
      volume_share: r4(total ? (a.cells * cell ** 3) / total : 0),
      floor_area_ft2: r3(nFloor * ca),
      footprint_ft2: r3(foot),
      bbox_min_ft: a.lo.map((v) => r3(v * cell)),
      bbox_max_ft: a.hi.map((v) => r3((v + 1) * cell)),
      extent_ft: ext.map(r3),
      clear_height_ft: clear,
      floor_z_ft: { min: fzs.length ? r3(Math.min(...fzs)) : null, max: fzs.length ? r3(Math.max(...fzs)) : null },
      sky_fraction: r4(sky),
      lit_fraction: r4(litF),
      light_distance_ft: r3(ldm),
      open_below: a.openBelow,
      faces_open_ft2: faces,
      level_ids: [...a.levels].sort((p, q) => p - q),
      centroid_ft: a.sum.map((v) => r3((v / a.cells + 0.5) * cell)),
    });
  }
  // names: a level word when there is more than one floor, the kind, the clear height and the footprint
  const zs = rooms.map((rm) => rm.floor_z_ft.min).filter((v): v is number => v !== null);
  const zlo = zs.length ? Math.min(...zs) : 0;
  const zhi = zs.length ? Math.max(...zs) : 0;
  const seen = new Map<string, number>();
  for (const rm of rooms) {
    const z = rm.floor_z_ft.min;
    let word = "";
    if (lv.levels.length >= 2 && z !== null && zhi - zlo >= 2.0) word = z - zlo < 0.2 * (zhi - zlo) ? "lower " : zhi - z < 0.2 * (zhi - zlo) ? "upper " : "middle ";
    const h = rm.kind === "shaft" ? rm.clear_height_ft.max : rm.clear_height_ft.mean;
    const [aa, bb] = [rm.extent_ft[0], rm.extent_ft[1]].sort((p, q) => q - p);
    const base = `${word}${rm.kind}, ${pyRound(h)} ft clear, ${pyRound(aa)} by ${pyRound(bb)} ft`;
    seen.set(base, (seen.get(base) ?? 0) + 1);
    rm.name = seen.get(base) === 1 ? base : `${base} (${seen.get(base)})`;
  }
  return rooms;
}

function analyzeConnections(rooms: RoomInfo[], lab: Int32Array, q: Int32Array, grid: Grid, cell: number): { connections: ConnectionInfo[]; graph: GraphInfo } {
  const inter = roomInterfaces(lab, q, grid, cell);
  const keys = [...inter.keys()]
    .map((k) => k.split(",").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const connections: ConnectionInfo[] = [];
  for (const [a, b] of keys) {
    const v = inter.get(`${a},${b}`)!;
    const area = v.n * cell * cell;
    const neck = Math.max(0, (2 * v.dmax) / cell - 1) * cell;
    if (area < PARAMS.min_link_ft2 || neck < PARAMS.min_link_neck_ft - 1e-9) continue;
    const vs = v.nz / v.n;
    connections.push({
      id: connections.length + 1,
      rooms: [a, b],
      area_ft2: r3(area),
      neck_ft: r3(neck),
      centre_ft: v.sum.map((s) => r3(s / v.n)),
      orientation: vs > 0.6 ? "vertical" : vs < 0.2 ? "horizontal" : "mixed",
    });
  }
  const deg = new Map<number, number>(rooms.map((r) => [r.id, 0]));
  const parent = new Map<number, number>(rooms.map((r) => [r.id, r.id]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const c of connections) {
    const [a, b] = c.rooms;
    deg.set(a, deg.get(a)! + 1);
    deg.set(b, deg.get(b)! + 1);
    parent.set(find(a), find(b));
  }
  const comps = new Set(rooms.map((r) => find(r.id))).size;
  const access = rooms.filter((r) => Object.values(r.faces_open_ft2).some((a) => a >= PARAMS.min_link_ft2)).map((r) => r.id);
  const necks = connections.map((c) => c.neck_ft);
  const graph: GraphInfo = {
    rooms: rooms.length,
    connections: connections.length,
    components: rooms.length ? comps : 0,
    loops: Math.max(0, connections.length - rooms.length + comps),
    dead_ends: rooms.filter((r) => deg.get(r.id) === 1).length,
    degree: rooms.map((r) => deg.get(r.id)!),
    access_rooms: access,
    neck_ft: { min: necks.length ? Math.min(...necks) : null, max: necks.length ? Math.max(...necks) : null },
  };
  return { connections, graph };
}

// ------------------------------------------------------------------ routes
const NEIGHBOURS26: { d: [number, number, number]; w: number }[] = (() => {
  const out: { d: [number, number, number]; w: number }[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) out.push({ d: [dx, dy, dz], w: Math.sqrt(dx * dx + dy * dy + dz * dz) });
  return out;
})();

function faceCells(vd: Uint8Array, grid: Grid, face: string): number[] {
  const [nx, ny, nz] = grid;
  const axis = "XYZ".indexOf(face[1]);
  const at = face[0] === "-" ? 0 : grid[axis] - 1;
  const out: number[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        if ([x, y, z][axis] !== at) continue;
        const i = (x * ny + y) * nz + z;
        if (vd[i]) out.push(i);
      }
  return out;
}

function dijkstra(vd: Uint8Array, grid: Grid, cell: number, sources: number[]): { dist: Float64Array; pred: Int32Array } {
  const [nx, ny, nz] = grid;
  const syz = ny * nz;
  const dist = new Float64Array(vd.length).fill(Infinity);
  const pred = new Int32Array(vd.length).fill(-1);
  const heap = new MinHeap();
  for (const s of sources) {
    dist[s] = 0;
    heap.push(0, s);
  }
  while (heap.size) {
    const { key, id: c } = heap.pop();
    if (key > dist[c]) continue;
    const x = Math.floor(c / syz);
    const y = Math.floor((c - x * syz) / nz);
    const z = c - x * syz - y * nz;
    for (const { d, w } of NEIGHBOURS26) {
      const xx = x + d[0];
      const yy = y + d[1];
      const zz = z + d[2];
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
      const m = (xx * ny + yy) * nz + zz;
      if (!vd[m]) continue;
      const nd = key + w * cell;
      if (nd < dist[m]) {
        dist[m] = nd;
        pred[m] = c;
        heap.push(nd, m);
      }
    }
  }
  return { dist, pred };
}

function analyzeRoutes(vd: Uint8Array, grid: Grid, lab: Int32Array, cell: number): { routes: RouteInfo[]; main: RouteInfo | null } {
  const [, ny, nz] = grid;
  const faces = SIDE_FACES.filter((fc) => faceCells(vd, grid, fc).length > 0);
  const routes: RouteInfo[] = [];
  if (faces.length < 2) return { routes, main: null };
  const runs = new Map<string, { dist: Float64Array; pred: Int32Array }>();
  for (const fc of faces) runs.set(fc, dijkstra(vd, grid, cell, faceCells(vd, grid, fc)));
  let best: RouteInfo | null = null;
  for (let a = 0; a < faces.length; a++)
    for (let b = a + 1; b < faces.length; b++) {
      const f = faces[a];
      const g = faces[b];
      const tgt = faceCells(vd, grid, g);
      const { dist, pred } = runs.get(f)!;
      let end = -1;
      let dmin = Infinity;
      for (const t of tgt) {
        if (dist[t] < dmin) {
          dmin = dist[t];
          end = t;
        }
      }
      if (!Number.isFinite(dmin)) continue;
      const path = [end];
      while (pred[path[path.length - 1]] >= 0) path.push(pred[path[path.length - 1]]);
      path.reverse();
      const pts = path.map((c) => {
        const x = Math.floor(c / (ny * nz));
        const y = Math.floor((c - x * ny * nz) / nz);
        const z = c - x * ny * nz - y * nz;
        return [(x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell];
      });
      const length = dmin + cell;
      const straight = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][2] - pts[0][2]) + cell;
      let samp = pts.filter((_, i) => i % ROUTE_STEP === 0);
      const lastP = pts[pts.length - 1];
      const lastS = samp[samp.length - 1];
      if (samp.length < 2 || Math.hypot(lastS[0] - lastP[0], lastS[1] - lastP[1], lastS[2] - lastP[2]) > 1e-9) samp = [...samp, lastP];
      const seg = samp.slice(1).map((p, i) => [p[0] - samp[i][0], p[1] - samp[i][1], p[2] - samp[i][2]]);
      const nrm = seg.map((s) => Math.hypot(s[0], s[1], s[2]));
      let bends = 0;
      const cosLimit = Math.cos((35 * Math.PI) / 180);
      for (let k = 1; k < seg.length; k++)
        if (nrm[k] > 1e-9 && nrm[k - 1] > 1e-9) {
          const dot = seg[k][0] * seg[k - 1][0] + seg[k][1] * seg[k - 1][1] + seg[k][2] * seg[k - 1][2];
          if (dot / (nrm[k] * nrm[k - 1]) < cosLimit) bends++;
        }
      const roomsOn: number[] = [];
      for (const c of path) {
        const r = lab[c];
        if (r && !roomsOn.includes(r)) roomsOn.push(r);
      }
      const step = Math.max(1, pyRound(1.0 / cell));
      const route: RouteInfo = {
        from: f,
        to: g,
        length_ft: r3(length),
        straight_ft: r3(straight),
        sinuosity: r3(length / Math.max(straight, 1e-9)),
        bends,
        rooms: roomsOn,
        points_ft: pts.filter((_, i) => i % step === 0).map((p) => p.map(r2)),
      };
      routes.push(route);
      if (!best || length > best.length_ft + 1e-6) best = route;
    }
  return { routes, main: best };
}

function routeProfile(grid: Grid, lab: Int32Array, route: RouteInfo | null, cell: number): ProfileInfo | null {
  if (!route || !route.rooms.length) return null;
  const [nx, ny, nz] = grid;
  const p0 = route.points_ft[0];
  const p1 = route.points_ft[route.points_ft.length - 1];
  const ax = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]) ? 0 : 1;
  const inRoute = new Set(route.rooms);
  const prof = new Float64Array(ax === 0 ? nx : ny);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) if (inRoute.has(lab[(x * ny + y) * nz + z])) prof[ax === 0 ? x : y] += cell * cell;
  const pos = [...prof].filter((v) => v > 0);
  const sorted = [...pos].sort((a, b) => a - b);
  const med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : 0.5 * (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2])) : 0;
  let squeezes = 0;
  let inRun = false;
  for (const v of prof) {
    if (v > 0 && v < 0.6 * med) {
      if (!inRun) squeezes++;
      inRun = true;
    } else inRun = false;
  }
  const lo = pos.length ? Math.min(...pos) : 0;
  const hi = pos.length ? Math.max(...pos) : 0;
  return {
    axis: ax === 0 ? "x" : "y",
    area_ft2: [...prof].map(r2),
    min_ft2: r3(lo),
    max_ft2: r3(hi),
    median_ft2: r3(med),
    ratio: pos.length ? r3(hi / Math.max(lo, 1e-9)) : 1.0,
    squeezes,
  };
}

// ------------------------------------------------------------------ openings, structure
function analyzeOpenings(vd: Uint8Array, grid: Grid, cell: number): OpeningsInfo {
  const out: OpeningsInfo = {};
  const ca = cell * cell;
  for (const face of VIEWS) {
    const { data, rows, cols } = faceLayer(vd, grid, face);
    const sizes = componentSizes2d(data, rows, cols)
      .map((n) => n * ca)
      .sort((a, b) => b - a)
      .filter((a) => a >= PARAMS.opening_min_ft2 - 1e-9);
    let total = 0;
    for (let i = 0; i < data.length; i++) total += data[i];
    out[face] = { count: sizes.length, areas_ft2: sizes.map(r3), total_ft2: r3(total * ca) };
  }
  return out;
}

function thinShare(foam: Uint8Array, grid: Grid, cell: number): Record<string, number> {
  const out: Record<string, number> = {};
  let nFoam = 0;
  for (let i = 0; i < foam.length; i++) nFoam += foam[i];
  if (!nFoam) {
    for (const w of THIN_WALLS_FT) out[String(w)] = 0;
    return out;
  }
  const dsq = edtSquared(foam, grid);
  for (const w of THIN_WALLS_FT) {
    const rc = w / 2 / cell;
    const coreMin = Math.ceil(rc * rc - 1e-9);
    const core = new Uint8Array(foam.length);
    let nCore = 0;
    for (let i = 0; i < foam.length; i++)
      if (foam[i] && Math.round(dsq[i]) >= coreMin) {
        core[i] = 1;
        nCore++;
      }
    if (!nCore) {
      out[String(w)] = 1.0;
      continue;
    }
    const notCore = new Uint8Array(foam.length);
    for (let i = 0; i < foam.length; i++) notCore[i] = core[i] ? 0 : 1;
    const d2 = edtSquared(notCore, grid);
    const keepMax = Math.floor(rc * rc + 1e-9);
    let kept = 0;
    for (let i = 0; i < foam.length; i++) if (foam[i] && Math.round(d2[i]) <= keepMax) kept++;
    out[String(w)] = r4(1.0 - kept / nFoam);
  }
  return out;
}

function analyzeStructure(input: AnalyzeInput, mask: Uint8Array): StructureInfo {
  const { grid, cell } = input;
  const vd = input.void;
  const [nx, ny, nz] = grid;
  const ca = cell * cell;
  const cv = cell ** 3;
  const foam = new Uint8Array(vd.length);
  let nFoam = 0;
  for (let i = 0; i < vd.length; i++)
    if (!vd[i] && mask[i]) {
      foam[i] = 1;
      nFoam++;
    }
  const { labels, count } = label6(foam, grid);
  const sizes = new Array<number>(count).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i]) sizes[labels[i] - 1]++;
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const grounded = new Set<number>();
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const i = (x * ny + y) * nz;
      if (foam[i]) grounded.add(labels[i]);
    }
  const pieces = order.slice(0, 12).map((i) => ({ id: i + 1, volume_ft3: r3(sizes[i] * cv), grounded: grounded.has(i + 1) }));
  let overhang = 0;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 1; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (foam[i] && vd[i - 1]) overhang++;
      }
  let foamSurface = 0;
  const syz = ny * nz;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        const nbrs = [x < nx - 1 ? i + syz : -1, y < ny - 1 ? i + nz : -1, z < nz - 1 ? i + 1 : -1];
        for (const j of nbrs) if (j >= 0 && ((foam[i] && vd[j]) || (vd[i] && foam[j]))) foamSurface++;
      }
  const plates: StructurePlate[] = [];
  let plateCells = 0;
  if (input.plates) {
    const ids = new Map<number, { cells: number; cols: Set<number>; pieces: Set<number> }>();
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) {
          const i = (x * ny + y) * nz + z;
          const p = input.plates[i];
          if (!p) continue;
          let e = ids.get(p);
          if (!e) {
            e = { cells: 0, cols: new Set(), pieces: new Set() };
            ids.set(p, e);
          }
          e.cells++;
          e.cols.add(x * ny + y);
          if (labels[i]) e.pieces.add(labels[i]);
          plateCells++;
        }
    for (const id of [...ids.keys()].sort((a, b) => a - b)) {
      const e = ids.get(id)!;
      plates.push({
        id,
        cells: e.cells,
        area_ft2: r3(e.cols.size * ca),
        thickness_ft: r3((e.cells / Math.max(e.cols.size, 1)) * cell),
        piece: e.pieces.size ? Math.min(...e.pieces) : 0,
        grounded: [...e.pieces].some((p) => grounded.has(p)),
      });
    }
  }
  let strutCells = 0;
  if (input.struts) for (let i = 0; i < input.struts.length; i++) if (input.struts[i]) strutCells++;
  let bed = 0;
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) if (foam[(x * ny + y) * nz]) bed++;
  const total = sizes.reduce((a, b) => a + b, 0);
  return {
    foam_ft3: r3(nFoam * cv),
    foam_pieces: count,
    main_piece_share: count ? r4(Math.max(...sizes) / total) : 0,
    pieces,
    floating_ft3: count ? r3((total - Math.max(...sizes)) * cv) : 0,
    thin_share: thinShare(foam, grid, cell),
    overhang_area_ft2: r3(overhang * ca),
    overhang_share: r4(overhang / Math.max(foamSurface, 1)),
    bed_contact_ft2: r3(bed * ca),
    foam_surface_ft2: r3(foamSurface * ca),
    plate_share: nFoam ? r4(plateCells / nFoam) : 0,
    branches_ft3: r3(strutCells * cv),
    plates,
  };
}

// ------------------------------------------------------------------ the whole thing
/** Levels, rooms, connections, graph, routes, route profile, daylight, openings and structure of a tile. */
export function analyzeTile(input: AnalyzeInput): TileAnalysis {
  const { grid, cell } = input;
  const vd = input.void;
  const mask = input.mask ?? new Uint8Array(vd.length).fill(1);
  const { clearTop, runUp } = verticalFields(vd, grid);
  const ldist = lightDistance(vd, clearTop, grid, cell);
  const fields: Fields = { clearTop, runUp, ldist };
  const lv = analyzeLevels(input, mask, fields);
  const { lab, q, specks } = labelRooms(vd, grid, cell);
  let roomCount = 0;
  for (let i = 0; i < lab.length; i++) if (lab[i] > roomCount) roomCount = lab[i];
  const rooms = analyzeRooms(input, lv, fields, lab, roomCount);
  const { connections, graph } = analyzeConnections(rooms, lab, q, grid, cell);
  graph.specks = specks;
  const { routes, main } = analyzeRoutes(vd, grid, lab, cell);
  const profile = routeProfile(grid, lab, main, cell);

  const litSteps = pyRound(PARAMS.lit_ft / cell);
  let nFloor = 0;
  let sky = 0;
  let lit = 0;
  let ldSum = 0;
  for (let i = 0; i < vd.length; i++)
    if (lv.floor[i]) {
      nFloor++;
      if (clearTop[i]) sky++;
      if (ldist[i] <= litSteps) lit++;
      ldSum += ldist[i];
    }
  const daylight: DaylightInfo = {
    lit_floor_fraction: r4(nFloor ? lit / nFloor : 0),
    sky_floor_fraction: r4(nFloor ? sky / nFloor : 0),
    mean_light_distance_ft: r3(nFloor ? (ldSum / nFloor) * cell : 0),
    floor_area_ft2: r3(nFloor * cell * cell),
    lit_within_ft: PARAMS.lit_ft,
  };
  const spaces: SpacesData = {
    analysis_version: ANALYSIS_VERSION,
    params: { ...PARAMS },
    cell_ft: cell,
    levels: lv.levels,
    rooms,
    connections,
    graph,
    routes,
    main_route: main,
    profile,
    daylight,
    openings: analyzeOpenings(vd, grid, cell),
  };
  const roomsOut = new Uint8Array(lab.length);
  for (let i = 0; i < lab.length; i++) roomsOut[i] = Math.min(255, lab[i]);
  return { spaces, structure: analyzeStructure(input, mask), rooms: roomsOut };
}

