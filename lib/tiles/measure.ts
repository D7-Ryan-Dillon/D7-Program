// tile.json's `metrics`, data/faces.json and data/sections.json, measured from a tile's voxels: the same quantities the
// Grasshopper engine writes (tile_metrics() / export_bundle() in engine/erosion_engine_7.py), so a tile built in the
// browser carries exactly the data an engine tile does. The Sections builder used to compute its own, slightly different
// versions of these (its "floor area by z" counted foam cells, the engine's counts floors); this replaces them.
//
// Not measured here: the smooth-mesh areas (void_mesh_area_ft2, foam_mesh_area_ft2), which need the engine's marching-cubes
// mesh. Everything that reads them falls back to the voxel wall area when they are absent.

import type { FaceEntry, FaceMetric, FacesJson, SectionEntry, SectionsJson, TileMetrics, VoidComponent } from "@/lib/types";
import { faceLayer, label6, VIEWS, type Grid } from "./grid";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface MeasureInput {
  void: Uint8Array;
  grid: Grid;
  cell: number;
  plates?: Uint8Array | null;
  mask?: Uint8Array | null;
}

export function measureMetrics(input: MeasureInput): TileMetrics {
  const { grid, cell } = input;
  const vd = input.void;
  const [nx, ny, nz] = grid;
  const cv = cell ** 3;
  const ca = cell * cell;
  let blockCells = vd.length;
  if (input.mask) {
    blockCells = 0;
    for (let i = 0; i < input.mask.length; i++) blockCells += input.mask[i];
  }
  let voidCells = 0;
  for (let i = 0; i < vd.length; i++) voidCells += vd[i];
  const total = blockCells * cv;
  const vol = voidCells * cv;

  // connected void pieces, largest first (the engine keeps the biggest 60)
  const { labels, count } = label6(vd, grid);
  const sizes = new Array<number>(count).fill(0);
  const lo = Array.from({ length: count }, () => [1e9, 1e9, 1e9]);
  const hi = Array.from({ length: count }, () => [-1, -1, -1]);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const l = labels[(x * ny + y) * nz + z];
        if (!l) continue;
        const k = l - 1;
        sizes[k]++;
        const p = [x, y, z];
        for (let a = 0; a < 3; a++) {
          if (p[a] < lo[k][a]) lo[k][a] = p[a];
          if (p[a] > hi[k][a]) hi[k][a] = p[a];
        }
      }
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const faceLabelRaw = (f: string) => {
    const ax = "XYZ".indexOf(f[1]);
    const at = f[0] === "-" ? 0 : grid[ax] - 1;
    const out: number[] = [];
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) if ([x, y, z][ax] === at) out.push(labels[(x * ny + y) * nz + z]);
    return out;
  };
  const faceLab = new Map<string, number[]>();
  for (const f of VIEWS) faceLab.set(f, faceLabelRaw(f));
  const components: VoidComponent[] = order.slice(0, 60).map((k) => {
    const touching: Record<string, number> = {};
    for (const f of VIEWS) {
      const n = faceLab.get(f)!.filter((l) => l === k + 1).length;
      if (n) touching[f] = r3(n * ca);
    }
    return {
      id: k + 1,
      volume_ft3: r3(sizes[k] * cv),
      bbox_min_ft: lo[k].map((v) => r3(v * cell)),
      bbox_max_ft: hi[k].map((v) => r3((v + 1) * cell)),
      touches_faces_open_area_ft2: touching,
    };
  });

  // horizontal surfaces: foam with void directly above = a floor, void with foam directly above = a ceiling
  const floorArea = new Array<number>(Math.max(nz - 1, 0)).fill(0);
  const ceilArea = new Array<number>(Math.max(nz - 1, 0)).fill(0);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz - 1; z++) {
        const i = (x * ny + y) * nz + z;
        if (!vd[i] && vd[i + 1]) floorArea[z] += ca;
        if (vd[i] && !vd[i + 1]) ceilArea[z] += ca;
      }
  let wall = 0;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (x < nx - 1 && vd[i] !== vd[i + ny * nz]) wall++;
        if (y < ny - 1 && vd[i] !== vd[i + nz]) wall++;
        if (z < nz - 1 && vd[i] !== vd[i + 1]) wall++;
      }
  const faces: Record<string, FaceMetric> = {};
  let openTotal = 0;
  for (const f of VIEWS) {
    const { data } = faceLayer(vd, grid, f);
    let n = 0;
    for (let i = 0; i < data.length; i++) n += data[i];
    faces[f] = { open_cells: n, open_area_ft2: r3(n * ca), open_fraction: r4(n / data.length) };
    openTotal += n * ca;
  }
  const prof = { x: new Array<number>(nx).fill(0), y: new Array<number>(ny).fill(0), z: new Array<number>(nz).fill(0) };
  let bbMin = [1e9, 1e9, 1e9];
  let bbMax = [-1, -1, -1];
  const sum = [0, 0, 0];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        if (!vd[(x * ny + y) * nz + z]) continue;
        prof.x[x] += ca;
        prof.y[y] += ca;
        prof.z[z] += ca;
        const p = [x, y, z];
        for (let a = 0; a < 3; a++) {
          if (p[a] < bbMin[a]) bbMin[a] = p[a];
          if (p[a] > bbMax[a]) bbMax[a] = p[a];
          sum[a] += p[a];
        }
      }
  const hasVoid = voidCells > 0;
  if (!hasVoid) {
    bbMin = [0, 0, 0];
    bbMax = [0, 0, 0];
  }
  const zc = prof.z.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const floorTotal = floorArea.reduce((a, b) => a + b, 0);
  return {
    void_volume_ft3: r3(vol),
    tile_volume_ft3: r3(total),
    void_fraction: total ? Math.round((vol / total) * 100000) / 100000 : 0,
    foam_volume_ft3: r3(total - vol),
    void_pieces: count,
    largest_void_ft3: count ? r3(sizes[order[0]] * cv) : 0,
    void_components: components,
    faces,
    open_area_on_faces_ft2: r3(openTotal),
    void_bbox: hasVoid
      ? { min_ft: bbMin.map((v) => r3(v * cell)), max_ft: bbMax.map((v) => r3((v + 1) * cell)), centroid_ft: sum.map((v) => r3((v / voidCells + 0.5) * cell)) }
      : undefined,
    void_z_range_ft: zc.length ? [r3(zc[0] * cell), r3((zc[zc.length - 1] + 1) * cell)] : undefined,
    voxel_wall_area_ft2: r3(wall * ca),
    floor_area_by_z_ft2: floorArea.map(r3),
    ceiling_area_by_z_ft2: ceilArea.map(r3),
    floor_area_total_ft2: r3(floorTotal),
    void_area_profile_ft2: { x: prof.x.map(r3), y: prof.y.map(r3), z: prof.z.map(r3) },
  };
}

const rows = (data: Uint8Array, nr: number, nc: number) => {
  const out: string[] = [];
  for (let r = 0; r < nr; r++) {
    let s = "";
    for (let c = 0; c < nc; c++) s += data[r * nc + c] ? "1" : "0";
    out.push(s);
  }
  return out;
};

/** Nearest-neighbour resample of a face mask onto the fixed 6 inch grid, whatever cell size the tile was made at. */
function onSixInchGrid(data: Uint8Array, nr: number, nc: number, cell: number): { data: Uint8Array; nr: number; nc: number } {
  const r = Math.round((nr * cell) / 0.5);
  const c = Math.round((nc * cell) / 0.5);
  if (r === nr && c === nc) return { data, nr, nc };
  const out = new Uint8Array(r * c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[i * c + j] = data[Math.min(nr - 1, Math.floor((i * nr) / r)) * nc + Math.min(nc - 1, Math.floor((j * nc) / c))];
  return { data: out, nr: r, nc: c };
}

/** data/faces.json for a box tile: the void mask of each face (6 inch and native), foam and plate masks, depth, edges. */
export function measureFaces(input: MeasureInput): FacesJson {
  const { grid, cell } = input;
  const vd = input.void;
  const [, ny, nz] = grid;
  const ca = cell * cell;
  const plate = input.plates ?? null;
  const entries: Record<string, FaceEntry> = {};
  for (const f of VIEWS) {
    const { data, rows: nr, cols: nc } = faceLayer(vd, grid, f);
    let open = 0;
    for (let i = 0; i < data.length; i++) open += data[i];
    // how many cells of void run straight in from each face cell
    const ax = "XYZ".indexOf(f[1]);
    const dir = f[0] === "-" ? 1 : -1;
    const start = f[0] === "-" ? 0 : grid[ax] - 1;
    const depth: number[][] = [];
    let maxDepth = 0;
    for (let r = 0; r < nr; r++) {
      const line: number[] = [];
      for (let c = 0; c < nc; c++) {
        let d = 0;
        for (; d < grid[ax]; d++) {
          const p = ax === 0 ? [start + dir * d, r, c] : ax === 1 ? [r, start + dir * d, c] : [r, c, start + dir * d];
          if (!vd[(p[0] * ny + p[1]) * nz + p[2]]) break;
        }
        line.push(d);
        if (d > maxDepth) maxDepth = d;
      }
      depth.push(line);
    }
    const foamLayer = new Uint8Array(data.length);
    const plateLayer = new Uint8Array(data.length);
    const pl = plate ? faceLayer(plate, grid, f).data : null;
    const mk = input.mask ? faceLayer(input.mask, grid, f).data : null;
    for (let i = 0; i < data.length; i++) {
      const isPlate = pl ? pl[i] : 0;
      plateLayer[i] = isPlate ? 1 : 0;
      foamLayer[i] = !data[i] && (mk ? mk[i] : 1) && !isPlate ? 1 : 0;
    }
    const m = rows(data, nr, nc);
    const six = onSixInchGrid(data, nr, nc, cell);
    const first = "XYZ".replace(f[1], "");
    entries[f] = {
      stored_axes: [first[0].toLowerCase(), first[1].toLowerCase()],
      mask_rows: m,
      mask_rows_6in: rows(six.data, six.nr, six.nc),
      foam_mask_rows: rows(foamLayer, nr, nc),
      plate_mask_rows: rows(plateLayer, nr, nc),
      depth_cells: depth,
      open_cells: open,
      open_area_ft2: r3(open * ca),
      max_depth_ft: maxDepth * cell,
      edges: {
        first_axis_min: m[0],
        first_axis_max: m[m.length - 1],
        second_axis_min: m.map((s) => s[0]).join(""),
        second_axis_max: m.map((s) => s[s.length - 1]).join(""),
      },
    };
    if (mk && mk.some((v) => !v)) entries[f].outside_mask_rows = rows(mk.map((v) => (v ? 0 : 1)) as unknown as Uint8Array, nr, nc);
  }
  return { schema: "erosion-tile/4", cell_ft: cell, faces: entries };
}

/** data/sections.json: evenly spaced slices along each axis (the engine's default is 9 per axis). */
export function measureSections(input: MeasureInput, count = 9): SectionsJson {
  const { grid, cell } = input;
  const vd = input.void;
  const [nx, ny, nz] = grid;
  const dims = [nx * cell, ny * cell, nz * cell];
  const sections: SectionEntry[] = [];
  (["X", "Y", "Z"] as const).forEach((axis, a) => {
    const n = grid[a];
    for (let i = 0; i < count; i++) {
      const pos = ((i + 0.5) / count) * dims[a];
      const k = Math.min(n - 1, Math.max(0, Math.floor(pos / cell)));
      let open = 0;
      for (let x = 0; x < nx; x++)
        for (let y = 0; y < ny; y++)
          for (let z = 0; z < nz; z++) if ([x, y, z][a] === k && vd[(x * ny + y) * nz + z]) open++;
      const area = a === 0 ? ny * nz : a === 1 ? nx * nz : nx * ny;
      sections.push({ axis, index: i + 1, position_ft: r3((k + 0.5) * cell), void_area_ft2: r3(open * cell * cell), void_fraction: r4(open / area) });
    }
  });
  return { schema: "erosion-tile/4", sections };
}
