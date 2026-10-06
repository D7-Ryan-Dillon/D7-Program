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
import { classAt, distinctRoutes, findRoute, OUT, SOLID, skylights, surfaceStats, VOID, voxelFacts, type RouteOverride0, type VoxelFacts } from "@/lib/scoring/voxelFacts";
import { cap, count, ft, ft2, ft3, list, num, pct, roomShort } from "@/lib/scoring/words";
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
  const method = "On the faces of the void: faces against eroded foam, as a share of all faces against material (eroded foam, floor plates, support branches). Openings to the air are not surface. Plates and branches are the designed, inserted elements, so a face against one is where a different element meets the carved surface.";
  const cannot = "How the building would be made. The files have no panel or joint model, so a surface that reads as one carved face is not shown to be seamless construction. Mesh triangles and voxel steps are not treated as panels or seams.";
  const f = c.f;
  if (!f || !f.voidCells) return unavailable("not assessable", method, cannot, "The tile has no voxel void to read a surface from.");
  const s = surfaceStats(f);
  const foam = s.wallFoam + s.floorFoam + s.ceilFoam;
  const plate = s.wallPlate + s.floorPlate + s.ceilPlate;
  const strut = s.wallStrut + s.floorStrut + s.ceilStrut;
  const total = foam + plate + strut;
  if (!total) return unavailable("not assessable", method, cannot, "The void has no surface against material (it is all open to the air).");
  const share = (100 * foam) / total;
  const voidShare = (100 * f.voidCells) / f.inside;
  const idx = share < 40 ? 0 : share < 70 ? 1 : share < 90 ? 2 : 3;
  return {
    measure: {
      headline: `${num(share, 0)}% of the void's surface is one eroded surface`,
      value: share,
      unit: "% of void surface against eroded foam (geometric continuity)",
      status: "proxy",
      method,
      cannot,
      supporting: [
        { label: "Against eroded foam", value: ft2(foam * cell2(f)), how: "faces of void against foam" },
        { label: "Against floor plates", value: ft2(plate * cell2(f)), how: "faces of void against a plate (floors and ceilings that were inserted)" },
        { label: "Against branches", value: ft2(strut * cell2(f)), how: "faces of void against a support branch" },
        { label: "Void in the block", value: pct(voidShare / 100), how: voidShare > 0 && f.shaped ? "of the container's cells (its notch is not counted)" : "of the container's cells" },
      ],
      used: [],
    },
    interpretation: {
      text: `${num(share, 0)}% of the void's bounding surface is eroded foam and the rest meets plates or branches, so ${share >= 70 ? "the void reads mainly as one cut surface" : "the cut surface is interrupted by inserted elements"}; ${num(voidShare, 0)}% of the container is void. This describes geometry, not whether it could be built without seams.`,
      scale: ["assembled", "mixed", "mostly carved", "carved"],
      index: idx,
    },
    evidence: { rooms: c.m?.rooms.slice(0, 1).map((r) => r.id) },
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
  const method = "On the void's section: for each layer of the tile, how far the void reaches along each horizontal axis; layers whose reach differs by less than 1 ft are one stage (voxel stair-stepping is not a setback), a stage must hold the height set below, and a step must move the edge at least the run set below. The count is of steps in the direction that repeats most, on the better axis; it is divided by the height of the container in units of 10 ft.";
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
  const n = Math.max(nVoid, terraces);
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
  const idx = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;
  return {
    measure: {
      headline: `${count(n, "setback increment")} in ${ft(heightFt)} of height`,
      value: per10,
      unit: `setback increments per 10 ft of height (${n} in all)`,
      status: "measured",
      method: `${method} Run ≥ ${ft(run, 1)}, held ≥ ${ft(rise, 1)}.`,
      cannot,
      supporting: [
        { label: "Steps of the void's section", value: `${pick.axis.toUpperCase()}: ${pick.inward} inward, ${pick.outward} outward`, how: "steps of the void's reach going up, on the better axis" },
        { label: "Terraces", value: String(terraces), how: "successive floors at least the set rise apart whose floor edge also steps by the set run" },
        { label: "Stages held", value: String(pick.segments), how: "stretches of height with the same reach" },
        { label: "Container setbacks", value: String(env), how: "the same count on the container's own outline (0 for a plain box)" },
        { label: "Height", value: ft(heightFt), how: "from the lowest to the highest cell of the container" },
      ],
      used: [`smallest setback ${ft(run, 1)}`, `must hold ${ft(rise, 1)}`],
    },
    interpretation: {
      text: n === 0 ? `The void's section does not step: its reach along either axis stays within 1 ft over the height of the tile, apart from changes smaller than ${ft(run, 1)} or shorter than ${ft(rise, 1)}, and no floor sits a full ${ft(rise, 1)} above another with its edge moved.` : `${cap(count(n, "setback increment"))} over ${ft(heightFt)}, ${num(per10, 1)} per 10 ft of height (${nVoid ? `the void's section steps ${dir}` : ""}${nVoid && terraces ? "; " : ""}${terraces ? `${count(terraces, "terrace")} of floors` : ""}).`,
      scale: ["no setbacks", "one setback", "a few setbacks", "terraced"],
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
  const method = "Proxy. The matrix counts visible seams per 10 m of surface; the files hold no panel, joint or construction model, so seams cannot be counted. Instead a floor-supported route is walked from a ground-level opening and the surface met on the way is read at three places (the floor underfoot and the wall on each side at standing height): a change from eroded foam to a floor plate or a support branch, or back, is counted as a material change. The count is per 10 m of each surface traversed.";
  const cannot = "That any surface is or is not seamless in construction. Mesh triangles and voxel edges are not seams and are not counted. A route that meets only eroded foam says the surface is geometrically continuous along it, not that no joints would be needed.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const rr = findRoute(f, { from: c.over?.from, to: c.over?.to, destination: "farthest" });
  if (!rr.route) return unavailable("not assessable", method, cannot, `${rr.reason} Without a floor-supported route there is no surface to walk along, and a line through the void is not substituted.`);
  const mc = materialChanges(f, rr.route.points);
  const idx = mc.per10m < 0.5 ? 3 : mc.per10m < 2 ? 2 : mc.per10m < 5 ? 1 : 0;
  return {
    measure: {
      headline: `${num(mc.per10m, 1)} material changes per 10 m of surface (proxy for seams)`,
      value: mc.per10m,
      unit: "material changes per 10 m of surface traversed",
      status: "proxy",
      method,
      cannot,
      supporting: [
        { label: "Route", value: `${ft(rr.route.lengthFt)} (${num(mc.lengthM, 1)} m)`, how: "floor-supported, from a ground-level opening to " + rr.route.how },
        { label: "Material changes", value: String(mc.changes), how: "foam ↔ plate or branch, summed over floor and both walls" },
      ],
      used: [walkUsed()],
    },
    interpretation: {
      text: `Along a ${ft(rr.route.lengthFt)} floor-supported route the surface changes material ${mc.changes} time${mc.changes === 1 ? "" : "s"} (${num(mc.per10m, 1)} per 10 m of surface). That reads as ${mc.per10m < 2 ? "geometrically continuous" : "broken up by plates and branches"}; it is a stand-in for the seams count, which the files cannot give.`,
      scale: ["broken up", "interrupted", "mostly continuous", "continuous"],
      index: idx,
    },
    evidence: { routePoints: rr.route.points },
  };
}

// ---- Retained / Resistant -------------------------------------------------------------------------------------------------------------------

function resistant(c: Ctx): Part {
  const method = "The retained element is the protected solid the recipe set: the floor plates and the support branches grown to hold them (they resist erosion; all other foam is eroded and is not called retained). Area is the plan area covered by those cells against the plan area of the container; volume is their cells against the container's cells. Cells outside a shaped container are in neither.";
  const cannot = "Whether the retained element reads as resisting the erosion: that depends on how it meets the void and how it is seen.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  let plateCells = 0;
  let strutCells = 0;
  const cols = new Uint8Array(f.nx * f.ny);
  for (let x = 0; x < f.nx; x++)
    for (let y = 0; y < f.ny; y++)
      for (let z = 0; z < f.nz; z++) {
        const i = (x * f.ny + y) * f.nz + z;
        if (f.cls[i] !== SOLID) continue;
        const p = f.plates && f.plates[i];
        const st = f.struts && f.struts[i];
        if (p) plateCells++;
        if (st) strutCells++;
        if (p || st) cols[x * f.ny + y] = 1;
      }
  const retained = plateCells + strutCells;
  if (!retained) {
    return {
      measure: { headline: "no retained element identified", value: null, unit: "", status: "unavailable", method, cannot, supporting: [{ label: "Foam", value: ft3((f.inside - f.voidCells) * f.cell ** 3), how: "all material, not called retained" }], used: [] },
      interpretation: { text: "This tile has no protected floor plates or support branches, so no element is identified as the one that resists the erosion. The remaining foam is what erosion left, not something retained; nothing is scored." },
      evidence: {},
    };
  }
  let colCount = 0;
  for (let i = 0; i < cols.length; i++) colCount += cols[i];
  const areaShare = (100 * colCount * cell2(f)) / f.footprintFt2;
  const volShare = (100 * retained) / f.inside;
  const idx = volShare < 3 ? 0 : volShare < 8 ? 1 : volShare < 15 ? 2 : 3;
  return {
    measure: {
      headline: `${num(areaShare, 0)}% of the floor area and ${num(volShare, 1)}% of the volume is retained solid`,
      value: areaShare,
      unit: "% of container plan area covered by retained solid (volume share given beside it)",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Volume", value: `${num(volShare, 1)}% (${ft3(retained * f.cell ** 3)})`, how: "plate and branch cells over the container's cells" },
        { label: "Floor plates", value: `${count((c.tile.structure?.plates ?? []).length, "plate")}, ${ft2((c.tile.structure?.plates ?? []).reduce((a, p) => a + p.area_ft2, 0))}`, how: "protected plates from the recipe" },
        { label: "Branches", value: ft3(strutCells * f.cell ** 3), how: "support branches grown to hold them" },
        { label: "Container", value: `${ft3(f.containerFt3)} over ${ft2(f.footprintFt2)}`, how: f.shaped ? "an L or stepped container: its notch is not counted" : "the whole block" },
      ],
      used: [],
    },
    interpretation: {
      text: `The retained solid (floor plates and their branches) covers ${num(areaShare, 0)}% of the container's plan and fills ${num(volShare, 1)}% of its volume; the rest of the foam is what erosion left.`,
      scale: ["slight", "present", "clear", "dominant"],
      index: idx,
    },
    evidence: { levels: c.m?.levels.filter((l) => l.plate_ids.length).map((l) => l.id) },
  };
}

// ---- Threaded ---------------------------------------------------------------------------------------------------------------------------------

function threaded(c: Ctx): Part {
  const method = "Counts rooms (spaces) whose floor lies above the ground floor and whose program is public. Program comes from the tile's own category (or, for an assembly, from the tile each room came from); a category is treated as public only if it is on the list set below, and any room can be set public or private by hand. A connected void is not a program instance, and a room with no category is not assumed public.";
  const cannot = "What actually happens in a room: the matrix counts public program, and the tile's category is only a label for it.";
  const m = c.m;
  if (!m) return unavailable("not assessable", method, cannot, "The tile has no spaces to count.");
  const cat = c.tile.meta?.category ?? c.tile.guessed.category;
  const perRoom = (c.tile.meta as { roomCategory?: Record<string, string> } | undefined)?.roomCategory;
  if (!cat && !perRoom) return unavailable("not assessable", method, cannot, "The tile carries no program category (gathering, office, lobby), and an unlabelled room does not establish public program. Set the rooms' class below to assess this.");
  const levels = m.levels;
  if (!levels.length) return unavailable("not assessable", method, cannot, "The tile has no floor level, so nothing is above or below ground.");
  const ground = Math.min(...levels.map((l) => l.z_ft));
  const isPublic = (r: (typeof m.rooms)[number]): boolean => {
    const key = `${c.tile.id}:${r.id}`;
    const o = c.a.roomClass[key];
    if (o) return o === "public";
    const k = perRoom?.[String(r.id)] ?? cat;
    return !!k && c.a.publicCategories.includes(k);
  };
  const above = m.rooms.filter((r) => r.floor_z_ft.min !== null && r.floor_z_ft.min > ground + c.a.groundToleranceFt && r.floor_area_ft2 >= 4);
  const pub = above.filter(isPublic);
  const overridden = Object.keys(c.a.roomClass).some((k) => k.startsWith(`${c.tile.id}:`));
  const total = m.rooms.filter((r) => r.floor_area_ft2 >= 4).length;
  const status: MatrixStatus = "assumed";
  return {
    measure: {
      headline: `${count(pub.length, "public program instance")} above the ground floor (of ${count(total, "room")})`,
      value: pub.length,
      unit: "public program instances above the ground floor",
      status,
      method,
      cannot,
      supporting: [
        { label: "Ground floor", value: `${ft(ground, 1)} (floors within ${ft(c.a.groundToleranceFt, 1)} of it count as ground)`, how: "the lowest floor of the tile" },
        { label: "Rooms above ground", value: String(above.length), how: "rooms whose lowest floor is above the ground floor" },
        { label: "Program", value: perRoom ? "from each room's own tile" : `${cat} (tile category)`, how: "label read from the tile's metadata" },
        { label: "Public categories", value: c.a.publicCategories.join(", ") || "none", how: "the assumption: these programs are public" },
      ],
      used: [`public = ${c.a.publicCategories.join(", ") || "none"}`, `ground tolerance ${ft(c.a.groundToleranceFt, 1)}`, ...(overridden ? ["some rooms set by hand"] : [])],
    },
    interpretation: {
      text: pub.length ? `${cap(count(pub.length, "room"))} of public program ${pub.length === 1 ? "sits" : "sit"} above the ground floor${list(pub.slice(0, 3).map(roomShort)) ? ` (${list(pub.slice(0, 3).map(roomShort))})` : ""}, so public program is met above the entry as well as at it. This rests on the assumption that ${c.a.publicCategories.join(" and ")} spaces are public.` : above.length ? `There are ${count(above.length, "room")} above the ground floor but none is public under the current assumption (${c.a.publicCategories.join(", ") || "none"} are public), so public program is met at the entry level only.` : "Every room is on the ground floor, so there is no public program above it.",
      scale: ["at entry only", "one above", "several above", "threaded"],
      index: pub.length === 0 ? 0 : pub.length === 1 ? 1 : pub.length <= 3 ? 2 : 3,
    },
    evidence: { rooms: pub.map((r) => r.id) },
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
  const method = "Enclosure is classed at each point of a floor-supported route from a ground-level opening: open to the sky (half or more of nine upward rays leave through open air), partly open (some sky, or a quarter or more of twelve horizontal rays reach the outside), or enclosed. Runs shorter than 3 ft are absorbed by their neighbours. The route starts outdoors, so the first change is from the outside into the building. The count is the number of changes in class.";
  const cannot = "Which zones are private and which public: that needs program information, and enclosure here is geometric. It also reads one route; another route through the tile may graduate differently.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const rr = findRoute(f, { from: c.over?.from, to: c.over?.to, destination: "farthest" });
  if (!rr.route) return unavailable("not assessable", method, cannot, `${rr.reason} Enclosure is read along a route a person could take, so none is measured.`);
  const raw = rr.route.points.map((p) => enclosureAt(f, p, c.a));
  const seq = [0, ...raw];
  // absorb short runs
  const minRun = Math.max(1, Math.round(3 / f.cell));
  const runs: { v: number; n: number }[] = [];
  for (const v of seq) {
    const last = runs[runs.length - 1];
    if (last && last.v === v) last.n++;
    else runs.push({ v, n: 1 });
  }
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].n < minRun) {
        const prev = runs[i - 1];
        const next = runs[i + 1];
        const into = next && next.n > prev.n ? next : prev;
        into.n += runs[i].n;
        runs.splice(i, 1);
        if (into === next && i < runs.length) {
          // keep order: the absorbed run joined the next one
        }
        changed = true;
        break;
      }
    }
    // merge equal neighbours
    for (let i = 1; i < runs.length; i++) if (runs[i].v === runs[i - 1].v) {
      runs[i - 1].n += runs[i].n;
      runs.splice(i, 1);
      changed = true;
      break;
    }
  }
  const steps = Math.max(0, runs.length - 1);
  const NAMES = ["open to the sky", "partly open", "enclosed"];
  const idx = steps === 0 ? 0 : steps === 1 ? 1 : steps === 2 ? 2 : 3;
  return {
    measure: {
      headline: `${count(steps, "enclosure step")} from the outside to ${rr.route.how.includes("farthest") ? "the far end" : "the destination"}`,
      value: steps,
      unit: "discrete enclosure steps along the route",
      status: "proxy",
      method,
      cannot,
      supporting: [
        { label: "Sequence", value: runs.map((r) => NAMES[r.v]).join(" → ") || "outdoors", how: "enclosure classes met along the route, from the outside in" },
        { label: "Route", value: ft(rr.route.lengthFt), how: `floor-supported, from a ground-level opening to ${rr.route.how}` },
      ],
      used: [`open sky ≥ ${pct(c.a.openSky)} of rays`, `partly open ≥ ${pct(c.a.semiSky)}`],
    },
    interpretation: {
      text: `Along a ${ft(rr.route.lengthFt)} route from the outside the enclosure changes ${steps} time${steps === 1 ? "" : "s"}: ${runs.map((r) => NAMES[r.v]).join(", then ")}. This is geometric enclosure; which of these zones is private or public is not assigned.`,
      scale: ["abrupt", "one step", "graded", "finely graded"],
      index: idx,
    },
    evidence: { routePoints: rr.route.points },
  };
}

// ---- Non-hierarchical circulation --------------------------------------------------------------------------------------------------------------

function nonHierarchical(c: Ctx): Part {
  const method = "From a ground-level opening (the entry) to one destination (the middle of the largest other room reached on foot), the cheapest floor-supported route is found; its corridor is then closed off (the width set below, except near the two ends) and the search is repeated, up to the limit set below. A route has to find a different way, so a small variation through neighbouring cells is not counted as another route. A route needs a floor, headroom and steps within the limits set below.";
  const cannot = "Whether the routes feel equally valid: they may differ greatly in length or quality. It counts the routes that exist from one entry to one destination, not every pair.";
  const f = c.f;
  if (!f) return unavailable("not assessable", method, cannot, "The tile has no voxel data.");
  const opt = { from: c.over?.from, to: c.over?.to, blockFt: c.a.routeBlockFt };
  const { routes, first } = distinctRoutes(f, opt, c.a.maxRoutes);
  if (!routes.length) return unavailable("not assessable", method, cannot, `${first.reason} With no route, no routes are counted (and nothing is substituted).`);
  const lens = routes.map((r) => r.lengthFt);
  const shortest = Math.min(...lens);
  const longest = Math.max(...lens);
  const capped = routes.length >= c.a.maxRoutes;
  const idx = routes.length <= 1 ? 0 : routes.length === 2 ? 1 : routes.length <= 4 ? 2 : 3;
  const e = routes[0].entry;
  const d = routes[0].dest;
  return {
    measure: {
      headline: `${count(routes.length, "distinct route")}${capped ? " or more" : ""} from the entry to the destination`,
      value: routes.length,
      unit: capped ? `distinct routes (search stopped at ${c.a.maxRoutes})` : "distinct routes",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Entry", value: `(${num(e[0])}, ${num(e[1])}, ${num(e[2])}) ft`, how: "a ground-level opening with a floor" },
        { label: "Destination", value: `(${num(d[0])}, ${num(d[1])}, ${num(d[2])}) ft`, how: routes[0].how },
        { label: "Route lengths", value: routes.length > 1 ? `${ft(shortest)} to ${ft(longest)}` : ft(shortest), how: "the shortest and longest of the routes found" },
        { label: "Search limits", value: `${c.a.maxRoutes} routes, ${ft(c.a.routeBlockFt, 1)} corridor closed after each`, how: "the settings" },
      ],
      used: [`corridor ${ft(c.a.routeBlockFt, 1)}`, `up to ${c.a.maxRoutes} routes`, walkUsed()],
    },
    interpretation: {
      text: routes.length === 1 ? `Only one floor-supported way leads from the entry to the destination: circulation here is a single path.` : `${cap(count(routes.length, "separate way"))}${capped ? " (the search stopped there)" : ""} lead from the entry to the destination, between ${ft(shortest)} and ${ft(longest)} long, so there is a choice of path.`,
      scale: ["single path", "a choice of two", "several paths", "a network"],
      index: idx,
    },
    evidence: { routePoints: routes[0].points },
  };
}

// ---- Force-driven -----------------------------------------------------------------------------------------------------------------------------------

function forceDriven(c: Ctx): Part {
  const method = "Reads the inputs the erosion recipe recorded as the forces that generated the geometry: the solvent dose of each source (ft³ of foam it could dissolve), gravity, drain, and how each source treats the floor plates. Their relation to the result is shown as the volume of void made per ft³ of dose. The matrix's examples (required sun-hours, pedestrian counts) are not inputs this system has.";
  const cannot = "Whether the generating force can be read in the finished form. A high gravity setting or a large dose does not prove a legible force-driven form; the result needs to be looked at.";
  const m = c.m;
  if (!m || !m.hasRecipe) return unavailable("not assessable", method, cannot, "This tile carries no erosion recipe (it was lofted, imported or built from other tiles), so the forces that generated it are not recorded and nothing is inferred about them.");
  const total = m.sources.reduce((a, s) => a + s.dose, 0);
  const p = m.prim;
  const modes = [...new Set(m.sources.map((s) => `${s.mode}${s.plateMode !== "pool" ? ` (${s.plateMode}${s.cut ? ", cut" : ""})` : ""}`))];
  const perDose = total > 0 ? m.voidFt3 / total : null;
  const idx = total <= 0 ? 0 : p.gravity < 0.2 ? 1 : p.gravity < 0.5 ? 2 : 3;
  return {
    measure: {
      headline: `${num(total)} ft³ of solvent dose from ${count(m.sources.length, "source")}, gravity ${num(p.gravity, 2)}${p.drain ? ", draining" : ""}`,
      value: total,
      unit: "ft³ of solvent dose (the measurable generating input)",
      status: "measured",
      method,
      cannot,
      supporting: [
        { label: "Gravity", value: `${num(p.gravity, 2)}${p.drain ? ", with a drain" : ""}`, how: "0 spreads the solvent evenly, higher pulls it down so it pools and floors flatten" },
        { label: "Sources", value: modes.join("; ") || "none", how: "how the solvent is applied" },
        { label: "Void made per dose", value: perDose === null ? "n/a" : `${num(perDose, 2)} ft³ per ft³`, how: "void volume of the result over the total dose" },
        { label: "Plate behaviour", value: [...new Set(m.sources.map((s) => s.plateMode))].join(", ") || "none", how: "how the sources treat the floor plates" },
      ],
      used: [],
    },
    interpretation: {
      text: `The recipe's forces are recorded exactly: ${num(total)} ft³ of dose in ${count(m.sources.length, "source")}, gravity ${num(p.gravity, 2)}${perDose === null ? "" : `, and the result has ${num(perDose, 2)} ft³ of void for each ft³ of dose`}. These are the inputs; whether the form shows them is a matter for reading the form.`,
      scale: ["weakly directed", "directed", "strongly directed", "forced"],
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
