// The shape of a building, planned before any tile is chosen. A plan is a list of CELLS on the lattice the tiles live on: x and y in whole tiles (20 ft for the
// standard cube), z in HALF tiles (10 ft). Every shape is built from the same few moves, so every shape works the same way:
//
//   - Pieces beside each other are at the same height or one half-tile (10 ft) apart: a floor at 2 ft against a floor at 12 ft. Two pieces in one column are a
//     whole tile apart (stacked). Half a tile apart in one column is a collision, so it never happens.
//   - Climbing is staggered. Neighbouring columns take opposite phases (one column's pieces at 0, 20, 40 ft, the next one's at 10, 30, 50 ft), so each piece sits
//     beside the floor of the piece next to it that is 10 ft higher or lower. A piece above another is reached from the next column, never through its own roof.
//   - The entrance is the first cell, on the ground, and nothing is below it (every z is 0 or more).
//
// `branching` turns the last third of a plan into wings that grow out of the core; off, the whole plan is the shape (a uniform tower, terrace or courtyard).
// The tall shapes (tower, compact, village, bridge) are built round a SPIRAL CLIMB: every piece one half-tile above the one before, winding round a hollow square. The
// sliders move the plan itself: Tall chooses how many levels there are (how much of the building is the climb; at 0 every plan is flat), Compact how tight it packs. generate.ts then finds tiles that satisfy the floor rules in the plan, and when a plan proves
// impossible with the tiles at hand it asks for the same plan with less Tall.

import type { GenSettings, Priorities, ShapeKind } from "./types";

export interface Cell {
  x: number;
  y: number;
  /** half-tiles (10 ft) above the ground */
  z: number;
  /** the cell it grows from (index in the plan), -1 for the entrance. Always beside it, never above or below it in one column. */
  parent: number;
}

type Rng = () => number;
/** Says whether the tiles could build a plan: used to grow a plan only into places that can be built. */
export type Fits = (cells: Cell[]) => boolean;
type Pt = { x: number; y: number; z: number };



/** Beside each other (one tile apart on the plan, at most one half-tile apart in height) or stacked (one tile apart in height). */
export const touches = (a: Pt, b: Pt): boolean => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const dz = Math.abs(a.z - b.z);
  return (dx + dy === 1 && dz <= 1) || (dx + dy === 0 && dz === 2);
};
export const beside = (a: Pt, b: Pt): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 && Math.abs(a.z - b.z) <= 1;
const clashes = (cells: Pt[], x: number, y: number, z: number): boolean => cells.some((c) => c.x === x && c.y === y && Math.abs(c.z - z) < 2);

const DIRS4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

interface Col {
  x: number;
  y: number;
  /** 0 or 1: the height of the lowest piece, half-tiles */
  phase: number;
  /** pieces that may stand in the column, one tile apart */
  depth: number;
}

/**
 * Takes cells from a set of columns, lowest `prio` first, each one beside a cell already taken (so the plan is one connected piece). The entrance is the best
 * ground cell.
 */
function pick(cols: Col[], n: number, prio: (c: Col, m: number) => number, rng: Rng, jitter = 0.15): Cell[] {
  const out: Cell[] = [];
  const per = new Map<string, number>();
  const colKey = (c: Col) => `${c.x},${c.y}`;
  const grounds = cols.filter((c) => c.phase === 0 && c.depth > 0);
  if (!grounds.length) return out;
  const start = grounds.reduce((best, c) => (prio(c, 0) + rng() * jitter < prio(best, 0) + rng() * jitter ? c : best), grounds[0]);
  out.push({ x: start.x, y: start.y, z: 0, parent: -1 });
  per.set(colKey(start), 1);
  while (out.length < n) {
    let best: { c: Col; m: number; z: number; parent: number; v: number } | null = null;
    for (const c of cols) {
      const m = per.get(colKey(c)) ?? 0;
      if (m >= c.depth) continue;
      const z = c.phase + 2 * m;
      // beside a cell that is already there: the route into the new piece
      let parent = -1;
      for (let i = 0; i < out.length; i++) if (beside(out[i], { x: c.x, y: c.y, z })) {
        parent = i;
        break;
      }
      if (parent < 0) continue;
      const v = prio(c, m) + rng() * jitter;
      if (!best || v < best.v) best = { c, m, z, parent, v };
    }
    if (!best) break;
    out.push({ x: best.c.x, y: best.c.y, z: best.z, parent: best.parent });
    per.set(colKey(best.c), best.m + 1);
  }
  return out;
}

/**
 * Grows `extra` more cells outward from the cells there, each beside one of them: the wings. `lift` (0..1) favours climbing (at 0 every wing stays level), `knit` favours
 * places that touch more of the mass, `topZ` is the highest a wing may go.
 */
export function branchCells(cells: Cell[], extra: number, rng: Rng, lift: number, knit: number, topZ = Infinity, ok?: Fits): Cell[] {
  const out = cells.map((c) => ({ ...c }));
  for (let k = 0; k < extra; k++) {
    const found: { cell: Cell; v: number }[] = [];
    for (let s = 0; s < (ok ? 90 : 40); s++) {
      const pi = Math.floor(rng() * out.length);
      const p = out[pi];
      const [dx, dy] = DIRS4[Math.floor(rng() * 4)];
      const r = rng();
      const up = 0.5 * lift;
      const dz = r < up ? 1 : r < up + 0.12 * lift ? -1 : 0;
      const z = p.z + dz;
      if (z < 0 || z > topZ) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (clashes(out, x, y, z)) continue;
      const near = out.filter((c) => touches(c, { x, y, z })).length;
      const v = Math.pow(near, 0.4 + 2.2 * knit) + rng() * 0.6;
      found.push({ cell: { x, y, z, parent: pi }, v });
    }
    // the best place, or (when the caller can say whether the tiles could build it) the best place where they can
    found.sort((a, b) => b.v - a.v);
    let best: { cell: Cell; v: number } | null = null;
    const tried = new Set<string>();
    for (const c of found) {
      const key = `${c.cell.x},${c.cell.y},${c.cell.z}`;
      if (tried.has(key)) continue;
      tried.add(key);
      if (!ok || ok([...out, c.cell])) {
        best = c;
        break;
      }
      if (tried.size >= 14) break;
    }
    if (!best) break;
    out.push(best.cell);
  }
  return out;
}

const rotate = (cells: Cell[], turns: number): Cell[] =>
  cells.map((c) => {
    let { x, y } = c;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [x, y] = [-y, x];
    return { ...c, x, y };
  });

/** Slides the plan so its entrance is the origin. */
const normalise = (cells: Cell[]): Cell[] => {
  if (!cells.length) return cells;
  const r = cells[0];
  return cells.map((c) => ({ ...c, x: c.x - r.x, y: c.y - r.y }));
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface PlanInput {
  shape: ShapeKind;
  n: number;
  direction: number;
  /** 0..1 */
  tall: number;
  compact: number;
  branching: boolean;
  rng: Rng;
  /** when given, extra pieces are only put where this says the tiles can build the plan */
  fits?: Fits;
}

export const planInput = (g: GenSettings, p: Priorities, direction: number, rng: Rng, n = g.amount, fits?: Fits): PlanInput => ({ shape: g.shape, n, direction, tall: p.tall / 100, compact: p.compact / 100, branching: !!g.branching, rng, fits });

/** The cells of a shape: the core, then wings when branching is on. The first cell is the entrance. */
export function planShape(inp: PlanInput): Cell[] {
  const { shape, n, tall, compact, rng, fits } = inp;
  const core = shape === "free" ? n : inp.branching ? Math.max(2, Math.ceil(n * 0.65)) : n;
  let cells = core > 0 ? corePlan(shape, core, tall, compact, rng, fits) : [];
  // a shape's columns can be fewer than the pieces asked for: the rest of the pieces extend it
  if (cells.length < n) cells = branchCells(cells, n - cells.length, rng, tall, compact, Infinity, fits);
  return normalise(rotate(cells, inp.direction));
}

function corePlan(shape: ShapeKind, n: number, tall: number, compact: number, rng: Rng, fits?: Fits): Cell[] {
  const cols: Col[] = [];
  const add = (x: number, y: number, phase: number, depth: number) => cols.push({ x, y, phase, depth });
  /** how many pieces share a level in a terrace or a slope: all in one at Tall 0 (flat), one to a level at Tall 100 */
  const plateauOf = () => (tall <= 0.05 ? 999 : Math.max(1, 3 - Math.round(tall * 2)));
  switch (shape) {
    case "spineV": {
      // a tower that is a spiral: every piece of the climb is one half-tile (10 ft) higher than the one before and winds round a hollow square (2 x 2 pieces when
      // compact, 3 x 3 when not), so the building rises with every block. Tall decides how many of the pieces are the climb; the rest stand beside it at the levels it
      // reaches (none at Tall 100: the whole building is the spiral; at Tall 0 it is one level).
      const ringTiles = compact >= 0.35 ? 2 : 3;
      const ring: [number, number][] = [];
      for (let i = 0; i < ringTiles; i++) ring.push([i, 0]);
      for (let j = 1; j < ringTiles; j++) ring.push([ringTiles - 1, j]);
      for (let i = ringTiles - 2; i >= 0; i--) ring.push([i, ringTiles - 1]);
      for (let j = ringTiles - 2; j >= 1; j--) ring.push([0, j]);
      if (rng() < 0.5) ring.reverse();
      // start the winding at a corner of the ring that has a neighbour on each side along the ring
      const climbN = Math.max(1, Math.min(n, Math.round(lerp(1, n, Math.pow(tall, 0.8)))));
      const out: Cell[] = [];
      for (let i = 0; i < climbN; i++) {
        const [x, y] = ring[i % ring.length];
        out.push({ x, y, z: i, parent: i - 1 });
      }
      return climbN < n ? branchCells(out, n - climbN, rng, 0, compact, Infinity, fits) : out;
    }
    case "spineH": {
      // a long bar: one or two rows, with raised bays along it when tall (each change of level is one climbing tile, so the bays are few and long)
      const rows = compact > 0.66 ? 2 : 1;
      const len = Math.ceil(n / rows) + 2;
      const bays = tall <= 0.2 ? 1 : 1 + Math.round(tall * 3);
      const bayLen = Math.max(2, Math.ceil(len / bays));
      for (let x = 0; x < len; x++) for (let y = 0; y < rows; y++) add(x, y, bays === 1 ? 0 : Math.floor(x / bayLen) & 1, 1);
      return pick(cols, n, (c) => c.x + 0.3 * Math.abs(c.y), rng);
    }
    case "courtyard": {
      // a ring round an open middle. At Tall 0 it is flat; otherwise a stretch of the ring is a level higher (two changes of level, each one climbing tile), and
      // when tall is high some of the pieces stack on the low part, reached from the raised one.
      const k = Math.max(3, Math.ceil(n / 4) + 1 + (compact < 0.35 ? 1 : 0));
      const ring: [number, number][] = [];
      for (let i = 0; i < k; i++) ring.push([i, 0]);
      for (let j = 1; j < k; j++) ring.push([k - 1, j]);
      for (let i = k - 2; i >= 0; i--) ring.push([i, k - 1]);
      for (let j = k - 2; j >= 1; j--) ring.push([0, j]);
      const raised = tall <= 0.1 ? 0 : Math.max(2, Math.round(ring.length * (0.25 + 0.3 * tall)));
      const from = Math.floor(ring.length / 2 - raised / 2);
      ring.forEach(([x, y], i) => add(x, y, i >= from && i < from + raised ? 1 : 0, 1));
      return pick(cols, n, (c) => ring.findIndex(([x, y]) => x === c.x && y === c.y), rng, 0.05);
    }
    case "stepped": {
      // terraces rising along a direction: a few pieces to each level, as many levels as tall asks for
      const plateau = plateauOf();
      const w = compact < 0.4 ? 1 : compact < 0.8 ? 2 : 3;
      const len = Math.ceil(n / w) + 2;
      for (let i = 0; i < len; i++) for (let j = 0; j < w; j++) add(i, j, Math.floor(i / plateau), 1);
      return pick(cols, n, (c) => c.x + 0.1 * c.y, rng, 0.05);
    }
    case "village": {
      // a street of ground pieces with towers standing off it, each tower a small spiral that climbs from the street (every piece one half-tile above the last), of
      // different heights. Tall decides how much of the village is tower; at Tall 0 it is the street alone.
      const towersN = n >= 12 ? 3 : n >= 7 ? 2 : 1;
      const towerPieces = tall <= 0.05 ? 0 : Math.min(n - towersN - 1, Math.round(n * lerp(0.15, 0.7, tall)));
      const streetN = n - towerPieces;
      const out: Cell[] = [];
      for (let i = 0; i < streetN; i++) out.push({ x: i, y: 0, z: 0, parent: i - 1 });
      if (towerPieces > 0) {
        // the towers stand on street pieces three apart (a tower is two pieces wide), tallest first
        const anchors: number[] = [];
        for (let a = Math.min(1, streetN - 1); a < streetN && anchors.length < towersN; a += 3) anchors.push(a);
        const use = anchors.length;
        const share = [0.5, 0.3, 0.2].slice(0, use);
        const sum = share.reduce((p, c) => p + c, 0);
        let left = towerPieces;
        anchors.forEach((ax, k) => {
          const h = k === use - 1 ? left : Math.max(1, Math.min(left - (use - 1 - k), Math.round((towerPieces * share[k]) / sum)));
          left -= h;
          // the winding of this tower: a 2 x 2 ring beside the street piece
          const ring: [number, number][] = [[0, 1], [1, 1], [1, 2], [0, 2]];
          if (rng() < 0.5) ring.reverse();
          let parent = ax;
          for (let i = 0; i < h; i++) {
            const [rx, ry] = ring[i % 4];
            out.push({ x: ax + rx, y: ry, z: i + 1, parent });
            parent = out.length - 1;
          }
        });
      }
      return out.length >= n ? out.slice(0, n) : branchCells(out, n - out.length, rng, 0, compact, Infinity, fits);
    }
    case "bridge": {
      // two towers and a span between them: a spiral up one tower, a level run across the top, a spiral down the other. Tall sets how high the span is; whatever the
      // pieces left over after the towers are, they lengthen the span (at Tall 0 the bridge is a flat run).
      const top = tall <= 0.05 ? 0 : Math.max(1, Math.round(lerp(1, Math.max(1, Math.floor((n - 2) / 2)), tall)));
      const spanN = Math.max(top > 0 ? 2 : n, n - 2 * top);
      const ring: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
      if (rng() < 0.5) ring.reverse();
      const out: Cell[] = [];
      // up: z = 0 .. top - 1, round a 2 x 2 ring at the near end
      for (let i = 0; i < top; i++) out.push({ x: ring[i % 4][0], y: ring[i % 4][1], z: i, parent: i - 1 });
      // across: one long run on the top level, away from the near tower
      const x0 = out.length ? out[out.length - 1].x : 0;
      const y0 = out.length ? out[out.length - 1].y : 0;
      const dir = x0 === 0 ? -1 : 1;
      let prev = out.length - 1;
      const spanTiles = Math.min(spanN, n - out.length);
      for (let i = 1; i <= spanTiles; i++) {
        out.push({ x: x0 + dir * i, y: y0, z: top, parent: prev });
        prev = out.length - 1;
      }
      // down: the far tower, z = top - 1 .. 0, winding round a ring at the far end
      const fx = out.length ? out[out.length - 1].x : 0;
      const fdir = dir;
      for (let i = 0; i < top && out.length < n; i++) {
        const r = ring[i % 4];
        out.push({ x: fx + fdir * (1 + (fdir > 0 ? r[0] : r[0])), y: y0 + r[1] - ring[0][1], z: top - 1 - i, parent: prev });
        prev = out.length - 1;
      }
      return out.length >= n ? out.slice(0, n) : branchCells(out, n - out.length, rng, 0, compact, Infinity, fits);
    }
    case "free": {
      // no overall shape: a wandering mass, climbing as tall asks and packing as compact asks
      return branchCells([{ x: 0, y: 0, z: 0, parent: -1 }], n - 1, rng, tall, compact, Infinity, fits);
    }
    default: {
      // compact: a dense block that is tall. A spiral climbs the outside of a small footprint (a hollow square, 2 x 2 pieces for a few, 3 x 3 for more), and the rest
      // of the pieces pack in beside it at the levels it reaches, so the mass is as tall as the spiral and no wider than it needs to be. Tall decides how much of it
      // is spiral (at Tall 0 it is a flat mound); Compact how tightly the rest packs.
      const ringTiles = n >= 10 ? 3 : 2;
      const ring: [number, number][] = [];
      for (let i = 0; i < ringTiles; i++) ring.push([i, 0]);
      for (let j = 1; j < ringTiles; j++) ring.push([ringTiles - 1, j]);
      for (let i = ringTiles - 2; i >= 0; i--) ring.push([i, ringTiles - 1]);
      for (let j = ringTiles - 2; j >= 1; j--) ring.push([0, j]);
      if (rng() < 0.5) ring.reverse();
      const climbN = Math.max(1, Math.min(n, Math.round(n * lerp(0.1, 0.7, tall))));
      const out: Cell[] = [];
      for (let i = 0; i < climbN; i++) out.push({ x: ring[i % ring.length][0], y: ring[i % ring.length][1], z: i, parent: i - 1 });
      return climbN < n ? branchCells(out, n - climbN, rng, 0, 0.6 + 0.4 * compact, Infinity, fits) : out;
    }
  }
}

/** The height of a plan in half-tiles, and its footprint in tiles: what the shape actually came out as. */
export function planMetrics(cells: Cell[]): { levels: number; heightTiles: number; widthTiles: number; depthTiles: number; stackedPairs: number } {
  if (!cells.length) return { levels: 0, heightTiles: 0, widthTiles: 0, depthTiles: 0, stackedPairs: 0 };
  const zs = new Set(cells.map((c) => c.z));
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const top = Math.max(...cells.map((c) => c.z)) + 2;
  let stacked = 0;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (cells[i].x === cells[j].x && cells[i].y === cells[j].y) stacked++;
  return { levels: zs.size, heightTiles: top / 2, widthTiles: Math.max(...xs) - Math.min(...xs) + 1, depthTiles: Math.max(...ys) - Math.min(...ys) + 1, stackedPairs: stacked };
}
