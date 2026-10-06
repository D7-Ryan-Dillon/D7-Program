// The one walking model. Everything in the program that asks "can a person stand here?" or "can a person get from here to there?" reads the
// answer from this file: Arrange's joints, reachability and generator; Analysis's routes (Graduated, Continuous, Non-hierarchical, Spatial
// density), its usable-space check and the assemblies it reads. There are no second copies of a threshold anywhere else.
//
//   standing    a void cell with material directly under it, clear headroom above it, and a clear disc round it (`widthFt` across) at every height
//               up to the headroom. Nothing else is a place to stand. Open air is not.
//   step        two standing cells that touch (side by side) and differ in height by no more than `stepFt` are one walkable surface. This is the
//               ONLY way a height change is crossed, inside a tile and across a joint alike. A bigger change has to be climbed by actual
//               geometry: a run of standing cells (a stair, a ramp, a stepped floor) each within the step limit of the next. No setting of any
//               kind turns a bigger jump into a connection.
//   zone        standing cells joined by steps; a zone smaller than `minZoneFt2` is a pocket, not a space.
//   connector   two floors that are close in height but further apart than a step: reported as "needs a connector" (a stair or ramp that
//               does not exist yet), never as walkable.
//
// These are proto-architecture tolerances (6.5 ft headroom, 2.5 ft clear width, a 6 in riser). They are not code compliance, an accessibility
// check or a structural check. The values live in WALK; the project can override them (see lib/useWalkRules.ts) and every result that depends
// on them is keyed with `walkKey()`, so changing one recomputes everything it touches.

/** What a cell is, for walking: OUT is outside a tile's container (open air for the tile, but not a floor and not a wall). */
export const OUT = 0;
export const SOLID = 1;
export const VOID = 2;

export interface WalkRules {
  /** clear height above a floor, ft */
  headroomFt: number;
  /** clear width of the standing place (a disc this wide that must hold no material), ft */
  widthFt: number;
  /** the largest rise or drop between two neighbouring standing cells, ft: one riser. Shared by every route in the program. */
  stepFt: number;
  /** a floor area smaller than this is a pocket, not a space, ft2 */
  minZoneFt2: number;
}

export const DEFAULT_WALK: Readonly<WalkRules> = { headroomFt: 6.5, widthFt: 2.5, stepFt: 0.5, minZoneFt2: 12 };

/** The rules in force (live: changed by applyWalk / setWalkRules, which also invalidate every cache keyed with walkKey). */
export const WALK: WalkRules = { ...DEFAULT_WALK };

/** How the four rules are described to the user, with their limits (the settings lists in Arrange and in Analysis both draw from this). */
export const WALK_FIELDS: { key: keyof WalkRules; label: string; unit: string; hint: string; min: number; max: number; step: number }[] = [
  { key: "headroomFt", label: "Headroom", unit: "ft", hint: "Clear height above the floor that a person needs to stand and walk", min: 5, max: 9, step: 0.5 },
  { key: "widthFt", label: "Clear width", unit: "ft", hint: "Clear width of a place to stand: a disc this wide that holds no material", min: 1.5, max: 5, step: 0.5 },
  { key: "stepFt", label: "Step (one riser)", unit: "ft", hint: "The largest rise or drop between two neighbouring floors that is still walked as a step. A bigger change needs actual stair or ramp geometry, whatever this is set to", min: 0.5, max: 1, step: 0.5 },
  { key: "minZoneFt2", label: "Smallest floor that counts as a space", unit: "ft²", hint: "A walkable floor smaller than this is a pocket, not a space", min: 4, max: 40, step: 2 },
];

let epoch = 0;
/** Changes whenever the rules do. */
export const walkEpoch = () => epoch;
/** A short stable text of the rules, for caches. */
export const walkKey = (r: WalkRules = WALK): string => `w${r.headroomFt}/${r.widthFt}/${r.stepFt}/${r.minZoneFt2}`;

const clean = (patch: Partial<WalkRules>): Partial<WalkRules> => {
  const out: Partial<WalkRules> = {};
  for (const f of WALK_FIELDS) {
    const v = patch[f.key];
    if (typeof v === "number" && Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  return out;
};

/** Merges `patch` into the rules in force. Returns true when something changed. */
export function applyWalk(patch: Partial<WalkRules> = {}): boolean {
  const before = walkKey();
  Object.assign(WALK, clean(patch));
  if (walkKey() === before) return false;
  epoch++;
  return true;
}

/** Sets the rules to the defaults plus `overrides` (the project's own choices); idempotent, so it may be called on every render. */
export function setWalkRules(overrides: Partial<WalkRules> = {}): boolean {
  const next = { ...DEFAULT_WALK, ...clean(overrides) };
  if (walkKey(next) === walkKey()) return false;
  Object.assign(WALK, next);
  epoch++;
  return true;
}

// ---- the rules in cells ----------------------------------------------------------------------------------------------------------------

export interface Kernel {
  cellFt: number;
  /** clear cells above a floor cell (the floor cell's own space and the ones above it up to the headroom) */
  head: number;
  /** the largest step between neighbouring standing cells, in cells */
  step: number;
  /** offsets of the clear disc, in cells */
  disc: [number, number][];
  /** cells in the smallest floor that counts as a space */
  minZoneCells: number;
  key: string;
}

const kernels = new Map<string, Kernel>();

/** The rules turned into cells for a grid of `cellFt` cells (cached; the same call after a rule changes gives the new kernel). */
export function kernelFor(cellFt: number, r: WalkRules = WALK): Kernel {
  const key = `${walkKey(r)}@${cellFt}`;
  const hit = kernels.get(key);
  if (hit) return hit;
  const radius = Math.max(1, Math.floor(r.widthFt / cellFt / 2)); // cells either side of the middle: a disc 2r+1 cells across (2.5 ft at 0.5 ft cells = r 2)
  const disc: [number, number][] = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) if (dx * dx + dy * dy <= radius * radius + 1) disc.push([dx, dy]);
  const k: Kernel = {
    cellFt,
    head: Math.max(2, Math.round(r.headroomFt / cellFt)),
    step: Math.max(1, Math.round(r.stepFt / cellFt)),
    disc,
    minZoneCells: Math.max(1, Math.round(r.minZoneFt2 / (cellFt * cellFt))),
    key,
  };
  if (kernels.size > 40) kernels.clear();
  kernels.set(key, k);
  return k;
}

/** Can someone stand in this cell, given a way of asking what is in any cell (OUT / SOLID / VOID)? */
export function standingAtWith(k: Kernel, cell: (x: number, y: number, z: number) => number, x: number, y: number, z: number): boolean {
  if (cell(x, y, z) !== VOID) return false;
  if (cell(x, y, z - 1) !== SOLID) return false;
  for (let h = 1; h < k.head; h++) for (const [dx, dy] of k.disc) if (cell(x + dx, y + dy, z + h) === SOLID) return false;
  return true;
}

/**
 * The standing cells of a grid read as a whole: a cell is standing when `standingAtWith` says so (a floor cell has VOID with SOLID under it).
 * `cls` holds OUT / SOLID / VOID per cell in the layout (x * ny + y) * nz + z; cells beyond the grid are OUT.
 */
export function standingCells(dims: [number, number, number], cls: Uint8Array, k: Kernel): Uint8Array {
  const [nx, ny, nz] = dims;
  const cell = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? OUT : cls[(x * ny + y) * nz + z]);
  const out = new Uint8Array(cls.length);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 1; z < nz; z++) {
        const i = (x * ny + y) * nz + z;
        if (cls[i] === VOID && cls[i - 1] === SOLID && standingAtWith(k, cell, x, y, z)) out[i] = 1;
      }
  return out;
}

export interface FloodedZones {
  /** zone id per cell, -1 where nobody stands */
  zone: Int32Array;
  /** cells per zone */
  cells: number[];
}

/** Joins standing cells into zones: neighbours (side by side) within one step of each other are one surface. The one connectivity rule. */
export function floodZones(dims: [number, number, number], stand: Uint8Array, k: Kernel): FloodedZones {
  const [nx, ny, nz] = dims;
  const zone = new Int32Array(stand.length).fill(-1);
  const cells: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < stand.length; s++) {
    if (!stand[s] || zone[s] >= 0) continue;
    const id = cells.length;
    let n = 0;
    stack.push(s);
    zone[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const z = i % nz;
      const y = ((i - z) / nz) % ny;
      const x = ((i - z) / nz - y) / ny;
      for (const [dx, dy] of NEIGHBOURS) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        for (let dz = -k.step; dz <= k.step; dz++) {
          const Z = z + dz;
          if (Z < 1 || Z >= nz) continue;
          const j = (X * ny + Y) * nz + Z;
          if (stand[j] && zone[j] < 0) {
            zone[j] = id;
            stack.push(j);
          }
        }
      }
    }
    cells.push(n);
  }
  return { zone, cells };
}

/** The four side-by-side neighbours (a route never moves diagonally). */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
