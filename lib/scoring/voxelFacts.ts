// What the matrix measurements read straight from a tile's voxels, with the container respected everywhere: cells OUTSIDE the container
// (mask = 0, the notch of an L, the empty side of a step) are open air, never foam and never void, and they are never part of a
// denominator. For an assembly (an arrangement added as a tile) the same reading is made on the combined voxels, so a roof opening that
// another tile now covers is no longer an opening to the sky.
//
//   classes   OUT (outside the container), SOLID (foam, plates, branches), VOID (carved space)
//   surfaces  the faces of the void, by what is on the other side: foam, a floor plate, a branch, or air (an opening)
//   route     a FLOOR-SUPPORTED way from a ground-level opening to a destination: a path of cells a person can stand in (the program's one walking
//             model, lib/walking.ts: material under, 6.5 ft of headroom and a 2.5 ft clear width by default) joined by steps no bigger than one
//             riser, the way a person would go; never a line through open air, and never a jump

import { edtSquared } from "@/lib/tiles/grid";
import type { ParsedTile } from "@/lib/types";
import { floodZones, kernelFor, NEIGHBOURS, OUT, SOLID, standingCells, VOID, type Kernel } from "@/lib/walking";

export { OUT, SOLID, VOID };

export interface VoxelFacts {
  nx: number;
  ny: number;
  nz: number;
  cell: number;
  /** OUT / SOLID / VOID per cell, layout of the tile's voxels */
  cls: Uint8Array;
  plates: Uint8Array | null;
  struts: Uint8Array | null;
  rooms: Uint8Array | null;
  /** cells inside the container */
  inside: number;
  voidCells: number;
  /** volume of the container's own material and space, ft3 (an L is not its bounding box) */
  containerFt3: number;
  /** plan area of the container (columns with any cell inside), ft2 */
  footprintFt2: number;
  /** the container is not the whole box */
  shaped: boolean;
}

const cache = new WeakMap<ParsedTile, VoxelFacts | null>();

export function voxelFacts(tile: ParsedTile): VoxelFacts | null {
  if (cache.has(tile)) return cache.get(tile)!;
  const out = build(tile);
  cache.set(tile, out);
  return out;
}

function build(tile: ParsedTile): VoxelFacts | null {
  const vd = tile.voxels.void;
  if (!vd) return null;
  const [nx, ny, nz] = tile.grid;
  const n = nx * ny * nz;
  if (vd.length !== n) return null;
  const mask = tile.voxels.mask;
  const cls = new Uint8Array(n);
  let inside = 0;
  let voidCells = 0;
  const col = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (mask && !mask[i]) continue;
        inside++;
        col[x * ny + y] = 1;
        if (vd[i]) {
          cls[i] = VOID;
          voidCells++;
        } else cls[i] = SOLID;
      }
  const c = tile.cellFt;
  let footprint = 0;
  for (let i = 0; i < col.length; i++) footprint += col[i];
  return {
    nx,
    ny,
    nz,
    cell: c,
    cls,
    plates: tile.voxels.plates ?? null,
    struts: tile.voxels.struts ?? null,
    rooms: tile.voxels.rooms ?? null,
    inside,
    voidCells,
    containerFt3: inside * c * c * c,
    footprintFt2: footprint * c * c,
    shaped: inside < n,
  };
}

export const idx = (f: VoxelFacts, x: number, y: number, z: number) => (x * f.ny + y) * f.nz + z;
/** The class at a cell; outside the grid is open air. */
export const classAt = (f: VoxelFacts, x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= f.nx || y >= f.ny || z >= f.nz ? OUT : f.cls[(x * f.ny + y) * f.nz + z]);

// ---- the faces of the void ------------------------------------------------------------------------------------------------------

export interface SurfaceStats {
  /** vertical faces (a wall, seen from inside) by what is behind them, in cells of area */
  wallFoam: number;
  wallPlate: number;
  wallStrut: number;
  /** wall faces that are open to the air (a window, a doorway, an opening through the container) */
  wallOpen: number;
  /** floor faces (the void's bottom) by what is under them */
  floorFoam: number;
  floorPlate: number;
  floorStrut: number;
  floorOpen: number;
  /** ceiling faces by what is over them; ceilingOpen = open to the sky */
  ceilFoam: number;
  ceilPlate: number;
  ceilStrut: number;
  ceilOpen: number;
  /** void-to-void (no surface) */
  inner: number;
}

export function surfaceStats(f: VoxelFacts): SurfaceStats {
  const s: SurfaceStats = { wallFoam: 0, wallPlate: 0, wallStrut: 0, wallOpen: 0, floorFoam: 0, floorPlate: 0, floorStrut: 0, floorOpen: 0, ceilFoam: 0, ceilPlate: 0, ceilStrut: 0, ceilOpen: 0, inner: 0 };
  const { nx, ny, nz } = f;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (f.cls[i] !== VOID) continue;
        for (let d = 0; d < 6; d++) {
          const X = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
          const Y = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
          const Z = z + (d === 4 ? -1 : d === 5 ? 1 : 0);
          const k = classAt(f, X, Y, Z);
          if (k === VOID) {
            s.inner++;
            continue;
          }
          const j = k === SOLID ? (X * ny + Y) * nz + Z : -1;
          const kind: "foam" | "plate" | "strut" | "open" = k === OUT ? "open" : f.plates && f.plates[j] ? "plate" : f.struts && f.struts[j] ? "strut" : "foam";
          const part = d < 4 ? "wall" : d === 4 ? "floor" : "ceil";
          const name = (part + kind[0].toUpperCase() + kind.slice(1)) as keyof SurfaceStats;
          s[name]++;
        }
      }
  return s;
}

// ---- openings to the sky ---------------------------------------------------------------------------------------------------------

export interface Skylights {
  /** cells (columns) of void with open air straight above them: a roof opening */
  openCells: number;
  /** per room id: roof-opening cells, and the floor cells of that room */
  perRoom: Map<number, { open: number; floor: number }>;
  /** where they are (cell indices), for the evidence */
  at: Int32Array;
}

export function skylights(f: VoxelFacts): Skylights {
  const perRoom = new Map<number, { open: number; floor: number }>();
  const at: number[] = [];
  const { nx, ny, nz } = f;
  let open = 0;
  const room = (i: number) => (f.rooms ? f.rooms[i] : 0);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (f.cls[i] !== VOID) continue;
        const r = room(i);
        let e = perRoom.get(r);
        if (!e) perRoom.set(r, (e = { open: 0, floor: 0 }));
        // a floor cell: material directly under it (the bottom of the container is not a floor)
        if (z > 0 && f.cls[i - 1] === SOLID) e.floor++;
        if (classAt(f, x, y, z + 1) === OUT) {
          e.open++;
          open++;
          at.push(i);
        }
      }
  return { openCells: open, perRoom, at: Int32Array.from(at) };
}

// ---- a floor-supported route -------------------------------------------------------------------------------------------------------

export interface RouteWalk {
  /** cells (indices) from the entry to the destination, and the same in feet (tile coordinates, cell centres) */
  cells: number[];
  points: [number, number, number][];
  lengthFt: number;
  entry: [number, number, number];
  dest: [number, number, number];
  /** how the destination was chosen */
  how: string;
}

export interface RouteResult {
  route: RouteWalk | null;
  /** why there is none */
  reason: string;
  /** the floor-supported cells that can be reached from the entry (cells) and all floor-supported cells: how much of the floor can be walked to */
  reachable: Uint8Array | null;
  supported: Uint8Array | null;
  entries: number[];
}

export interface RouteOptions {
  /** override: entry and destination as tile coordinates (ft); the nearest supported cell is used */
  from?: [number, number, number];
  to?: [number, number, number];
  /** cells to keep clear of an earlier route when looking for another (ft) */
  blockFt?: number;
  /** where the route goes when no destination is set: the middle of the largest other room reached on foot ("room", for counting routes to a place) or the farthest point reached on foot ("farthest", the longest sequence, for reading a passage or an enclosure along it) */
  destination?: "room" | "farthest";
}

export const DEFAULT_ROUTE: RouteOptions = {};

/** A route you chose: where it starts and where it goes (tile coordinates, ft). Either may be left to the automatic choice. */
export interface RouteOverride0 {
  from?: [number, number, number];
  to?: [number, number, number];
}

const standCache = new WeakMap<VoxelFacts, { key: string; cells: Uint8Array }>();

/**
 * Standing cells: void with material under it, the full headroom above it and a clear disc round it (the shared walking rules), in a floor that is a
 * space and not a pocket (the zone it belongs to is at least the smallest space). Cached per tile and rule set.
 */
export function supportedCells(f: VoxelFacts, k: Kernel = kernelFor(f.cell)): Uint8Array {
  const hit = standCache.get(f);
  if (hit && hit.key === k.key) return hit.cells;
  const dims: [number, number, number] = [f.nx, f.ny, f.nz];
  const stand = standingCells(dims, f.cls, k);
  const { zone, cells } = floodZones(dims, stand, k);
  for (let i = 0; i < stand.length; i++) if (stand[i] && cells[zone[i]] < k.minZoneCells) stand[i] = 0;
  standCache.set(f, { key: k.key, cells: stand });
  return stand;
}

const NB = NEIGHBOURS as [number, number][];

/** The cells next to an opening in a side wall (air beyond a void cell) at the lowest floor level reached by any opening, where a person would come in. */
export function groundEntries(f: VoxelFacts, supported: Uint8Array, single = false): number[] {
  const reach = Math.max(1, Math.round(3 / f.cell));
  const found = new Map<number, number>(); // supported cell index -> its z
  const faceOf = new Map<number, number>(); // ... and the side of the container whose opening it is next to
  const { nx, ny, nz } = f;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (f.cls[i] !== VOID) continue;
        let open = -1;
        NB.forEach(([dx, dy], k) => {
          if (open < 0 && classAt(f, x + dx, y + dy, z) === OUT) open = k;
        });
        if (open < 0) continue;
        // a supported cell within reach of this opening, at about its floor level
        for (let dx = -reach; dx <= reach; dx++)
          for (let dy = -reach; dy <= reach; dy++)
            for (let dz = -2; dz <= 0; dz++) {
              const X = x + dx;
              const Y = y + dy;
              const Z = z + dz;
              if (X < 0 || Y < 0 || Z < 1 || X >= nx || Y >= ny || Z >= nz) continue;
              const j = (X * ny + Y) * nz + Z;
              if (supported[j]) {
                found.set(j, Z);
                if (!faceOf.has(j)) faceOf.set(j, open);
              }
            }
      }
  if (!found.size) return [];
  const lowest = Math.min(...found.values());
  const tol = Math.round(3 / f.cell);
  let entries = [...found.entries()].filter(([, z]) => z <= lowest + tol).map(([j]) => j);
  if (single) {
    // one way in: the side of the container with the most ground-level opening (a route is read from one door, not from all of them at once)
    const perFace = new Map<number, number>();
    for (const j of entries) perFace.set(faceOf.get(j)!, (perFace.get(faceOf.get(j)!) ?? 0) + 1);
    const best = [...perFace.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    entries = entries.filter((j) => faceOf.get(j) === best);
  }
  return entries;
}

/** The cheapest floor-supported way between sources and a target, favouring the middle of a passage; null when there is none. */
function dijkstra(f: VoxelFacts, supported: Uint8Array, sources: number[], clear: Float64Array, step: number, blocked: Uint8Array | null, target: number | null): { dist: Float64Array; prev: Int32Array } {
  const n = f.cls.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  // a binary heap of [cost, index]
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (k: number, v: number) => {
    let i = hk.length;
    hk.push(k);
    hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = k;
    hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0];
    const k = hk.pop()!;
    const v = hv.pop()!;
    const m = hk.length;
    if (m > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= m) break;
        if (c + 1 < m && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = k;
      hv[i] = v;
    }
    return top;
  };
  for (const s of sources) {
    dist[s] = 0;
    push(0, s);
  }
  const { ny, nz } = f;
  while (hk.length) {
    const i = pop();
    if (target !== null && i === target) break;
    const z = i % nz;
    const y = ((i - z) / nz) % ny;
    const x = ((i - z) / nz - y) / ny;
    const di = dist[i];
    for (const [dx, dy] of NB) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= f.nx || Y >= ny) continue;
      for (let dz = -step; dz <= step; dz++) {
        const Z = z + dz;
        if (Z < 1 || Z >= nz) continue;
        const j = (X * ny + Y) * nz + Z;
        if (!supported[j] || (blocked && blocked[j])) continue;
        const nd = di + (1 + 3 / (1 + clear[j])) * (dz ? 1.2 : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          push(nd, j);
        }
      }
    }
  }
  return { dist, prev };
}

const centre = (f: VoxelFacts, i: number): [number, number, number] => {
  const z = i % f.nz;
  const y = ((i - z) / f.nz) % f.ny;
  const x = ((i - z) / f.nz - y) / f.ny;
  return [(x + 0.5) * f.cell, (y + 0.5) * f.cell, (z + 0.5) * f.cell];
};
const cellOfFt = (f: VoxelFacts, p: [number, number, number]) => [Math.floor(p[0] / f.cell), Math.floor(p[1] / f.cell), Math.floor(p[2] / f.cell)] as const;

const clearCache = new WeakMap<VoxelFacts, Float64Array>();
/** Distance (in cells) from each cell to the nearest material, for centring a route in a passage. */
function clearance(f: VoxelFacts): Float64Array {
  let c = clearCache.get(f);
  if (c) return c;
  const free = new Uint8Array(f.cls.length);
  for (let i = 0; i < free.length; i++) free[i] = f.cls[i] === SOLID ? 0 : 1;
  const d2 = edtSquared(free, [f.nx, f.ny, f.nz]);
  c = new Float64Array(d2.length);
  for (let i = 0; i < d2.length; i++) c[i] = Math.sqrt(d2[i]);
  clearCache.set(f, c);
  return c;
}

/** The route a person would take in: from a ground-level opening to the largest other room reachable on foot (or what was asked for). */
export function findRoute(f: VoxelFacts, opt: RouteOptions = DEFAULT_ROUTE, blocked: Uint8Array | null = null): RouteResult {
  const kernel = kernelFor(f.cell);
  const supported = supportedCells(f, kernel);
  let any = false;
  for (let i = 0; i < supported.length && !any; i++) if (supported[i]) any = true;
  if (!any) return { route: null, reason: "No floor that a person can stand on was found in the tile: nothing has material under it with the headroom and clear width the walking rules need.", reachable: null, supported, entries: [] };
  const step = kernel.step;
  const clear = clearance(f);
  let entries = groundEntries(f, supported, true);
  const nearest = (p: [number, number, number]): number => {
    const [cx, cy, cz] = cellOfFt(f, p);
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < supported.length; i++) {
      if (!supported[i]) continue;
      const z = i % f.nz;
      const y = ((i - z) / f.nz) % f.ny;
      const x = ((i - z) / f.nz - y) / f.ny;
      const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  if (opt.from) {
    const s = nearest(opt.from);
    if (s >= 0) entries = [s];
  }
  if (!entries.length) return { route: null, reason: "No opening at ground level has a floor to stand on, so there is no entry to start a route from.", reachable: null, supported, entries };
  const walk = dijkstra(f, supported, entries, clear, step, blocked, null);
  const reachable = new Uint8Array(supported.length);
  for (let i = 0; i < reachable.length; i++) if (Number.isFinite(walk.dist[i])) reachable[i] = 1;

  // the destination: asked for, or the middle of the largest room (by volume) reached on foot that is not the entrance's own room, else the farthest cell
  let dest = -1;
  let how = "";
  if (opt.to) {
    dest = nearest(opt.to);
    how = "the destination you set";
    if (dest >= 0 && !reachable[dest]) return { route: null, reason: "The destination you set cannot be reached on foot from the entry.", reachable, supported, entries };
  } else {
    const entryRooms = new Set<number>(entries.map((e) => (f.rooms ? f.rooms[e] : 0)));
    const volumes = new Map<number, number>();
    if (f.rooms) for (let i = 0; i < f.rooms.length; i++) if (f.rooms[i] && f.cls[i] === VOID) volumes.set(f.rooms[i], (volumes.get(f.rooms[i]) ?? 0) + 1);
    const candidates = opt.destination === "farthest" ? [] : [...volumes.entries()].filter(([r]) => !entryRooms.has(r)).sort((a, b) => b[1] - a[1]);
    for (const [r] of candidates) {
      // the reached supported cell of this room that is most central (farthest from the walls)
      let best = -1;
      let bc = -1;
      for (let i = 0; i < reachable.length; i++) if (reachable[i] && f.rooms && f.rooms[i] === r && clear[i] > bc) {
        bc = clear[i];
        best = i;
      }
      if (best >= 0) {
        dest = best;
        how = "the middle of the largest room reached on foot that is not the entrance's";
        break;
      }
    }
    if (dest < 0) {
      let far = -1;
      let fd = -1;
      for (let i = 0; i < walk.dist.length; i++) if (Number.isFinite(walk.dist[i]) && walk.dist[i] > fd) {
        fd = walk.dist[i];
        far = i;
      }
      dest = far;
      how = opt.destination === "farthest" ? "the farthest point reached on foot" : "the farthest point reached on foot (the tile has no second room to go to)";
    }
  }
  if (dest < 0 || !Number.isFinite(walk.dist[dest]) || walk.dist[dest] === 0) return { route: null, reason: "There is nowhere to walk to from the entry: no reachable destination other than the doorway itself.", reachable, supported, entries };

  // rebuild the path
  const cells: number[] = [];
  for (let i = dest; i !== -1; i = walk.prev[i]) cells.push(i);
  cells.reverse();
  const points = cells.map((c) => centre(f, c));
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  return { route: { cells, points, lengthFt: len, entry: points[0], dest: points[points.length - 1], how }, reason: "", reachable, supported, entries };
}

/**
 * Distinct routes from the entry to the destination: each is found with the earlier ones closed off by a corridor `blockFt` wide
 * (except near the two ends), so two routes never share a passage and a tiny variation through neighbouring cells is not a new route.
 */
export function distinctRoutes(f: VoxelFacts, opt: RouteOptions, limit = 6): { routes: RouteWalk[]; first: RouteResult } {
  const first = findRoute(f, opt);
  if (!first.route) return { routes: [], first };
  const routes = [first.route];
  const block = Math.max(1, Math.round((opt.blockFt ?? 1.5) / f.cell));
  const blocked = new Uint8Array(f.cls.length);
  const fixed: RouteOptions = { ...opt, from: first.route.entry, to: first.route.dest };
  for (let k = 1; k < limit; k++) {
    const last = routes[routes.length - 1];
    const cells = last.cells;
    // the two ends are left open (every route starts and finishes at the same places); a short route is closed off almost to its ends
    const endZone = Math.min(Math.round(6 / f.cell), Math.max(1, Math.floor(cells.length / 4)));
    for (let c = endZone; c < cells.length - endZone; c++) {
      const z = cells[c] % f.nz;
      const y = ((cells[c] - z) / f.nz) % f.ny;
      const x = ((cells[c] - z) / f.nz - y) / f.ny;
      for (let dx = -block; dx <= block; dx++)
        for (let dy = -block; dy <= block; dy++)
          for (let dz = -block; dz <= block; dz++) {
            const X = x + dx;
            const Y = y + dy;
            const Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= f.nx || Y >= f.ny || Z >= f.nz) continue;
            blocked[(X * f.ny + Y) * f.nz + Z] = 1;
          }
    }
    const next = findRoute(f, fixed, blocked);
    if (!next.route) break;
    // a route that mostly runs along an earlier one is the same route
    const seen = new Set(routes.flatMap((r) => r.cells));
    const shared = next.route.cells.filter((c) => seen.has(c)).length / next.route.cells.length;
    if (shared > 0.7) break;
    routes.push(next.route);
  }
  return { routes, first };
}

/** Clear width of the passage at each point of a route: open space to either side of the direction of travel, at standing height. */
export function passageWidths(f: VoxelFacts, route: RouteWalk, heightFt = 4): { widths: number[]; along: number[] } {
  const pts = route.points;
  const widths: number[] = [];
  const along: number[] = [];
  const back = Math.max(2, Math.round(2 / f.cell));
  const cap = Math.round(40 / f.cell);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    along.push(s);
    const a = pts[Math.max(0, i - back)];
    const b = pts[Math.min(pts.length - 1, i + back)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty);
    if (tl < f.cell) {
      // the route climbs on the spot (a stair turning): no horizontal direction, carry the last width
      widths.push(widths.length ? widths[widths.length - 1] : NaN);
      continue;
    }
    tx /= tl;
    ty /= tl;
    const nxv = -ty;
    const nyv = tx;
    const z = Math.min(f.nz - 1, Math.floor(pts[i][2] / f.cell) + Math.round(heightFt / f.cell) - 1);
    const march = (sign: number) => {
      let d = 0;
      for (; d < cap; d += 0.5) {
        const X = Math.floor((pts[i][0] + sign * nxv * d * f.cell) / f.cell);
        const Y = Math.floor((pts[i][1] + sign * nyv * d * f.cell) / f.cell);
        // the container's edge ends a passage as a wall does: open air beyond it is not part of the width
        const k = classAt(f, X, Y, z);
        if (k === SOLID || k === OUT) break;
      }
      return d * f.cell;
    };
    widths.push(march(1) + march(-1) + f.cell);
  }
  return { widths, along };
}

export { centre as cellCentre };
