// Usable space, as against space that is merely carved. A carved void is not all somewhere a person can go: floor needs clear room to stand
// (WALK in lib/arrange/occupancy.ts, the same thresholds Arrange uses for its walkable routes: 6.5 ft headroom, a 2.5 ft clear width, steps of
// no more than 0.5 ft), and the floor has to be joined to a way in. This reads, for one tile or one assembly:
//   total void against the void above floor that can be reached on foot
//   plate area against the floor that is exposed and usable (and what is loose or cut off)
//   void connectivity (open space joined) against floor-supported circulation (floors joined)
//   vertical connections that only let the view through against those a person can use
// and says WHERE the problems are (clearance problems, floor that cannot be reached), not a mean. These are proto-architectural thresholds,
// not code compliance and not structural certification.

import type { ParsedTile } from "@/lib/types";
import { WALK } from "@/lib/arrange/occupancy";
import { classAt, groundEntries, supportedCells, SOLID, VOID, voxelFacts, type VoxelFacts } from "./voxelFacts";

export interface Region {
  areaFt2: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface UsableSpace {
  available: boolean;
  reason: string;
  thresholds: { headroomFt: number; widthFt: number; stepFt: number; minZoneFt2: number };
  voidFt3: number;
  reachableVoidFt3: number;
  /** material of floor plates in plan, ft2 (the engine's plate objects), against floor that people can stand on and reach */
  plateFt2: number;
  /** all floor-supported cells (material under, 5 ft of headroom) in ft2 */
  floorFt2: number;
  /** of it: stand-able (clear width and headroom) and reachable from the entry */
  usableFt2: number;
  /** stand-able but not joined to the entry */
  cutOffFt2: number;
  /** a floor, but too narrow or too low to stand and walk on */
  tightFt2: number;
  voidPieces: number;
  /** floor zones (joined stand-able floor): how many, and how many are reachable */
  zones: number;
  zonesReached: number;
  verticalVisual: number;
  levelsTotal: number;
  levelsReached: number;
  /** the tile has levels that are reached on foot above the entry level (a stair or ramp joins them) */
  verticalTraversable: boolean;
  tight: Region[];
  cutOff: Region[];
}

const NB: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Stand-able cells: floor-supported with the full headroom and a disc of clear width (the Arrange rule), read in this tile's own cells. */
function standable(f: VoxelFacts, supported: Uint8Array): Uint8Array {
  const out = new Uint8Array(supported.length);
  const head = Math.max(2, Math.round(WALK.headroomFt / f.cell));
  const r = Math.max(1, Math.floor(WALK.widthFt / f.cell / 2));
  const disc: [number, number][] = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r + 1) disc.push([dx, dy]);
  const { nx, ny, nz } = f;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 1; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (!supported[i]) continue;
        let ok = true;
        for (let k = 1; k < head && ok; k++) for (const [dx, dy] of disc) if (classAt(f, x + dx, y + dy, z + k) === SOLID) {
          ok = false;
          break;
        }
        if (ok) out[i] = 1;
      }
  return out;
}

/** Bins cells into regions (4 ft boxes joined to neighbours) with their floor area, biggest first. */
function regionsOf(f: VoxelFacts, cells: number[], limit = 8): Region[] {
  const bin = Math.max(1, Math.round(4 / f.cell));
  const bins = new Map<string, { n: number; min: [number, number, number]; max: [number, number, number]; bx: number; by: number; bz: number }>();
  for (const i of cells) {
    const z = i % f.nz;
    const y = ((i - z) / f.nz) % f.ny;
    const x = ((i - z) / f.nz - y) / f.ny;
    const bx = Math.floor(x / bin);
    const by = Math.floor(y / bin);
    const bz = Math.floor(z / bin);
    const k = `${bx},${by},${bz}`;
    let b = bins.get(k);
    if (!b) bins.set(k, (b = { n: 0, min: [x, y, z], max: [x, y, z], bx, by, bz }));
    b.n++;
    b.min = [Math.min(b.min[0], x), Math.min(b.min[1], y), Math.min(b.min[2], z)];
    b.max = [Math.max(b.max[0], x), Math.max(b.max[1], y), Math.max(b.max[2], z)];
  }
  const seen = new Set<string>();
  const out: Region[] = [];
  for (const [k, b0] of bins) {
    if (seen.has(k)) continue;
    seen.add(k);
    const stack = [b0];
    let n = 0;
    let min: [number, number, number] = [...b0.min];
    let max: [number, number, number] = [...b0.max];
    while (stack.length) {
      const b = stack.pop()!;
      n += b.n;
      min = [Math.min(min[0], b.min[0]), Math.min(min[1], b.min[1]), Math.min(min[2], b.min[2])];
      max = [Math.max(max[0], b.max[0]), Math.max(max[1], b.max[1]), Math.max(max[2], b.max[2])];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nk = `${b.bx + dx},${b.by + dy},${b.bz + dz}`;
        const nb = bins.get(nk);
        if (nb && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nb);
        }
      }
    }
    out.push({ areaFt2: n * f.cell * f.cell, min: [min[0] * f.cell, min[1] * f.cell, min[2] * f.cell], max: [(max[0] + 1) * f.cell, (max[1] + 1) * f.cell, (max[2] + 1) * f.cell] });
  }
  return out.sort((a, b) => b.areaFt2 - a.areaFt2).slice(0, limit);
}

const cache = new WeakMap<ParsedTile, UsableSpace>();

export function usableSpace(tile: ParsedTile): UsableSpace {
  const hit = cache.get(tile);
  if (hit) return hit;
  const out = compute(tile);
  cache.set(tile, out);
  return out;
}

function compute(tile: ParsedTile): UsableSpace {
  const thresholds = { headroomFt: WALK.headroomFt, widthFt: WALK.widthFt, stepFt: WALK.stepFt, minZoneFt2: WALK.minZoneFt2 };
  const empty = (reason: string): UsableSpace => ({ available: false, reason, thresholds, voidFt3: 0, reachableVoidFt3: 0, plateFt2: 0, floorFt2: 0, usableFt2: 0, cutOffFt2: 0, tightFt2: 0, voidPieces: 0, zones: 0, zonesReached: 0, verticalVisual: 0, levelsTotal: 0, levelsReached: 0, verticalTraversable: false, tight: [], cutOff: [] });
  const f = voxelFacts(tile);
  if (!f) return empty("This tile carries no voxel data.");
  const c3 = f.cell ** 3;
  const c2 = f.cell ** 2;
  const supported = supportedCells(f, 5);
  const strict = standable(f, supported);
  const entries = groundEntries(f, strict);
  const step = Math.max(1, Math.round(WALK.stepFt / f.cell));
  // flood the stand-able floor from the way in
  const reached = new Uint8Array(strict.length);
  const stack: number[] = [];
  for (const e of entries) {
    reached[e] = 1;
    stack.push(e);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const z = i % f.nz;
    const y = ((i - z) / f.nz) % f.ny;
    const x = ((i - z) / f.nz - y) / f.ny;
    for (const [dx, dy] of NB) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= f.nx || Y >= f.ny) continue;
      for (let dz = -step; dz <= step; dz++) {
        const Z = z + dz;
        if (Z < 1 || Z >= f.nz) continue;
        const j = (X * f.ny + Y) * f.nz + Z;
        if (strict[j] && !reached[j]) {
          reached[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  let floor = 0;
  let usable = 0;
  let cutOff = 0;
  let tight = 0;
  const tightCells: number[] = [];
  const cutCells: number[] = [];
  for (let i = 0; i < supported.length; i++) {
    if (!supported[i]) continue;
    floor++;
    if (reached[i]) usable++;
    else if (strict[i]) {
      cutOff++;
      cutCells.push(i);
    } else {
      tight++;
      tightCells.push(i);
    }
  }
  // void above the floor that can be reached: the column over each reached floor cell
  const counted = new Uint8Array(f.cls.length);
  let reachableVoid = 0;
  for (let i = 0; i < reached.length; i++) {
    if (!reached[i]) continue;
    for (let k = i; k < i - (i % f.nz) + f.nz && f.cls[k] === VOID; k++) {
      if (!counted[k]) {
        counted[k] = 1;
        reachableVoid++;
      }
    }
  }
  // zones of stand-able floor, and how many are joined to the way in (a zone counts when it holds at least minZone of floor)
  const minCells = Math.round(WALK.minZoneFt2 / c2);
  const zoneId = new Int32Array(strict.length).fill(-1);
  let zones = 0;
  let zonesReached = 0;
  for (let s = 0; s < strict.length; s++) {
    if (!strict[s] || zoneId[s] >= 0) continue;
    let n = 0;
    let isReached = false;
    const st = [s];
    zoneId[s] = zones;
    while (st.length) {
      const i = st.pop()!;
      n++;
      if (reached[i]) isReached = true;
      const z = i % f.nz;
      const y = ((i - z) / f.nz) % f.ny;
      const x = ((i - z) / f.nz - y) / f.ny;
      for (const [dx, dy] of NB) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= f.nx || Y >= f.ny) continue;
        for (let dz = -step; dz <= step; dz++) {
          const Z = z + dz;
          if (Z < 1 || Z >= f.nz) continue;
          const j = (X * f.ny + Y) * f.nz + Z;
          if (strict[j] && zoneId[j] < 0) {
            zoneId[j] = zones;
            st.push(j);
          }
        }
      }
    }
    if (n >= minCells) {
      zones++;
      if (isReached) zonesReached++;
    } else zoneId[s] = -2;
  }
  const levels = tile.spaces?.levels ?? [];
  let levelsReached = 0;
  for (const l of levels) {
    let any = false;
    for (let i = 0; i < reached.length && !any; i++) {
      if (!reached[i]) continue;
      const z = i % f.nz;
      if (z >= l.layers[0] && z <= l.layers[1]) any = true;
    }
    if (any) levelsReached++;
  }
  const plateFt2 = (tile.structure?.plates ?? []).reduce((a, p) => a + p.area_ft2, 0);
  const verticalVisual = (tile.spaces?.connections ?? []).filter((x) => x.orientation !== "horizontal").length;
  return {
    available: true,
    reason: entries.length ? "" : "No opening at ground level has a stand-able floor, so no floor counts as reachable.",
    thresholds,
    voidFt3: f.voidCells * c3,
    reachableVoidFt3: reachableVoid * c3,
    plateFt2,
    floorFt2: floor * c2,
    usableFt2: usable * c2,
    cutOffFt2: cutOff * c2,
    tightFt2: tight * c2,
    voidPieces: tile.metrics.void_pieces ?? 1,
    zones,
    zonesReached,
    verticalVisual,
    levelsTotal: levels.length,
    levelsReached,
    verticalTraversable: levelsReached >= 2,
    tight: regionsOf(f, tightCells),
    cutOff: regionsOf(f, cutCells),
  };
}
