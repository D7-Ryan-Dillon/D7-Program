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
// The sliders move the plan itself: Tall chooses how many levels there are (how much of the building is tower, how long a terrace plateau is, how many layers a block
// has; at 0 every plan is flat), Compact how tight it packs. generate.ts then finds tiles that satisfy the floor rules in the plan, and when a plan proves
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
export function branchCells(cells: Cell[], extra: number, rng: Rng, lift: number, knit: number, topZ = Infinity): Cell[] {
  const out = cells.map((c) => ({ ...c }));
  for (let k = 0; k < extra; k++) {
    let best: { cell: Cell; v: number } | null = null;
    for (let s = 0; s < 40; s++) {
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
      if (!best || v > best.v) best = { cell: { x, y, z, parent: pi }, v };
    }
    if (!best) break;
    out.push(best.cell);
  }
  return out;
}

/**
 * Terraces a flat set of cells: the heights rise in `levels` plateaus along the direction `ang`, each plateau with about the same number of pieces (so the
 * entrance end is never a lone piece against a wall of higher ones), and no two neighbours more than a half-tile apart. The cell lowest along the direction is the
 * entrance. The result is in plan order (each cell beside an earlier one).
 */
function terrace(flat: { x: number; y: number }[], levels: number, ang: number): Cell[] {
  const n = flat.length;
  if (!n) return [];
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const cx = flat.reduce((a, c) => a + c.x, 0) / n;
  const cy = flat.reduce((a, c) => a + c.y, 0) / n;
  const along = flat.map((c) => c.x * dx + c.y * dy + 0.001 * Math.hypot(c.x - cx, c.y - cy));
  const order = flat.map((_, i) => i).sort((a, b) => along[a] - along[b]);
  const z = new Array<number>(n).fill(0);
  order.forEach((idx, rank) => {
    z[idx] = Math.min(levels - 1, Math.floor((rank * levels) / n));
  });
  // neighbours never more than one level apart: the higher one comes down
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(flat[i].x - flat[j].x) + Math.abs(flat[i].y - flat[j].y) !== 1) continue;
        if (z[i] - z[j] > 1) {
          z[i] = z[j] + 1;
          changed = true;
        } else if (z[j] - z[i] > 1) {
          z[j] = z[i] + 1;
          changed = true;
        }
      }
    if (!changed) break;
  }
  const root = order[0];
  z[root] = 0;
  const out: Cell[] = [{ x: flat[root].x, y: flat[root].y, z: 0, parent: -1 }];
  const done = new Set<number>([root]);
  for (let head = 0; head < out.length; head++) {
    for (const j of order) {
      if (done.has(j) || !beside(out[head], { x: flat[j].x, y: flat[j].y, z: z[j] })) continue;
      done.add(j);
      out.push({ x: flat[j].x, y: flat[j].y, z: z[j], parent: head });
    }
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
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface PlanInput {
  shape: ShapeKind;
  n: number;
  direction: number;
  /** 0..1 */
  tall: number;
  compact: number;
  branching: boolean;
  rng: Rng;
}

export const planInput = (g: GenSettings, p: Priorities, direction: number, rng: Rng, n = g.amount): PlanInput => ({ shape: g.shape, n, direction, tall: p.tall / 100, compact: p.compact / 100, branching: !!g.branching, rng });

/** The cells of a shape: the core, then wings when branching is on. The first cell is the entrance. */
export function planShape(inp: PlanInput): Cell[] {
  const { shape, n, tall, compact, rng } = inp;
  const core = shape === "free" ? n : inp.branching ? Math.max(2, Math.ceil(n * 0.65)) : n;
  let cells = core > 0 ? corePlan(shape, core, tall, compact, rng) : [];
  // a shape's columns can be fewer than the pieces asked for: the rest of the pieces extend it
  if (cells.length < n) cells = branchCells(cells, n - cells.length, rng, tall, compact);
  return normalise(rotate(cells, inp.direction));
}

function corePlan(shape: ShapeKind, n: number, tall: number, compact: number, rng: Rng): Cell[] {
  const cols: Col[] = [];
  const add = (x: number, y: number, phase: number, depth: number) => cols.push({ x, y, phase, depth });
  const phaseOf = (x: number, y: number) => (x + y) & 1;
  /** how many pieces share a level in a terrace or a slope: all in one at Tall 0 (flat), one to a level at Tall 100 */
  const plateauOf = () => (tall <= 0.05 ? 999 : Math.max(1, 3 - Math.round(tall * 2)));
  switch (shape) {
    case "spineV": {
      // a tower: two columns zig-zagging up in 10 ft steps, or four when compact is high. Tall decides how much of the building is the tower: tall puts almost every
      // piece into it, low puts most into a low base round its foot.
      const footprint = compact >= 0.7 ? 4 : 2;
      for (let i = 0; i < footprint; i++) {
        const x = footprint === 2 ? i : i % 2;
        const y = footprint === 2 ? 0 : Math.floor(i / 2);
        add(x, y, phaseOf(x, y), 99);
      }
      const towerN = Math.max(2, Math.min(n, Math.ceil(n * lerp(0.15, 1, tall))));
      const tower = pick(cols, towerN, (c, m) => c.phase + 2 * m + 0.02 * (c.x + c.y), rng);
      return towerN < n ? branchCells(tower, n - towerN, rng, 0, compact, 1) : tower;
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
    case "cascade": {
      // a slope that climbs with every piece (or every second one when tall is lower), falling away to each side when tall is high
      const plateau = plateauOf() === 999 ? 999 : Math.max(1, Math.min(2, plateauOf() - 1));
      const w = compact < 0.4 ? 0 : compact < 0.8 ? 1 : 2;
      const fall = tall > 0.3 ? 1 : 0;
      const len = Math.ceil(n / (2 * w + 1)) + 2;
      for (let i = 0; i < len; i++) for (let j = -w; j <= w; j++) add(i, j, Math.floor(i / plateau) + fall * Math.abs(j), 1);
      return pick(cols, n, (c) => c.phase + 0.05 * c.x, rng, 0.05);
    }
    case "slab": {
      // a wide low block: one layer at Tall 0, up to three terraced layers along its length (each change of level is a line of steps); widest at the bottom
      const levels = tall < 0.2 ? 1 : tall < 0.6 ? 2 : 3;
      const w = Math.max(3, Math.ceil(Math.sqrt(n * 2)));
      const d = Math.max(2, Math.ceil(n / w));
      for (let x = 0; x < w + 1; x++) for (let y = 0; y < d + 1; y++) add(x, y, 0, 1);
      const flat = pick(cols, n, (c) => c.x + 0.4 * Math.abs(c.y - d / 2), rng, 0.2);
      return levels > 1 ? terrace(flat, levels, 0) : flat;
    }
    case "village": {
      // a base of ground pieces with small towers standing on it (each a pair of columns, climbing in 10 ft); tall makes the towers a bigger part
      const baseN = Math.max(2, Math.ceil(n * lerp(0.9, 0.4, tall)));
      const towers = Math.max(1, Math.round(baseN / 2));
      const height = tall <= 0.05 ? 0 : Math.max(1, Math.ceil((n - baseN) / Math.max(1, towers * 2)));
      for (let i = 0; i < baseN; i++) {
        const isTowerFoot = height > 0 && i % 2 === 0 && i / 2 < towers;
        add(i, 0, 0, isTowerFoot ? 1 + height : 1);
        if (isTowerFoot) add(i, 1, 1, height);
      }
      return pick(cols, n, (c, m) => c.phase + 2 * m + (c.y === 0 && m === 0 ? -50 : 0) + 0.01 * c.x, rng);
    }
    case "bridge": {
      // two slim towers and a raised span between them: up one tower, across, down the other. Tall sets how high the span is.
      const gap = tall >= 0.5 ? 1 : 2;
      const most = Math.max(0, 2 * Math.floor(Math.max(0, (n - gap) / 2 - 1) / 2));
      const top = tall <= 0.05 ? 0 : Math.max(2, Math.min(most, 2 * Math.round(lerp(1, 4, tall))));
      const out: Cell[] = [];
      const push = (x: number, y: number, z: number) => {
        let parent = -1;
        for (let i = 0; i < out.length; i++) if (beside(out[i], { x, y, z })) {
          parent = i;
          break;
        }
        if (out.length && parent < 0) return;
        out.push({ x, y, z, parent });
      };
      const far = gap + 1;
      for (let z = 0; z <= top && out.length < n; z++) push(0, z & 1, z);
      for (let x = 1; x <= gap && out.length < n; x++) push(x, 0, top);
      for (let z = top; z >= 0 && out.length < n; z--) push(far, z & 1, z);
      return out;
    }
    case "free": {
      // no overall shape: a wandering mass, climbing as tall asks and packing as compact asks
      return branchCells([{ x: 0, y: 0, z: 0, parent: -1 }], n - 1, rng, tall, compact);
    }
    default: {
      // compact: a tight mound, terraced up as tall asks (one flat layer at Tall 0): each change of level is a line of steps across it, so few pieces have to climb
      const levels = tall < 0.2 ? 1 : clamp(Math.round(lerp(2, 4, tall)), 2, 4);
      const r = Math.max(1, Math.ceil(Math.sqrt(n)) + (compact < 0.35 ? 1 : 0));
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) add(x, y, 0, 1);
      const squash = lerp(1.6, 0.6, compact);
      const flat = pick(cols, n, (c) => Math.hypot(c.x, c.y) * squash, rng, 0.3);
      return levels > 1 ? terrace(flat, Math.min(levels, Math.max(2, Math.floor(n / 2))), rng() * Math.PI * 2) : flat;
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
