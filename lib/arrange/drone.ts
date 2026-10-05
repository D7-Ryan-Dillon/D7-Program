// The drone tour: a camera that flies through the voids of the arrangement like a house-tour drone, never through foam.
//
// How it stays out of the walls: the combined voxels are reduced to 1 ft cells (a cell is an obstacle if ANY of its eight
// half-foot cells is foam, a floor plate or a strut), padded with free air round the outside and a solid ground below, and
// a distance field says how far every free cell is from the nearest obstacle. The path is found by A* through cells that
// are at least `clearance` away from foam (so it can only go through real openings), preferring the middle of a space; it
// is then relaxed into a smooth curve with every move re-checked against the clearance. The camera then looks where a
// drone operator would: ahead, swaying a little, into the deepest open direction, tilting up in tall voids and following
// the climb on a vertical move. Everything is in the arrangement's Z-up feet.

import type { Composite } from "./composite";
import type { PoseFt } from "./capture";
import type { Vec3 } from "./types";

export interface DronePose extends PoseFt {
  /** bank, degrees */
  roll: number;
}

export interface DronePlan {
  /** the flight path, feet, about every 0.5 ft */
  path: Vec3[];
  lengthFt: number;
  /** how far from any foam the camera always stays, feet */
  clearanceFt: number;
  /** piece ids the tour passes through, in order */
  visited: string[];
  /** piece ids it could not reach with enough room */
  skipped: string[];
  /** the camera at t in 0..1 of the film; `seconds` is the film's length (it sets how long the opening turn takes) */
  pose(t: number, seconds?: number): DronePose;
}

const OUTSIDE_COST = 6; // open air outside the building is this many times dearer than a way through the voids
const PAD = 14; // cells of free air round the outside (1 ft cells)
const RADII = [2.5, 1.8, 1.3, 1, 0.8];

interface Grid {
  nx: number;
  ny: number;
  nz: number;
  /** feet: the world position of coarse cell (0,0,0)'s low corner (includes the padding) */
  ox: number;
  oy: number;
  oz: number;
  cell: number;
  solid: Uint8Array;
  /** distance (ft) from each free cell to the nearest solid cell */
  dist: Float32Array;
  /** which piece (index) owns each coarse cell, -1 = none */
  owner: Int16Array;
}

const idx = (g: Grid, x: number, y: number, z: number) => (x * g.ny + y) * g.nz + z;

function buildGrid(c: Composite): Grid {
  const f = 2;
  const cell = c.cell * f;
  const [gx, gy, gz] = c.grid;
  const cx = Math.ceil(gx / f);
  const cy = Math.ceil(gy / f);
  const cz = Math.ceil(gz / f);
  const nx = cx + 2 * PAD;
  const ny = cy + 2 * PAD;
  const nz = cz + PAD + 1; // one solid layer below (the ground), free air above
  const g: Grid = {
    nx,
    ny,
    nz,
    ox: c.origin[0] - PAD * cell,
    oy: c.origin[1] - PAD * cell,
    oz: c.origin[2] - cell,
    cell,
    solid: new Uint8Array(nx * ny * nz),
    dist: new Float32Array(nx * ny * nz),
    owner: new Int16Array(nx * ny * nz).fill(-1),
  };
  // the ground
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) g.solid[idx(g, x, y, 0)] = 1;
  // foam (anything in a piece that is not void) and ownership
  for (let x = 0; x < gx; x++)
    for (let y = 0; y < gy; y++)
      for (let z = 0; z < gz; z++) {
        const i = (x * gy + y) * gz + z;
        if (!c.mask[i]) continue;
        const k = (((x >> 1) + PAD) * ny + (y >> 1) + PAD) * nz + (z >> 1) + 1;
        if (!c.void[i]) g.solid[k] = 1;
        if (g.owner[k] < 0) g.owner[k] = c.owner[i];
      }
  distanceField(g);
  return g;
}

/** Euclidean-ish distance (chamfer 3-4-5 style weights) from every cell to the nearest solid cell, in feet. */
function distanceField(g: Grid) {
  const { nx, ny, nz, solid, dist, cell } = g;
  const INF = 1e9;
  for (let i = 0; i < dist.length; i++) dist[i] = solid[i] ? 0 : INF;
  const fwd: [number, number, number, number][] = [];
  const bwd: [number, number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const w = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const before = dx < 0 || (dx === 0 && (dy < 0 || (dy === 0 && dz < 0)));
        (before ? fwd : bwd).push([dx, dy, dz, w]);
      }
  const pass = (list: [number, number, number, number][], forward: boolean) => {
    const xs = forward ? [0, nx, 1] : [nx - 1, -1, -1];
    const ys = forward ? [0, ny, 1] : [ny - 1, -1, -1];
    const zs = forward ? [0, nz, 1] : [nz - 1, -1, -1];
    for (let x = xs[0]; x !== xs[1]; x += xs[2])
      for (let y = ys[0]; y !== ys[1]; y += ys[2])
        for (let z = zs[0]; z !== zs[1]; z += zs[2]) {
          const i = (x * ny + y) * nz + z;
          let best = dist[i];
          if (best === 0) continue;
          for (const [dx, dy, dz, w] of list) {
            const X = x + dx;
            const Y = y + dy;
            const Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
            const d = dist[(X * ny + Y) * nz + Z] + w;
            if (d < best) best = d;
          }
          dist[i] = best;
        }
  };
  pass(fwd, true);
  pass(bwd, false);
  for (let i = 0; i < dist.length; i++) dist[i] = Math.min(dist[i], 40) * cell;
}

const cellOf = (g: Grid, p: Vec3): [number, number, number] => [Math.floor((p[0] - g.ox) / g.cell), Math.floor((p[1] - g.oy) / g.cell), Math.floor((p[2] - g.oz) / g.cell)];
const inside = (g: Grid, x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz;
const centerOf = (g: Grid, x: number, y: number, z: number): Vec3 => [g.ox + (x + 0.5) * g.cell, g.oy + (y + 0.5) * g.cell, g.oz + (z + 0.5) * g.cell];

/** Clearance (ft) at a point; points outside the padded box count as free air, below the ground as solid. */
function clearanceAt(g: Grid, p: Vec3): number {
  const [x, y, z] = cellOf(g, p);
  if (z < 0) return 0;
  if (!inside(g, x, y, z)) return 40;
  return g.dist[idx(g, x, y, z)];
}

// ---- A* ------------------------------------------------------------------------------------------------------------------

class Heap {
  keys: number[] = [];
  vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const ks = this.keys;
    const vs = this.vals;
    let i = ks.length;
    ks.push(k);
    vs.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= k) break;
      ks[i] = ks[p];
      vs[i] = vs[p];
      i = p;
    }
    ks[i] = k;
    vs[i] = v;
  }
  pop(): number {
    const ks = this.keys;
    const vs = this.vals;
    const top = vs[0];
    const k = ks.pop()!;
    const v = vs.pop()!;
    const n = ks.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && ks[c + 1] < ks[c]) c++;
        if (ks[c] >= k) break;
        ks[i] = ks[c];
        vs[i] = vs[c];
        i = c;
      }
      ks[i] = k;
      vs[i] = v;
    }
    return top;
  }
}

const STEPS: [number, number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue; // faces and edge diagonals
      STEPS.push([dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz)]);
    }

/** The cheapest chain of cells at least `r` ft from any foam, favouring the middle of a space. Null when there is no way. */
function search(g: Grid, from: [number, number, number], to: [number, number, number], r: number, used: Float32Array, outside: number): [number, number, number][] | null {
  const free = (x: number, y: number, z: number) => inside(g, x, y, z) && g.dist[idx(g, x, y, z)] >= r;
  if (!free(...from) || !free(...to)) return null;
  const n = g.nx * g.ny * g.nz;
  const cost = new Float64Array(n).fill(Infinity);
  const closed = new Uint8Array(n);
  const prev = new Int32Array(n).fill(-1);
  const open = new Heap();
  const s = idx(g, ...from);
  const t = idx(g, ...to);
  cost[s] = 0;
  open.push(0, s);
  const h = (x: number, y: number, z: number) => Math.hypot(x - to[0], y - to[1], z - to[2]);
  while (open.size) {
    const i = open.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === t) break;
    const z = i % g.nz;
    const y = ((i - z) / g.nz) % g.ny;
    const x = ((i - z) / g.nz - y) / g.ny;
    const ci = cost[i];
    for (const [dx, dy, dz, w] of STEPS) {
      const X = x + dx;
      const Y = y + dy;
      const Z = z + dz;
      if (!free(X, Y, Z)) continue;
      // a diagonal must not cut a corner: both cells it squeezes between have to be free too
      if (dx && dy && (!free(x + dx, y, z) || !free(x, y + dy, z))) continue;
      if (dx && dz && (!free(x + dx, y, z) || !free(x, y, z + dz))) continue;
      if (dy && dz && (!free(x, y + dy, z) || !free(x, y, z + dz))) continue;
      const j = idx(g, X, Y, Z);
      const room = g.dist[j];
      // narrow places cost more, vertical moves a little more (a drone prefers to glide)
      // narrow places cost more; open air outside the building costs a lot (stay between the voids); ground already flown costs (do not retrace)
      const step = w * (1 + 3 * Math.max(0, (5 - room) / 5)) * (dz ? 1.15 : 1) * (g.owner[j] < 0 ? outside : 1) * (1 + 1.2 * Math.min(3, used[j]));
      const nc = ci + step;
      if (!closed[j] && nc < cost[j] - 1e-9) {
        cost[j] = nc;
        prev[j] = i;
        open.push(nc + h(X, Y, Z), j);
      }
    }
  }
  if (!Number.isFinite(cost[t])) return null;
  const out: [number, number, number][] = [];
  for (let i = t; i !== -1; i = prev[i]) {
    const z = i % g.nz;
    const y = ((i - z) / g.nz) % g.ny;
    const x = ((i - z) / g.nz - y) / g.ny;
    out.push([x, y, z]);
  }
  return out.reverse();
}

/** The free cell nearest to a point (within a few feet), at least `r` from foam. */
function nearestFree(g: Grid, p: Vec3, r: number): [number, number, number] | null {
  const [cx, cy, cz] = cellOf(g, p);
  let best: [number, number, number] | null = null;
  let bd = Infinity;
  for (let R = 0; R <= 8 && !best; R++)
    for (let x = cx - R; x <= cx + R; x++)
      for (let y = cy - R; y <= cy + R; y++)
        for (let z = cz - R; z <= cz + R; z++) {
          if (!inside(g, x, y, z) || g.dist[idx(g, x, y, z)] < r) continue;
          const d = Math.hypot(x - cx, y - cy, z - cz);
          if (d < bd) {
            bd = d;
            best = [x, y, z];
          }
        }
  return best;
}

// ---- the tour ------------------------------------------------------------------------------------------------------------

const len3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function resample(pts: Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = len3(a, b);
    let d = step - carry;
    while (d <= L) {
      const u = d / L;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      d += step;
    }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1];
  if (len3(out[out.length - 1], last) > 1e-6) out.push(last);
  return out;
}

/** Rounds the corners of a path without leaving the free space: each point moves toward its neighbours' average only while the move stays clear. */
function relax(g: Grid, pts: Vec3[], r: number, strict = 0.92): Vec3[] {
  let cur = pts.map((p) => [...p] as Vec3);
  const ok = (p: Vec3) => clearanceAt(g, p) >= r * strict;
  const segOk = (a: Vec3, b: Vec3) => {
    const n = Math.max(1, Math.ceil(len3(a, b) / (g.cell * 0.5)));
    for (let k = 1; k < n; k++) {
      const u = k / n;
      if (!ok([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u])) return false;
    }
    return true;
  };
  for (let pass = 0; pass < 40; pass++) {
    const next = cur.map((p) => [...p] as Vec3);
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      const c = cur[i + 1];
      const cand: Vec3 = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4];
      if (ok(cand) && segOk(next[i - 1], cand) && segOk(cand, c)) next[i] = cand;
    }
    cur = next;
  }
  return cur;
}

export interface Glance {
  /** where the flight passes (the junction the spur left from) */
  at: Vec3;
  /** the end of the spur that was cut: what the camera turns to look at while passing */
  target: Vec3;
}

/** The angle between the way in and the way out at `m`, looking W samples either side. */
const TURN_W = 3;
const sharpTurn = (path: Vec3[], m: number) => {
  const a = [path[m][0] - path[m - TURN_W][0], path[m][1] - path[m - TURN_W][1], path[m][2] - path[m - TURN_W][2]];
  const b = [path[m + TURN_W][0] - path[m][0], path[m + TURN_W][1] - path[m][1], path[m + TURN_W][2] - path[m][2]];
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (la < 1 || lb < 1) return false;
  return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb) < -0.5; // turns back by more than 120 degrees
};

/**
 * Takes the out-and-back spurs out of a path. Where the flight goes into a space and comes back out the way it went in (the two arms
 * run within 5 ft of each other), the arms are cut so the line carries straight on past the entrance of that space; the camera is
 * told to slow and turn to look into it while passing, so it still shows the space from the junction.
 */
function dropSpurs(g: Grid, r: number, pts: Vec3[]): { path: Vec3[]; glances: Glance[] } {
  const path = pts.slice();
  const glances: Glance[] = [];
  let from = TURN_W;
  for (let guard = 0; guard < 300; guard++) {
    let m = -1;
    for (let i = from; i < path.length - TURN_W; i++)
      if (sharpTurn(path, i)) {
        m = i;
        break;
      }
    if (m < 0) break;
    let s = 0;
    while (m - s - 1 > 0 && m + s + 1 < path.length - 1 && len3(path[m - s - 1], path[m + s + 1]) < 5) s++;
    const k = m - s;
    const j = m + s;
    let clear = s >= 2;
    if (clear) {
      const n = Math.ceil(len3(path[k], path[j]) / 0.5);
      for (let q = 1; q < n && clear; q++) {
        const u = q / n;
        if (clearanceAt(g, [path[k][0] + (path[j][0] - path[k][0]) * u, path[k][1] + (path[j][1] - path[k][1]) * u, path[k][2] + (path[j][2] - path[k][2]) * u]) < r * 0.8) clear = false;
      }
    }
    if (!clear) {
      from = m + 1;
      continue;
    }
    glances.push({ at: path[k], target: path[m] });
    path.splice(k + 1, j - k - 1);
    from = Math.max(TURN_W, k - TURN_W);
  }
  return { path, glances };
}

/** How many sharp reversals (more than 120 degrees back on itself) a path still has. */
export function reversalsIn(path: Vec3[]): number {
  let n = 0;
  for (let i = TURN_W; i < path.length - TURN_W; i++) if (sharpTurn(path, i)) {
    n++;
    i += TURN_W * 2;
  }
  return n;
}

/** True when no point of the path, nor a ring 0.35 ft round it, is in foam, plate or strut (checked on the fine voxels). */
function pathClear(c: Composite, pts: Vec3[]): boolean {
  const [nx, ny, nz] = c.grid;
  const foam = (x: number, y: number, z: number) => {
    const i = Math.floor((x - c.origin[0]) / c.cell);
    const j = Math.floor((y - c.origin[1]) / c.cell);
    const k = Math.floor((z - c.origin[2]) / c.cell);
    if (k < 0) return true;
    if (i < 0 || j < 0 || i >= nx || j >= ny || k >= nz) return false;
    const idx = (i * ny + j) * nz + k;
    return c.mask[idx] === 1 && c.void[idx] === 0;
  };
  const m = 0.35;
  for (const [x, y, z] of pts) {
    if (foam(x, y, z) || foam(x + m, y, z) || foam(x - m, y, z) || foam(x, y + m, z) || foam(x, y - m, z) || foam(x, y, z + m) || foam(x, y, z - m)) return false;
  }
  return true;
}

/** How far a ray from `p` travels through free air before foam, feet (capped). */
function rayFree(g: Grid, p: Vec3, dir: Vec3, cap: number): number {
  let t = 0.5;
  while (t < cap) {
    const q: Vec3 = [p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t];
    if (clearanceAt(g, q) < 0.4) return t;
    t += 0.75;
  }
  return cap;
}

const unwrap = (a: number[]) => {
  for (let i = 1; i < a.length; i++) {
    while (a[i] - a[i - 1] > Math.PI) a[i] -= 2 * Math.PI;
    while (a[i] - a[i - 1] < -Math.PI) a[i] += 2 * Math.PI;
  }
};
const smoothSeries = (a: number[], w: number) => a.map((_, i) => {
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) {
    s += a[k];
    n++;
  }
  return s / n;
});

export interface DroneOptions {
  /** piece ids in the order to visit them (the sequence from the entrance first) */
  order: string[];
  /** the way in (feet), if known: the tour then starts outside and flies in through it */
  entrance: Vec3 | null;
  fov?: number;
  /**
   * A short tour: instead of every space, only the highlights. That many spaces are picked (at least the way in, then the roomiest
   * and tallest, spread along the route) and the camera goes straight between them.
   */
  highlights?: number;
  /** begin outside and fly in through the entrance (default true) */
  approach?: boolean;
  /** an edited tour: exactly these spaces, in this order (nothing added, nothing dropped) */
  only?: string[];
}

/** Plans the tour. Null when there is nothing to fly through. */
export function planDrone(comp: Composite, opts: DroneOptions): DronePlan | null {
  const g = buildGrid(comp);
  const fov = opts.fov ?? 70;

  // the roomiest spot in each piece (and a second one a storey higher or lower, for the vertical moves)
  const spots = new Map<string, { main: [number, number, number]; other: [number, number, number] | null; room: number }>();
  const best = new Map<number, { i: number; room: number }>();
  for (let i = 0; i < g.owner.length; i++) {
    const k = g.owner[i];
    if (k < 0 || g.solid[i]) continue;
    const room = g.dist[i];
    const b = best.get(k);
    if (!b || room > b.room) best.set(k, { i, room });
  }
  const xyz = (i: number): [number, number, number] => {
    const z = i % g.nz;
    const y = ((i - z) / g.nz) % g.ny;
    return [((i - z) / g.nz - y) / g.ny, y, z];
  };
  for (const [k, b] of best) {
    const main = xyz(b.i);
    let other: [number, number, number] | null = null;
    let orr = 0;
    for (let i = 0; i < g.owner.length; i++) {
      if (g.owner[i] !== k || g.solid[i]) continue;
      const z = i % g.nz;
      if (Math.abs(z - main[2]) * g.cell < 8) continue;
      if (g.dist[i] > orr) {
        orr = g.dist[i];
        other = xyz(i);
      }
    }
    if (orr < b.room * 0.5) other = null;
    spots.set(comp.pieceIds[k], { main, other, room: b.room });
  }
  if (!spots.size) return null;

  // the way in: outside, in front of the entrance
  let start: Vec3 | null = null;
  let door: Vec3 | null = null;
  if (opts.entrance && opts.approach !== false) {
    const e = opts.entrance;
    let bestDir: [number, number] | null = null;
    let bestSteps = Infinity;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      let s = 0;
      while (s < 40) {
        const x = Math.floor((e[0] + d[0] * s * 0.5 - comp.origin[0]) / comp.cell);
        const y = Math.floor((e[1] + d[1] * s * 0.5 - comp.origin[1]) / comp.cell);
        const z = Math.floor((e[2] - comp.origin[2]) / comp.cell);
        const [nx, ny, nz] = comp.grid;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz || !comp.mask[(x * ny + y) * nz + z]) break;
        s++;
      }
      if (s < bestSteps) {
        bestSteps = s;
        bestDir = d;
      }
    }
    if (bestDir) {
      start = [e[0] + bestDir[0] * (bestSteps * 0.5 + 16), e[1] + bestDir[1] * (bestSteps * 0.5 + 16), e[2] + 9];
      door = [e[0] - bestDir[0] * 3, e[1] - bestDir[1] * 3, e[2] + 1.5];
    }
  }

  // visiting order: what was asked first, then the rest by nearest neighbour
  const wanted = opts.order.filter((id) => spots.has(id));
  const rest = [...spots.keys()].filter((id) => !wanted.includes(id));
  const centre = (id: string) => centerOf(g, ...spots.get(id)!.main);
  const ordered = [...wanted];
  let at = ordered.length ? centre(ordered[ordered.length - 1]) : door ?? centre(rest[0]);
  while (rest.length) {
    rest.sort((a, b) => len3(centre(a), at) - len3(centre(b), at));
    const next = rest.shift()!;
    ordered.push(next);
    at = centre(next);
  }

  if (opts.only) {
    ordered.length = 0;
    ordered.push(...opts.only.filter((id) => spots.has(id)));
    if (!ordered.length) return null;
  }

  // a short tour keeps only the highlights: the way in, then the spaces with the most to show (room, height), in route order
  const upper = new Set<string>(ordered);
  if (!opts.only && opts.highlights && opts.highlights < ordered.length) {
    const headroom = (id: string) => {
      const [x, y, z0] = spots.get(id)!.main;
      let z = z0;
      while (z + 1 < g.nz && !g.solid[idx(g, x, y, z + 1)]) z++;
      return (z - z0) * g.cell;
    };
    const interest = new Map(ordered.map((id) => [id, spots.get(id)!.room + 0.45 * headroom(id)]));
    const keep = new Set<string>([ordered[0]]);
    const byInterest = [...ordered].sort((a, b) => interest.get(b)! - interest.get(a)!);
    for (const id of byInterest) {
      if (keep.size >= opts.highlights) break;
      // spread them out: skip a space that sits right on top of one already chosen
      if ([...keep].some((k) => len3(centre(k), centre(id)) < 8)) continue;
      keep.add(id);
    }
    for (const id of byInterest) if (keep.size < opts.highlights) keep.add(id);
    const chosen = ordered.filter((id) => keep.has(id));
    ordered.length = 0;
    ordered.push(...chosen);
    upper.clear();
    if (byInterest.length) upper.add(byInterest.find((id) => keep.has(id))!);
  }

  // each clearance gives a tour; keep the one that visits the most of the building while staying between the voids (a smaller clearance
  // can squeeze through the narrower doorways instead of flying round the outside)
  const candidates: { score: number; build: () => DronePlan }[] = [];
  for (const r of RADII) {
    const stops: { id: string | null; cell: [number, number, number] }[] = [];
    const first = start ? nearestFree(g, start, r) : null;
    if (start && !first) continue;
    if (first) stops.push({ id: null, cell: first });
    const doorCell = door ? nearestFree(g, door, r) : null;
    if (doorCell) stops.push({ id: null, cell: doorCell });
    const skipped: string[] = [];
    for (const id of ordered) {
      const sp = spots.get(id)!;
      const cells: [number, number, number][] = [sp.main];
      if (sp.other && upper.has(id)) cells.push(sp.other);
      for (const c of cells) if (g.dist[idx(g, ...c)] >= r) stops.push({ id, cell: c });
      if (g.dist[idx(g, ...sp.main)] < r) skipped.push(id);
    }
    if (stops.length < 2) continue;

    // join the stops; a stop that cannot be reached is left out
    const cells: [number, number, number][] = [];
    const visited: string[] = [];
    let cur = stops[0];
    cells.push(cur.cell);
    // how often each cell has been flown through: ground already covered is dear, so the tour looks for new ground instead of retracing
    const used = new Float32Array(g.nx * g.ny * g.nz);
    for (let k = 1; k < stops.length; k++) {
      const leg = search(g, cur.cell, stops[k].cell, r, used, OUTSIDE_COST);
      if (leg) {
        for (const [x, y, z] of leg)
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) if (inside(g, x + dx, y + dy, z + dz)) used[idx(g, x + dx, y + dy, z + dz)] += dx || dy || dz ? 0.25 : 0.7;
      }
      if (!leg) {
        if (stops[k].id && !skipped.includes(stops[k].id!)) skipped.push(stops[k].id!);
        continue;
      }
      for (const c of leg.slice(1)) cells.push(c);
      cur = stops[k];
      if (stops[k].id && !visited.includes(stops[k].id!)) visited.push(stops[k].id!);
    }
    if (cells.length < 6 || !visited.length) continue;
    const reachedAll = !ordered.some((id) => !visited.includes(id) && g.dist[idx(g, ...spots.get(id)!.main)] >= r);
    if (!reachedAll && r > RADII[RADII.length - 1]) {
      // try a smaller clearance so that more of the building is visited
      if (visited.length < ordered.length * 0.6) continue;
    }

    // the share of the flight outside the building once it has gone in
    let wentIn = false;
    let out = 0;
    let after = 0;
    for (const [x, y, z] of cells) {
      const own = g.owner[idx(g, x, y, z)] >= 0;
      if (own) wentIn = true;
      if (wentIn) {
        after++;
        if (!own) out++;
      }
    }
    const outShare = after ? out / after : 0;
    const frac = visited.length / Math.max(1, ordered.length);
    candidates.push({
      score: frac - 1.6 * outShare + 0.04 * r,
      build: () => {
        // the way out: from the last space to the nearest opening to the outside and on to the edge of the free air
        let exitCells: [number, number, number][] = [];
        let exitLen = Infinity;
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const last = cur.cell;
          const goal: [number, number, number] = [d[0] > 0 ? g.nx - 2 : d[0] < 0 ? 1 : last[0], d[1] > 0 ? g.ny - 2 : d[1] < 0 ? 1 : last[1], last[2]];
          const leg = search(g, last, goal, r, used, 2);
          if (!leg) continue;
          let L = 0;
          for (let q = 1; q < leg.length; q++) L += Math.hypot(leg[q][0] - leg[q - 1][0], leg[q][1] - leg[q - 1][1], leg[q][2] - leg[q - 1][2]);
          if (L < exitLen) {
            exitLen = L;
            exitCells = leg;
          }
        }
        const raw = [...cells, ...exitCells.slice(1)].map((c) => centerOf(g, ...c));
        const { path: dense, glances } = dropSpurs(g, r, resample(raw, 1));
        // the smoothed path has to clear the foam in the fine voxels too (the coarse cells can hide a corner); stricter smoothing, then the plain cell centres, are the fallbacks
        const tries = [resample(relax(g, dense, r), 0.5), resample(relax(g, dense, r, 1.5), 0.5), resample(dense, 0.5)];
        const smooth = tries.find((t) => pathClear(comp, t)) ?? tries[tries.length - 1];
        // and straight on out, into nothing: the film ends in empty black
        const tail = smooth.slice(-Math.min(smooth.length, 24));
        let ex = tail[tail.length - 1][0] - tail[0][0];
        let ey = tail[tail.length - 1][1] - tail[0][1];
        let ez = Math.max(0, tail[tail.length - 1][2] - tail[0][2]);
        const el = Math.hypot(ex, ey, ez) || 1;
        ex /= el;
        ey /= el;
        ez /= el;
        const end = smooth[smooth.length - 1];
        const extFrom = smooth.length;
        const full = smooth.slice();
        for (let q = 1; q <= 140; q++) full.push([end[0] + ex * q * 0.5, end[1] + ey * q * 0.5, end[2] + ez * q * 0.5]);
        return finish(g, full, r, visited, ordered.filter((id) => !visited.includes(id)), fov, !!start, glances, extFrom);
      },
    });
    if (frac >= 0.99 && outShare < 0.08) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].build() : null;
}

function finish(g: Grid, path: Vec3[], r: number, visited: string[], skipped: string[], fov: number, hasIntro: boolean, glances: Glance[] = [], extFrom = Infinity): DronePlan {
  const n = path.length;
  // arc length at each sample
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + len3(path[i - 1], path[i]));
  const total = arc[n - 1];

  // where the camera looks, as angles along the path
  const yaw: number[] = [];
  const pitch: number[] = [];
  const glance: number[] = []; // 0..1: how much the camera is turned to a cut spur here
  const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const AHEAD = 12; // samples (6 ft)
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[Math.min(n - 1, i + AHEAD)];
    const c = path[Math.max(0, i - AHEAD)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    if (Math.hypot(dx, dy) < 0.5) {
      dx = a[0] - c[0];
      dy = a[1] - c[1];
      dz = a[2] - c[2];
    }
    const heading = Math.atan2(dy, dx);
    const climb = Math.atan2(dz, Math.max(Math.hypot(dx, dy), 3));
    // sway: a slow look to the side, smaller in tight places
    const room = clearanceAt(g, a);
    const sway = (Math.sin((arc[i] / 28) * Math.PI) * 26 * Math.min(1, Math.max(0, (room - 1.5) / 3)) * Math.PI) / 180;
    // lean toward the deepest open direction ahead
    let openYaw = 0;
    let openBest = -1;
    for (const off of [-50, -35, -20, -10, 0, 10, 20, 35, 50]) {
      const yy = heading + (off * Math.PI) / 180;
      const d = rayFree(g, a, [Math.cos(yy), Math.sin(yy), 0], 40) * Math.cos((off * Math.PI) / 180);
      if (d > openBest) {
        openBest = d;
        openYaw = off;
      }
    }
    // a space whose spur was cut: slow down and turn to look into it while passing (a smooth bump over about 14 ft either side)
    let gw = 0, gYaw = 0, gPitch = 0;
    for (const gl of glances) {
      const d = len3(a, gl.at);
      if (d >= 14) continue;
      const w = (1 - d / 14) ** 2;
      if (w > gw) {
        gw = w;
        gYaw = Math.atan2(gl.target[1] - a[1], gl.target[0] - a[0]);
        gPitch = Math.atan2(gl.target[2] - a[2], Math.max(Math.hypot(gl.target[0] - a[0], gl.target[1] - a[1]), 3));
      }
    }
    glance.push(gw);
    const baseYaw = heading + sway * (1 - gw) + 0.35 * ((openYaw * Math.PI) / 180) * (1 - gw);
    yaw.push(baseYaw + gw * 0.92 * wrapPi(gYaw - baseYaw));
    // tilt: follow the climb, look up into tall voids, look down at the start
    const up = rayFree(g, a, [0, 0, 1], 30);
    const tall = Math.min(1, Math.max(0, (up - 12) / 14));
    const intro = hasIntro ? Math.max(0, 1 - arc[i] / 26) : 0;
    const basePitch = climb * 0.9 + (tall * 15 * Math.PI) / 180 - (intro * 16 * Math.PI) / 180 - (3 * Math.PI) / 180;
    pitch.push(basePitch + gw * 0.8 * (gPitch - basePitch));
  }
  unwrap(yaw);
  const yawS = smoothSeries(smoothSeries(yaw, 16), 10);
  const pitchS = smoothSeries(smoothSeries(pitch, 16), 10);
  const bank = yawS.map((_, i) => {
    const a = yawS[Math.max(0, i - 6)];
    const b = yawS[Math.min(n - 1, i + 6)];
    return Math.max(-7, Math.min(7, ((b - a) * 180 / Math.PI) * 0.6));
  });

  // time: slow where the camera has something to show (tight turns, climbs, tall voids), quicker in a plain run
  const slow = path.map((_, i) => {
    const turn = Math.abs(yawS[Math.min(n - 1, i + 8)] - yawS[Math.max(0, i - 8)]);
    const vert = Math.abs(pitchS[i]);
    const tall = rayFree(g, path[i], [0, 0, 1], 30) > 18 ? 0.25 : 0;
    return Math.min(0.9, turn * 0.5 + vert * 0.6 + tall + 0.5 * glance[i]);
  });
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + (arc[i] - arc[i - 1]) * (i >= extFrom ? 0.55 : 1 + slow[i]));
  const T = cum[n - 1];

  const pose = (t: number, seconds = 30): DronePose => {
    // the opening turn: parked outside facing away from the building (nothing but black), it swings round to the entrance, then the tour starts
    const spin = hasIntro ? Math.min(0.2, 2.8 / Math.max(4, seconds)) : 0;
    if (spin > 0 && t < spin) {
      const k = Math.max(0, t / spin);
      const e = k * k * (3 - 2 * k);
      const from = yawS[0] + Math.PI;
      const yy = from + (yawS[0] - from) * e;
      const pp = pitchS[0] * e;
      const pos0 = path[0];
      const dir0: Vec3 = [Math.cos(pp) * Math.cos(yy), Math.cos(pp) * Math.sin(yy), Math.sin(pp)];
      return { pos: pos0, target: [pos0[0] + dir0[0] * 10, pos0[1] + dir0[1] * 10, pos0[2] + dir0[2] * 10], fov, roll: 0 };
    }
    t = spin > 0 ? (t - spin) / (1 - spin) : t;
    const u = Math.max(0, Math.min(1, t));
    // a gentle ease at both ends, near-constant between
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
    const target = e * T;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo] || 1;
    const f = Math.max(0, Math.min(1, (target - cum[lo]) / span));
    const lerp = (a: number, b: number) => a + (b - a) * f;
    const pos: Vec3 = [lerp(path[lo][0], path[hi][0]), lerp(path[lo][1], path[hi][1]), lerp(path[lo][2], path[hi][2])];
    const yy = lerp(yawS[lo], yawS[hi]);
    const pp = lerp(pitchS[lo], pitchS[hi]);
    const dir: Vec3 = [Math.cos(pp) * Math.cos(yy), Math.cos(pp) * Math.sin(yy), Math.sin(pp)];
    return { pos, target: [pos[0] + dir[0] * 10, pos[1] + dir[1] * 10, pos[2] + dir[2] * 10], fov, roll: lerp(bank[lo], bank[hi]) };
  };

  return { path, lengthFt: total, clearanceFt: r, visited, skipped, pose };
}
