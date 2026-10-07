// The generator. It does not wander: it PLANS the shape first (lib/arrange/patterns.ts: a list of cells on the lattice the tiles live on), then searches for tiles
// to fill the plan, backing up when a choice leaves something that cannot be put right. A building it returns obeys these rules, all of them, every time:
//
//   floors meet floors   every joint on the way in is a walkable crossing between two floors at the same height (within the program's step), with a score
//                        above the Min joint setting; the score is where openings and voids have to match
//   no dead-end stair    a tile whose main floor climbs (a stair or ramp lives in it) must have a neighbour meeting the TOP of that climb
//   no stranded floor    every floor that counts as a space, in every tile, can be walked to from the entrance (the upper floors that belong to a neighbour
//                        included): there is no dead space
//   one way in           the first cell is the entrance, on the ground, and nothing is below it
//   the program          counts, limits, the site, and the adjacency rules ("never" is never)
//
// What it costs is time, not quality, so there is no clock: the search runs until the plan is filled. The answer to "can tile A stand beside tile B this way" is
// worked out once (lib/arrange/pairs.ts) and remembered, so later runs are quick. `generateSteps` is a generator (it yields progress and can be stopped at any
// point); `generateArrangement` runs it to the end, `generateAsync` runs it without freezing the page.

import type { ParsedTile } from "@/lib/types";
import { analyzeLayout, type Layout } from "./layout";
import { placeBox, toCell, toFt } from "./geometry";
import { placementFree } from "./collision";
import { entryZones, factsOf, pairInfo, partnersOf, stateFor, statesOf, type LState, type PairInfo } from "./pairs";
import { beside, branchCells, planInput, planMetrics, planShape, touches, type Cell } from "./patterns";
import { categoryOf, getOriented, isPlaceable } from "./orient";
import { getOcc } from "./occupancy";
import { ruleBetween, ruleValue } from "./program";
import { mulberry32 } from "./rng";
import { makePiece, newPieceId } from "./ops";
import { allowedByCounts, placeAgainst, scoreCandidate, stateOf } from "./candidates";
import { ARRANGE_CELL, connectorReachFt, type ArrangementDoc, type GenSettings, type Piece, type Priorities, type ProgramRules, type Site } from "./types";

export interface GenContext {
  tileById: Map<string, ParsedTile>;
  /** the tiles the generator may use */
  bank: ParsedTile[];
  rules: ProgramRules;
  priorities: Priorities;
  site: Site;
  settings: GenSettings;
}

export interface GenProgress {
  phase: "planning" | "searching" | "checking";
  attempt: number;
  /** cells filled / cells in the plan, in the deepest search so far in this attempt */
  placed: number;
  total: number;
  nodes: number;
  message: string;
}

/** What was asked, and what the building came out as. */
export interface GenReport {
  asked: { pieces: number; shape: string; tall: number; compact: number; varied: number; branching: boolean };
  got: { pieces: number; levels: number; heightFt: number; widthFt: number; depthFt: number; stackedPairs: number; distinctTiles: number; climbingTiles: number; routeSteps: number };
  attempts: number;
}

export interface GenResult {
  doc: ArrangementDoc;
  notes: string[];
  score: number;
  /** one line on why this result */
  why: string;
  report?: GenReport;
}

export interface GenOptions {
  /** how many pieces the result should have in all (default: the pieces already there plus `settings.amount`, or `settings.amount` for a fresh start) */
  target?: number;
}

const NODE_LIMIT = 30000;
const MAX_ATTEMPTS = 90;
const TRIES_PER_LEVEL = 2;
const CHANCE_TRIES = 5;
/** Growing from pieces that are there: the new cells are chosen at random, so an impossible set of places is not the end of a level: other places are tried. */
const GROW_TRIES = 8;
/** Plans with more cells than this are searched in stages of this many cells. */
const STAGE_AT = 10;
const STAGE = 8;
/** How many cells at the end of a stage are not kept but searched again with the next one. */
const STAGE_OVERLAP = 4;
/** How many stage searches one plan may spend before it counts as not buildable. */
const STAGE_TRIES = 40;
/** [how much of the Tall setting is kept, how much of the Min joint is kept] */
/** How many times over the copies of one tile the variety setting allows are let through when the plan cannot be built without repeating the tiles that climb. */
const CAP_MULT = [1, 2, 4, Infinity];
const LADDER: [number, number][] = [[1, 1], [0.85, 0.9], [0.7, 0.75], [0.55, 0.65], [0.4, 0.5], [0.28, 0.4], [0.18, 0.3], [0.08, 0.15], [0, 0]];
/** A floor that climbs at least this far, ft, is a stair or a ramp: its top must meet something. */
const CLIMB_FT = 6;
/** A floor smaller than this, ft2, is a pocket (a doormat behind a door), not a floor plate: it need not be reached. */
const PLATE_FT2 = 30;
/** How near the top of a climb a crossing must be to count as meeting it, ft. */
const TOP_FT = 3;

// ---- the lattice -----------------------------------------------------------------------------------------------------

interface Lattice {
  /** names the bank, so what is remembered about it is not mixed up with another bank */
  sig: string;
  /** the tile pitch on the plan, cells */
  px: number;
  /** half a tile's height, cells: the vertical step */
  hz: number;
  states: LState[];
  skipped: ParsedTile[];
}

/** The size most tiles in the bank share (a cube of whole cells) sets the lattice; tiles of another size cannot sit on it and are left out. */
function latticeOf(bank: ParsedTile[]): Lattice | null {
  const count = new Map<string, { n: number; dims: [number, number, number] }>();
  const placeable = bank.filter(isPlaceable);
  for (const t of placeable) {
    const d = getOriented(t, 0, false, 1).dims;
    if (d[0] !== d[1]) continue;
    const k = d.join(",");
    count.set(k, { n: (count.get(k)?.n ?? 0) + 1, dims: d });
  }
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return null;
  const states: LState[] = [];
  const skipped: ParsedTile[] = [];
  for (const t of placeable) {
    const d = getOriented(t, 0, false, 1).dims;
    if (d.join(",") === best.dims.join(",")) states.push(...statesOf(t));
    else skipped.push(t);
  }
  let h = 5381;
  for (const ch of states.map((x) => x.id).join(";")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return { sig: String(h), px: best.dims[0], hz: Math.round(best.dims[2] / 2), states, skipped };
}

// ---- what a tile offers -----------------------------------------------------------------------------------------------

const isEntrance = (s: LState): boolean => {
  const f = factsOf(s);
  const main = f.floors.find((x) => x.zone === f.main);
  return !!main && main.loFt <= 3 && f.openFt2["x-"] + f.openFt2["x+"] + f.openFt2["y-"] + f.openFt2["y+"] >= 40;
};

// ---- the search -------------------------------------------------------------------------------------------------------

interface Slot {
  cell: Cell;
  /** the low corner, cells */
  at: [number, number, number];
  /** a piece already there (Grow more): its state is fixed */
  fixed?: LState;
  pieceId?: string;
}

interface Counts {
  copies: Map<string, number>;
  cats: Map<string, number>;
  total: number;
}

function tally(c: Counts, t: ParsedTile, sign: 1 | -1) {
  c.copies.set(t.id, (c.copies.get(t.id) ?? 0) + sign);
  const k = categoryOf(t);
  c.cats.set(k, (c.cats.get(k) ?? 0) + sign);
  c.total += sign;
}

const gumbel = (rng: () => number) => -Math.log(-Math.log(Math.max(1e-9, rng())));

class Blocked {
  reasons = new Map<string, number>();
  add(r: string) {
    this.reasons.set(r, (this.reasons.get(r) ?? 0) + 1);
  }
  top(): string[] {
    return [...this.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  }
}

interface Attempt {
  slots: Slot[];
  states: (LState | null)[];
  depth: number;
  ok: boolean;
  /** the search tried everything and nothing fits (not: it ran out of effort): this plan cannot be built from these tiles */
  impossible: boolean;
}

export interface Val {
  s: LState;
  mask: number;
}

/** Which of the four sides of each cell have no cell beside them (x+, x-, y+, y-): where the way in can be. */
function sidesFree(slots: Slot[]): [boolean, boolean, boolean, boolean][] {
  return slots.map((s) => {
    const free: [boolean, boolean, boolean, boolean] = [true, true, true, true];
    slots.forEach((o) => {
      if (o === s) return;
      const dx = o.cell.x - s.cell.x;
      const dy = o.cell.y - s.cell.y;
      if (Math.abs(o.cell.z - s.cell.z) > 1) return;
      if (dx === 1 && dy === 0) free[0] = false;
      if (dx === -1 && dy === 0) free[1] = false;
      if (dy === 1 && dx === 0) free[2] = false;
      if (dy === -1 && dx === 0) free[3] = false;
    });
    return free;
  });
}

/**
 * Look-ahead over a whole plan: which tiles can stand in each cell and still be followed, cell by cell, to the end of the plan. A value is a tile standing one way and the
 * set of its floors a person has reached when they walk in from the cell it grows from. A cell keeps a value only when every cell that grows from it has a value that it
 * can lead to (the route goes on along a floor that was reached). This is what stops the search spending its effort on a tile that cannot be followed: a piece that has to
 * climb with a neighbour that does not, a turn no tile can make. Returns null when some cell is left with no tile at all: the plan cannot be built from these tiles.
 * Pieces in `preset` keep their tile; pieces already there (`fixed`) are reached on the floors in `known`.
 */
export function planReach(lat: Lattice, slots: Slot[], preset: (LState | null)[], known: Map<number, number[]>, tol: number, minScore: number): Map<string, Val>[] | null {
  const n = slots.length;
  const nb: number[][] = slots.map(() => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (touches(slots[i].cell, slots[j].cell)) {
    nb[i].push(j);
    nb[j].push(i);
  }
  const offset = (a: Slot, b: Slot): [number, number, number] => [b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]];
  const sideFree = sidesFree(slots);
  // A value is a tile standing one way and the set of its floors a person has reached when they walk in from the cell it grows from. A cell keeps a value only
  // when every cell that grows from it has a value that it can lead to (the route goes on along a floor that was reached). This is what stops the search spending
  // its effort on a tile that cannot be followed: a piece that has to climb with a neighbour that does not, a turn no tile can make.
  const bit = (z: number) => (z < 30 ? 1 << z : 0);
  const maskOf = (zs: number[]) => zs.reduce((m, z) => m | bit(z), 0);
  const kids: number[][] = slots.map(() => []);
  slots.forEach((sl, k) => {
    if (sl.cell.parent >= 0 && !sl.fixed) kids[sl.cell.parent].push(k);
  });
    let vals: Map<string, Val>[] = slots.map(() => new Map());
    let alive: Set<string>[] | null = null;
    for (let round = 0; round < 8; round++) {
      const supported = new Map<Val, Map<number, Val[]>>();
      vals = slots.map(() => new Map());
      for (let i = 0; i < n; i++) {
        const sl = slots[i];
        const put = (s: LState, mask: number, from?: Val) => {
          const key = s.id + "#" + mask;
          let v = vals[i].get(key);
          if (!v) vals[i].set(key, (v = { s, mask }));
          if (from) {
            const byCell = supported.get(from) ?? supported.set(from, new Map()).get(from)!;
            (byCell.get(i) ?? byCell.set(i, []).get(i)!).push(v);
          }
        };
        if (sl.fixed) {
          put(sl.fixed, maskOf(known.get(i) ?? factsOf(sl.fixed).floors.map((x) => x.zone)));
          continue;
        }
        if (sl.cell.parent < 0) {
          for (const s of lat.states) {
            if (preset[i] ? s.id !== preset[i]!.id : !isEntrance(s)) continue;
            const m = maskOf(entryZones(s, sideFree[i]));
            if (m) put(s, m);
          }
          continue;
        }
        const pv = vals[sl.cell.parent];
        for (const vp of pv.values()) {
          if (alive && !alive[sl.cell.parent].has(vp.s.id + "#" + vp.mask)) continue;
          for (const p of partnersOf(vp.s, offset(slots[sl.cell.parent], sl), lat.states, lat.sig, tol)) {
            if (p.info.score < minScore) continue;
            if (preset[i] && p.s.id !== preset[i]!.id) continue;
            let m = 0;
            for (const c of p.info.crossings) if (vp.mask & bit(c.za)) m |= bit(c.zb);
            if (!m) continue;
            // a cell that touches nothing but the cells it grows from and into: nothing else can reach its floors or meet the top of its stair
            if (nb[i].every((j) => j === sl.cell.parent || kids[i].includes(j))) {
              const fl = factsOf(p.s).floors;
              if (fl.some((x) => x.areaFt2 >= PLATE_FT2 && !(m & bit(x.zone)))) continue;
              if (!kids[i].length && fl.some((x) => x.hiFt - x.loFt >= CLIMB_FT && m & bit(x.zone) && !p.info.crossings.some((c) => c.zb === x.zone && c.yb >= x.hiFt - TOP_FT))) continue;
            }
            put(p.s, m, vp);
          }
        }
      }
      // a value that leads to nothing in one of its cells' children goes
      const keep: Set<string>[] = slots.map(() => new Set());
      for (let i = n - 1; i >= 0; i--)
        for (const v of vals[i].values()) {
          const sup = supported.get(v);
          if (kids[i].every((k) => (sup?.get(k) ?? []).some((w) => keep[k].has(w.s.id + "#" + w.mask)))) keep[i].add(v.s.id + "#" + v.mask);
        }
      if (slots.some((_, i) => !keep[i].size)) return null;
      const settled = alive !== null && keep.every((k, i) => k.size === alive![i].size);
      alive = keep;
      if (settled) {
        for (let i = 0; i < n; i++) for (const key of [...vals[i].keys()]) if (!keep[i].has(key)) vals[i].delete(key);
        return vals;
      }
    }
    return null;
}

/** The search for one plan. Yields now and then so the caller can show progress or stop. */
function* searchPlan(ctx: GenContext, lat: Lattice, slots: Slot[], firstFree: number, entry: number, known: Map<number, number[]>, limit: number, preset: (LState | null)[], rng: () => number, tol: number, minScore: number, blocked: Blocked, attemptNo: number, capMult: number): Generator<GenProgress, Attempt, void> {
  const n = slots.length;
  const { priorities: pr, rules } = ctx;
  const states: (LState | null)[] = preset.slice();
  const counts: Counts = { copies: new Map(), cats: new Map(), total: 0 };
  for (const s of states) if (s) tally(counts, s.tile, 1);
  const bankTiles = new Set(lat.states.map((s) => s.tile.id)).size;
  const variedW = (pr.varied - 50) / 50;
  const capTier = pr.varied >= 90 ? 1 : pr.varied >= 70 ? 2 : pr.varied >= 45 ? 3 : pr.varied >= 20 ? 4 : Infinity;
  const needCopies = Math.ceil(n / Math.max(1, bankTiles));
  const rulesCap = rules.counts.maxCopies > 0 ? rules.counts.maxCopies : Infinity;
  const copyCap = Math.min(rulesCap, Math.max(capTier, needCopies) * capMult);
  const programW = (pr.program / 100) * 1.5;
  // which cells touch which (plan neighbours), by index
  const nb: number[][] = slots.map(() => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (touches(slots[i].cell, slots[j].cell)) {
    nb[i].push(j);
    nb[j].push(i);
  }
  const offset = (a: Slot, b: Slot): [number, number, number] => [b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]];
  const stackedPair = (a: Slot, b: Slot) => a.cell.x === b.cell.x && a.cell.y === b.cell.y;
  const sideFree = slots.map((s) => {
    const free: [boolean, boolean, boolean, boolean] = [true, true, true, true];
    slots.forEach((o) => {
      if (o === s) return;
      const dx = o.cell.x - s.cell.x;
      const dy = o.cell.y - s.cell.y;
      if (Math.abs(o.cell.z - s.cell.z) > 1) return;
      if (dx === 1 && dy === 0) free[0] = false;
      if (dx === -1 && dy === 0) free[1] = false;
      if (dy === 1 && dx === 0) free[2] = false;
      if (dy === -1 && dx === 0) free[3] = false;
    });
    return free;
  });
  // the floors, as a graph over the cells placed so far, and the rules that need it
  const entranceIdx = entry >= 0 ? entry : slots.findIndex((s) => s.cell.parent < 0 && !s.fixed);
  const pairOf = (i: number, j: number): PairInfo => pairInfo(states[i]!, states[j]!, offset(slots[i], slots[j]), tol);

  let lastReached = new Set<number>();
  let lastTops = new Map<number, number[]>();
  /** Fails (returns a reason) when a cell whose neighbours are all placed has a stranded floor or a dead-end climb. */
  const floorRules = (upTo: number): string | null => {
    const placed: number[] = [];
    for (let i = 0; i < n; i++) if (states[i] && (i <= upTo || slots[i].fixed)) placed.push(i);
    const inSet = new Set(placed);
    // nodes: i*64 + zone; heights per node
    const adj = new Map<number, number[]>();
    const tops = new Map<number, number[]>();
    const link = (u: number, v: number) => {
      (adj.get(u) ?? adj.set(u, []).get(u)!).push(v);
      (adj.get(v) ?? adj.set(v, []).get(v)!).push(u);
    };
    for (const i of placed) for (const j of nb[i]) {
      if (j <= i || !inSet.has(j)) continue;
      const info = pairOf(i, j);
      for (const c of info.crossings) {
        link(i * 64 + c.za, j * 64 + c.zb);
        (tops.get(i * 64 + c.za) ?? tops.set(i * 64 + c.za, []).get(i * 64 + c.za)!).push(c.ya);
        (tops.get(j * 64 + c.zb) ?? tops.set(j * 64 + c.zb, []).get(j * 64 + c.zb)!).push(c.yb);
      }
    }
    const reached = new Set<number>();
    const stack: number[] = [];
    const root = entranceIdx >= 0 ? entranceIdx : placed[0];
    for (const zone of entryZones(states[root]!, sideFree[root])) {
      reached.add(root * 64 + zone);
      stack.push(root * 64 + zone);
    }
    // pieces that are already there: the floors that can be walked to now still can
    for (const [i, zones] of known) for (const zone of zones) if (states[i] && !reached.has(i * 64 + zone)) {
      reached.add(i * 64 + zone);
      stack.push(i * 64 + zone);
    }
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj.get(u) ?? []) if (!reached.has(v)) {
        reached.add(v);
        stack.push(v);
      }
    }
    lastReached = reached;
    lastTops = tops;
    for (const i of placed) {
      if (slots[i].fixed) continue;
      // a cell is closed when everything it touches is placed: nothing else can come to meet its floors
      if (nb[i].some((j) => j > upTo && !slots[j].fixed)) continue;
      for (const f of factsOf(states[i]!).floors) {
        const node = i * 64 + f.zone;
        if (f.areaFt2 >= PLATE_FT2 && !reached.has(node)) return "a floor that nothing else reaches";
        if (f.hiFt - f.loFt >= CLIMB_FT && !(tops.get(node) ?? []).some((y) => y >= f.hiFt - TOP_FT)) return "a stair or ramp that ends nowhere";
      }
    }
    return null;
  };

  /**
   * Looks ahead: a floor plate that nothing reaches yet, or a climb whose top nothing meets yet, needs one of the cells still to come to supply it. Fails (with a
   * reason) when none of them could, whatever tile went there.
   */
  const potential = (i: number): string | null => {
    const st = states[i]!;
    for (const f of factsOf(st).floors) {
      const climbs = f.hiFt - f.loFt >= CLIMB_FT;
      const plate = f.areaFt2 >= PLATE_FT2;
      if (!plate && !climbs) continue;
      const node = i * 64 + f.zone;
      const tops = lastTops.get(node) ?? [];
      const reachedNow = lastReached.has(node) && (!plate || tops.length > 0 || slots[i].cell.parent < 0);
      const topNow = tops.some((y) => y >= f.hiFt - TOP_FT);
      if ((!plate || reachedNow) && (!climbs || topNow)) continue;
      let can = false;
      for (const j of nb[i]) {
        if (states[j] || slots[j].fixed || !beside(slots[i].cell, slots[j].cell)) continue;
        const list = partnersOf(st, offset(slots[i], slots[j]), lat.states, lat.sig, tol);
        if (list.some((p) => p.info.crossings.some((c) => c.za === f.zone && (!climbs || topNow || c.ya >= f.hiFt - TOP_FT)))) {
          can = true;
          break;
        }
      }
      if (!can) return climbs && !topNow ? "a stair or ramp that ends nowhere" : "a floor that nothing else reaches";
    }
    return null;
  };

  const placedBoxes = (upTo: number) => {
    const out = [];
    for (let i = 0; i <= upTo; i++) {
      const s = states[i];
      if (!s) continue;
      const piece: Piece = { id: `s${i}`, tileId: s.tile.id, pos: [toFt(slots[i].at[0]), toFt(slots[i].at[1]), toFt(slots[i].at[2])], rotZ: s.rot, mirrorX: s.mirror, scale: 1, locked: false };
      out.push(placeBox(piece, s.tile));
    }
    return out;
  };

  const countsAllow = (t: ParsedTile): boolean => {
    const copies = counts.copies.get(t.id) ?? 0;
    if (copies >= copyCap) return false;
    const pt = rules.counts.perTile[t.id];
    if (pt && pt.max > 0 && copies >= pt.max) return false;
    const pc = rules.counts.perCategory[categoryOf(t)];
    if (pc && pc.max > 0 && (counts.cats.get(categoryOf(t)) ?? 0) >= pc.max) return false;
    return true;
  };
  const children: number[][] = slots.map(() => []);
  slots.forEach((sl, k) => {
    if (sl.cell.parent >= 0 && !sl.fixed) children[sl.cell.parent].push(k);
  });
  const reach = planReach(lat, slots, preset, known, tol, minScore);
  if (!reach) return { slots, states: preset.slice(), depth: firstFree, ok: false, impossible: true };
  const stateById = new Map(lat.states.map((x) => [x.id, x]));
  const allowed: Set<string>[] = reach.map((m) => new Set([...m.values()].map((v) => v.s.id)));

  let nodes = 0;
  let deepest = (() => {
    let k = 0;
    while (k < slots.length && states[k]) k++;
    return Math.max(firstFree, k);
  })();
  let bestStates: (LState | null)[] = states.slice();

  function* dfs(i: number): Generator<GenProgress, boolean, void> {
    if (i >= limit) return true;
    if (slots[i].fixed || preset[i]) return yield* dfs(i + 1);
    const slot = slots[i];
    const parent = slot.cell.parent;
    // the candidates for this cell, best first
    const cand: { s: LState; v: number }[] = [];
    const parentState = parent >= 0 ? states[parent] : null;
    const options: { s: LState; info: PairInfo | null }[] = parentState ? partnersOf(parentState, offset(slots[parent], slot), lat.states, lat.sig, tol) : lat.states.filter(isEntrance).map((x) => ({ s: x, info: null }));
    for (const { s, info } of options) {
      if (!allowed[i].has(s.id)) continue;
      if (counts.total >= (rules.counts.total.max || Infinity)) {
        blocked.add("the total piece limit");
        break;
      }
      if (!countsAllow(s.tile)) continue;
      const copies = counts.copies.get(s.tile.id) ?? 0;
      let v = 0;
      if (parentState && info) {
        // the way in: a walkable crossing between floors, joint good enough
        if (info.score < minScore) continue;
        const level = ruleBetween(rules, parentState.tile, s.tile, false);
        if (level === "never") continue;
        v += (1.5 * info.score) / 100 + programW * ruleValue(level);
      } else if (categoryOf(s.tile) === "lobby") v += 2;
      v += variedW * (copies === 0 ? 1 : -Math.min(copies, 3) * 0.4);
      const pcat = rules.counts.perCategory[categoryOf(s.tile)];
      if (pcat && pcat.min > 0 && (counts.cats.get(categoryOf(s.tile)) ?? 0) < pcat.min) v += 1.5;
      const ptile = rules.counts.perTile[s.tile.id];
      if (ptile && ptile.min > 0 && copies < ptile.min) v += 1.5;
      v += 0.55 * gumbel(rng);
      cand.push({ s, v });
    }
    cand.sort((a, b) => b.v - a.v);
    if (!cand.length) blocked.add(parent < 0 ? "no tile can be the entrance" : "no tile meets its neighbour with a walkable floor at that height");
    for (const { s } of cand) {
      if (nodes++ > NODE_LIMIT) return false;
      states[i] = s;
      // everything else it touches: no collision, no floors a doorway apart, the program's "never"
      let ok = true;
      for (const j of nb[i]) {
        if (j === parent || !states[j]) continue;
        const info = pairOf(i, j);
        if (!info.free) ok = false;
        else if (info.kind === "connector") ok = false;
        else if (ruleBetween(rules, s.tile, states[j]!.tile, stackedPair(slots[i], slots[j])) === "never") ok = false;
        if (!ok) break;
      }
      if (!ok) {
        blocked.add("a neighbour it would collide with or meet at the wrong height");
        states[i] = null;
        continue;
      }
      // pieces that are not neighbours in the plan can still collide when the tiles are not the lattice's size (kept pieces); check the cells
      if (slots.some((o, j) => j !== i && o.fixed && !nb[i].includes(j))) {
        const box = placeBox({ id: `s${i}`, tileId: s.tile.id, pos: [toFt(slot.at[0]), toFt(slot.at[1]), toFt(slot.at[2])], rotZ: s.rot, mirrorX: s.mirror, scale: 1, locked: false }, s.tile);
        const others = placedBoxes(slots.length - 1).filter((b) => b.piece.id !== `s${i}`);
        if (!placementFree(box, others)) {
          states[i] = null;
          continue;
        }
      }
      tally(counts, s.tile, 1);
      const why = floorRules(i);
      if (why) {
        blocked.add(why);
        tally(counts, s.tile, -1);
        states[i] = null;
        continue;
      }
      // look ahead: this cell's floors, and its placed neighbours', must still be able to be met by the cells that are left
      let lacking: string | null = potential(i);
      if (!lacking) for (const j of nb[i]) if (states[j] && !slots[j].fixed && (lacking = potential(j))) break;
      if (lacking) {
        blocked.add(lacking);
        tally(counts, s.tile, -1);
        states[i] = null;
        continue;
      }
      // forward check: every cell that grows from this one must still have a tile that can meet it
      let starved = false;
      for (const j of children[i]) {
        if (!partnersOf(s, offset(slot, slots[j]), lat.states, lat.sig, tol).some((p) => p.info.score >= minScore && countsAllow(p.s.tile))) {
          starved = true;
          break;
        }
      }
      // and every other cell that touches this one and is still empty must have some tile that can stand there without a collision or a doorway-high near miss
      if (!starved)
        for (const j of nb[i]) {
          if (j <= i || states[j] || slots[j].fixed || children[i].includes(j)) continue;
          let fits = false;
          for (const id of allowed[j]) {
            const info = pairInfo(s, stateById.get(id)!, offset(slot, slots[j]), tol);
            if (info.free && info.kind !== "connector") {
              fits = true;
              break;
            }
          }
          if (!fits) {
            starved = true;
            break;
          }
        }
      if (starved) {
        blocked.add("a neighbour that no tile can meet at that height");
        tally(counts, s.tile, -1);
        states[i] = null;
        continue;
      }
      if (i + 1 > deepest) {
        deepest = i + 1;
        bestStates = states.slice();
      }
      if ((nodes & 63) === 0)
        yield { phase: "searching", attempt: attemptNo, placed: deepest, total: n, nodes, message: `Attempt ${attemptNo + 1}: ${deepest} of ${n} pieces placed` };
      if (yield* dfs(i + 1)) return true;
      tally(counts, s.tile, -1);
      states[i] = null;
    }
    return false;
  }

  const ok = yield* dfs(0);
  return { slots, states: ok ? states : bestStates, depth: ok ? limit : deepest, ok, impossible: !ok && nodes <= NODE_LIMIT };
}

/**
 * A big plan is built in stages: the first stretch is searched and kept, the next is searched beside it, and so on, stepping back a stage when one cannot be built (the
 * floors of a kept piece are still checked once everything beside it is there). Searching the whole plan at once grows too hard for many pieces.
 */
function* stagedSearch(ctx: GenContext, lat: Lattice, slots: Slot[], firstFree: number, entry: number, known: Map<number, number[]>, rng: () => number, tol: number, minScore: number, blocked: Blocked, attemptNo: number, capMult: number): Generator<GenProgress, Attempt, void> {
  const n = slots.length;
  let preset: (LState | null)[] = slots.map((q) => q.fixed ?? null);
  if (n - firstFree <= STAGE_AT) return yield* searchPlan(ctx, lat, slots, firstFree, entry, known, n, preset, rng, tol, minScore, blocked, attemptNo, capMult);
  let committed = firstFree;
  let best: Attempt | null = null;
  let spent = 0;
  while (committed < n && spent < STAGE_TRIES) {
    const limit = Math.min(n, committed + STAGE);
    let done: Attempt | null = null;
    for (let t = 0; t < 4 && !done; t++) {
      spent++;
      const a = yield* searchPlan(ctx, lat, slots, firstFree, entry, known, limit, preset, rng, tol, minScore, blocked, attemptNo, capMult);
      if (a.ok) done = a;
      else if (!best || a.depth > best.depth) best = a;
    }
    if (done) {
      // the last few cells of a stage are searched again with the next stage: a tile that fitted the end of this one may leave nothing that can continue
      const keep = limit >= n ? n : Math.max(committed + 1, limit - STAGE_OVERLAP);
      preset = done.states.map((s, i) => (i < keep || slots[i].fixed ? s : null));
      committed = keep;
    } else {
      if (committed <= firstFree) break;
      const back = Math.max(firstFree, committed - STAGE);
      for (let i = back; i < committed; i++) if (!slots[i].fixed) preset[i] = null;
      committed = back;
    }
  }
  if (committed >= n) return { slots, states: preset, depth: n, ok: true, impossible: false };
  return best ?? { slots, states: preset, depth: committed, ok: false, impossible: false };
}

// ---- turning a plan into a building ------------------------------------------------------------------------------------

function slotsFor(cells: Cell[], origin: [number, number, number], lat: Lattice): Slot[] {
  return cells.map((c) => ({ cell: c, at: [origin[0] + c.x * lat.px, origin[1] + c.y * lat.px, origin[2] + c.z * lat.hz] as [number, number, number] }));
}

const pieceFor = (doc: ArrangementDoc, s: Slot, st: LState): Piece => makePiece(doc, st.tile.id, [toFt(s.at[0]), toFt(s.at[1]), toFt(s.at[2])], { rotZ: st.rot, mirrorX: st.mirror });

function fitsSiteAndLimits(ctx: GenContext, slots: Slot[], lat: Lattice): boolean {
  const { site, rules } = ctx;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const s of slots) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], s.at[k]);
    hi[k] = Math.max(hi[k], s.at[k] + (k === 2 ? 2 * lat.hz : lat.px));
  }
  if (site.enabled) {
    if (toFt(lo[0]) < site.min[0] - 1e-6 || toFt(lo[1]) < site.min[1] - 1e-6 || toFt(hi[0]) > site.min[0] + site.size[0] + 1e-6 || toFt(hi[1]) > site.min[1] + site.size[1] + 1e-6) return false;
    if (site.maxHeight > 0 && toFt(hi[2]) > site.maxHeight + 1e-6) return false;
  }
  const l = rules.limits;
  if (l.maxHeightFt > 0 && toFt(hi[2] - lo[2]) > l.maxHeightFt + 1e-6) return false;
  if (l.maxFootprintFt > 0 && Math.max(toFt(hi[0] - lo[0]), toFt(hi[1] - lo[1])) > l.maxFootprintFt + 1e-6) return false;
  return true;
}

export interface Audit {
  /** floor plates (a floor of 30 ft2 or more) that nobody can walk to from the entrance */
  stranded: number;
  /** stairs and ramps (a floor that climbs 6 ft or more) whose top meets no neighbouring floor */
  deadEnds: number;
}

/** What the generator promises, read back from a finished layout with the program's own analysis: no floor plate nobody can reach, no stair that ends nowhere. */
export function auditBuilding(layout: Layout, skip: Set<string> = new Set()): Audit {
  let stranded = 0;
  let deadEnds = 0;
  for (const b of layout.boxes) {
    const id = b.piece.id;
    if (skip.has(id)) continue;
    for (const f of factsOf(stateFor(b.tile, b.piece.rotZ, b.piece.mirrorX)).floors) {
      if (f.areaFt2 >= PLATE_FT2 && !layout.reachedZones.has(`${id}#${f.zone}`)) stranded++;
      if (f.hiFt - f.loFt >= CLIMB_FT) {
        const top = b.min[2] + Math.round(f.hiFt / ARRANGE_CELL);
        const met = layout.joints.some((j) => j.connect.crossings.some((x) => ((x.aId === id && x.zoneA === f.zone) || (x.bId === id && x.zoneB === f.zone)) && x.floor >= top - TOP_FT / ARRANGE_CELL));
        if (!met) deadEnds++;
      }
    }
  }
  return { stranded, deadEnds };
}

/**
 * New cells for Grow more: each one beside a piece that is already there, in a place where some tile in the bank could actually meet that piece (its face has an opening and
 * a floor there), so the random choice is never wasted on a wall. Once those places are used up, further cells go beside the new ones.
 */
function growCells(cells: Cell[], slots: Slot[], known: Map<number, number[]>, extra: number, rng: () => number, lift: number, knit: number, lat: Lattice, tol: number, bank: LState[]): Cell[] {
  const out = cells.map((c) => ({ ...c }));
  const fixed = slots.filter((q) => q.fixed);
  for (let k = 0; k < extra; k++) {
    let best: { cell: Cell; v: number } | null = null;
    for (const p of fixed) {
      const reachedHere = new Set(known.get(slots.indexOf(p)) ?? []);
      const pi = out.findIndex((c) => c.x === p.cell.x && c.y === p.cell.y && c.z === p.cell.z);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][])
        for (const dz of [-1, 0, 1]) {
          const z = p.cell.z + dz;
          const x = p.cell.x + dx;
          const y = p.cell.y + dy;
          if (z < 0 || out.some((c) => c.x === x && c.y === y && Math.abs(c.z - z) < 2)) continue;
          // some tile must be able to meet a floor of that piece that a person can walk to now
          if (!partnersOf(p.fixed!, [dx * lat.px, dy * lat.px, dz * lat.hz], bank, lat.sig, tol).some((pt) => pt.info.crossings.some((c) => reachedHere.has(c.za)))) continue;
          const near = out.filter((c) => touches(c, { x, y, z })).length;
          const v = Math.pow(near, 0.4 + 2.2 * knit) + rng() * 0.6 + (dz === 1 ? lift * 0.5 : dz === 0 ? 0.2 : 0);
          if (!best || v > best.v) best = { cell: { x, y, z, parent: pi }, v };
        }
    }
    if (best) out.push(best.cell);
    else out.splice(0, out.length, ...branchCells(out, 1, rng, lift, knit));
  }
  return out;
}

/** How good a finished arrangement is as a whole (used to rank replacements and to keep the better of two results). */
export { assemblyScore } from "./candidates";

/**
 * Tiles that are not cubes of one size (a long block, a tall one, an assembly added as a tile) cannot sit on the lattice. A bank with no lattice of its own is grown one
 * piece at a time instead: each piece laid against an opening of one already there (lib/arrange/candidates.ts), the best of a sample of placements, kept only when the
 * whole stays collision-free, one connected piece, and walkable from the entrance. It knows nothing about shapes or levels.
 */
function* looseSteps(ctx: GenContext, base: ArrangementDoc, target: number, notes: string[]): Generator<GenProgress, GenResult, void> {
  const rng = mulberry32(ctx.settings.seed * 7919 + 17);
  const bank = ctx.bank.filter(isPlaceable);
  let doc = base;
  if (!doc.pieces.length) {
    if (!bank.length) return { doc, notes: ["no tile in the bank can be placed"], score: 0, why: "" };
    const lobbies = bank.filter((t) => categoryOf(t) === "lobby");
    const from = lobbies.length ? lobbies : bank;
    const root = makePiece(doc, from[Math.floor(rng() * from.length)].id, [0, 0, 0], { rotZ: Math.floor(rng() * 4), mirrorX: rng() < 0.5 });
    doc = { ...doc, pieces: [root], entranceId: root.id };
  }
  let stopped = false;
  while (doc.pieces.length < target && !stopped) {
    yield { phase: "searching", attempt: 0, placed: doc.pieces.length, total: target, nodes: 0, message: `${doc.pieces.length} of ${target} pieces placed` };
    const st = stateOf(doc.pieces, ctx, true, doc.entranceId);
    const before = st.layout?.unreachable.length ?? 0;
    let best: { score: number; piece: Piece } | null = null;
    for (let k = 0; k < 900 && st.exposed.length; k++) {
      const slot = st.exposed[Math.floor(rng() * st.exposed.length)];
      const tile = bank[Math.floor(rng() * bank.length)];
      if (!allowedByCounts(tile, st, ctx, doc.pieces.length)) continue;
      const r = rng();
      const level = r < 0.4 ? null : r < 0.75 ? (rng() < 0.5 ? 0 : 1) : 2 + 8 * Math.floor(rng() * 40);
      const c = placeAgainst(ctx, st, slot, tile, Math.floor(rng() * 4), rng() < 0.5, Math.floor(rng() * 3), level, ctx.settings.minScore, Math.floor(rng() * 9));
      if (!c) continue;
      const score = scoreCandidate(ctx, st, c) + rng() * 0.2;
      if (best && score <= best.score) continue;
      const trial: ArrangementDoc = { ...doc, pieces: [...doc.pieces, { ...c.piece, id: newPieceId(doc) }] };
      const l = analyzeLayout(trial, ctx.tileById, ctx.rules);
      if (l.overlaps.length === 0 && l.islands.length === 0 && l.unreachable.length <= before) best = { score, piece: trial.pieces[trial.pieces.length - 1] };
    }
    if (!best) stopped = true;
    else doc = { ...doc, pieces: [...doc.pieces, best.piece] };
  }
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const js = layout.joints.filter((j) => j.score !== null);
  const avg = js.length ? js.reduce((a, j) => a + (j.score ?? 0), 0) / js.length : 0;
  if (stopped) notes.push("The tile bank could not satisfy the constraints for the rest: no placement beside the building was walkable, collision-free and within the rules.");
  return { doc: { ...doc, entranceId: doc.entranceId ?? layout.entranceId }, notes, score: avg, why: `${doc.pieces.length} pieces of tiles that do not share one lattice, joints average ${avg.toFixed(0)}.` };
}

/**
 * Plans and searches until it has a building, or has tried every attempt. Yields progress; the return value is the result.
 * `base` holds pieces that stay (the entrance is theirs).
 */
export function* generateSteps(ctx: GenContext, base: ArrangementDoc, opts: GenOptions = {}): Generator<GenProgress, GenResult, void> {
  const settings = ctx.settings;
  const lat = latticeOf(ctx.bank);
  const notes: string[] = [];
  // a bank with no lattice of its own (fewer than two cube tiles of one size), or with a shaped tile (a notch or a step that another tile may nest into: the lattice puts
  // pieces a whole tile apart, so it would never use one), is grown piece by piece instead
  const shaped = ctx.bank.some((t) => {
    if (!isPlaceable(t)) return false;
    const o = getOriented(t, 0, false, 1);
    return getOcc(o).inside < o.dims[0] * o.dims[1] * o.dims[2] * 0.97;
  });
  if (!lat || shaped || new Set(lat.states.map((x) => x.tile.id)).size < 2) {
    notes.push(shaped ? "The bank has tiles with a notch or a step, so the building is grown piece by piece to let them nest: it has no shape and no levels planned." : "The tiles do not share one cube size, so the building is grown piece by piece: it has no shape and no levels planned.");
    return yield* looseSteps(ctx, base, Math.max(1, opts.target ?? (base.pieces.length ? base.pieces.length + settings.amount : settings.amount)), notes);
  }
  if (lat.skipped.length) notes.push(`${lat.skipped.length} tile${lat.skipped.length === 1 ? "" : "s"} of another size were left out: the generator builds on the ${toFt(lat.px)} ft lattice of the rest.`);
  const tol = connectorReachFt(ctx.rules);
  const target = Math.max(1, opts.target ?? (base.pieces.length ? base.pieces.length + settings.amount : settings.amount));
  const fresh = base.pieces.length === 0;
  const blocked = new Blocked();
  let bestPartial: Attempt | null = null;
  let attempts = 0;

  // pieces that stay: they are cells too, when they stand on the lattice
  const keepSlots: Slot[] = [];
  const knownZones = new Map<number, number[]>();
  let origin: [number, number, number] = [0, 0, 0];
  if (!fresh) {
    const first = base.pieces.find((p) => p.id === base.entranceId) ?? base.pieces[0];
    origin = [toCell(first.pos[0]), toCell(first.pos[1]), toCell(first.pos[2])];
    base.pieces.forEach((p) => {
      const t = ctx.tileById.get(p.tileId);
      if (!t || !isPlaceable(t)) return;
      const rel = [toCell(p.pos[0]) - origin[0], toCell(p.pos[1]) - origin[1], toCell(p.pos[2]) - origin[2]];
      const x = rel[0] / lat.px;
      const y = rel[1] / lat.px;
      const z = rel[2] / lat.hz;
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return; // off the lattice: an obstacle, not a neighbour
      const st = statesOf(t).find((s) => s.rot === ((p.rotZ % 4) + 4) % 4 && s.mirror === p.mirrorX && s.dims.join() === `${lat.px},${lat.px},${lat.hz * 2}`);
      if (!st) return;
      keepSlots.push({ cell: { x, y, z, parent: -2 }, at: [origin[0] + x * lat.px, origin[1] + y * lat.px, origin[2] + z * lat.hz], fixed: st, pieceId: p.id });
    });
    if (!keepSlots.length) return { doc: base, notes: ["the pieces already there are not on the 10 ft lattice, so nothing can be grown from them"], score: 0, why: "" };
    // the floors of the pieces already there that a person can walk to now, read by the program's own analysis
    const now = analyzeLayout(base, ctx.tileById, ctx.rules);
    keepSlots.forEach((k, i) => {
      const zones = factsOf(k.fixed!).floors.map((f) => f.zone).filter((z) => now.reachedZones.has(`${k.pieceId}#${z}`));
      knownZones.set(i, zones);
    });
  } else if (ctx.site.enabled) origin = [toCell(ctx.site.min[0] + ctx.site.size[0] / 2 - 10), toCell(ctx.site.min[1] + ctx.site.size[1] / 2 - 10), 0];

  // The plan is tried as asked. When a plan is proven impossible with these tiles (every choice was tried), the next one is a little simpler: not as tall, then a lower
  // bar for the joint. A plan that only ran out of effort is tried again with another seed. The rules about floors are never eased.
  let level = 0;
  let triesAtLevel = 0;
  let capStep = 0;
  for (attempts = 0; attempts < MAX_ATTEMPTS && level < LADDER.length; attempts++) {
    const rng = mulberry32(settings.seed * 7919 + attempts * 104729 + 1);
    const [eased, barScale] = LADDER[level];
    const minScore = ctx.settings.minScore * barScale;
    yield { phase: "planning", attempt: attempts, placed: 0, total: target, nodes: 0, message: `Attempt ${attempts + 1}: planning the ${settings.shape === "free" ? "free-form" : settings.shape} shape${level ? " (simpler)" : ""}` };
    let slots: Slot[];
    let firstFree = 0;
    let entryIdx = -1;
    if (fresh) {
      const fits = (cells: Cell[]) => !!planReach(lat, slotsFor(cells, origin, lat), [], new Map(), tol, minScore);
      const input = planInput(settings, { ...ctx.priorities, tall: ctx.priorities.tall * eased }, settings.direction, rng, target, fits);
      slots = slotsFor(planShape(input), origin, lat);
    } else {
      // grow from what is there: new cells go beside the kept ones
      const cells: Cell[] = keepSlots.map((k) => ({ ...k.cell }));
      const grown = growCells(cells, keepSlots, knownZones, Math.max(0, target - keepSlots.length), rng, (ctx.priorities.tall / 100) * eased, ctx.priorities.compact / 100, lat, tol, lat.states);
      slots = [...keepSlots, ...slotsFor(grown.slice(keepSlots.length), origin, lat)];
      firstFree = keepSlots.length;
      entryIdx = Math.max(0, keepSlots.findIndex((k) => k.pieceId === (base.entranceId ?? keepSlots[0].pieceId)));
    }
    if (!fitsSiteAndLimits(ctx, slots, lat)) {
      blocked.add("the site or a height or footprint limit");
      level++;
      triesAtLevel = 0;
      continue;
    }
    const attempt = yield* stagedSearch(ctx, lat, slots, firstFree, entryIdx, knownZones, rng, tol, minScore, blocked, attempts, CAP_MULT[capStep]);
    if (!bestPartial || attempt.depth > bestPartial.depth) bestPartial = attempt;
    if (attempt.ok) {
      bestPartial = attempt;
      yield { phase: "checking", attempt: attempts, placed: slots.length, total: slots.length, nodes: 0, message: "Checking the whole building" };
      const built = finish(ctx, base, attempt, attempts + 1);
      if (built) return { ...built, notes: [...notes, ...(level ? [ctx.priorities.tall > 0 ? "It is a simpler building than asked for (not as tall): the tiles could not make the first plan work within the floor rules." : "The first plan could not be built within the floor rules, so the joints are held to a lower score than the Min joint setting."] : []), ...built.notes] };
      blocked.add("the whole building did not pass the final check");
      bestPartial = { ...attempt, ok: false, depth: attempt.depth - 1 };
    }
    triesAtLevel++;
    // a plan that has some chance in it (a mass, a free form, wings) is tried with other seeds before it is given up on; one that is always the same is not
    const chancy = settings.shape === "compact" || settings.shape === "free" || settings.shape === "bridge" || !!settings.branching;
    const tries = fresh ? (chancy ? CHANCE_TRIES : TRIES_PER_LEVEL) : GROW_TRIES;
    if ((fresh && attempt.impossible && !chancy) || triesAtLevel >= tries) {
      triesAtLevel = 0;
      // the height asked for comes first: a tower is a chain of the few tiles that climb, so before it is made lower, the same tile may be used more often
      if (capStep < CAP_MULT.length - 1) capStep++;
      else {
        level++;
        capStep = 0;
      }
    }
  }

  // nothing passed in every attempt: the deepest plan that kept every rule, as far as it got
  if (bestPartial) {
    const built = finish(ctx, base, { ...bestPartial, states: bestPartial.states.map((s) => s), ok: false }, attempts, true);
    if (built) {
      const why = blocked.top();
      return { ...built, notes: [...notes, `Built ${built.doc.pieces.length - base.pieces.length} of ${target - base.pieces.length} new pieces: no tile fitted the rest within the rules.`, ...(why.length ? [`What stopped it most: ${why.join("; ")}.`] : []), ...built.notes] };
    }
  }
  return { doc: base, notes: [...notes, `Nothing could be built within the rules${blocked.top().length ? `: ${blocked.top().join("; ")}` : ""}.`], score: 0, why: "" };
}

/** Builds the document from a finished search and checks the whole building with the program's own analysis. */
function finish(ctx: GenContext, base: ArrangementDoc, att: Attempt, attempts: number, partial = false): GenResult | null {
  const pieces: Piece[] = [...base.pieces];
  let doc: ArrangementDoc = { ...base, pieces };
  let entranceId = base.entranceId;
  const placedStates = att.states.map((s, i) => ({ s, slot: att.slots[i] }));
  for (const { s, slot } of placedStates) {
    if (!s || slot.fixed) continue;
    const piece = pieceFor(doc, slot, s);
    pieces.push(piece);
    doc = { ...doc, pieces };
    if (slot.cell.parent < 0 && !entranceId) entranceId = piece.id;
  }
  if (partial && pieces.length === base.pieces.length) return null;
  doc = { ...doc, pieces, entranceId };
  let layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const keptIds = new Set(base.pieces.map((p) => p.id));
  let audit = auditBuilding(layout, keptIds);
  const sound = () => !layout.overlaps.length && !layout.islands.length && !layout.unreachable.length && !audit.stranded && !audit.deadEnds;
  if (partial) {
    // as many pieces as keep every rule: pieces come in plan order, each beside an earlier one, so a shorter list is still one connected building, and taking away the last
    // ones takes away what a floor or a stair at the edge was waiting for
    while (pieces.length > base.pieces.length + 1 && !sound()) {
      pieces.pop();
      doc = { ...doc, pieces };
      layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
      audit = auditBuilding(layout, keptIds);
    }
    if (!sound()) return null;
  }
  if (!partial && !sound()) return null;
  const metrics = planMetrics(att.slots.filter((s, i) => att.states[i] && !s.fixed || s.fixed).map((s) => s.cell));
  const tilesUsed = new Set(pieces.map((p) => p.tileId));
  const lo = layout.bounds?.min ?? [0, 0, 0];
  const hi = layout.bounds?.max ?? [0, 0, 0];
  const js = layout.joints.filter((j) => j.score !== null);
  const avg = js.length ? js.reduce((a, j) => a + (j.score ?? 0), 0) / js.length : 0;
  const climbing = layout.boxes.filter((b) => factsOf(stateFor(b.tile, b.piece.rotZ, b.piece.mirrorX)).climbFt >= CLIMB_FT).length;
  const report: GenReport = {
    asked: { pieces: ctx.settings.amount, shape: ctx.settings.shape, tall: ctx.priorities.tall, compact: ctx.priorities.compact, varied: ctx.priorities.varied, branching: !!ctx.settings.branching },
    got: { pieces: pieces.length, levels: metrics.levels, heightFt: toFt(hi[2] - lo[2]), widthFt: toFt(hi[0] - lo[0]), depthFt: toFt(hi[1] - lo[1]), stackedPairs: metrics.stackedPairs, distinctTiles: tilesUsed.size, climbingTiles: climbing, routeSteps: layout.walk.size },
    attempts,
  };
  const why = `${pieces.length} pieces, ${ctx.settings.shape} shape${ctx.settings.branching ? " with wings" : ""}, ${metrics.levels} level${metrics.levels === 1 ? "" : "s"} (${report.got.heightFt.toFixed(0)} ft), ${tilesUsed.size} different tiles, joints average ${avg.toFixed(0)}.`;
  return { doc: { ...doc, entranceId: doc.entranceId ?? layout.entranceId }, notes: [], score: avg, why, report };
}

// ---- running it ----------------------------------------------------------------------------------------------------

/** Runs to the end (scripts, tests). */
export function generateArrangement(ctx: GenContext, base: ArrangementDoc, opts: GenOptions = {}): GenResult {
  const it = generateSteps(ctx, base, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Runs any of the step generators without freezing the page: gives the browser a turn every few milliseconds, reports progress, and stops when the signal says so (then resolves to null). */
export async function drive(it: Generator<GenProgress, GenResult, void>, onProgress?: (p: GenProgress) => void, signal?: AbortSignal): Promise<GenResult | null> {
  let last = Date.now();
  for (;;) {
    if (signal?.aborted) return null;
    const r = it.next();
    if (r.done) return r.value;
    if (Date.now() - last > 40) {
      onProgress?.(r.value);
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
  }
}

export const generateAsync = (ctx: GenContext, base: ArrangementDoc, opts: GenOptions = {}, onProgress?: (p: GenProgress) => void, signal?: AbortSignal) => drive(generateSteps(ctx, base, opts), onProgress, signal);

/** Removes the branch that grew past each bad joint (and everything only reachable through it, except locked pieces), then grows it back. */
export function* regenerateSteps(ctx: GenContext, doc: ArrangementDoc, badJointIds: Set<string>, target: number): Generator<GenProgress, GenResult, void> {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const root = layout.entranceId ?? doc.pieces[0]?.id;
  const adj = new Map<string, string[]>();
  for (const b of layout.boxes) adj.set(b.piece.id, []);
  for (const j of layout.joints) {
    adj.get(j.aId)!.push(j.bId);
    adj.get(j.bId)!.push(j.aId);
  }
  const depth = new Map<string, number>([[root, 0]]);
  const children = new Map<string, string[]>();
  const queue = [root];
  for (let i = 0; i < queue.length; i++)
    for (const n of adj.get(queue[i]) ?? []) if (!depth.has(n)) {
      depth.set(n, depth.get(queue[i])! + 1);
      children.set(queue[i], [...(children.get(queue[i]) ?? []), n]);
      queue.push(n);
    }
  const locked = new Set(doc.pieces.filter((p) => p.locked).map((p) => p.id));
  const remove = new Set<string>();
  for (const j of layout.joints) {
    if (!badJointIds.has(j.id)) continue;
    const child = (depth.get(j.aId) ?? 0) > (depth.get(j.bId) ?? 0) ? j.aId : j.bId;
    const stack = [child];
    while (stack.length) {
      const id = stack.pop()!;
      if (remove.has(id) || id === root) continue;
      remove.add(id);
      for (const c of children.get(id) ?? []) stack.push(c);
    }
  }
  // locked pieces stay, and so does the path that holds them
  for (const id of locked) {
    for (let cur: string | undefined = id; cur && remove.has(cur); ) {
      remove.delete(cur);
      cur = [...children.entries()].find(([, kids]) => kids.includes(cur!))?.[0];
    }
  }
  const kept: ArrangementDoc = { ...doc, pieces: doc.pieces.filter((p) => !remove.has(p.id)), ratings: Object.fromEntries(Object.entries(doc.ratings).filter(([k]) => !badJointIds.has(k))) };
  return yield* generateSteps(ctx, kept, { target: Math.max(target, kept.pieces.length + 1) });
}

export const regenerateAsync = (ctx: GenContext, doc: ArrangementDoc, bad: Set<string>, target: number, onProgress?: (p: GenProgress) => void, signal?: AbortSignal) => drive(regenerateSteps(ctx, doc, bad, target), onProgress, signal);

export function regenerateMarked(ctx: GenContext, doc: ArrangementDoc, badJointIds: Set<string>, target: number): GenResult {
  const it = regenerateSteps(ctx, doc, badJointIds, target);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

