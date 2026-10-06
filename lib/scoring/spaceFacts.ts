// What several of the matrix descriptors read from a tile's voxels, beyond a single route: how many separate carved spaces there are and how connected
// they are, the terraces and risers of the floor, the walkable floors and the levels they sit on, and how many independent ways lead through the
// tile. All read with the program's one walking model (lib/walking.ts) and cached per tile and rule set.

import { floodZones, kernelFor, NEIGHBOURS, SOLID, VOID, WALK } from "@/lib/walking";
import { floorCells } from "@/lib/scoring/usable";
import { groundEntries, supportedCells, type VoxelFacts } from "@/lib/scoring/voxelFacts";

/** A carved pocket smaller than this is a speck of erosion, not a space (ft3). */
export const SPECK_FT3 = 20;
/** A flat stretch of floor smaller than this is not a tread (ft2). */
export const TREAD_MIN_FT2 = 4;
/** A change of floor height smaller than this is a ramp's voxel stepping, not a riser (ft). */
export const RISER_MIN_FT = 1;
/** ... and one taller than this is a drop, not a riser (ft). */
export const RISER_MAX_FT = 8;

const cache = new WeakMap<VoxelFacts, Map<string, unknown>>();
function memo<T>(f: VoxelFacts, key: string, make: () => T): T {
  let m = cache.get(f);
  if (!m) cache.set(f, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

const xyz = (f: VoxelFacts, i: number): [number, number, number] => {
  const z = i % f.nz;
  const y = ((i - z) / f.nz) % f.ny;
  return [((i - z) / f.nz - y) / f.ny, y, z];
};

// ---- separate carved spaces ---------------------------------------------------------------------------------------------------------------------

export interface VoidComponents {
  /** cells of each space (a joined body of void), biggest first, specks left out */
  sizes: number[];
  /** how many specks (pockets under SPECK_FT3) were left out */
  specks: number;
  /** void cells in the spaces (specks left out) */
  cells: number;
}

/** The separate bodies of void (6-connected), the specks of erosion apart from the real spaces. */
export function voidComponents(f: VoxelFacts): VoidComponents {
  return memo(f, "void", () => {
    const n = f.cls.length;
    const seen = new Uint8Array(n);
    const speck = Math.max(1, Math.round(SPECK_FT3 / f.cell ** 3));
    const sizes: number[] = [];
    let specks = 0;
    const stack: number[] = [];
    const { nx, ny, nz } = f;
    for (let s = 0; s < n; s++) {
      if (f.cls[s] !== VOID || seen[s]) continue;
      let cells = 0;
      seen[s] = 1;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        cells++;
        const [x, y, z] = xyz(f, i);
        const tryAt = (X: number, Y: number, Z: number) => {
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) return;
          const j = (X * ny + Y) * nz + Z;
          if (f.cls[j] === VOID && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        };
        tryAt(x + 1, y, z);
        tryAt(x - 1, y, z);
        tryAt(x, y + 1, z);
        tryAt(x, y - 1, z);
        tryAt(x, y, z + 1);
        tryAt(x, y, z - 1);
      }
      if (cells >= speck) sizes.push(cells);
      else specks++;
    }
    sizes.sort((a, b) => b - a);
    return { sizes, specks, cells: sizes.reduce((a, b) => a + b, 0) };
  });
}

// ---- terraces and risers --------------------------------------------------------------------------------------------------------------------

export interface TreadFacts {
  /** flat stretches of floor of at least TREAD_MIN_FT2 */
  plateaus: number;
  /** the plateaus that a riser (a step of RISER_MIN_FT to RISER_MAX_FT in the floor) leads to or from: the treads of a stair, terrace or cascade */
  treads: number;
  /** distinct risers: pairs of neighbouring plateaus at different heights */
  risers: number;
  /** lowest to highest tread, ft (0 when there is none) */
  spanFt: number;
}

/** Floor plateaus (flat, joined, at one height) and the risers between neighbouring ones, read on the floor surface (every floor with a person's height above it, walkable or not: a seat is a tread). */
export function treadFacts(f: VoxelFacts): TreadFacts {
  return memo(f, "treads", () => {
    const empty: TreadFacts = { plateaus: 0, treads: 0, risers: 0, spanFt: 0 };
    if (f.cls.length > 4_000_000) return empty;
    const floor = floorCells(f);
    const n = floor.length;
    const label = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    const heights: number[] = [];
    const { nx, ny, nz } = f;
    const stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (!floor[s] || label[s] >= 0) continue;
      const id = sizes.length;
      let cells = 0;
      const z0 = s % nz;
      label[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        cells++;
        const [x, y] = xyz(f, i);
        for (const [dx, dy] of NEIGHBOURS) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
          const j = (X * ny + Y) * nz + z0;
          if (floor[j] && label[j] < 0) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
      sizes.push(cells);
      heights.push(z0);
    }
    const minCells = Math.max(2, Math.round(TREAD_MIN_FT2 / (f.cell * f.cell)));
    const big = sizes.map((s) => s >= minCells);
    const plateaus = big.filter(Boolean).length;
    const lo = Math.max(1, Math.round(RISER_MIN_FT / f.cell));
    const hi = Math.max(lo, Math.round(RISER_MAX_FT / f.cell));
    const pairs = new Set<string>();
    const inRiser = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (!floor[i]) continue;
      const a = label[i];
      if (!big[a]) continue;
      const [x, y, z] = xyz(f, i);
      for (const [dx, dy] of NEIGHBOURS) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        // the riser as seen from the lower tread: solid beside it for the height of the step, then the next tread's floor
        for (let d = 1; d <= hi; d++) {
          const Z = z + d;
          if (Z >= nz) break;
          const j = (X * ny + Y) * nz + Z;
          const below = (X * ny + Y) * nz + Z - 1;
          if (f.cls[below] !== SOLID) break;
          if (floor[j]) {
            if (d >= lo) {
              const b = label[j];
              if (b !== a && big[b]) {
                pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
                inRiser.add(a);
                inRiser.add(b);
              }
            }
            break;
          }
        }
      }
    }
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const id of inRiser) {
      zmin = Math.min(zmin, heights[id]);
      zmax = Math.max(zmax, heights[id]);
    }
    return { plateaus, treads: inRiser.size, risers: pairs.size, spanFt: inRiser.size ? (zmax - zmin) * f.cell : 0 };
  });
}

// ---- walkable floors and their levels --------------------------------------------------------------------------------------------------------

export interface WalkFacts {
  /** standing cells (the walking rules) in floors that are spaces */
  stand: Uint8Array;
  zone: Int32Array;
  /** the walkable floors (zones), biggest first */
  zones: { id: number; cells: number; areaFt2: number; zLo: number; zHi: number }[];
  /** the biggest zone's share of all walkable floor, 0..1 */
  mainShare: number;
  /** flat stretches of walkable floor (at least the smallest space) with the zone they belong to and their height (cells) */
  patches: { zone: number; z: number; areaFt2: number; cell: number }[];
  /** the lowest walkable floor, cells */
  groundZ: number;
}

export function walkFacts(f: VoxelFacts): WalkFacts {
  const k = kernelFor(f.cell);
  return memo(f, `walk${k.key}`, () => {
    const dims: [number, number, number] = [f.nx, f.ny, f.nz];
    const stand = supportedCells(f, k);
    const { zone, cells } = floodZones(dims, stand, k);
    let total = 0;
    const lo = new Array<number>(cells.length).fill(Infinity);
    const hi = new Array<number>(cells.length).fill(-Infinity);
    let groundZ = Infinity;
    for (let i = 0; i < stand.length; i++) {
      if (!stand[i]) continue;
      total++;
      const z = i % f.nz;
      const zn = zone[i];
      if (z < lo[zn]) lo[zn] = z;
      if (z > hi[zn]) hi[zn] = z;
      if (z < groundZ) groundZ = z;
    }
    const zones = cells
      .map((c, id) => ({ id, cells: c, areaFt2: c * f.cell * f.cell, zLo: lo[id], zHi: hi[id] }))
      .filter((z) => Number.isFinite(z.zLo))
      .sort((a, b) => b.cells - a.cells);
    // flat stretches at one height
    const seen = new Uint8Array(stand.length);
    const patches: WalkFacts["patches"] = [];
    const minCells = k.minZoneCells;
    const stack: number[] = [];
    for (let s = 0; s < stand.length; s++) {
      if (!stand[s] || seen[s]) continue;
      const z0 = s % f.nz;
      let n = 0;
      seen[s] = 1;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        n++;
        const [x, y] = xyz(f, i);
        for (const [dx, dy] of NEIGHBOURS) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= f.nx || Y >= f.ny) continue;
          const j = (X * f.ny + Y) * f.nz + z0;
          if (stand[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      if (n >= minCells) patches.push({ zone: zone[s], z: z0, areaFt2: n * f.cell * f.cell, cell: s });
    }
    return { stand, zone, zones, mainShare: total ? (zones[0]?.cells ?? 0) / total : 0, patches, groundZ: Number.isFinite(groundZ) ? groundZ : 0 };
  });
}

export interface LevelFacts {
  /** floor levels of walkable floor (heights within `bandFt` of the first of a level are one level) */
  levels: { zFt: number; areaFt2: number }[];
  /** walkable spaces (a floor of one level that is a zone of its own) above the ground floor */
  above: { zone: number; zFt: number; areaFt2: number; cell: number }[];
  groundFt: number;
}

/** The walkable levels, and the spaces on them above the ground floor (more than `aboveFt` over the lowest walkable floor). */
export function levelFacts(f: VoxelFacts, aboveFt: number, bandFt = 3): LevelFacts {
  const w = walkFacts(f);
  const band = Math.max(1, Math.round(bandFt / f.cell));
  const patches = w.patches.slice().sort((a, b) => a.z - b.z);
  const levels: { z0: number; area: number }[] = [];
  for (const p of patches) {
    const last = levels[levels.length - 1];
    if (last && p.z - last.z0 <= band) last.area += p.areaFt2;
    else levels.push({ z0: p.z, area: p.areaFt2 });
  }
  const groundFt = w.groundZ * f.cell;
  const spaces = new Map<string, { zone: number; z0: number; area: number; cell: number }>();
  for (const p of patches) {
    if (p.z * f.cell <= groundFt + aboveFt) continue;
    const lvl = levels.filter((l) => l.z0 <= p.z).length; // the level it belongs to
    const key = `${p.zone}/${lvl}`;
    const s = spaces.get(key);
    if (s) s.area += p.areaFt2;
    else spaces.set(key, { zone: p.zone, z0: p.z, area: p.areaFt2, cell: p.cell });
  }
  return {
    levels: levels.map((l) => ({ zFt: l.z0 * f.cell, areaFt2: l.area })),
    above: [...spaces.values()].map((s) => ({ zone: s.zone, zFt: s.z0 * f.cell, areaFt2: s.area, cell: s.cell })),
    groundFt,
  };
}

// ---- independent ways through the tile -------------------------------------------------------------------------------------------------------

export interface RouteFacts {
  /** independent routes (no shared 5 ft stretch of floor) from the ways in to the middle and far parts of the walkable floor: the typical figure, capped */
  routes: number;
  /** the same to the farthest part */
  farthest: number;
  entries: number;
  /** independent loops in the network of walkable stretches (the cyclomatic number) */
  loops: number;
  /** stretches of floor (5 ft blocks) in the network */
  blocks: number;
}

const BLOCK_FT = 5;

/** Counts independent ways (no 5 ft stretch of floor shared) from the ground-level entries to parts of the walkable floor, by flow through a network of floor blocks. */
export function routeFacts(f: VoxelFacts, cap = 6, blockFt = BLOCK_FT): RouteFacts {
  return memo(f, `routes${kernelFor(f.cell).key}/${cap}/${blockFt}`, () => {
    const w = walkFacts(f);
    const B = Math.max(2, Math.round(blockFt / f.cell));
    const zb = Math.max(2, Math.round(6.5 / f.cell)); // floors a headroom apart are different blocks
    const blockOf = new Map<string, number>();
    const count: number[] = [];
    const idOf = (i: number): number => {
      const [x, y, z] = xyz(f, i);
      const key = `${Math.floor(x / B)},${Math.floor(y / B)},${Math.floor(z / zb)}`;
      let id = blockOf.get(key);
      if (id === undefined) {
        id = count.length;
        blockOf.set(key, id);
        count.push(0);
      }
      return id;
    };
    const cellBlock = new Int32Array(w.stand.length).fill(-1);
    for (let i = 0; i < w.stand.length; i++) if (w.stand[i]) {
      cellBlock[i] = idOf(i);
      count[cellBlock[i]]++;
    }
    const minCells = Math.max(3, Math.round((B * B) / 5)); // a block counts when a fifth of it is floor
    const ok = count.map((c) => c >= minCells);
    // edges: neighbouring blocks joined by at least a clear width of floor cells side by side
    const need = Math.max(2, Math.round(WALK.widthFt / f.cell));
    const cross = new Map<string, number>();
    for (let i = 0; i < w.stand.length; i++) {
      if (!w.stand[i]) continue;
      const a = cellBlock[i];
      if (!ok[a]) continue;
      const [x, y, z] = xyz(f, i);
      for (const [dx, dy] of NEIGHBOURS) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= f.nx || Y >= f.ny) continue;
        for (let dz = -1; dz <= 1; dz++) {
          const Z = z + dz;
          if (Z < 1 || Z >= f.nz) continue;
          const j = (X * f.ny + Y) * f.nz + Z;
          const b = cellBlock[j];
          if (b < 0 || b === a || !ok[b]) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          cross.set(key, (cross.get(key) ?? 0) + 1);
        }
      }
    }
    const nodes = ok.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const adj = new Map<number, Set<number>>();
    for (const id of nodes) adj.set(id, new Set());
    for (const [key, c] of cross) {
      if (c < need) continue;
      const [a, b] = key.split("|").map(Number);
      adj.get(a)?.add(b);
      adj.get(b)?.add(a);
    }
    const entryCells = groundEntries(f, w.stand, false);
    const entryBlocks = [...new Set(entryCells.map((i) => cellBlock[i]).filter((b) => b >= 0 && ok[b]))];
    if (!entryBlocks.length || !nodes.length) return { routes: 0, farthest: 0, entries: entryBlocks.length, loops: 0, blocks: nodes.length };
    // distances from the entries, to choose the middle and far parts
    const dist = new Map<number, number>();
    let frontier = [...entryBlocks];
    for (const e of frontier) dist.set(e, 0);
    while (frontier.length) {
      const next: number[] = [];
      for (const a of frontier) for (const b of adj.get(a) ?? []) if (!dist.has(b)) {
        dist.set(b, dist.get(a)! + 1);
        next.push(b);
      }
      frontier = next;
    }
    const reached = [...dist.keys()];
    // components of the network for the loop count
    const compSeen = new Set<number>();
    let comps = 0;
    for (const s of reached) {
      if (compSeen.has(s)) continue;
      comps++;
      const st = [s];
      compSeen.add(s);
      while (st.length) {
        const a = st.pop()!;
        for (const b of adj.get(a) ?? []) if (!compSeen.has(b)) {
          compSeen.add(b);
          st.push(b);
        }
      }
    }
    let reachedEdges = 0;
    for (const a of reached) reachedEdges += (adj.get(a)?.size ?? 0);
    reachedEdges /= 2;
    const loops = Math.max(0, reachedEdges - reached.length + comps);
    // sinks: the farthest block, and the ones about half way and three quarters of the way out
    const byDist = reached.filter((b) => !entryBlocks.includes(b)).sort((a, b) => dist.get(a)! - dist.get(b)!);
    if (!byDist.length) return { routes: entryBlocks.length ? 1 : 0, farthest: 1, entries: entryBlocks.length, loops, blocks: nodes.length };
    const pick = (q: number) => byDist[Math.min(byDist.length - 1, Math.floor(q * (byDist.length - 1)))];
    const sinks = [...new Set([pick(1), pick(0.75), pick(0.5)])];
    const flows = sinks.map((t) => vertexDisjointPaths(adj, entryBlocks, t, cap));
    const farthest = flows[0];
    const sorted = flows.slice().sort((a, b) => a - b);
    return { routes: sorted[Math.floor(sorted.length / 2)], farthest, entries: entryBlocks.length, loops, blocks: nodes.length };
  });
}

/** Vertex-disjoint paths from any of the sources to the sink in an undirected graph (max flow on the split graph), at most `cap`. */
function vertexDisjointPaths(adj: Map<number, Set<number>>, sources: number[], sink: number, cap: number): number {
  // node v -> v_in = 2v, v_out = 2v+1; capacity 1 inside a node (the sink and the super source unlimited)
  const SRC = -1;
  const id = (v: number, out: boolean) => v * 2 + (out ? 1 : 0);
  const capacity = new Map<string, number>();
  const nbr = new Map<number, number[]>();
  const add = (a: number, b: number, c: number) => {
    const k = `${a}>${b}`;
    if (!capacity.has(k)) {
      (nbr.get(a) ?? nbr.set(a, []).get(a)!).push(b);
      (nbr.get(b) ?? nbr.set(b, []).get(b)!).push(a);
      capacity.set(k, 0);
      if (!capacity.has(`${b}>${a}`)) capacity.set(`${b}>${a}`, 0);
    }
    capacity.set(k, capacity.get(k)! + c);
  };
  for (const [v, set] of adj) {
    add(id(v, false), id(v, true), v === sink ? cap : 1);
    for (const w of set) add(id(v, true), id(w, false), 1);
  }
  for (const s of sources) add(SRC, id(s, false), 1);
  const T = id(sink, true);
  let flow = 0;
  while (flow < cap) {
    const prev = new Map<number, number>([[SRC, SRC]]);
    const q = [SRC];
    let found = false;
    for (let h = 0; h < q.length && !found; h++) {
      const a = q[h];
      for (const b of nbr.get(a) ?? []) {
        if (prev.has(b) || (capacity.get(`${a}>${b}`) ?? 0) <= 0) continue;
        prev.set(b, a);
        if (b === T) {
          found = true;
          break;
        }
        q.push(b);
      }
    }
    if (!found) break;
    for (let b = T; b !== SRC; b = prev.get(b)!) {
      const a = prev.get(b)!;
      capacity.set(`${a}>${b}`, capacity.get(`${a}>${b}`)! - 1);
      capacity.set(`${b}>${a}`, (capacity.get(`${b}>${a}`) ?? 0) + 1);
    }
    flow++;
  }
  return flow;
}

// ---- the floor plates, read from the voxels -------------------------------------------------------------------------------------------------------

export interface PlateFacts {
  id: number;
  cells: number;
  /** plan area, ft2 */
  areaFt2: number;
  /** lowest and highest cell, ft */
  zMinFt: number;
  zMaxFt: number;
  /** mean height of the top surface over the plate's columns, ft */
  topFt: number;
  /** the plate reaches the bottom of the tile: the ground slab */
  ground: boolean;
}

/** The floor plates of a tile (the engine's protected plates), from the voxels: where each sits and how much of the plan it covers. */
export function plateFacts(f: VoxelFacts): PlateFacts[] {
  return memo(f, "plates", () => {
    if (!f.plates) return [];
    const per = new Map<number, { cells: number; zMin: number; zMax: number; tops: Map<number, number> }>();
    for (let x = 0; x < f.nx; x++)
      for (let y = 0; y < f.ny; y++)
        for (let z = 0; z < f.nz; z++) {
          const i = (x * f.ny + y) * f.nz + z;
          const id = f.plates[i];
          if (!id || f.cls[i] !== SOLID) continue;
          let p = per.get(id);
          if (!p) per.set(id, (p = { cells: 0, zMin: z, zMax: z, tops: new Map() }));
          p.cells++;
          if (z < p.zMin) p.zMin = z;
          if (z > p.zMax) p.zMax = z;
          const col = x * f.ny + y;
          if ((p.tops.get(col) ?? -1) < z) p.tops.set(col, z);
        }
    const out: PlateFacts[] = [];
    for (const [id, p] of per) {
      let sum = 0;
      for (const z of p.tops.values()) sum += z + 1;
      out.push({
        id,
        cells: p.cells,
        areaFt2: p.tops.size * f.cell * f.cell,
        zMinFt: p.zMin * f.cell,
        zMaxFt: (p.zMax + 1) * f.cell,
        topFt: (sum / Math.max(1, p.tops.size)) * f.cell,
        ground: p.zMin <= 1,
      });
    }
    return out.sort((a, b) => a.topFt - b.topFt);
  });
}

/** How many distinct heights the plates' top surfaces stand at, the ground slab included (heights within `tolFt` are one): a stepped stack of floors. */
export function plateHeights(plates: PlateFacts[], tolFt = 1): number {
  const tops = plates.map((p) => p.topFt).sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const t of tops) {
    if (t - last > tolFt) n++;
    last = t;
  }
  return n;
}
