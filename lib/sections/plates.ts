// Floor plates for the cube/hex builder: flat slabs at set heights inside the
// tile, added to (or cut from) the lofted field. Runs after Swap foam & void
// and before cleanup (loft -> swap -> plates -> cleanup), so a plate's
// "foam" or "void" side always means the FINAL foam / final void whatever
// Swap is set to. lib/sections/volumeField.ts is not touched: like cleanup.ts
// this reads a field and returns a new one.
//
// A plate is a slab (its top surface at an elevation, thickness below it)
// times a plan footprint. The slab is made of the same kind of signed field
// the loft is, unioned in with `max`, so the mesh, voxelizer and cleanup
// treat it like any other part of the tile. Plates are eroded from their
// surroundings: wherever a void shaft runs unbroken above AND below a column
// of the plate, the plate recedes there (more with a higher setting), which
// is what keeps vertical connections open; an explicit opening, soft random
// erosion and a "keep a vertical connection" guarantee sit on top of that.
// Anything within 1.5 ft of a tile wall is never eroded, so floors still
// reach the face and meet the neighbouring tile's.

import { HEX_APOTHEM, type VolumeField } from "./volumeField";

const EDGE = 2; // first/last tile node (see volumeField.ts: 2 forced-void margin nodes each side)
const WALL_PROTECT_FT = 1.5;
const MIN_CONNECTION_RADIUS_FT = 3;
const NOISE_CELL_FT = 4;

export type PlateFootprint = "full" | "inset" | "L" | "T" | "plus";
export type PlateSide = "foam" | "void";

export interface PlateSettings {
  enabled: boolean;
  /** Which final side the plates belong to -- independent of Swap foam & void. */
  side: PlateSide;
  count: number;
  /** Elevation (ft above the tile base) of the lowest plate's top surface. */
  firstElevationFt: number;
  floorToFloorFt: number;
  thicknessFt: number;
  footprint: PlateFootprint;
  /** Pull the plate in from the walls (ft). */
  insetFt: number;
  /** Size of a deliberate opening, as a % of the tile width (0 = none). */
  openingPct: number;
  /** How readily a plate recedes where a void shaft runs through it, 0-100. */
  erodePct: number;
  /** Soft random holes, 0-100. */
  noisePct: number;
  seed: number;
  /** Guarantee every plate keeps at least one opening for a vertical connection. */
  keepConnection: boolean;
}

export const defaultPlates = (): PlateSettings => ({
  enabled: false,
  side: "foam",
  count: 1,
  firstElevationFt: 10,
  floorToFloorFt: 10,
  thicknessFt: 1,
  footprint: "full",
  insetFt: 0,
  openingPct: 0,
  erodePct: 0,
  noisePct: 0,
  seed: 1,
  keepConnection: false,
});

export function arePlatesActive(p: PlateSettings | undefined): p is PlateSettings {
  return !!p && p.enabled && p.count > 0;
}

export interface PlateStats {
  /** Elevations actually built (ft). */
  elevations: number[];
  /** How many of those plates have at least one opening. */
  withOpenings: number;
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 0-1 value noise over the plan, lattice spacing NOISE_CELL_FT. */
function noise(xFt: number, zFt: number, seed: number): number {
  const fx = xFt / NOISE_CELL_FT;
  const fz = zFt / NOISE_CELL_FT;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Applies the plates to a copy of `volume`; never mutates the input. */
export function applyPlates(volume: VolumeField, settings: PlateSettings, shape: "cube" | "hex-prism", tileFt = 20): { volume: VolumeField; stats: PlateStats } {
  const stats: PlateStats = { elevations: [], withOpenings: 0 };
  if (!arePlatesActive(settings)) return { volume, stats };

  const n = volume.resolution;
  const nn = n * n;
  const lo = EDGE;
  const hi = n - 1 - EDGE;
  const span = hi - lo; // node steps across the tile
  const cellFt = tileFt / span;
  const src = volume.field;
  const sgn = settings.side === "foam" ? 1 : -1;
  const idx = (x: number, y: number, z: number) => z * nn + y * n + x;

  // Field slope per cell near the surface, so a slab's own field is on the
  // same scale as the loft's (marching cubes interpolates between the two).
  let slopeSum = 0;
  let slopeCount = 0;
  for (let z = lo; z <= hi; z += 2)
    for (let y = lo; y <= hi; y += 2)
      for (let x = lo; x < hi; x++) {
        const a = src[idx(x, y, z)];
        const b = src[idx(x + 1, y, z)];
        if (a > 0 !== b > 0) {
          slopeSum += Math.abs(a - b);
          slopeCount++;
        }
      }
  const slope = slopeCount ? slopeSum / slopeCount : 1;

  const half = tileFt / 2;
  const wallDist = (px: number, pz: number): number => {
    if (shape === "hex-prism") {
      // World units: the hex's circumradius is 1 = tileFt/2 ft, flats at +-HEX_APOTHEM.
      const wx = (px / tileFt) * 2 - 1;
      const wz = (pz / tileFt) * 2 - 1;
      let m = Infinity;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        m = Math.min(m, HEX_APOTHEM - Math.abs(wx * Math.cos(a) + wz * Math.sin(a)));
      }
      return m * half;
    }
    return Math.min(px, tileFt - px, pz, tileFt - pz);
  };

  /** Plan footprint as a signed distance in ft (positive inside). */
  const footprintFt = (px: number, pz: number): number => {
    // A plate that reaches a wall runs one cell past it, so the wall nodes are inside
    // it and the slab meets the tile face exactly (floors continue into the neighbour).
    const inset = settings.footprint === "full" ? 0 : settings.insetFt;
    const base = wallDist(px, pz) - inset + (inset <= 0 ? cellFt : 0);
    switch (settings.footprint) {
      case "L":
        return Math.min(base, -Math.min(px - half, pz - half));
      case "T":
        return Math.min(base, Math.max(tileFt * 0.4 - pz, tileFt * 0.2 - Math.abs(px - half)));
      case "plus":
        return Math.min(base, Math.max(tileFt * 0.2 - Math.abs(px - half), tileFt * 0.2 - Math.abs(pz - half)));
      default:
        return base;
    }
  };

  const thickness = Math.max(1, settings.thicknessFt);
  const g = new Float32Array(src.length);
  for (let i = 0; i < g.length; i++) g[i] = sgn * src[i];
  const out = new Float32Array(g); // g with the slabs unioned in

  const openingRadiusFt = (settings.openingPct / 100) * half;

  for (let k = 0; k < Math.min(12, Math.round(settings.count)); k++) {
    const elev = Math.min(tileFt, Math.max(thickness, settings.firstElevationFt + k * settings.floorToFloorFt));
    if (settings.firstElevationFt + k * settings.floorToFloorFt > tileFt + 1e-6) break;
    // A plate flush with a tile face reaches one cell past it, so the face
    // node itself is inside the slab and the surface lands exactly on the face.
    const bottom = elev - thickness <= 1e-6 ? -cellFt : elev - thickness;
    const top = elev >= tileFt - 1e-6 ? tileFt + cellFt : elev;
    const nodeOf = (ft: number) => Math.round(lo + ft / cellFt);
    const bottomNode = Math.max(lo, nodeOf(Math.max(bottom, 0)));
    const topNode = Math.min(hi, nodeOf(Math.min(top, tileFt)));

    // 1) per-column plan field (ft, positive = solid) and vertical clearance
    const plan = new Float32Array(n * n); // [z * n + x]
    const clearance = new Float32Array(n * n);
    const thr = 10 * (1 - settings.erodePct / 100) + 1.5;
    for (let z = lo; z <= hi; z++)
      for (let x = lo; x <= hi; x++) {
        const px = (x - lo) * cellFt;
        const pz = (z - lo) * cellFt;
        let p = footprintFt(px, pz);
        // How far void runs unbroken above and below this column of the slab
        // (a shaft open to the tile face counts as open all the way).
        let down = 0;
        let y = bottomNode - 1;
        while (y >= lo && g[idx(x, y, z)] <= 0) {
          down++;
          y--;
        }
        const downFt = y < lo ? tileFt : down * cellFt;
        let upN = 0;
        y = topNode + 1;
        while (y <= hi && g[idx(x, y, z)] <= 0) {
          upN++;
          y++;
        }
        const upFt = y > hi ? tileFt : upN * cellFt;
        const c = Math.min(downFt, upFt);
        clearance[z * n + x] = c;

        if (wallDist(px, pz) >= WALL_PROTECT_FT) {
          if (settings.erodePct > 0) p = Math.min(p, -(c - thr));
          if (settings.noisePct > 0) p = Math.min(p, -(noise(px, pz, settings.seed + k * 101) - (1 - 0.8 * (settings.noisePct / 100))) * 6);
        }
        plan[z * n + x] = p;
      }

    // 2) deliberate opening (staggered per plate so a stair can climb through them),
    //    and the guaranteed vertical connection
    let radius = openingRadiusFt;
    let cx = half + 0.22 * tileFt * Math.cos(k * 2.4);
    let cz = half + 0.22 * tileFt * Math.sin(k * 2.4);
    const needsConnection = () => {
      for (let z = lo; z <= hi; z++)
        for (let x = lo; x <= hi; x++) {
          const px = (x - lo) * cellFt;
          const pz = (z - lo) * cellFt;
          if (plan[z * n + x] < 0 && footprintFt(px, pz) > WALL_PROTECT_FT) return false;
        }
      return true;
    };
    const carve = (rFt: number, ox: number, oz: number) => {
      for (let z = lo; z <= hi; z++)
        for (let x = lo; x <= hi; x++) {
          const px = (x - lo) * cellFt;
          const pz = (z - lo) * cellFt;
          if (wallDist(px, pz) < WALL_PROTECT_FT) continue;
          plan[z * n + x] = Math.min(plan[z * n + x], Math.hypot(px - ox, pz - oz) - rFt);
        }
    };
    if (radius > 0) carve(radius, cx, cz);
    if (settings.keepConnection && needsConnection()) {
      // Put the opening where the most void runs through the plate, if any does.
      let best = -1;
      for (let z = lo; z <= hi; z++)
        for (let x = lo; x <= hi; x++) {
          const px = (x - lo) * cellFt;
          const pz = (z - lo) * cellFt;
          if (wallDist(px, pz) < 3 || footprintFt(px, pz) < 3) continue;
          const c = clearance[z * n + x];
          if (c > best) {
            best = c;
            cx = px;
            cz = pz;
          }
        }
      radius = Math.max(MIN_CONNECTION_RADIUS_FT, radius);
      carve(radius, best >= 1 ? cx : half, best >= 1 ? cz : half);
    }

    // 3) the slab itself: min(vertical, plan), unioned into the field
    let hasOpening = false;
    for (let z = lo; z <= hi; z++)
      for (let x = lo; x <= hi; x++) {
        const p = plan[z * n + x];
        if (p < 0 && footprintFt((x - lo) * cellFt, (z - lo) * cellFt) > WALL_PROTECT_FT) hasOpening = true;
        for (let y = lo; y <= hi; y++) {
          const yFt = (y - lo) * cellFt;
          const vert = Math.min(yFt - bottom, top - yFt);
          const slab = (Math.min(vert, p) / cellFt) * slope;
          const i = idx(x, y, z);
          if (slab > out[i]) out[i] = slab;
        }
      }
    stats.elevations.push(Math.round(elev * 100) / 100);
    if (hasOpening) stats.withOpenings++;
  }

  const field = new Float32Array(src.length);
  for (let i = 0; i < field.length; i++) field[i] = sgn * out[i];
  return { volume: { ...volume, field }, stats };
}
