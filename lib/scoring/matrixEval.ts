// Evaluates a tile (or an assembly) against the matrix (lib/scoring/matrix.ts), automatically and honestly. For each of the twelve descriptors:
//   the original qualitative and quantitative criteria        (from the matrix, never edited here)
//   the measured result, with units                           (measure.value / measure.unit / measure.headline)
//   a status                                                  measured / inferred / proxy / assumed / not assessable / not applicable
//   the method, and what the number cannot establish          (measure.method / measure.cannot)
//   an automated qualitative interpretation                   (generated text, labelled as generated, never a human judgment or a simulation)
//   evidence                                                  rooms, levels, a route or regions to light up
// Where the matrix's measurement cannot be taken literally from the files, the criterion is kept, an adapted proxy is offered and labelled, and
// what it cannot show is said; where even a proxy would be invented, the result is "not assessable" and the rest of the workflow carries on.
// Nothing here is a daylight simulation, a structural check or a code check.

import type { ParsedTile } from "@/lib/types";
import type { DescriptorResult, Evidence } from "@/lib/scoring/descriptors";
import { legacyMeasurementsFor, scoreTile } from "@/lib/scoring/descriptors";
import { measuresFor, type Measures } from "@/lib/scoring/measures";
import { assumptionsKey, DEFAULT_ASSUMPTIONS, mergeAssumptions, type Assumptions } from "@/lib/scoring/assumptions";
import { MATRIX, type MatrixCriterion, type MatrixKey, type MatrixStatus } from "@/lib/scoring/matrix";
import { spatialDensityFor } from "@/lib/scoring/spatialDensity";
import { usableSpace, type UsableSpace } from "@/lib/scoring/usable";
import { classAt, findRoute, groundEntries, OUT, SOLID, skylights, surfaceStats, VOID, voxelFacts, type RouteOverride0, type VoxelFacts } from "@/lib/scoring/voxelFacts";
import { levelFacts, plateFacts, plateHeights, routeFacts, SPECK_FT3, treadFacts, voidComponents, walkFacts } from "@/lib/scoring/spaceFacts";
import { cap, count, ft, ft2, ft3, num, pct } from "@/lib/scoring/words";
import { WALK, walkKey } from "@/lib/walking";

/** The walking rules every route in this evaluation was read with (the project's one set, shared with Arrange). */
const walkUsed = () => `walking rules: ${ft(WALK.headroomFt, 1)} headroom, ${ft(WALK.widthFt, 1)} clear width, steps of ${ft(WALK.stepFt, 1)} or less (shared with Arrange)`;

export interface MatrixMeasure {
  /** the result in a line, with units */
  headline: string;
  /** the number behind it (null when nothing could be measured) and its unit */
  value: number | null;
  unit: string;
  status: MatrixStatus;
  /** how it was measured: what was counted, the denominator, the thresholds */
  method: string;
  /** what this result cannot establish */
  cannot: string;
  supporting: { label: string; value: string; how?: string }[];
  /** the assumptions this result rests on (they are in the evaluation profile and can be changed) */
  used: string[];
}

export interface MatrixInterpretation {
  /** a short reading, written by the app from the measurement */
  text: string;
  /** the app's own words for where the value falls (thresholds are the app's, not the matrix's) */
  scale?: string[];
  index?: number;
  generated: true;
}

export interface MatrixResult {
  key: MatrixKey;
  criterion: MatrixCriterion;
  measure: MatrixMeasure;
  interpretation: MatrixInterpretation;
  evidence: Evidence;
  /** the app's older 0-100 presence index for this descriptor (a blend of proxies): kept for the bars and older boards, not the matrix measurement */
  legacy: DescriptorResult;
}

export interface EvalInputs {
  assumptions: Assumptions;
  /** a route you chose, by tile id */
  routes: Record<string, RouteOverride0>;
}

export const defaultEvalInputs = (): EvalInputs => ({ assumptions: DEFAULT_ASSUMPTIONS, routes: {} });

export interface TileEvaluation {
  tileId: string;
  results: MatrixResult[];
  /** older measurements kept beside the twelve as legacy readings (the earlier Spatial density formula): never relabelled as the current criterion */
  legacyMeasurements: DescriptorResult[];
  usable: UsableSpace;
  assumptions: Assumptions;
}

type Part = { measure: MatrixMeasure; interpretation: Omit<MatrixInterpretation, "generated">; evidence: Evidence };

const unavailable = (headline: string, method: string, cannot: string, why: string): Part => ({
  measure: { headline, value: null, unit: "", status: "unavailable", method, cannot, supporting: [], used: [] },
  interpretation: { text: why },
  evidence: {},
});

interface Ctx {
  tile: ParsedTile;
  f: VoxelFacts | null;
  m: Measures | null;
  a: Assumptions;
  over: RouteOverride0 | undefined;
  legacy: Map<string, DescriptorResult>;
  /** the earlier Spatial density (cross-section area) for this tile: a legacy measurement shown beside the current criterion, never in place of it */
  legacyDensity?: DescriptorResult;
}

const cell2 = (f: VoxelFacts) => f.cell * f.cell;

// ---- Carved --------------------------------------------------------------------------------------------------------------------------------

function carved(c: Ctx): Part {
  const method = "Counts the separate carved spaces in the tile and reads how hollow it is. A space is a body of void (cells joined face to face); a pocket under 20 ft³ is a speck of erosion and is not a space. The tile's own room analysis (chambers joined by narrower passages) is counted too, and the larger of the two counts is used. Hollowness is the void as a share of the container's cells. The share of the void's surface that is eroded foam rather than inserted plates or branches is given beside it, no longer the headline.";
  const cannot = "How the building would be made. The files have no panel or joint model, so a surface that reads as one carved face is not shown to be seamless construction. Mesh triangles and voxel steps are not treated as panels or seams.";
  const f = c.f;
  if (!f || !f.voidCells) return unavailable("not assessable", method, cannot, "The tile has no voxel void to read a surface from.");
  const vc = voidComponents(f);
  const rooms = (c.m?.rooms ?? []).filter((r) => r.volume_ft3 >= SPECK_FT3).length;
  const spaces = Math.max(vc.sizes.length, rooms, 1);
  const voidShare = (100 * f.voidCells) / f.inside;
  const largest = vc.cells ? (100 * vc.sizes[0]) / vc.cells : 100;
  const s = surfaceStats(f);
  const foam = s.wallFoam + s.floorFoam + s.ceilFoam;
  const total = foam + s.wallPlate + s.floorPlate + s.ceilPlate + s.wallStrut + s.floorStrut + s.ceilStrut;
  const eroded = total ? (100 * foam) / total : null;
  let idx = voidShare < 30 ? 0 : voidShare < 45 ? 1 : voidShare < 60 ? 2 : 3;
  if (spaces >= 4 && idx < 3) idx++;
  return {
    measure: {
      headline: `${count(spaces, "carved space")}; the void is ${num(voidShare, 0)}% of the block`,
      value: voidShare,
      unit: `% of the container that is carved void (${count(spaces, "separate space")} counted)`,
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Separate spaces", value: `${vc.sizes.length} joined body${vc.sizes.length === 1 ? "" : "ies"} of void, ${count(rooms, "chamber")} by the room analysis`, how: "bodies of void of at least 20 ft³, and chambers the room analysis found" },
        { label: "Void in the block", value: `${num(voidShare, 1)}% (${ft3(f.voidCells * f.cell ** 3)})`, how: f.shaped ? "of the container's cells (its notch is not counted)" : "of the container's cells" },
        { label: "Largest space", value: `${num(largest, 0)}% of the void`, how: "the biggest body of void over all void in spaces" },
        { label: "Specks", value: `${vc.specks} under 20 ft³`, how: "pockets of void too small to be a space" },
        { label: "Against eroded foam", value: eroded === null ? "n/a" : `${num(eroded, 0)}% of the void's surface`, how: "faces of void against eroded foam rather than a plate or branch" },
      ],
      used: [`a space is at least ${ft3(SPECK_FT3)}`],
    },
    interpretation: {
      text: `${cap(count(spaces, "carved space"))}, and ${num(voidShare, 0)}% of the container is void, so the tile reads as ${voidShare < 30 ? "mostly solid with carved pockets" : voidShare < 45 ? "a solid mass hollowed in places" : voidShare < 60 ? "a hollowed mass" : "a cavernous mass"}${spaces > 1 ? `; the largest space holds ${num(largest, 0)}% of the void` : ""}. This describes geometry, not whether it could be built without seams.`,
      scale: ["solid", "pocketed", "hollowed", "cavernous"],
      index: idx,
    },
    evidence: { rooms: c.m?.rooms.slice(0, 3).map((r) => r.id) },
  };
}

// ---- Stepped / Terraced ----------------------------------------------------------------------------------------------------------------------

interface Setbacks {
  inward: number;
  outward: number;
  segments: number;
  axis: "x" | "y";
}

/** Successive setbacks of the extent of `present` cells along a horizontal axis, going up. Layers whose extent differs by less than 1 ft are one segment (voxel stepping is not a setback); a segment must hold `riseFt`; a step must be at least `runFt`. */
function setbacks(f: VoxelFacts, present: (x: number, y: number, z: number) => boolean, axis: "x" | "y", runFt: number, riseFt: number): Setbacks {
  const run = Math.max(1, Math.round(runFt / f.cell));
  const rise = Math.max(1, Math.round(riseFt / f.cell));
  const tol = Math.max(1, Math.round(1 / f.cell));
  const minCells = Math.max(2, Math.round(4 / (f.cell * f.cell)));
  type L = { z: number; lo: number; hi: number };
  const layers: L[] = [];
  for (let z = 0; z < f.nz; z++) {
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    for (let x = 0; x < f.nx; x++) for (let y = 0; y < f.ny; y++) if (present(x, y, z)) {
      const p = axis === "x" ? x : y;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      n++;
    }
    if (n >= minCells) layers.push({ z, lo, hi });
  }
  const segs: { z0: number; z1: number; lo: number; hi: number }[] = [];
  for (const l of layers) {
    const last = segs[segs.length - 1];
    if (last && l.z - last.z1 <= 2 && Math.abs(l.lo - last.lo) < tol && Math.abs(l.hi - last.hi) < tol) last.z1 = l.z;
    else segs.push({ z0: l.z, z1: l.z, lo: l.lo, hi: l.hi });
  }
  const held = segs.filter((s) => s.z1 - s.z0 + 1 >= rise);
  let inward = 0;
  let outward = 0;
  for (let i = 1; i < held.length; i++) {
    const dlo = held[i].lo - held[i - 1].lo;
    const dhi = held[i].hi - held[i - 1].hi;
    if (Math.abs(dlo) < run && Math.abs(dhi) < run) continue;
    // narrowing going up: the low edge moves in or the high edge moves in
    const narrows = dlo >= run || -dhi >= run;
    const widens = -dlo >= run || dhi >= run;
    if (narrows && !widens) inward++;
    else if (widens && !narrows) outward++;
    else {
      inward++;
      outward++;
    }
  }
  return { inward, outward, segments: held.length, axis };
}

function stepped(c: Ctx): Part {
  const method = "The count of steps is the most of four readings. On the void's section: for each layer of the tile, how far the void reaches along each horizontal axis; layers whose reach differs by less than 1 ft are one stage (voxel stair-stepping is not a setback), a stage must hold the height set below, and a step must move the edge at least the run set below. The count is of steps in the direction that repeats most, on the better axis; it is divided by the height of the container in units of 10 ft.";
  const cannot = "Whether the steps read as terraces to someone standing in the space; and nothing about the outside of the building, which this tile alone does not have (the container's own setbacks are reported separately).";
  const f = c.f;
  if (!f || !f.voidCells) return unavailable("not assessable", method, cannot, "The tile has no voxel void to take a section from.");
  const run = c.a.setbackRunFt;
  const rise = c.a.setbackRiseFt;
  const isVoid = (x: number, y: number, z: number) => f.cls[(x * f.ny + y) * f.nz + z] === VOID;
  const sx = setbacks(f, isVoid, "x", run, rise);
  const sy = setbacks(f, isVoid, "y", run, rise);
  const best = (s: Setbacks) => Math.max(s.inward, s.outward);
  const pick = best(sx) >= best(sy) ? sx : sy;
  const dir = pick.inward >= pick.outward ? "inward" : "outward";
  // terraces: successive floor levels, each at least the set rise above the last, whose floor edge also steps by the set run
  const levels = (c.m?.levels ?? []).filter((l) => l.area_ft2 >= 8).slice().sort((p, q) => p.z_ft - q.z_ft);
  const floorExtent = (l: (typeof levels)[number], axis: "x" | "y") => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < f.nx; x++)
      for (let y = 0; y < f.ny; y++)
        for (let z = Math.max(1, l.layers[0]); z <= Math.min(f.nz - 1, l.layers[1]); z++) {
          const i = (x * f.ny + y) * f.nz + z;
          if (f.cls[i] === VOID && f.cls[i - 1] === SOLID) {
            const p = axis === "x" ? x : y;
            if (p < lo) lo = p;
            if (p > hi) hi = p;
            break;
          }
        }
    return [lo, hi] as const;
  };
  const runCells = Math.max(1, Math.round(run / f.cell));
  const terraceSteps = (axis: "x" | "y") => {
    let steps = 0;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i].z_ft - levels[i - 1].z_ft < rise) continue;
      const [alo, ahi] = floorExtent(levels[i - 1], axis);
      const [blo, bhi] = floorExtent(levels[i], axis);
      if (Math.abs(blo - alo) >= runCells || Math.abs(bhi - ahi) >= runCells) steps++;
    }
    return steps;
  };
  const terraces = Math.max(terraceSteps("x"), terraceSteps("y"));
  const nVoid = best(pick);
  // the floor itself: the treads and risers of a stair, terrace or cascade (read on the floor surface, walkable or not), and floors that step up level by level
  const tf = treadFacts(f);
  const lvl = levelFacts(f, c.a.groundToleranceFt);
  const levelSteps = Math.max(0, lvl.levels.length - 1);
  // floor plates standing at different heights (a cascade of retained floors): each height above the ground slab is a step up
  const plateSteps = Math.max(0, plateHeights(plateFacts(f)) - 1);
  const n = Math.max(nVoid, terraces, tf.risers, levelSteps, plateSteps);
  // the container's own outline (an L or a stepped section): the same count on the occupied cells
  const inside = (x: number, y: number, z: number) => f.cls[(x * f.ny + y) * f.nz + z] !== OUT;
  const ex = setbacks(f, inside, "x", run, rise);
  const ey = setbacks(f, inside, "y", run, rise);
  const env = Math.max(best(ex), best(ey));
  let zlo = f.nz;
  let zhi = -1;
  for (let x = 0; x < f.nx; x++) for (let y = 0; y < f.ny; y++) for (let z = 0; z < f.nz; z++) if (f.cls[(x * f.ny + y) * f.nz + z] !== OUT) {
    if (z < zlo) zlo = z;
    if (z > zhi) zhi = z;
  }
  const heightFt = Math.max(f.cell, (zhi - zlo + 1) * f.cell);
  const per10 = (n / heightFt) * 10;
  const idx = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3;
  return {
    measure: {
      headline: `${count(n, "step")} up the section in ${ft(heightFt)} of height${tf.treads ? ` (${count(tf.treads, "tread")}, ${count(tf.risers, "riser")})` : ""}`,
      value: per10,
      unit: `steps per 10 ft of height (${n} in all: the most of the void's setbacks, terraces of floors, risers of the floor and stepped levels)`,
      status: "measured",
      method: `${method} Run ≥ ${ft(run, 1)}, held ≥ ${ft(rise, 1)}.`,
      cannot,
      supporting: [
        { label: "Steps of the void's section", value: `${pick.axis.toUpperCase()}: ${pick.inward} inward, ${pick.outward} outward`, how: "steps of the void's reach going up, on the better axis" },
        { label: "Treads and risers", value: `${tf.treads} treads, ${tf.risers} risers${tf.spanFt ? ` over ${ft(tf.spanFt, 1)}` : ""}`, how: "flat stretches of floor of at least 4 ft² that a step of 1 to 8 ft in the floor joins, read on the floor surface (walkable or not: a seat is a tread)" },
        { label: "Plates at different heights", value: String(plateSteps), how: "heights the floor plates' top surfaces stand at above the ground slab (within 1 ft is one)" },
        { label: "Walkable levels", value: String(lvl.levels.length), how: "heights of walkable floor, within 3 ft of each other counted as one; each step up between them is a step" },
        { label: "Terraces", value: String(terraces), how: "successive floors at least the set rise apart whose floor edge also steps by the set run" },
        { label: "Stages held", value: String(pick.segments), how: "stretches of height with the same reach" },
        { label: "Container setbacks", value: String(env), how: "the same count on the container's own outline (0 for a plain box)" },
        { label: "Height", value: ft(heightFt), how: "from the lowest to the highest cell of the container" },
      ],
      used: [`smallest setback ${ft(run, 1)}`, `must hold ${ft(rise, 1)}`],
    },
    interpretation: {
      text: n === 0 ? `Neither the void's section nor the floor steps: its reach along either axis stays within 1 ft over the height of the tile, there is no riser of 1 ft or more in the floor, and no floor sits a full ${ft(rise, 1)} above another.` : `${cap(count(n, "step"))} over ${ft(heightFt)}, ${num(per10, 1)} per 10 ft of height (${[nVoid ? `the void's section steps ${dir}` : "", tf.risers ? `${count(tf.treads, "tread")} joined by ${count(tf.risers, "riser")}` : "", levelSteps ? `${count(lvl.levels.length, "walkable level")}` : "", terraces ? `${count(terraces, "terrace")} of floors` : ""].filter(Boolean).join("; ")}).`,
      scale: ["no steps", "a step or two", "stepped", "terraced"],
      index: idx,
    },
    evidence: { levels: c.m?.levels.map((l) => l.id) },
  };
}

// ---- Porous ----------------------------------------------------------------------------------------------------------------------------------

function porous(c: Ctx): Part {
  const method = "Evaluated boundary: the vertical faces of the void (its walls). Openings are wall faces of void with air beyond (through the container); solid wall is every other wall face. The share is openings / (openings + solid wall). Wall area of rough eroded surface is scaled by the ratio of the smoothed void mesh to the blocky voxel surface the engine measured, so a staircase of voxels does not count as extra wall. Floors, ceilings and roof openings are not walls and are left out here (roof openings belong to Light-filled). Bridges (plates that span open space) are listed separately, not added, so nothing is counted twice.";
  const cannot = "How permeable the space looks from where a person stands: it does not trace lines of sight, and it does not know what is in an opening (glazing, screens).";
  const f = c.f;
  if (!f || !f.voidCells) return unavailable("not assessable", method, cannot, "The tile has no voxel void to read walls from.");
  const s = surfaceStats(f);
  const wallSolid = s.wallFoam + s.wallPlate + s.wallStrut;
  const m = c.tile.metrics;
  const ratio = m.void_mesh_area_ft2 && m.voxel_wall_area_ft2 ? Math.min(1, m.void_mesh_area_ft2 / m.voxel_wall_area_ft2) : 1;
  const solidFt2 = wallSolid * cell2(f) * ratio;
  const openFt2 = s.wallOpen * cell2(f);
  const total = solidFt2 + openFt2;
  if (total <= 0) return unavailable("not assessable", method, cannot, "The void has no wall.");
  const share = (100 * openFt2) / total;
  // bridges: plates with void clear above and below them (free-spanning floors)
  const bridges = (c.tile.structure?.plates ?? []).filter((p) => (p.clear_above_ft?.mean ?? 0) >= 3 && (p.clear_below_ft?.mean ?? 0) >= 3);
  // cross-level visibility: columns where open void runs at least 10 ft up
  const need = Math.round(10 / f.cell);
  let tallCols = 0;
  for (let x = 0; x < f.nx; x++)
    for (let y = 0; y < f.ny; y++) {
      let run = 0;
      let hit = false;
      for (let z = 0; z < f.nz && !hit; z++) {
        if (f.cls[(x * f.ny + y) * f.nz + z] === VOID) run++;
        else run = 0;
        if (run >= need) hit = true;
      }
      if (hit) tallCols++;
    }
  const tallFt2 = tallCols * cell2(f);
  const idx = share < 5 ? 0 : share < 15 ? 1 : share < 30 ? 2 : 3;
  return {
    measure: {
      headline: `${num(share, 0)}% of the void's wall area is open`,
      value: share,
      unit: "% of void wall area that is opening",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Openings", value: ft2(openFt2), how: "wall faces of void with air beyond" },
        { label: "Solid wall", value: ft2(solidFt2), how: ratio < 1 ? `wall faces against material, scaled ×${num(ratio, 2)} to the smooth surface` : "wall faces against material" },
        { label: "Bridges", value: bridges.length ? `${bridges.length} plate${bridges.length === 1 ? "" : "s"}, ${ft2(bridges.reduce((a, p) => a + p.area_ft2, 0))}` : "none", how: "plates with 3 ft or more of void both above and below (listed, not added)" },
        { label: "Void open across levels", value: tallFt2 ? ft2(tallFt2) : "none", how: "plan area where void runs 10 ft or more up: a view across levels" },
      ],
      used: [],
    },
    interpretation: {
      text: `${num(share, 0)}% of the void's wall area is open to the air (${ft2(openFt2)} against ${ft2(solidFt2)} of solid wall)${tallFt2 ? `; ${ft2(tallFt2)} of plan has void open 10 ft or more upward, so the levels can see each other` : "; no void is open for 10 ft or more upward, so the levels do not look onto each other"}.`,
      scale: ["sealed", "perforated", "porous", "open frame"],
      index: idx,
    },
    evidence: { rooms: c.m?.spaces.graph.access_rooms },
  };
}

// ---- Continuous ------------------------------------------------------------------------------------------------------------------------------

/** What the surface is made of at a point on a route: the floor underfoot and the walls to each side at standing height. */
function materialChanges(f: VoxelFacts, points: [number, number, number][]): { changes: number; per10m: number; lengthM: number } {
  const kind = (i: number): number => (f.plates && f.plates[i] ? 2 : f.struts && f.struts[i] ? 3 : 1);
  const chans: number[][] = [[], [], []];
  const back = Math.max(2, Math.round(2 / f.cell));
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const cx = Math.floor(p[0] / f.cell);
    const cy = Math.floor(p[1] / f.cell);
    const cz = Math.floor(p[2] / f.cell);
    const below = cz > 0 ? (cx * f.ny + cy) * f.nz + cz - 1 : -1;
    chans[0].push(below >= 0 && f.cls[below] === SOLID ? kind(below) : 0);
    const a = points[Math.max(0, i - back)];
    const b = points[Math.min(points.length - 1, i + back)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty);
    if (tl < f.cell) {
      chans[1].push(chans[1][chans[1].length - 1] ?? 0);
      chans[2].push(chans[2][chans[2].length - 1] ?? 0);
      continue;
    }
    tx /= tl;
    ty /= tl;
    const z = Math.min(f.nz - 1, cz + Math.round(4 / f.cell) - 1);
    [1, -1].forEach((sign, ch) => {
      let found = 0;
      for (let d = 0.5; d < 40 && !found; d += 0.5) {
        const X = Math.floor((p[0] - sign * ty * d * f.cell) / f.cell);
        const Y = Math.floor((p[1] + sign * tx * d * f.cell) / f.cell);
        if (X < 0 || Y < 0 || X >= f.nx || Y >= f.ny) break;
        const j = (X * f.ny + Y) * f.nz + z;
        if (f.cls[j] === SOLID) found = kind(j);
      }
      chans[1 + ch].push(found);
    });
  }
  // runs shorter than 1 ft are noise; a change is a switch between kinds of material
  const minRun = Math.max(1, Math.round(1 / f.cell));
  let changes = 0;
  for (const ch of chans) {
    const runs: number[] = [];
    let cur = ch[0] ?? 0;
    let len = 0;
    for (const v of ch) {
      if (v === cur) len++;
      else {
        if (len >= minRun && cur !== 0) runs.push(cur);
        cur = v;
        len = 1;
      }
    }
    if (len >= minRun && cur !== 0) runs.push(cur);
    for (let i = 1; i < runs.length; i++) if (runs[i] !== runs[i - 1]) changes++;
  }
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  const lengthM = len * 0.3048;
  const traversed = lengthM * 3;
  return { changes, lengthM, per10m: traversed > 0 ? (changes / traversed) * 10 : 0 };
}

function continuous(c: Ctx): Part {
  const method = "Reads how continuous the space of the tile is. First, the share of the void that is one connected body (cells joined face to face; specks under 20 ft³ are left out). Second, the share of the walkable floor that is one surface (a person can step from any part of it to any other under the shared walking rules). The measure is the mean of the two. The tile's room analysis (chambers, the passages between them, loops) is given beside it. The older count of material changes along a route (a proxy for seams) is kept below as a supporting line.";
  const cannot = "That the space is seamless in construction, or that it feels continuous to a person: it reads the connectivity of the geometry only.";
  const f = c.f;
  if (!f || !f.voidCells) return unavailable("not assessable", method, cannot, "The tile has no voxel void to read.");
  const vc = voidComponents(f);
  const w = walkFacts(f);
  const mainVoid = vc.cells ? (100 * vc.sizes[0]) / vc.cells : 0;
  const hasWalk = w.zones.length > 0;
  const mainWalk = 100 * w.mainShare;
  const value = hasWalk ? (mainVoid + mainWalk) / 2 : mainVoid;
  const idx = value >= 90 ? 3 : value >= 70 ? 2 : value >= 45 ? 1 : 0;
  const g = c.m?.spaces.graph;
  const rr = findRoute(f, { from: c.over?.from, to: c.over?.to, destination: "farthest" });
  const mc = rr.route ? materialChanges(f, rr.route.points) : null;
  return {
    measure: {
      headline: `${num(mainVoid, 0)}% of the void is one connected space${hasWalk ? `; ${num(mainWalk, 0)}% of the walkable floor is one surface` : "; no walkable floor"}`,
      value,
      unit: "% continuity of space (mean of connected void and connected walkable floor)",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Connected void", value: `${num(mainVoid, 0)}% in the largest of ${count(vc.sizes.length, "space")}`, how: "the biggest body of void over all void in spaces" },
        { label: "Walkable floor", value: hasWalk ? `${num(mainWalk, 0)}% in one of ${count(w.zones.length, "surface")}` : "none", how: "the biggest stand-able floor over all of it, under the walking rules" },
        ...(g ? [{ label: "Rooms", value: `${g.rooms} rooms, ${g.connections} connections, ${g.loops} loops${g.neck_ft.min !== null ? `, narrowest passage ${ft(g.neck_ft.min, 1)}` : ""}`, how: "the tile's room analysis" }] : []),
        ...(mc ? [{ label: "Seam proxy", value: `${num(mc.per10m, 1)} material changes per 10 m`, how: "foam to plate or branch along a floor-supported route (the earlier measure, kept as a supporting line)" }] : []),
      ],
      used: [walkUsed()],
    },
    interpretation: {
      text: `${num(mainVoid, 0)}% of the void is one connected body${vc.sizes.length > 1 ? ` (of ${count(vc.sizes.length, "separate space")})` : ""}${hasWalk ? ` and ${num(mainWalk, 0)}% of the walkable floor is one surface (${count(w.zones.length, "walkable floor")})` : ", with no walkable floor to join"}, so the space reads as ${idx >= 3 ? "continuous" : idx === 2 ? "mostly continuous" : idx === 1 ? "interrupted" : "broken up"}.`,
      scale: ["broken up", "interrupted", "mostly continuous", "continuous"],
      index: idx,
    },
    evidence: rr.route ? { routePoints: rr.route.points } : {},
  };
}

// ---- Retained / Resistant -------------------------------------------------------------------------------------------------------------------

function resistant(c: Ctx): Part {
  const method = "The retained element is the protected solid the recipe set: the floor plates (the engine's plates) and the support branches grown to hold them. They resist the erosion; all other foam is eroded and is not called retained. The ground slab is the foundation the tile stands on and is reported separately, not counted as a retained floor. Read: how many floor plates remain, their plan area against the container's footprint (a measure of floors' worth), how much of their designed thickness survived, and how they were set to resist (the recipe's resistance).";
  const cannot = "Whether the retained element reads as resisting the erosion: that depends on how it meets the void and how it is seen.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const pf = plateFacts(f);
  const info = new Map((c.tile.structure?.plates ?? []).map((p) => [p.id, p]));
  let strutCells = 0;
  let plateCells = 0;
  for (let i = 0; i < f.cls.length; i++) {
    if (f.cls[i] !== SOLID) continue;
    if (f.plates && f.plates[i]) plateCells++;
    if (f.struts && f.struts[i]) strutCells++;
  }
  if (!pf.length && !plateCells && !strutCells) {
    return {
      measure: { headline: "no retained element identified", value: null, unit: "", status: "unavailable", method, cannot, supporting: [{ label: "Foam", value: ft3((f.inside - f.voidCells) * f.cell ** 3), how: "all material, not called retained" }], used: [] },
      interpretation: { text: "This tile has no protected floor plates or support branches, so no element is identified as the one that resists the erosion. The remaining foam is what erosion left, not something retained; nothing is scored." },
      evidence: {},
    };
  }
  // the ground slab is the plate that reaches the bottom of the tile; the others are the retained floors
  const ground = pf.filter((p) => p.ground);
  const floors = pf.filter((p) => !p.ground);
  const nameOf = (p: (typeof pf)[number]) => info.get(p.id)?.name ?? `plate ${p.id}`;
  const floorArea = floors.reduce((a, p) => a + p.areaFt2, 0);
  const worth = f.footprintFt2 ? (100 * floorArea) / f.footprintFt2 : 0;
  const designed = (id: number) => (info.get(id) as { designed_thickness_ft?: number } | undefined)?.designed_thickness_ft ?? 0;
  const thick = floors.filter((p) => designed(p.id) > 0 && info.get(p.id));
  const survival = thick.length ? (100 * thick.reduce((a, p) => a + Math.min(1, info.get(p.id)!.thickness_ft / designed(p.id)), 0)) / thick.length : null;
  const volShare = (100 * (plateCells + strutCells)) / f.inside;
  const idx = worth < 15 ? 0 : worth < 40 ? 1 : worth < 80 ? 2 : 3;
  const res = c.m?.plateResistance ?? null;
  return {
    measure: {
      headline: floors.length ? `${count(floors.length, "retained floor plate")}, ${ft2(floorArea)} (${num(worth, 0)}% of the plan), besides the ground slab` : "no retained floor plate besides the ground slab",
      value: worth,
      unit: "% of the container's footprint covered by retained floor plates (the ground slab excluded)",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Floor plates", value: floors.length ? floors.map((p) => `${nameOf(p)} ${ft2(p.areaFt2)} at ${ft(p.topFt, 1)}`).join("; ") : "none", how: "the engine's protected plates other than the ground slab" },
        { label: "Ground slab", value: ground.length ? ground.map((p) => `${ft2(p.areaFt2)}, ${ft(p.zMaxFt - p.zMinFt, 1)} thick`).join("; ") : "none identified", how: "the foundation, not counted as a retained floor" },
        { label: "Survived", value: survival === null ? "n/a" : `${num(survival, 0)}% of designed thickness`, how: "built thickness of the floor plates over what the recipe designed" },
        { label: "Resistance set", value: res === null ? "n/a" : `${num(res, 2)} (1 = like the foam)`, how: "the recipe's plate resistance to the solvent" },
        { label: "Volume", value: `${num(volShare, 1)}% (${ft3((plateCells + strutCells) * f.cell ** 3)})`, how: "plate and branch cells over the container's cells, ground slab included" },
        { label: "Branches", value: ft3(strutCells * f.cell ** 3), how: "support branches grown to hold the plates" },
        { label: "Container", value: `${ft3(f.containerFt3)} over ${ft2(f.footprintFt2)}`, how: f.shaped ? "an L or stepped container: its notch is not counted" : "the whole block" },
      ],
      used: [],
    },
    interpretation: {
      text: floors.length ? `${cap(count(floors.length, "retained floor plate"))} stand${floors.length === 1 ? "s" : ""} in the eroded mass, ${ft2(floorArea)} in all, about ${num(worth / 100, 1)} floors' worth of the plan${survival !== null && survival < 85 ? `; the plates survived at ${num(survival, 0)}% of their designed thickness` : ""}. Everything else is eroded foam.` : "No floor plate is retained besides the ground slab: the floors, where there are any, are shaped by the erosion itself.",
      scale: ["slight", "present", "clear", "dominant"],
      index: idx,
    },
    evidence: { levels: c.m?.levels.filter((l) => l.plate_ids.length).map((l) => l.id) },
  };
}

// ---- Threaded ---------------------------------------------------------------------------------------------------------------------------------

function threaded(c: Ctx): Part {
  const method = "Counts the spaces a person can walk to above the ground floor. A space is a stretch of walkable floor (the shared walking rules) that sits on a level more than the ground tolerance above the lowest walkable floor and is a floor of its own (a flat stretch of at least the smallest space, joined or not to the ground floor). Levels are the heights of walkable floor, within 3 ft of each other counted as one. Each space is a program instance of the tile's own category, public if that category is on the list set below (a stand-in: the files carry no program for individual rooms). The earlier count, rooms from the room analysis whose lowest floor is above ground, is the fallback where there is no walkable floor.";
  const cannot = "What actually happens in a space: the matrix counts public program, and the tile's category is only a label for it.";
  const f = c.f;
  const m = c.m;
  if (!f && !m) return unavailable("not assessable", method, cannot, "The tile has no spaces to count.");
  const cat = c.tile.meta?.category ?? c.tile.guessed.category;
  const perRoom = (c.tile.meta as { roomCategory?: Record<string, string> } | undefined)?.roomCategory;
  const lv = f ? levelFacts(f, c.a.groundToleranceFt) : null;
  // the program of a space: the category of the room it is in (an assembly keeps each room's own tile category), else the tile's; public by the list below or by hand
  const isPublic = (cell: number): boolean => {
    const room = f?.rooms ? f.rooms[cell] : 0;
    const o = room ? c.a.roomClass[`${c.tile.id}:${room}`] : undefined;
    if (o) return o === "public";
    const k = (room ? perRoom?.[String(room)] : undefined) ?? cat;
    return !!k && c.a.publicCategories.includes(k);
  };
  const walk = !!lv && lv.levels.length > 0;
  let aboveN = 0;
  let levelsN = 0;
  let groundFt = 0;
  const totalRooms = (m?.rooms ?? []).filter((r) => r.floor_area_ft2 >= 4).length;
  let roomsAbove: number[] = [];
  if (walk && lv) {
    aboveN = lv.above.length;
    levelsN = lv.levels.length;
    groundFt = lv.groundFt;
  } else if (m) {
    const levels = m.levels;
    if (!levels.length) return unavailable("not assessable", method, cannot, "The tile has no walkable floor and no floor level, so nothing is above or below ground.");
    groundFt = Math.min(...levels.map((l) => l.z_ft));
    const above = m.rooms.filter((r) => r.floor_z_ft.min !== null && r.floor_z_ft.min > groundFt + c.a.groundToleranceFt && r.floor_area_ft2 >= 4);
    aboveN = above.length;
    roomsAbove = above.map((r) => r.id);
    levelsN = levels.length;
  }
  const publicN = walk && lv ? lv.above.filter((s) => isPublic(s.cell)).length : aboveN && cat && c.a.publicCategories.includes(cat) ? aboveN : 0;
  const idx = aboveN === 0 ? 0 : aboveN === 1 ? 1 : aboveN <= 3 ? 2 : 3;
  const levelIds = (m?.levels ?? []).filter((l) => l.z_ft > groundFt + c.a.groundToleranceFt).map((l) => l.id);
  return {
    measure: {
      headline: `${count(aboveN, "walkable space")} above the ground floor, on ${count(levelsN, "level")} (${count(totalRooms, "room")} in all)`,
      value: aboveN,
      unit: "walkable spaces above the ground floor",
      status: "inferred",
      method,
      cannot,
      supporting: [
        { label: "Ground floor", value: `${ft(groundFt, 1)} (floors within ${ft(c.a.groundToleranceFt, 1)} of it count as ground)`, how: "the lowest walkable floor of the tile" },
        { label: "Levels", value: walk && lv ? lv.levels.map((l) => `${ft(l.zFt, 1)} (${ft2(l.areaFt2)})`).join(", ") : "from the room analysis", how: "heights of walkable floor, within 3 ft of each other counted as one" },
        { label: "Public program", value: `${publicN} of ${aboveN} spaces above ground${perRoom ? " (each room's own tile category)" : cat ? ` (${cat} category)` : " (no category: not assumed public)"}`, how: "a space is public if its category is on the list below, or you set it by hand" },
        { label: "Public categories", value: c.a.publicCategories.join(", ") || "none", how: "the assumption: these programs are public" },
      ],
      used: [`public = ${c.a.publicCategories.join(", ") || "none"}`, `ground tolerance ${ft(c.a.groundToleranceFt, 1)}`],
    },
    interpretation: {
      text: aboveN ? `${cap(count(aboveN, "walkable space"))} ${aboveN === 1 ? "sits" : "sit"} above the ground floor, on ${count(levelsN, "level")} in all; ${publicN} of them read as public program${cat || perRoom ? " by the category label" : " (the tile has no program category)"}. Program is that label, not something drawn into each space.` : "Every walkable floor is at the ground level, so program is met at the entry level only.",
      scale: ["at entry only", "one above", "several above", "threaded"],
      index: idx,
    },
    evidence: roomsAbove.length ? { rooms: roomsAbove } : { levels: levelIds },
  };
}

// ---- Graduated --------------------------------------------------------------------------------------------------------------------------------

/** Enclosure at a point: 0 open to the sky, 1 partly open, 2 enclosed. */
function enclosureAt(f: VoxelFacts, p: [number, number, number], a: Assumptions): number {
  const x0 = p[0] / f.cell;
  const y0 = p[1] / f.cell;
  const z0 = p[2] / f.cell + 3;
  const exits = (dx: number, dy: number, dz: number, reach: number) => {
    for (let t = 1; t <= reach; t++) {
      const X = Math.floor(x0 + dx * t);
      const Y = Math.floor(y0 + dy * t);
      const Z = Math.floor(z0 + dz * t);
      const k = classAt(f, X, Y, Z);
      if (k === SOLID) return false;
      if (k === OUT) return true;
    }
    return false;
  };
  const up = Math.round(60 / f.cell);
  let sky = exits(0, 0, 1, up) ? 1 : 0;
  const tilt = Math.tan((35 * Math.PI) / 180);
  for (let k = 0; k < 8; k++) sky += exits(Math.cos((k * Math.PI) / 4) * tilt, Math.sin((k * Math.PI) / 4) * tilt, 1, up) ? 1 : 0;
  const skyShare = sky / 9;
  let side = 0;
  for (let k = 0; k < 12; k++) side += exits(Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6), 0, Math.round(30 / f.cell)) ? 1 : 0;
  const sideShare = side / 12;
  if (skyShare >= a.openSky) return 0;
  if (skyShare >= a.semiSky || sideShare >= 0.25) return 1;
  return 2;
}

function graduated(c: Ctx): Part {
  const method = "Enclosure is classed at standing places spread over the whole walkable floor (one about every 3 ft): open to the sky (half or more of nine upward rays leave through open air), partly open (some sky, or a quarter or more of twelve horizontal rays reach the outside), or enclosed. The places are ordered by their distance from the ground-level entries (2 ft bands, each given its commonest class) and the changes of class along that order are counted: how many steps of enclosure a person passes through going from the way in to the farthest part, over the whole floor and not one route. A band that differs from both its neighbours, which agree with each other, takes their class.";
  const cannot = "Which zones are private and which public: that needs program information, and enclosure here is geometric. It orders places by straight-line distance from the entries, which is not the length of the way a person walks.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const w = walkFacts(f);
  if (!w.zones.length) return unavailable("not assessable", method, cannot, "No floor that a person can stand on was found, so enclosure has no standing places to be read at.");
  const entries = groundEntries(f, w.stand, false);
  if (!entries.length) return unavailable("not assessable", method, cannot, "No opening at ground level has a floor to stand on, so there is no entry to read enclosure outward from.");
  const stride = Math.max(1, Math.round(3 / f.cell));
  const entryAt = entries.map((e) => {
    const z = e % f.nz;
    const y = ((e - z) / f.nz) % f.ny;
    return [((e - z) / f.nz - y) / f.ny, y, z] as const;
  });
  const samples: { d: number; cls: number }[] = [];
  for (let i = 0; i < w.stand.length; i++) {
    if (!w.stand[i]) continue;
    const z = i % f.nz;
    const y = ((i - z) / f.nz) % f.ny;
    const x = ((i - z) / f.nz - y) / f.ny;
    if (x % stride !== 0 || y % stride !== 0) continue;
    let near = Infinity;
    for (const [ex, ey, ez] of entryAt) near = Math.min(near, (x - ex) ** 2 + (y - ey) ** 2 + (z - ez) ** 2);
    samples.push({ d: Math.sqrt(near) * f.cell, cls: enclosureAt(f, [x * f.cell, y * f.cell, z * f.cell], c.a) });
  }
  if (!samples.length) return unavailable("not assessable", method, cannot, "No standing place could be read.");
  const band = 2;
  const bins = new Map<number, number[]>();
  for (const s of samples) {
    const b = Math.floor(s.d / band);
    (bins.get(b) ?? bins.set(b, [0, 0, 0]).get(b)!)[s.cls]++;
  }
  const order = [...bins.keys()].sort((a, b) => a - b);
  // each band takes its commonest class; a band that differs from both neighbours (which agree) is noise and takes theirs
  const seq = order.map((q) => {
    const h = bins.get(q)!;
    return h[2] >= h[0] && h[2] >= h[1] ? 2 : h[1] >= h[0] ? 1 : 0;
  });
  const smooth = seq.map((v, i) => (i > 0 && i < seq.length - 1 && seq[i - 1] === seq[i + 1] && seq[i - 1] !== v ? seq[i - 1] : v));
  const runs: { v: number; n: number }[] = [];
  for (const v of smooth) {
    const last = runs[runs.length - 1];
    if (last && last.v === v) last.n++;
    else runs.push({ v, n: 1 });
  }
  const steps = Math.max(0, runs.length - 1);
  const share = [0, 0, 0];
  for (const s of samples) share[s.cls]++;
  const NAMES = ["open to the sky", "partly open", "enclosed"];
  const present = share.filter((v) => v > 0).length;
  const far = order.length ? order[order.length - 1] * band : 0;
  const idx = steps === 0 ? 0 : steps === 1 ? 1 : steps <= 3 ? 2 : 3;
  const rr = findRoute(f, { from: c.over?.from, to: c.over?.to, destination: "farthest" });
  return {
    measure: {
      headline: `${count(steps, "enclosure step")} from the way in to ${far ? `${ft(far)} out` : "the far end"}, ${present} kind${present === 1 ? "" : "s"} of enclosure`,
      value: steps,
      unit: "discrete enclosure steps from the entries outward, over the whole walkable floor",
      status: "proxy",
      method,
      cannot,
      supporting: [
        { label: "Sequence", value: runs.map((r) => NAMES[r.v]).join(" → ") || NAMES[2], how: "enclosure classes by distance from the entries" },
        { label: "Mix of places", value: share.map((v, i) => `${num((100 * v) / samples.length, 0)}% ${NAMES[i]}`).join(", "), how: `${samples.length} standing places, about one every ${ft(3)}` },
        { label: "Reach", value: `${ft(far)} from the entries`, how: "the farthest distance from an entry that a standing place was read at" },
      ],
      used: [`open sky ≥ ${pct(c.a.openSky)} of rays`, `partly open ≥ ${pct(c.a.semiSky)}`],
    },
    interpretation: {
      text: `Going outward from the entries over the whole walkable floor, the enclosure changes ${steps} time${steps === 1 ? "" : "s"}: ${runs.map((r) => NAMES[r.v]).join(", then ")}. ${present === 1 ? "Everywhere read is the same kind of enclosure, so there is no gradation." : ""} This is geometric enclosure; which of these zones is private or public is not assigned.`,
      scale: ["uniform", "one step", "graded", "finely graded"],
      index: idx,
    },
    evidence: rr.route ? { routePoints: rr.route.points } : {},
  };
}

// ---- Non-hierarchical circulation --------------------------------------------------------------------------------------------------------------

function nonHierarchical(c: Ctx): Part {
  const method = "The walkable floor is cut into stretches of the width set below (5 ft by default; a stretch counts when a fifth of it is floor and two stretches are joined when at least a clear width of floor runs between them). From all the ground-level entries, the number of independent routes (no stretch of floor shared) is counted to the farthest part of the floor and to the parts about half and three quarters of the way out; the figure is the middle of the three, capped at the limit set below. Loops are the independent circuits in the network of stretches, the ways round something rather than through it.";
  const cannot = "Whether the routes feel equally valid: they may differ greatly in length or quality. It counts independent ways to a few far parts of the floor, not every pair of places.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const limit = Math.max(2, c.a.maxRoutes);
  const rt = routeFacts(f, limit, c.a.routeBlockFt);
  if (!rt.blocks) return unavailable("not assessable", method, cannot, "No floor that a person can stand on was found in the tile, so no routes are counted (and nothing is substituted).");
  if (!rt.entries) return unavailable("not assessable", method, cannot, "No opening at ground level has a floor to stand on, so there is no entry to count routes from.");
  const capped = rt.routes >= limit;
  const idx = rt.routes <= 1 ? 0 : rt.routes === 2 ? 1 : rt.routes <= 4 ? 2 : 3;
  const rr = findRoute(f, { from: c.over?.from, to: c.over?.to, destination: "farthest" });
  return {
    measure: {
      headline: `${count(rt.routes, "independent route")}${capped ? " or more" : ""} through the floor, from ${count(rt.entries, "entry stretch", "entry stretches")}${rt.loops ? `; ${count(rt.loops, "loop")}` : ""}`,
      value: rt.routes,
      unit: capped ? `independent routes (counting stopped at ${limit})` : "independent routes",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "To the farthest part", value: String(rt.farthest), how: "independent routes from the entries to the farthest stretch of floor" },
        { label: "Entries", value: String(rt.entries), how: "stretches of floor next to an opening at the lowest floor level reached" },
        { label: "Loops", value: String(rt.loops), how: "independent circuits in the network of walkable stretches" },
        { label: "Network", value: `${rt.blocks} stretches of ${ft(c.a.routeBlockFt)}`, how: "the walkable floor in blocks of the width set below" },
      ],
      used: [`up to ${limit} routes`, `stretches of ${ft(c.a.routeBlockFt, 1)}`, walkUsed()],
    },
    interpretation: {
      text: rt.routes <= 1 ? `Circulation here is a single path: only one independent way leads through the floor to its far parts${rt.loops ? `, though there ${rt.loops === 1 ? "is a loop" : `are ${rt.loops} loops`}` : ""}.` : `${cap(count(rt.routes, "independent way"))}${capped ? " (the count stopped there)" : ""} lead through the floor, so there is a choice of path${rt.loops ? ` and ${count(rt.loops, "way")} round` : ""}.`,
      scale: ["single path", "a choice of two", "several paths", "a network"],
      index: idx,
    },
    evidence: rr.route ? { routePoints: rr.route.points } : {},
  };
}

// ---- Force-driven -----------------------------------------------------------------------------------------------------------------------------------

function forceDriven(c: Ctx): Part {
  const method = "Reads the inputs the erosion recipe recorded as the forces that generated the geometry: the solvent dose of each source (ft³ of foam it could dissolve), and how it is applied. The measure is how the dose is shared: the largest source's share of all the dose, the effective number of sources (1 over the sum of squared shares: 1 for one dominant source, as many as the sources when they are equal) and how many sources carry at least 5% of it. Gravity, drain and how each source treats the floor plates are given beside it. The matrix's examples (required sun-hours, pedestrian counts) are not inputs this system has.";
  const cannot = "Whether the generating force can be read in the finished form. A dominant source does not prove a legible force-driven form; the result needs to be looked at.";
  const m = c.m;
  if (!m || !m.hasRecipe) return unavailable("not assessable", method, cannot, "This tile carries no erosion recipe (it was lofted, imported or built from other tiles), so the forces that generated it are not recorded and nothing is inferred about them.");
  const doses = m.sources.map((s) => s.dose).filter((d) => d > 0).sort((a, b) => b - a);
  const total = doses.reduce((a, b) => a + b, 0);
  if (!total) return unavailable("not assessable", method, cannot, "The recipe's sources carry no recorded dose.");
  const shares = doses.map((d) => d / total);
  const top = shares[0] * 100;
  const effective = 1 / shares.reduce((a, s) => a + s * s, 0);
  const major = shares.filter((s) => s >= 0.05).length;
  const p = m.prim;
  const modes = [...new Set(m.sources.map((s) => `${s.mode}${s.plateMode !== "pool" ? ` (${s.plateMode}${s.cut ? ", cut" : ""})` : ""}`))];
  const perDose = m.voidFt3 / total;
  const idx = top < 15 ? 0 : top < 30 ? 1 : top < 50 ? 2 : 3;
  return {
    measure: {
      headline: `the largest of ${count(m.sources.length, "source")} holds ${num(top, 0)}% of the dose (${num(effective, 1)} effective sources)`,
      value: top,
      unit: "% of the total solvent dose held by the largest source",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Dominance", value: `${num(top, 0)}% in the largest, ${major} source${major === 1 ? "" : "s"} at 5% or more`, how: "the share of the total dose in the biggest source, and how many carry a real share" },
        { label: "Effective sources", value: num(effective, 1), how: "1 over the sum of squared shares of the dose" },
        { label: "Total dose", value: `${num(total)} ft³`, how: "the solvent dose of all sources" },
        { label: "Gravity", value: `${num(p.gravity, 2)}${p.drain ? ", with a drain" : ""}`, how: "0 spreads the solvent evenly, higher pulls it down so it pools and floors flatten" },
        { label: "Sources", value: modes.join("; ") || "none", how: "how the solvent is applied" },
        { label: "Void made per dose", value: `${num(perDose, 2)} ft³ per ft³`, how: "void volume of the result over the total dose" },
      ],
      used: [],
    },
    interpretation: {
      text: top >= 50 ? `One source drives the form: it holds ${num(top, 0)}% of the dose, and the other ${count(m.sources.length - 1, "source")} add${m.sources.length === 2 ? "s" : ""} detail.` : top >= 30 ? `A leading source holds ${num(top, 0)}% of the dose among ${count(m.sources.length, "source")}, about ${num(effective, 1)} effective sources: one force leads and others share the work.` : top >= 15 ? `A few sources share the work: the largest holds ${num(top, 0)}% of the dose among ${count(m.sources.length, "source")}, about ${num(effective, 1)} effective sources.` : `The dose is spread over many sources: the largest holds ${num(top, 0)}% and there are about ${num(effective, 1)} effective sources, so no single force drives the form. Whether the form shows these inputs is a matter for reading the form.`,
      scale: ["many small forces", "a few forces", "a leading force", "one dominant force"],
      index: idx,
    },
    evidence: {},
  };
}

// ---- Light-filled -----------------------------------------------------------------------------------------------------------------------------------

function lightFilled(c: Ctx): Part {
  const method = "A geometric indicator, not a daylight simulation. Roof openings are void cells with open air straight above (outside the container counts as open air; another tile above covers them). For each room that has one, its roof-opening area is divided by that room's floor area (floor = void with material under it); the result is the total opening over the total floor of those rooms. Openings are unglazed in the model: no glazing, shading or sun path is known, so an opening here is a hole to the sky, not a skylight with a material.";
  const cannot = "How bright the space is. It does not trace light, does not know glazing, orientation or season, and treats a roof opening as an unglazed opening.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const sk = skylights(f);
  let openFt2 = 0;
  let floorFt2 = 0;
  let allFloor = 0;
  let rooms = 0;
  for (const [room, v] of sk.perRoom) {
    allFloor += v.floor;
    if (v.open > 0) {
      openFt2 += v.open * cell2(f);
      floorFt2 += v.floor * cell2(f);
      if (room) rooms++;
    }
  }
  allFloor *= cell2(f);
  const share = floorFt2 > 0 ? (100 * openFt2) / floorFt2 : 0;
  const side = c.m?.spaces.daylight;
  const idx = openFt2 === 0 ? 0 : share < 5 ? 1 : share < 20 ? 2 : 3;
  const roomsLit = [...sk.perRoom.entries()].filter(([r, v]) => r && v.open > 0).map(([r]) => r);
  return {
    measure: {
      headline: openFt2 > 0 ? `${num(share, 0)}% — ${ft2(openFt2)} of unglazed roof opening over ${ft2(floorFt2)} of floor` : "no roof opening: 0 ft² over any floor",
      value: share,
      unit: "% roof-opening area over the floor area of the rooms it opens into (unglazed)",
      status: "proxy",
      method,
      cannot,
      supporting: [
        { label: "Roof openings", value: ft2(openFt2), how: "void with open air straight above" },
        { label: "Floor below", value: ft2(floorFt2), how: `floor of the ${count(rooms, "room")} that ${rooms === 1 ? "has" : "have"} one` },
        { label: "All void floor", value: ft2(allFloor), how: "every floor cell of the tile" },
        ...(side ? [{ label: "Floor within reach of light", value: pct(side.lit_floor_fraction), how: `within ${num(side.lit_within_ft)} ft of open sky or a side opening` }] : []),
      ],
      used: [],
    },
    interpretation: {
      text: openFt2 > 0 ? `${ft2(openFt2)} of the roof is open over ${ft2(floorFt2)} of floor (${num(share, 0)}%): a geometric indicator of overhead light, not a measurement of brightness. The openings are unglazed in the model.` : "No part of the void reaches an open roof, so there is no overhead opening; any light comes from the sides. This is a geometric indicator, not a daylight simulation.",
      scale: ["no overhead light", "a little", "generous", "flooded from above"],
      index: idx,
    },
    evidence: { rooms: roomsLit.length ? roomsLit : undefined },
  };
}

// ---- Monumental --------------------------------------------------------------------------------------------------------------------------------

function monumental(c: Ctx): Part {
  const method = "The evaluated void is the tallest room (its typical clear height, a shaft's full height). Width is that room's narrower horizontal extent. The ratio is height over width. The volume share is all void over the container's own volume (a shaped container's notch is not building volume). Actual dimensions are kept beside the ratios so a large ratio is not mistaken for a large space.";
  const cannot = "Perceived significance: a 20 ft tall, 8 ft wide slot has a high ratio and is not a large space. Scale also depends on what a person compares it to.";
  const m = c.m;
  const f = c.f;
  if (!m || !f) return unavailable("not assessable", method, cannot, "The tile has no spaces to measure a void from.");
  const t = m.tallest;
  if (!t.room) return unavailable("not assessable", method, cannot, "No room was found to take a height and width from.");
  const volShare = (100 * f.voidCells) / Math.max(1, f.inside);
  const voidFt3 = f.voidCells * f.cell ** 3;
  const big = m.rooms[0];
  const idx = t.clearFt < 10 ? 0 : t.clearFt < 16 ? 1 : t.clearFt < 24 ? 2 : 3;
  return {
    measure: {
      headline: `${ft(t.clearFt, 1)} tall over ${ft(t.widthFt, 1)} wide (${num(t.ratio, 2)}); void is ${num(volShare, 0)}% of the building volume`,
      value: t.ratio,
      unit: "height-to-width ratio of the tallest void (void volume share given beside it)",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Height", value: ft(t.clearFt, 1), how: `clear height of the ${t.room.name.split(",")[0]}` },
        { label: "Width", value: ft(t.widthFt, 1), how: "its narrower horizontal extent" },
        { label: "Void volume", value: `${ft3(voidFt3)} = ${num(volShare, 1)}% of ${ft3(f.containerFt3)}`, how: f.shaped ? "the container's own volume (the notch is not counted)" : "the whole block" },
        { label: "Largest room", value: big ? `${ft3(big.volume_ft3)}, ${pct(big.volume_share)} of the void` : "none", how: "by volume" },
      ],
      used: [],
    },
    interpretation: {
      text: `The tallest void is ${ft(t.clearFt, 1)} high and ${ft(t.widthFt, 1)} across (${num(t.ratio, 2)}), and void is ${num(volShare, 0)}% of the building volume. ${t.clearFt < 10 ? "At these dimensions the space stays close to body scale." : t.clearFt < 16 ? "It is roomy rather than grand." : "The height is well above an ordinary ceiling."}`,
      scale: ["intimate", "generous", "grand", "monumental"],
      index: idx,
    },
    evidence: { rooms: t.room ? [t.room.id] : [] },
  };
}

// ---- Spatial density ---------------------------------------------------------------------------------------------------------------------

function spatialDensity(c: Ctx): Part {
  const method = "Along a floor-supported route from a ground-level opening (a way a person can walk under the shared walking rules), the clear width of the passage (open space across the direction of travel at the height set below) is sampled at every cell and smoothed over about 3 ft. The quantity is the narrowest over the widest smoothed width. A constriction is a stretch of 2 ft or more narrower than the ratio set below of the typical (median) width; an expansion one wider than the ratio set below. Where they sit along the route is reported.";
  const cannot = "That more contrast is better or that the tile was designed to compress and release. It reads one route; the route has to be a way a person could walk, and no line through open air is substituted for it.";
  if (!c.f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const r = spatialDensityFor(c.tile, c.a, c.over);
  if (!r.ok) return unavailable("not assessable", method, cannot, r.reason);
  const p = r.profile;
  // floor the route could not reach (a passage too narrow or too low, a level change bigger than one step): said, so a short route is not mistaken for a whole tile
  const cut = usableSpace(c.tile).cutOffFt2;
  const legacyNote = c.legacyDensity ? { label: "Earlier formula (legacy)", value: `${c.legacyDensity.quant.headline}; older index ${c.legacyDensity.score}`, how: "the earlier Spatial density measured the void's cross-section area along the engine's main route: a different formula, kept as a legacy measurement and not the criterion above" } : null;
  const con = p.stretches.filter((s) => s.kind === "constriction");
  const exp = p.stretches.filter((s) => s.kind === "expansion");
  const idx = p.ratio >= 0.8 ? 0 : p.ratio >= 0.55 ? 1 : p.ratio >= 0.35 ? 2 : 3;
  return {
    measure: {
      headline: `narrowest ${ft(p.narrowFt, 1)} to widest ${ft(p.wideFt, 1)}: ratio ${num(p.ratio, 2)}`,
      value: p.ratio,
      unit: "narrowest ÷ widest passage width along the route",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Narrowest", value: `${ft(p.narrowFt, 1)} at ${num(p.narrowAt[0])}, ${num(p.narrowAt[1])}, ${num(p.narrowAt[2])} ft`, how: "smoothed width, with where it is" },
        { label: "Widest", value: `${ft(p.wideFt, 1)} at ${num(p.wideAt[0])}, ${num(p.wideAt[1])}, ${num(p.wideAt[2])} ft`, how: "smoothed width, with where it is" },
        { label: "Constrictions", value: con.length ? con.map((s) => `${ft(s.widthFt, 1)} at ${ft(s.fromFt)} along`).join("; ") : "none", how: `stretches ≥ 2 ft narrower than ${num(c.a.constrictionRatio, 2)} of the typical ${ft(p.typicalFt, 1)}` },
        { label: "Expansions", value: exp.length ? exp.map((s) => `${ft(s.widthFt, 1)} at ${ft(s.fromFt)} along`).join("; ") : "none", how: `stretches ≥ 2 ft wider than ${num(c.a.expansionRatio, 2)} of it` },
        { label: "Route", value: ft(p.route.lengthFt), how: `floor-supported, to ${p.route.how}` },
        ...(cut >= WALK.minZoneFt2 ? [{ label: "Floor not reached", value: ft2(cut), how: "standing floor that no step, stair or ramp joins to the way in (a passage narrower or lower than the walking rules, or a level change bigger than one step): the route does not go there" }] : []),
        ...(legacyNote ? [legacyNote] : []),
      ],
      used: [`width read ${ft(c.a.passageHeightFt, 1)} above the floor`, `constriction < ${num(c.a.constrictionRatio, 2)}`, `expansion > ${num(c.a.expansionRatio, 2)}`, walkUsed()],
    },
    interpretation: {
      text: `Along a ${ft(p.route.lengthFt)} route the passage narrows to ${ft(p.narrowFt, 1)} and opens to ${ft(p.wideFt, 1)} (${num(p.ratio, 2)}); ${p.releases ? `${count(p.releases, "squeeze")} ${p.releases === 1 ? "is" : "are"} followed by a wider stretch` : "no narrow stretch is followed by a clearly wider one"}.`,
      scale: ["little contrast", "gentle contrast", "marked contrast", "sharp contrast"],
      index: idx,
    },
    evidence: { routePoints: p.route.points, regions: p.stretches.slice(0, 6).map((s) => ({ min: [s.at[0] - 1.5, s.at[1] - 1.5, s.at[2] - 1], max: [s.at[0] + 1.5, s.at[1] + 1.5, s.at[2] + 3] })) },
  };
}

const PARTS: Record<MatrixKey, (c: Ctx) => Part> = { carved, stepped, porous, continuous, resistant: resistant, threaded, graduated, nonHierarchical, forceDriven, lightFilled, monumental, spatialDensity };

// ---- the evaluation --------------------------------------------------------------------------------------------------------------------------------

const memo = new WeakMap<ParsedTile, Map<string, TileEvaluation>>();

/** The twelve matrix results for one tile, with the shared assumptions and any route you chose; cached per tile and settings. */
export function evaluateTile(tile: ParsedTile, inputs: Partial<EvalInputs> = {}): TileEvaluation {
  const a = mergeAssumptions(inputs.assumptions);
  const over = inputs.routes?.[tile.id];
  const key = assumptionsKey(a) + JSON.stringify(over ?? null) + walkKey();
  let byKey = memo.get(tile);
  if (!byKey) memo.set(tile, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const legacy = scoreTile(tile);
  const legacyMeasurements = legacyMeasurementsFor(tile);
  const ctx: Ctx = { tile, f: voxelFacts(tile), m: measuresFor(tile), a, over, legacy: new Map(legacy.map((r) => [r.key, r])), legacyDensity: legacyMeasurements[0] };
  const results: MatrixResult[] = MATRIX.map((criterion) => {
    let part: Part;
    try {
      part = PARTS[criterion.key](ctx);
    } catch (err) {
      part = unavailable("not assessable", "", "", `The measurement could not be completed for this tile (${err instanceof Error ? err.message : "an error"}).`);
    }
    return { key: criterion.key, criterion, measure: part.measure, interpretation: { ...part.interpretation, generated: true }, evidence: part.evidence, legacy: ctx.legacy.get(criterion.key)! };
  });
  const out: TileEvaluation = { tileId: tile.id, results, legacyMeasurements, usable: usableSpace(tile), assumptions: a };
  if (byKey.size > 6) byKey.clear();
  byKey.set(key, out);
  return out;
}

export { findRoute };
