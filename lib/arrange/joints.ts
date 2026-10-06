// Joint scoring. A joint is wherever two pieces touch. The pieces may meet in several separate patches (a notch and a step,
// two faces of an L), each on whatever surface the containers really share, not only on the box faces. The joint gets four
// readable parts and one overall number, counted over the real interface cells only (so a big overlap of boxes, or a patch
// that does not touch anything useful, adds nothing):
//   void        void against void, exactly the program's long-standing rule (docs/DATA_FORMAT.md section 5):
//               matched = open on both sides, dead = open on one side only; 100 * matched / (matched + dead)
//   floors      floors that meet at (nearly) the same height; any pair of floor levels may meet, so floor 1 of one tile
//               can meet floor 2 of another; a step bigger than the level tolerance counts against
//   foam        structure touching structure across the joint (no hairline joints)
//   circulation each opening on one side that continues into an opening on the other (a route end meeting a route end)
// null = that part does not apply (nothing opens onto the joint; no floors; ...).
//
// Separately from the score, the joint says what it carries (JointConnect): contact, void connection, walkable route.

import { aggregateScore, ARRANGE_CELL, type Joint, type JointConnect, type JointParts, type JointPatch, type Rating, type Vec3 } from "./types";
import { contactsBetween, findContacts, OTHER_AXES, pieceSig, toFt, type Contact, type PlacedBox } from "./geometry";
import { SOLID, VOID } from "./occupancy";
import { crossingsOf, nearContact, World, type Crossing } from "./walk";

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

/** The two touching layers over the contact patch, as w x h arrays (index u * h + v); cells outside the patch are empty. */
export function contactLayers(c: Contact): Layers {
  const w = c.hi[0] - c.lo[0];
  const h = c.hi[1] - c.lo[1];
  const n = w * h;
  const voidA = new Uint8Array(n);
  const voidB = new Uint8Array(n);
  const foamA = new Uint8Array(n);
  const foamB = new Uint8Array(n);
  const [o1, o2] = OTHER_AXES[c.axis];
  const at = (b: PlacedBox, axisCell: number, u: number, v: number) => {
    const p: [number, number, number] = [0, 0, 0];
    p[c.axis] = axisCell;
    p[o1] = c.lo[0] + u;
    p[o2] = c.lo[1] + v;
    const [, ny, nz] = b.occ.dims;
    const lx = p[0] - b.min[0];
    const ly = p[1] - b.min[1];
    const lz = p[2] - b.min[2];
    return b.occ.cls[(lx * ny + ly) * nz + lz];
  };
  for (let u = 0; u < w; u++)
    for (let v = 0; v < h; v++) {
      const k = u * h + v;
      if (!c.cells[k]) continue;
      const ka = at(c.a, c.plane - 1, u, v);
      const kb = at(c.b, c.plane, u, v);
      if (ka === VOID) voidA[k] = 1;
      else if (ka === SOLID) foamA[k] = 1;
      if (kb === VOID) voidB[k] = 1;
      else if (kb === SOLID) foamB[k] = 1;
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

interface PatchStats {
  matched: number;
  dead: number;
  foamBoth: number;
  foamAny: number;
  floorsTotal: number;
  floorsOk: number;
  steps: number[];
  comps: number;
  met: number;
  matchedA: number;
}

function statsOf(c: Contact, L: Layers, tolFt: number): PatchStats {
  const { w, h } = L;
  const st: PatchStats = { matched: 0, dead: 0, foamBoth: 0, foamAny: 0, floorsTotal: 0, floorsOk: 0, steps: [], comps: 0, met: 0, matchedA: 0 };
  for (let i = 0; i < w * h; i++) {
    if (L.voidA[i] && L.voidB[i]) st.matched++;
    else if (L.voidA[i] !== L.voidB[i]) st.dead++;
    if (L.foamA[i] && L.foamB[i]) st.foamBoth++;
    if (L.foamA[i] || L.foamB[i]) st.foamAny++;
  }
  if (c.axis !== 2) {
    // columns run along z (v); a floor is where a run of void starts
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
        st.floorsTotal++;
        const step = Math.abs(a[0] - best[0]) * ARRANGE_CELL;
        if (step <= tolFt + 1e-6) st.floorsOk++;
        st.steps.push(step);
      }
    }
  }
  const [compsA, metA, matchedA] = componentsMet(L.voidA, L.voidB, w, h);
  const [compsB, metB] = componentsMet(L.voidB, L.voidA, w, h);
  st.comps = compsA + compsB;
  st.met = metA + metB;
  st.matchedA = matchedA;
  return st;
}

export interface JointCore {
  parts: JointParts;
  score: number | null;
  legacy: number | null;
  walkable: boolean;
  floorStepFt: number | null;
  matchedCells: number;
  patches: JointPatch[];
  connect: JointConnect;
}

/** Greedy decomposition of a patch into a few rectangles, so the joint can be drawn exactly where the pieces touch. */
function rectsOf(c: Contact): { min: Vec3; max: Vec3 }[] {
  const w = c.hi[0] - c.lo[0];
  const h = c.hi[1] - c.lo[1];
  const used = new Uint8Array(w * h);
  const [o1, o2] = OTHER_AXES[c.axis];
  const out: { min: Vec3; max: Vec3 }[] = [];
  for (let u = 0; u < w && out.length < 16; u++)
    for (let v = 0; v < h && out.length < 16; v++) {
      const k = u * h + v;
      if (!c.cells[k] || used[k]) continue;
      let v2 = v;
      while (v2 + 1 < h && c.cells[u * h + v2 + 1] && !used[u * h + v2 + 1]) v2++;
      let u2 = u;
      grow: while (u2 + 1 < w) {
        for (let q = v; q <= v2; q++) if (!c.cells[(u2 + 1) * h + q] || used[(u2 + 1) * h + q]) break grow;
        u2++;
      }
      for (let a = u; a <= u2; a++) for (let b = v; b <= v2; b++) used[a * h + b] = 1;
      const min: Vec3 = [0, 0, 0];
      const max: Vec3 = [0, 0, 0];
      min[c.axis] = max[c.axis] = toFt(c.plane);
      min[o1] = toFt(c.lo[0] + u);
      max[o1] = toFt(c.lo[0] + u2 + 1);
      min[o2] = toFt(c.lo[1] + v);
      max[o2] = toFt(c.lo[1] + v2 + 1);
      out.push({ min, max });
    }
  return out;
}

/** `tolFt` is the level tolerance: floors within it count as one level, and a walkable route may step that much. `all` are the pieces near the contacts (for clearance). */
export function scoreContacts(contacts: Contact[], all: PlacedBox[], tolFt: number): JointCore {
  const tolCells = Math.max(1, Math.round(tolFt / ARRANGE_CELL));
  let matched = 0;
  let dead = 0;
  let foamBoth = 0;
  let foamAny = 0;
  let floorsTotal = 0;
  let floorsOk = 0;
  const steps: number[] = [];
  let comps = 0;
  let met = 0;
  let matchedA = 0;
  const patches: JointPatch[] = [];
  const crossings: Crossing[] = [];
  const reached = { floorA: false, floorB: false, standA: false, standB: false, paired: false, significant: false, open: false, clear: false };
  let anyVertical = false;
  for (const c of contacts) {
    const L = contactLayers(c);
    const st = statsOf(c, L, tolFt);
    matched += st.matched;
    dead += st.dead;
    foamBoth += st.foamBoth;
    foamAny += st.foamAny;
    floorsTotal += st.floorsTotal;
    floorsOk += st.floorsOk;
    steps.push(...st.steps);
    comps += st.comps;
    met += st.met;
    matchedA += st.matchedA;
    let patchWalk: Crossing[] = [];
    if (c.axis !== 2 && st.matched >= MIN_COMPONENT_CELLS) {
      const r = crossingsOf(c, L.voidA, L.voidB, new World(nearContact(all, c)), tolCells);
      patchWalk = r.crossings;
      for (const key of Object.keys(reached) as (keyof typeof reached)[]) reached[key] = reached[key] || r.reached[key];
    }
    if (c.axis === 2 && st.matched >= MIN_COMPONENT_CELLS) anyVertical = true;
    crossings.push(...patchWalk);
    patches.push({
      axis: c.axis,
      plane: toFt(c.plane),
      rects: rectsOf(c),
      areaFt2: c.count * ARRANGE_CELL * ARRANGE_CELL,
      voidFt2: st.matched * ARRANGE_CELL * ARRANGE_CELL,
      walkable: patchWalk.length > 0,
    });
  }
  const voidScore = matched + dead > 0 ? (100 * matched) / (matched + dead) : null;
  const floors = floorsTotal > 0 ? (100 * floorsOk) / floorsTotal : null;
  const floorStepFt = steps.length ? [...steps].sort((x, y) => x - y)[Math.floor(steps.length / 2)] : null;
  const foam = foamAny > 0 && (foamBoth > 0 || voidScore !== null) ? (100 * foamBoth) / foamAny : null;
  const circulation = comps > 0 ? (100 * met) / comps : null;
  const voidConnected = met > 0 && matched >= MIN_COMPONENT_CELLS && matchedA > 0;
  const walkable = crossings.length > 0;

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

  let why = "";
  if (!walkable) {
    if (!voidConnected) why = matched === 0 && dead > 0 ? "an opening on one side meets solid material on the other" : "no open space continues across the joint";
    else if (anyVertical && !crossings.length && !reached.paired) why = "the openings meet across a horizontal plane (a shaft): a view, not a route; no stair or ramp joins the floors";
    else if (!reached.floorA || !reached.floorB) why = "the openings meet but there is no floor to stand on " + (!reached.floorA && !reached.floorB ? "on either side" : "on one side");
    else if (!reached.standA || !reached.standB) why = "the passage is too narrow or too low on " + (!reached.standA && !reached.standB ? "both sides" : "one side") + " (it needs 2.5 ft clear width and 6.5 ft headroom)";
    else if (!reached.paired) why = `the floors on the two sides differ by more than the ${tolFt} ft step allowed`;
    else if (!reached.significant) why = "the opening leads into a pocket of floor too small to be a space, not into the tile's circulation";
    else if (!reached.open) why = "the standing places on the two sides do not face each other across the opening";
    else if (!reached.clear) why = "the passage is too narrow or too low (it needs 2.5 ft clear width and 6.5 ft headroom)";
    else why = "no walkable route across the joint";
  }
  const stepFt = crossings.length ? Math.min(...crossings.map((x) => x.stepFt)) : null;
  const connect: JointConnect = {
    contactFt2: contacts.reduce((a, c) => a + c.count, 0) * ARRANGE_CELL * ARRANGE_CELL,
    voidFt2: matched * ARRANGE_CELL * ARRANGE_CELL,
    voidConnected,
    walkable,
    stepFt,
    crossings: [...new Map(crossings.map((x) => [`${x.aId}#${x.zoneA}~${x.bId}#${x.zoneB}`, { aId: x.aId, zoneA: x.zoneA, bId: x.bId, zoneB: x.zoneB }])).values()],
    kind: walkable ? "walkable" : voidConnected ? "void" : "contact",
    why,
  };
  return { parts, score, legacy: voidScore, walkable, floorStepFt, matchedCells: matched, patches, connect };
}

const cache = new Map<string, JointCore>();
export const jointId = (aId: string, bId: string) => (aId < bId ? `${aId}~${bId}` : `${bId}~${aId}`);

/** The joint for one pair of pieces from all the patches where they meet. `all`: the pieces round them (clearance can depend on a third piece). */
export function jointFromContacts(contacts: Contact[], all: PlacedBox[], tolFt: number, ratings: Record<string, Rating> = {}): Joint {
  const first = contacts[0];
  const near = new Map<string, PlacedBox>();
  for (const c of contacts) for (const b of nearContact(all, c)) near.set(b.piece.id, b);
  const key = [...near.values()].map((b) => `${b.piece.id}@${pieceSig(b.piece)}`).sort().join("|") + `|${tolFt}|${contacts.map((c) => `${c.axis}${c.plane}:${c.count}`).join(",")}`;
  let core = cache.get(key);
  if (!core) {
    core = scoreContacts(contacts, [...near.values()], tolFt);
    if (cache.size > 6000) cache.clear();
    cache.set(key, core);
  }
  const big = core.patches.reduce((m, p) => (p.areaFt2 > m.areaFt2 ? p : m), core.patches[0]);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const r of big.rects) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], r.min[k]);
    max[k] = Math.max(max[k], r.max[k]);
  }
  const id = jointId(first.a.piece.id, first.b.piece.id);
  return {
    id,
    aId: first.a.piece.id,
    bId: first.b.piece.id,
    axis: big.axis,
    min,
    max,
    areaFt2: core.connect.contactFt2,
    parts: core.parts,
    score: core.score,
    legacy: core.legacy,
    walkable: core.walkable,
    floorStepFt: core.floorStepFt,
    rating: ratings[id] ?? null,
    patches: core.patches,
    connect: core.connect,
  };
}

/** Groups contacts by pair (a joint is one pair of pieces, whatever number of patches), keeping each pair's lower-side convention of its first patch. */
export function groupByPair(contacts: Contact[]): Contact[][] {
  const m = new Map<string, Contact[]>();
  for (const c of contacts) {
    const k = jointId(c.a.piece.id, c.b.piece.id);
    const g = m.get(k);
    if (g) g.push(c);
    else m.set(k, [c]);
  }
  return [...m.values()];
}

export function computeJoints(boxes: PlacedBox[], tolFt: number, ratings: Record<string, Rating> = {}): Joint[] {
  return groupByPair(findContacts(boxes)).map((g) => jointFromContacts(g, boxes, tolFt, ratings));
}

/** The joint a new box would make with one existing box, scored (null when they do not touch). */
export function jointBetween(p: PlacedBox, q: PlacedBox, tolFt: number, all: PlacedBox[] = [p, q]): Joint | null {
  const cs = contactsBetween(p, q);
  return cs.length ? jointFromContacts(cs, all, tolFt) : null;
}

export const overallScore = (joints: Joint[]) => aggregateScore(joints.map((j) => j.score));
