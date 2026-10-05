// Joint scoring. A joint is wherever two pieces touch. It gets four readable parts and one overall number:
//   void        void against void, exactly the program's long-standing rule (docs/DATA_FORMAT.md section 5):
//               matched = open on both sides, dead = open on one side only; 100 * matched / (matched + dead)
//   floors      floors that meet at (nearly) the same height; any pair of floor levels may meet, so floor 1 of one tile
//               can meet floor 2 of another; a step bigger than the level tolerance counts against
//   foam        structure touching structure across the joint (no hairline joints)
//   circulation each opening on one side that continues into an opening on the other (a route end meeting a route end)
// null = that part does not apply (nothing opens onto the joint; no floors; ...).

import { aggregateScore, ARRANGE_CELL, type Joint, type JointParts, type Rating, type Vec3 } from "./types";
import { contactBetween, findContacts, localIndex, pieceSig, toFt, type Contact, type PlacedBox } from "./geometry";

const WEIGHTS = { void: 0.4, floors: 0.25, circulation: 0.2, foam: 0.15 };
const MIN_COMPONENT_CELLS = Math.round(4 / (ARRANGE_CELL * ARRANGE_CELL)); // an opening of 4 ft2 or more
const MIN_FLOOR_OVERLAP = 2; // cells (1 ft) of shared height before two floor runs count as the same level

export interface Layers {
  w: number;
  h: number;
  voidA: Uint8Array;
  voidB: Uint8Array;
  foamA: Uint8Array;
  foamB: Uint8Array;
}

/** The two touching layers over the contact rectangle, as w x h arrays (index u * h + v). */
export function contactLayers(c: Contact): Layers {
  const w = c.hi[0] - c.lo[0];
  const h = c.hi[1] - c.lo[1];
  const n = w * h;
  const voidA = new Uint8Array(n);
  const voidB = new Uint8Array(n);
  const foamA = new Uint8Array(n);
  const foamB = new Uint8Array(n);
  const at = (b: PlacedBox, axisCell: number, u: number, v: number) => {
    const p: [number, number, number] = [0, 0, 0];
    p[c.axis] = axisCell;
    const others = c.axis === 0 ? [1, 2] : c.axis === 1 ? [0, 2] : [0, 1];
    p[others[0]] = c.lo[0] + u;
    p[others[1]] = c.lo[1] + v;
    return localIndex(b, p[0], p[1], p[2]);
  };
  for (let u = 0; u < w; u++)
    for (let v = 0; v < h; v++) {
      const k = u * h + v;
      const ia = at(c.a, c.plane - 1, u, v);
      const ib = at(c.b, c.plane, u, v);
      if (ia >= 0 && (!c.a.o.mask || c.a.o.mask[ia])) {
        if (c.a.o.void[ia]) voidA[k] = 1;
        else foamA[k] = 1;
      }
      if (ib >= 0 && (!c.b.o.mask || c.b.o.mask[ib])) {
        if (c.b.o.void[ib]) voidB[k] = 1;
        else foamB[k] = 1;
      }
    }
  return { w, h, voidA, voidB, foamA, foamB };
}

/** How many cells of the component(s) of `layer` meet void on the other layer: returns [components, met components, matched cells]. */
function componentsMet(layer: Uint8Array, other: Uint8Array, w: number, h: number): [number, number, number] {
  const seen = new Uint8Array(w * h);
  let comps = 0;
  let met = 0;
  let matched = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!layer[s] || seen[s]) continue;
    let n = 0;
    let hit = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      if (other[i]) hit++;
      const u = (i / h) | 0;
      const v = i - u * h;
      if (u > 0 && layer[i - h] && !seen[i - h]) { seen[i - h] = 1; stack.push(i - h); }
      if (u < w - 1 && layer[i + h] && !seen[i + h]) { seen[i + h] = 1; stack.push(i + h); }
      if (v > 0 && layer[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (v < h - 1 && layer[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    }
    if (n < MIN_COMPONENT_CELLS) continue;
    comps++;
    if (hit * 2 >= n) {
      met++;
      matched += hit;
    }
  }
  return [comps, met, matched];
}

function runsOf(col: Uint8Array, base: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let v = 0; v <= h; v++) {
    const on = v < h && col[base + v] !== 0;
    if (on && s < 0) s = v;
    else if (!on && s >= 0) {
      out.push([s, v]);
      s = -1;
    }
  }
  return out;
}

export interface JointCore {
  parts: JointParts;
  score: number | null;
  legacy: number | null;
  walkable: boolean;
  floorStepFt: number | null;
  matchedCells: number;
}

/** `tolFt` is the level tolerance: floors within it count as one level. */
export function scoreContact(c: Contact, tolFt: number): JointCore {
  const L = contactLayers(c);
  const { w, h } = L;
  let matched = 0;
  let dead = 0;
  let foamBoth = 0;
  let foamAny = 0;
  for (let i = 0; i < w * h; i++) {
    if (L.voidA[i] && L.voidB[i]) matched++;
    else if (L.voidA[i] !== L.voidB[i]) dead++;
    if (L.foamA[i] && L.foamB[i]) foamBoth++;
    if (L.foamA[i] || L.foamB[i]) foamAny++;
  }
  const voidScore = matched + dead > 0 ? (100 * matched) / (matched + dead) : null;

  let floors: number | null = null;
  let floorStepFt: number | null = null;
  if (c.axis !== 2) {
    // columns run along z (v); a floor is where a run of void starts
    let total = 0;
    let ok = 0;
    const steps: number[] = [];
    for (let u = 0; u < w; u++) {
      const ra = runsOf(L.voidA, u * h, h);
      const rb = runsOf(L.voidB, u * h, h);
      for (const a of ra) {
        // the floor on the other side that this one meets: of the runs it shares height with, the one whose floor is nearest
        let best: [number, number] | null = null;
        for (const b of rb) {
          if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) < MIN_FLOOR_OVERLAP) continue;
          if (!best || Math.abs(a[0] - b[0]) < Math.abs(a[0] - best[0])) best = b;
        }
        if (!best) continue;
        total++;
        const step = Math.abs(a[0] - best[0]) * ARRANGE_CELL;
        if (step <= tolFt + 1e-6) ok++;
        steps.push(step);
      }
    }
    if (total > 0) {
      floors = (100 * ok) / total;
      // the typical step, not the worst: one column where a plate ends at the joint should not condemn the whole joint
      floorStepFt = steps.sort((x, y) => x - y)[Math.floor(steps.length / 2)];
    }
  }

  const foam = foamAny > 0 && (foamBoth > 0 || voidScore !== null) ? (100 * foamBoth) / foamAny : null;

  const [compsA, metA, matchedA] = componentsMet(L.voidA, L.voidB, w, h);
  const [compsB, metB] = componentsMet(L.voidB, L.voidA, w, h);
  const circulation = compsA + compsB > 0 ? (100 * (metA + metB)) / (compsA + compsB) : null;
  const walkable = metA + metB > 0 && matched >= MIN_COMPONENT_CELLS && matchedA > 0;

  const parts: JointParts = { void: voidScore, floors, foam, circulation };
  let score: number | null = null;
  if (voidScore !== null) {
    let sum = 0;
    let wsum = 0;
    for (const k of ["void", "floors", "circulation", "foam"] as const) {
      const v = parts[k];
      if (v === null) continue;
      sum += WEIGHTS[k] * v;
      wsum += WEIGHTS[k];
    }
    score = wsum > 0 ? sum / wsum : null;
  }
  return { parts, score, legacy: voidScore, walkable, floorStepFt, matchedCells: matched };
}

const cache = new Map<string, JointCore>();
export const jointId = (aId: string, bId: string) => (aId < bId ? `${aId}~${bId}` : `${bId}~${aId}`);

export function jointFromContact(c: Contact, tolFt: number, ratings: Record<string, Rating> = {}): Joint {
  const k = `${pieceSig(c.a.piece)}|${pieceSig(c.b.piece)}|${tolFt}`;
  let core = cache.get(k);
  if (!core) {
    core = scoreContact(c, tolFt);
    if (cache.size > 6000) cache.clear();
    cache.set(k, core);
  }
  const others = c.axis === 0 ? [1, 2] : c.axis === 1 ? [0, 2] : [0, 1];
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  min[c.axis] = max[c.axis] = toFt(c.plane);
  min[others[0]] = toFt(c.lo[0]);
  max[others[0]] = toFt(c.hi[0]);
  min[others[1]] = toFt(c.lo[1]);
  max[others[1]] = toFt(c.hi[1]);
  const id = jointId(c.a.piece.id, c.b.piece.id);
  return {
    id,
    aId: c.a.piece.id,
    bId: c.b.piece.id,
    axis: c.axis,
    min,
    max,
    areaFt2: (c.hi[0] - c.lo[0]) * (c.hi[1] - c.lo[1]) * ARRANGE_CELL * ARRANGE_CELL,
    parts: core.parts,
    score: core.score,
    legacy: core.legacy,
    walkable: core.walkable,
    floorStepFt: core.floorStepFt,
    rating: ratings[id] ?? null,
  };
}

export function computeJoints(boxes: PlacedBox[], tolFt: number, ratings: Record<string, Rating> = {}): Joint[] {
  return findContacts(boxes).map((c) => jointFromContact(c, tolFt, ratings));
}

/** The joint a new box would make with one existing box, scored (null when they do not touch). */
export function jointBetween(p: PlacedBox, q: PlacedBox, tolFt: number): Joint | null {
  const c = contactBetween(p, q);
  return c ? jointFromContact(c, tolFt) : null;
}

export const overallScore = (joints: Joint[]) => aggregateScore(joints.map((j) => j.score));

