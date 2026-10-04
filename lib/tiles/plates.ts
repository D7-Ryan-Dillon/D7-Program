// Floor-plate facts read from the plate cells (voxels/plates.u8): what the engine writes analytically into
// data/plates.json, derived here for tiles that have no such file (the Sections builder's own plates, older exports).
// Same field names as plates.json, so the Viewer's plate inspector and the Analysis read both the same way.

import type { Grid } from "./grid";
import type { PlateEntry, StructureInfo } from "./types";

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function stats(values: number[]) {
  if (!values.length) return { min: 0, mean: 0, max: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  for (const v of values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
  }
  return { min: r3(lo), mean: r3(sum / values.length), max: r3(hi) };
}

/** Slope in degrees of the plane fitted through the plate's column tops (least squares, as the engine does). */
function planeSlopeDeg(xs: number[], ys: number[], zs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sz += zs[i];
  }
  const mx = sx / n, my = sy / n, mz = sz / n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my, dz = zs[i] - mz;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxz += dx * dz;
    syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) {
    // a plate one cell wide: the slope is along the line it lies on
    if (sxx > 1e-9) return (Math.atan(Math.abs(sxz / sxx)) * 180) / Math.PI;
    if (syy > 1e-9) return (Math.atan(Math.abs(syz / syy)) * 180) / Math.PI;
    return 0;
  }
  const a = (sxz * syy - syz * sxy) / det;
  const b = (syz * sxx - sxz * sxy) / det;
  return (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
}

/** Holes of a plate's footprint (cells inside it that are not plate and cannot reach the grid edge without crossing the plate). */
function holes(keep: Uint8Array, nx: number, ny: number): { count: number; cells: number } {
  const outside = new Uint8Array(keep.length);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!keep[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < nx; x++) {
    seed(x * ny);
    seed(x * ny + ny - 1);
  }
  for (let y = 0; y < ny; y++) {
    seed(y);
    seed((nx - 1) * ny + y);
  }
  while (stack.length) {
    const c = stack.pop()!;
    const x = Math.floor(c / ny);
    const y = c - x * ny;
    if (x > 0) seed(c - ny);
    if (x < nx - 1) seed(c + ny);
    if (y > 0) seed(c - 1);
    if (y < ny - 1) seed(c + 1);
  }
  const seen = new Uint8Array(keep.length);
  let count = 0;
  let cells = 0;
  for (let i = 0; i < keep.length; i++) {
    if (keep[i] || outside[i] || seen[i]) continue;
    count++;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      cells++;
      const x = Math.floor(c / ny);
      const y = c - x * ny;
      const nbrs = [x > 0 ? c - ny : -1, x < nx - 1 ? c + ny : -1, y > 0 ? c - 1 : -1, y < ny - 1 ? c + 1 : -1];
      for (const m of nbrs) {
        if (m >= 0 && !keep[m] && !outside[m] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
  }
  return { count, cells };
}

/** One entry per plate id found in `plates`. `structure` (optional) supplies whether each plate joins the grounded foam. */
export function derivePlates(voidVoxels: Uint8Array, plates: Uint8Array, grid: Grid, cell: number, structure?: StructureInfo): PlateEntry[] {
  const [nx, ny, nz] = grid;
  const ids = new Set<number>();
  for (let i = 0; i < plates.length; i++) if (plates[i]) ids.add(plates[i]);
  const out: PlateEntry[] = [];
  const ca = cell * cell;
  for (const id of [...ids].sort((a, b) => a - b)) {
    const topZ = new Float64Array(nx * ny).fill(-1);
    const botZ = new Float64Array(nx * ny).fill(-1);
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const base = (x * ny + y) * nz;
        for (let z = 0; z < nz; z++)
          if (plates[base + z] === id) {
            if (botZ[x * ny + y] < 0) botZ[x * ny + y] = z;
            topZ[x * ny + y] = z + 1;
          }
      }
    const keep = new Uint8Array(nx * ny);
    const tops: number[] = [];
    const bots: number[] = [];
    const above: number[] = [];
    const below: number[] = [];
    const px: number[] = [];
    const py: number[] = [];
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const c = x * ny + y;
        if (topZ[c] < 0) continue;
        keep[c] = 1;
        tops.push(topZ[c] * cell);
        bots.push(botZ[c] * cell);
        px.push((x + 0.5) * cell);
        py.push((y + 0.5) * cell);
        const base = (x * ny + y) * nz;
        let up = 0;
        for (let z = topZ[c]; z < nz && voidVoxels[base + z]; z++) up++;
        let down = 0;
        for (let z = botZ[c] - 1; z >= 0 && voidVoxels[base + z]; z--) down++;
        above.push(up * cell);
        below.push(down * cell);
      }
    const n = tops.length;
    const th = tops.map((t, i) => t - bots[i]);
    const hole = holes(keep, nx, ny);
    const sp = structure?.plates.find((p) => p.id === id);
    out.push({
      id,
      name: `plate ${id}`,
      present: n > 0,
      area_ft2: r3(n * ca),
      thickness_ft: r3(th.reduce((a, b) => a + b, 0) / Math.max(n, 1)),
      slope_deg: r2(planeSlopeDeg(px, py, tops)),
      top_z_ft: stats(tops),
      bottom_z_ft: { min: stats(bots).min, max: stats(bots).max },
      space_above: { clear_height_ft: stats(above), area_clear_8ft_ft2: r3(above.filter((v) => v >= 8).length * ca) },
      space_below: { clear_height_ft: stats(below), area_clear_8ft_ft2: r3(below.filter((v) => v >= 8).length * ca) },
      openings: { count: hole.count, total_ft2: r3(hole.cells * ca) },
      support: sp ? { supported: sp.grounded } : undefined,
    });
  }
  return out;
}
