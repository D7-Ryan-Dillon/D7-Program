// Marching squares on a 2D scalar grid, chained into closed rings. Used for the plan and section drawings: the slice of a
// tile's smoothed field is traced at the 0.5 level, so outlines are smooth (and a plate's flat top stays flat) instead of
// stepping at the 6 inch cells.
//
// The grid is padded with one ring of zeros, so a region that reaches the edge still closes. Points come back in feet
// (u to the right, v up), cell centres at ((i + 0.5) * cell, (j + 0.5) * cell), clipped to the tile.

export type Ring = number[][];

/** field(i, j) for i in [0, w), j in [0, h). Returns closed rings (no repeated end point). */
export function traceField(field: (i: number, j: number) => number, w: number, h: number, level: number, cell: number, tol = 0.04): Ring[] {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : field(i, j));
  // edge ids: horizontal edge between (i, j)-(i+1, j) is "h:i:j"; vertical edge between (i, j)-(i, j+1) is "v:i:j"
  const pointOf = new Map<string, [number, number]>();
  const segs = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!segs.has(a)) segs.set(a, []);
    if (!segs.has(b)) segs.set(b, []);
    segs.get(a)!.push(b);
    segs.get(b)!.push(a);
  };
  const edgePoint = (id: string, i: number, j: number, vertical: boolean, a: number, b: number) => {
    if (pointOf.has(id)) return;
    const t = b === a ? 0.5 : (level - a) / (b - a);
    pointOf.set(id, vertical ? [i, j + t] : [i + t, j]);
  };
  for (let j = -1; j < h; j++)
    for (let i = -1; i < w; i++) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      const c = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const bottom = `h:${i}:${j}`;
      const top = `h:${i}:${j + 1}`;
      const left = `v:${i}:${j}`;
      const right = `v:${i + 1}:${j}`;
      edgePoint(bottom, i, j, false, v0, v1);
      edgePoint(top, i, j + 1, false, v3, v2);
      edgePoint(left, i, j, true, v0, v3);
      edgePoint(right, i + 1, j, true, v1, v2);
      const centre = (v0 + v1 + v2 + v3) / 4 >= level;
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, top); break;
        case 6: case 9: link(bottom, top); break;
        case 7: case 8: link(left, top); break;
        case 5:
          if (centre) {
            link(bottom, right);
            link(left, top);
          } else {
            link(left, bottom);
            link(right, top);
          }
          break;
        case 10:
          if (centre) {
            link(left, bottom);
            link(right, top);
          } else {
            link(bottom, right);
            link(left, top);
          }
          break;
      }
    }
  const used = new Set<string>();
  const rings: Ring[] = [];
  const toFt = ([x, y]: [number, number]) => [Math.min(Math.max((x + 0.5) * cell, 0), w * cell), Math.min(Math.max((y + 0.5) * cell, 0), h * cell)];
  for (const start of segs.keys()) {
    if (used.has(start)) continue;
    const ring: [number, number][] = [];
    let prev = "";
    let cur = start;
    for (let guard = 0; guard < segs.size + 4; guard++) {
      used.add(cur);
      ring.push(pointOf.get(cur)!);
      const next = segs.get(cur)!.find((n) => n !== prev && !used.has(n));
      if (!next) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) rings.push(simplify(ring.map(toFt), tol));
  }
  return rings.filter((r) => r.length >= 3);
}

/** Douglas-Peucker on a closed ring. */
function simplify(ring: Ring, tol: number): Ring {
  if (ring.length <= 4 || tol <= 0) return ring;
  // split the ring at its two farthest-apart points so both halves are open polylines
  let a = 0;
  let b = 0;
  let best = -1;
  const step = Math.max(1, Math.floor(ring.length / 24));
  for (let i = 0; i < ring.length; i += step)
    for (let j = i + 1; j < ring.length; j += step) {
      const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  const half = (from: number, to: number): Ring => {
    const pts: Ring = [];
    for (let i = from; i !== to; i = (i + 1) % ring.length) pts.push(ring[i]);
    pts.push(ring[to]);
    return pts;
  };
  const dp = (pts: Ring): Ring => {
    if (pts.length < 3) return pts;
    const [x1, y1] = pts[0];
    const [x2, y2] = pts[pts.length - 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = -1;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  const h1 = dp(half(a, b));
  const h2 = dp(half(b, a));
  return [...h1.slice(0, -1), ...h2.slice(0, -1)];
}

/** Outlines of the cells where test(i, j) is true, following the cell edges exactly (rectilinear), as closed rings in feet. */
export function traceCells(test: (i: number, j: number) => boolean, w: number, h: number, cell: number): Ring[] {
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && test(i, j);
  type Edge = { x1: number; y1: number; x2: number; y2: number; used: boolean };
  const out = new Map<string, Edge[]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = `${x1},${y1}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ x1, y1, x2, y2, used: false });
  };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(i, j, i + 1, j);
      if (!on(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!on(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!on(i - 1, j)) add(i, j + 1, i, j);
    }
  const rings: Ring[] = [];
  for (const edges of out.values())
    for (const first of edges) {
      if (first.used) continue;
      const pts: [number, number][] = [];
      let e: Edge | undefined = first;
      while (e && !e.used) {
        e.used = true;
        pts.push([e.x1, e.y1]);
        const next: Edge[] = out.get(`${e.x2},${e.y2}`) ?? [];
        const dx: number = e.x2 - e.x1;
        const dy: number = e.y2 - e.y1;
        // at a vertex where two outlines touch, turn left first so each loop stays one piece
        const turn = (c: Edge): number => dx * (c.y2 - c.y1) - dy * (c.x2 - c.x1);
        e = next.filter((c) => !c.used).sort((a, b) => turn(b) - turn(a))[0];
      }
      // drop the points that sit in the middle of a straight run
      const ring = pts.filter((p, n) => {
        const a = pts[(n + pts.length - 1) % pts.length];
        const b = pts[(n + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (ring.length >= 4) rings.push(ring.map(([x, y]) => [x * cell, y * cell]));
    }
  return rings;
}
