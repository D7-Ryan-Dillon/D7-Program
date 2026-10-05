// A label sunk flush into the underside of a printed block, for a multi-colour print (Bambu P1S + AMS).
//
// The block prints with its underside on the plate, so the label is the first layers of the print and the block sits on top
// of it. Two files come out: the block with a pocket cut into its underside, and the label that exactly fills the pocket.
// Loaded together in Bambu Studio ("load as one object with multiple parts") they fit; each part gets its own filament.
//
//   1. findLabelPatch   the largest flat patch of foam on the bottom layer that is deep enough for the pocket and big enough for
//                       legible text (a maximal-rectangle search on the tile's voxels, every cell shrunk by one for the smoothing).
//   2. labelBitmap      the text drawn with the browser's bold sans font and thresholded to a bitmap, 0.1 mm per pixel.
//   3. labelSoup        the bitmap as a closed solid (flat tops, bottoms and walls), MIRRORED so the text reads correctly when
//                       the underside is looked at from below.
//   4. buildLabelledBlock  the pocket: the foam mesh minus the label solid (three-bvh-csg), plus the label itself.
//
// Everything is in millimetres, Z up, the tile's low corner at the origin: the same frame as lib/exporters/stl.ts.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import type { ParsedTile } from "@/lib/types";
import { openEdges, tileTriangles, volumeMm3 } from "@/lib/exporters/stl";
import { fineSoup, type Detail } from "@/lib/exporters/printMesh";

export interface LabelPatch {
  /** the rectangle on the plate, mm */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** the text runs along Y instead of X */
  rotated: boolean;
  /** how tall the letters can be here, mm */
  textHeightMm: number;
}

export interface LabelOptions {
  text: string;
  /** how deep the label sinks into the block, mm */
  depthMm: number;
  /** the tallest letters wanted, mm */
  maxHeightMm: number;
}

/** The size of one pixel of the label, mm. Far finer than a 0.4 mm nozzle can print. */
export const LABEL_PX_MM = 0.1;
/** Letters shorter than this do not read in a 0.4 mm print. */
export const MIN_TEXT_MM = 3.5;

/** How wide bold letters run compared with their height. */
const aspectOf = (text: string) => Math.max(1.3, text.length * 0.66);

/** Short label from a tile's name: "office_4_void_edge_workspace" -> "O-4", "gathering_2_..." -> "G-2", "lobby_3_..." -> "L-3". Anything else: its initials. */
export function labelFor(name: string, fallbackIndex = 0): string {
  const m = /^([A-Za-z]+)_(\d+)(?:_|$)/.exec(name);
  if (m) {
    const c = m[1].toLowerCase();
    const letter = c === "office" || c === "workspace" ? "O" : c === "gathering" ? "G" : c === "lobby" ? "L" : c[0].toUpperCase();
    return `${letter}-${Number(m[2])}`;
  }
  const initials = name
    .replace(/_V\d+.*$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 3);
  return initials ? `${initials}-${fallbackIndex + 1}` : `T-${fallbackIndex + 1}`;
}

/** Foam cells of the tile (1 = foam). */
function foamOf(tile: ParsedTile): Uint8Array | null {
  const v = tile.voxels.void;
  if (!v) return null;
  const mask = tile.voxels.mask;
  const out = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = !v[i] && (!mask || mask[i]) ? 1 : 0;
  return out;
}

/** The best spot for the label on the bottom layer, or null with the reason. */
export function findLabelPatch(tile: ParsedTile, ratio: number, o: LabelOptions): { patch: LabelPatch } | { error: string } {
  const foam = foamOf(tile);
  if (!foam) return { error: "this tile has no voxels to find the underside from" };
  const [nx, ny, nz] = tile.grid;
  const cellMm = (tile.cellFt * 304.8) / ratio;
  // the foam above the label has to be at least as deep again as the label plus a little, or it would break through the top
  const need = Math.min(nz, Math.max(1, Math.ceil((o.depthMm + 0.8) / cellMm)));
  const col = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      let ok = 1;
      for (let z = 0; z < need && ok; z++) if (!foam[(x * ny + y) * nz + z]) ok = 0;
      col[x * ny + y] = ok;
    }
  // shrink by two cells: the smooth mesh rounds off and sits a little inside the voxel edge, and the label must lie on the flat part
  const safe = new Uint8Array(nx * ny);
  for (let x = 2; x < nx - 2; x++)
    for (let y = 2; y < ny - 2; y++) {
      let ok = 1;
      for (let dx = -2; dx <= 2 && ok; dx++) for (let dy = -2; dy <= 2 && ok; dy++) if (!col[(x + dx) * ny + y + dy]) ok = 0;
      safe[x * ny + y] = ok;
    }
  const aspect = aspectOf(o.text);
  const size = (wCells: number, hCells: number): { th: number; rotated: boolean } => {
    const w = wCells * cellMm;
    const h = hCells * cellMm;
    const a = Math.min(o.maxHeightMm, h * 0.9, (w * 0.9) / aspect);
    const b = Math.min(o.maxHeightMm, w * 0.9, (h * 0.9) / aspect);
    return a >= b ? { th: a, rotated: false } : { th: b, rotated: true };
  };
  let best: { th: number; rotated: boolean; x0: number; x1: number; y0: number; y1: number } | null = null;
  const heights = new Int32Array(ny);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) heights[y] = safe[x * ny + y] ? heights[y] + 1 : 0;
    // every maximal rectangle ending on this row: a stack over the histogram
    const stack: number[] = [];
    for (let y = 0; y <= ny; y++) {
      const h = y === ny ? 0 : heights[y];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const hh = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = y - left;
        if (hh > 0) {
          const s = size(hh, width);
          if (!best || s.th > best.th) best = { ...s, x0: x - hh + 1, x1: x + 1, y0: left, y1: y };
        }
      }
      stack.push(y);
    }
  }
  if (!best || best.th < MIN_TEXT_MM) {
    return { error: `no flat patch of foam on the underside is big enough for letters of ${MIN_TEXT_MM} mm at this scale${best ? ` (the best gives ${best.th.toFixed(1)} mm)` : ""}` };
  }
  return { patch: { x0: best.x0 * cellMm, x1: best.x1 * cellMm, y0: best.y0 * cellMm, y1: best.y1 * cellMm, rotated: best.rotated, textHeightMm: best.th } };
}

/** The text as a black-and-white bitmap with letters `heightMm` tall (browser only). true = ink. */
export function labelBitmap(text: string, heightMm: number, maxLengthMm: number): { w: number; h: number; ink: Uint8Array } {
  const px = 1 / LABEL_PX_MM;
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = (size: number) => `800 ${size}px "Arial Black", Arial, Helvetica, sans-serif`;
  measure.font = font(100);
  const m = measure.measureText(text);
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  let size = (heightMm * px * 100) / Math.max(1, inkH);
  measure.font = font(size);
  let mm = measure.measureText(text);
  const maxW = maxLengthMm * px;
  if (mm.width > maxW) {
    size *= maxW / mm.width;
    measure.font = font(size);
    mm = measure.measureText(text);
  }
  const w = Math.ceil(mm.actualBoundingBoxLeft + mm.actualBoundingBoxRight) + 2;
  const h = Math.ceil(mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent) + 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = font(size);
  ctx.fillText(text, 1 + mm.actualBoundingBoxLeft, 1 + mm.actualBoundingBoxAscent);
  const data = ctx.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = data[i * 4] > 127 ? 1 : 0;
  return { w, h, ink };
}

/** Puts a bitmap on the plate: the grid of ink cells in world orientation, mirrored (read from below) and turned if the patch asks for it. */
export function placeBitmap(b: { w: number; h: number; ink: Uint8Array }, rotated: boolean): { gw: number; gh: number; cells: Uint8Array } {
  const gw = rotated ? b.h : b.w;
  const gh = rotated ? b.w : b.h;
  const cells = new Uint8Array(gw * gh);
  for (let j = 0; j < b.h; j++)
    for (let i = 0; i < b.w; i++) {
      if (!b.ink[j * b.w + i]) continue;
      const tx = i;
      const ty = b.h - 1 - j; // up
      // seen from below: right = -X and up = +Y; turned: right = +Y and up = +X
      const wx = rotated ? ty : b.w - 1 - tx;
      const wy = rotated ? tx : ty;
      cells[wx * gh + wy] = 1;
    }
  return { gw, gh, cells };
}

type Pt = [number, number];

/** The outlines of the ink cells: closed loops of cell corners with the ink on the left (outer loops run counter-clockwise, holes clockwise). */
function traceLoops(grid: { gw: number; gh: number; cells: Uint8Array }): Pt[][] {
  const { gw, gh, cells } = grid;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < gw && y < gh ? cells[x * gh + y] : 0);
  const key = (x: number, y: number) => x * (gh + 1) + y;
  const out = new Map<number, Pt[]>(); // start corner -> the corners its edges go to
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const l = out.get(k);
    if (l) l.push([x1, y1]);
    else out.set(k, [[x1, y1]]);
  };
  for (let x = 0; x < gw; x++)
    for (let y = 0; y < gh; y++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: Pt[][] = [];
  for (const [startKey, firsts] of out) {
    while (firsts.length) {
      const sx = Math.floor(startKey / (gh + 1));
      const sy = startKey % (gh + 1);
      const loop: Pt[] = [[sx, sy]];
      let [cx, cy] = firsts.pop()!;
      let px = sx, py = sy;
      for (let guard = 0; guard < 1e6; guard++) {
        if (cx === sx && cy === sy) break;
        loop.push([cx, cy]);
        const list = out.get(key(cx, cy));
        if (!list || !list.length) break;
        // where two edges leave a corner (ink cells touching diagonally) take the sharpest left turn, which keeps the loops apart
        let pick = 0;
        if (list.length > 1) {
          let bestCross = -Infinity;
          const dx = cx - px, dy = cy - py;
          list.forEach(([nx, ny], i) => {
            const cr = dx * (ny - cy) - dy * (nx - cx);
            if (cr > bestCross) {
              bestCross = cr;
              pick = i;
            }
          });
        }
        const [nx, ny] = list.splice(pick, 1)[0];
        px = cx;
        py = cy;
        cx = nx;
        cy = ny;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** A closed loop with the corners that are not corners taken out, then simplified to within `eps` (Douglas-Peucker from two far-apart anchors). */
function simplifyLoop(loop: Pt[], eps: number): Pt[] {
  // exact collinear points first
  const pts: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i + loop.length - 1) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) pts.push(b);
  }
  if (pts.length < 4) return pts;
  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const rdp = (list: Pt[]): Pt[] => {
    if (list.length < 3) return list;
    let worst = -1, wi = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const d = dist(list[i], list[0], list[list.length - 1]);
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst <= eps) return [list[0], list[list.length - 1]];
    return [...rdp(list.slice(0, wi + 1)).slice(0, -1), ...rdp(list.slice(wi))];
  };
  // anchors: point 0 and the point farthest from it
  let far = 0, fd = -1;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  });
  const first = rdp(pts.slice(0, far + 1));
  const second = rdp([...pts.slice(far), pts[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

const area = (l: Pt[]) => l.reduce((a, p, i) => a + (p[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * p[1]), 0) / 2;
const within = (pt: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * A closed solid of the ink between two heights, as a triangle soup (mm); the grid's low corner is at (x0, y0). The ink's outlines
 * are traced and simplified to a twentieth of a millimetre, then extruded: a few hundred triangles instead of tens of thousands, and
 * the letters keep their holes (O, 4, 0, 6, 8, 9).
 */
export function labelSoup(grid: { gw: number; gh: number; cells: Uint8Array }, x0: number, y0: number, z0: number, z1: number): Float32Array {
  const px = LABEL_PX_MM;
  const loops = traceLoops(grid).map((l) => simplifyLoop(l, 0.5)).filter((l) => l.length >= 3);
  const outers = loops.filter((l) => area(l) > 0);
  const holes = loops.filter((l) => area(l) < 0);
  const shapes = outers.map((o) => new THREE.Shape(o.map(([x, y]) => new THREE.Vector2(x0 + x * px, y0 + y * px))));
  for (const h of holes) {
    // the smallest outer loop that contains the hole
    let owner = -1, ownerArea = Infinity;
    outers.forEach((o, i) => {
      const a = area(o);
      if (a < ownerArea && within(h[0], o)) {
        owner = i;
        ownerArea = a;
      }
    });
    if (owner >= 0) shapes[owner].holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x0 + x * px, y0 + y * px))));
  }
  if (!shapes.length) return new Float32Array(0);
  const g = new THREE.ExtrudeGeometry(shapes, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = index ? index.getX(i) : i;
    out[i * 3] = pos.getX(v);
    out[i * 3 + 1] = pos.getY(v);
    out[i * 3 + 2] = pos.getZ(v);
  }
  g.dispose();
  return out;
}

// ---- the pocket ---------------------------------------------------------------------------------------------------------------------

function brushOf(soup: Float32Array): Brush {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(soup, 3));
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  if (!welded.attributes.uv) welded.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(welded.attributes.position.count * 2), 2));
  const b = new Brush(welded);
  b.updateMatrixWorld(true);
  return b;
}

function soupOf(g: THREE.BufferGeometry): Float32Array {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = index ? index.getX(i) : i;
    out[i * 3] = pos.getX(v);
    out[i * 3 + 1] = pos.getY(v);
    out[i * 3 + 2] = pos.getZ(v);
  }
  return out;
}

/**
 * The cut leaves T-junctions on the underside: a vertex of the pocket (or of the re-triangulated bottom face) that sits in the middle of
 * an edge of a neighbouring triangle. A slicer has to repair those. Here every triangle that touches the bottom slab (below `zMax`)
 * is split at the vertices lying on its edges, so the mesh comes out closed. Vertices are found through a 2 mm bucket grid, so it stays
 * fast on a big tile.
 */
function healTJunctions(soup: Float32Array, lo: [number, number, number], hi: [number, number, number]): Float32Array {
  const E = 2e-4;
  const B = 2;
  const near: number[][] = [];
  const far: number[] = [];
  for (let i = 0; i < soup.length; i += 9) {
    let a0 = Infinity, a1 = Infinity, a2 = Infinity, b0 = -Infinity, b1 = -Infinity, b2 = -Infinity;
    for (let k = 0; k < 3; k++) {
      a0 = Math.min(a0, soup[i + k * 3]); b0 = Math.max(b0, soup[i + k * 3]);
      a1 = Math.min(a1, soup[i + k * 3 + 1]); b1 = Math.max(b1, soup[i + k * 3 + 1]);
      a2 = Math.min(a2, soup[i + k * 3 + 2]); b2 = Math.max(b2, soup[i + k * 3 + 2]);
    }
    if (b0 >= lo[0] && a0 <= hi[0] && b1 >= lo[1] && a1 <= hi[1] && b2 >= lo[2] && a2 <= hi[2]) near.push(Array.from(soup.subarray(i, i + 9)));
    else for (let k = 0; k < 9; k++) far.push(soup[i + k]);
  }
  const cellKey = (x: number, y: number, z: number) => `${Math.floor(x / B)},${Math.floor(y / B)},${Math.floor(z / B)}`;
  const grid = new Map<string, number[][]>();
  const seen = new Set<string>();
  for (const t of near)
    for (let k = 0; k < 3; k++) {
      const v = [t[k * 3], t[k * 3 + 1], t[k * 3 + 2]];
      if (v[0] < lo[0] || v[0] > hi[0] || v[1] < lo[1] || v[1] > hi[1] || v[2] < lo[2] || v[2] > hi[2]) continue;
      const id = `${Math.round(v[0] * 2000)},${Math.round(v[1] * 2000)},${Math.round(v[2] * 2000)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const ck = cellKey(v[0], v[1], v[2]);
      const list = grid.get(ck);
      if (list) list.push(v);
      else grid.set(ck, [v]);
    }
  const candidates = (a: number[], b: number[]): number[][] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(len / (B * 0.5)));
    const got = new Set<number[]>();
    const visited = new Set<string>();
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const ck = cellKey(x + dx * B, y + dy * B, z + dz * B);
        if (visited.has(ck)) continue;
        visited.add(ck);
        for (const v of grid.get(ck) ?? []) got.add(v);
      }
    }
    return [...got];
  };
  let work = near;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const next: number[][] = [];
    for (const t of work) {
      let done = false;
      // a triangle with no area (all three vertices on one line) is left as it is: splitting it only makes more of them
      const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2];
      const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const flat = cx * cx + cy * cy + cz * cz < 1e-12;
      for (let e = 0; e < 3 && !done && !flat; e++) {
        const a = [t[e * 3], t[e * 3 + 1], t[e * 3 + 2]];
        const b = [t[((e + 1) % 3) * 3], t[((e + 1) % 3) * 3 + 1], t[((e + 1) % 3) * 3 + 2]];
        const c = [t[((e + 2) % 3) * 3], t[((e + 2) % 3) * 3 + 1], t[((e + 2) % 3) * 3 + 2]];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        if (len2 < 4 * E * E) continue;
        const len = Math.sqrt(len2);
        const on: { u: number; v: number[] }[] = [];
        for (const v of candidates(a, b)) {
          const av = [v[0] - a[0], v[1] - a[1], v[2] - a[2]];
          const u = (av[0] * ab[0] + av[1] * ab[1] + av[2] * ab[2]) / len2;
          if (u <= E / len || u >= 1 - E / len) continue;
          const dx = av[0] - ab[0] * u, dy = av[1] - ab[1] * u, dz = av[2] - ab[2] * u;
          if (dx * dx + dy * dy + dz * dz < 25 * E * E) on.push({ u, v });
        }
        if (!on.length) continue;
        on.sort((p, q) => p.u - q.u);
        const chain = [a, ...on.map((o) => o.v), b];
        for (let k = 0; k < chain.length - 1; k++) next.push([...chain[k], ...chain[k + 1], ...c]);
        done = true;
        changed = true;
      }
      if (!done) next.push(t);
    }
    work = next;
    if (!changed || work.length > near.length * 6 + 2000) break;
  }
  const out = new Float32Array(far.length + work.length * 9);
  out.set(far, 0);
  let o = far.length;
  for (const t of work) {
    out.set(t, o);
    o += 9;
  }
  return out;
}

/** The foam mesh minus the cutter solid, closed. */
export function cutPocket(foam: Float32Array, cutter: Float32Array): Float32Array {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const cut = soupOf(evaluator.evaluate(brushOf(foam), brushOf(cutter), SUBTRACTION).geometry);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cutter.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], cutter[i + k]);
    hi[k] = Math.max(hi[k], cutter[i + k]);
  }
  // the neighbourhood of the pocket: a little wider than the label, from just under the plate to just above the pocket
  return healTJunctions(cut, [lo[0] - 1, lo[1] - 1, -1], [hi[0] + 1, hi[1] + 1, hi[2] + 0.5]);
}

export interface LabelledBlock {
  /** the foam with the pocket cut into its underside */
  block: Float32Array;
  /** the label that fills it */
  label: Float32Array;
  patch: LabelPatch;
  /** how far everything of this tile was lowered (mm) so that the underside of the foam sits exactly on the plate: apply the same to the tile's other parts */
  zShift: number;
  warnings: string[];
}

/** The lowest point of a triangle soup. */
export function lowestZ(soup: Float32Array): number {
  let z = Infinity;
  for (let i = 2; i < soup.length; i += 3) if (soup[i] < z) z = soup[i];
  return Number.isFinite(z) ? z : 0;
}

/** The height of the flat underside beneath a patch: the most common height of the vertices in it (within a millimetre of the lowest). */
export function bottomPlane(soup: Float32Array, patch: { x0: number; y0: number; x1: number; y1: number }, lowest: number): number {
  const bins = new Map<number, { n: number; sum: number }>();
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    if (x < patch.x0 - 1 || x > patch.x1 + 1 || y < patch.y0 - 1 || y > patch.y1 + 1 || z > lowest + 1) continue;
    const k = Math.round(z / 0.02);
    const b = bins.get(k) ?? { n: 0, sum: 0 };
    b.n++;
    b.sum += z;
    bins.set(k, b);
  }
  let best: { n: number; sum: number } | null = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  return best ? best.sum / best.n : lowest;
}

/** A soup moved down by `dz`. */
export function lowered(soup: Float32Array, dz: number): Float32Array {
  if (!dz) return soup;
  const out = new Float32Array(soup);
  for (let i = 2; i < out.length; i += 3) out[i] -= dz;
  return out;
}

/** The foam of a tile with a label pocket in its underside, and the label. Browser only (it draws the text). */
export async function buildLabelledBlock(tile: ParsedTile, ratio: number, o: LabelOptions, detail: 0 | Detail = 3): Promise<LabelledBlock | { error: string }> {
  const found = findLabelPatch(tile, ratio, o);
  if ("error" in found) return found;
  const { patch } = found;
  const len = (patch.rotated ? patch.y1 - patch.y0 : patch.x1 - patch.x0) * 0.9;
  const bitmap = labelBitmap(o.text, patch.textHeightMm, len);
  const grid = placeBitmap(bitmap, patch.rotated);
  const cx = (patch.x0 + patch.x1) / 2;
  const cy = (patch.y0 + patch.y1) / 2;
  const x0 = cx - (grid.gw * LABEL_PX_MM) / 2;
  const y0 = cy - (grid.gh * LABEL_PX_MM) / 2;
  const label = labelSoup(grid, x0, y0, 0, o.depthMm);
  if (!label.length) return { error: "the label came out empty" };
  // the cutter reaches a little below the plate so the pocket opens cleanly instead of leaving a skin
  const cutter = labelSoup(grid, x0, y0, -0.4, o.depthMm);

  const fine = detail ? fineSoup(tile, ratio, detail, "foam") : null;
  const foamRaw = fine ?? (await tileTriangles(tile, tile.glbUrl, "foam", ratio)).v;
  if (!foamRaw.length) return { error: "this tile has no foam mesh" };
  // the underside under the label is the plate: lower everything so that plane is z = 0, where the label is
  const lowest = lowestZ(foamRaw);
  const zShift = bottomPlane(foamRaw, patch, lowest);
  let foam = lowered(foamRaw, zShift);
  await new Promise((r) => setTimeout(r, 0));
  // a few vertices can hang below the main underside (a sliver of a tenth of a millimetre): lift them onto the plate so the block rests flat on that plane
  if (lowest < zShift - 0.03) {
    foam = new Float32Array(foam);
    for (let i = 2; i < foam.length; i += 3) if (foam[i] < 0) foam[i] = 0;
  }
  await new Promise((r) => setTimeout(r, 0));
  const block = cutPocket(foam, cutter);

  const warnings: string[] = [];
  const cut = volumeMm3(foam) - volumeMm3(block);
  const want = volumeMm3(label);
  if (want > 0 && Math.abs(cut - want) / want > 0.25) warnings.push(`the pocket volume (${cut.toFixed(0)} mm³) does not match the label (${want.toFixed(0)} mm³): check the underside in the slicer`);
  if (block.length < 9) return { error: "the cut removed the whole block" };
  const before = foam.length / 9 < 400000 ? openEdges(foam) : 0;
  const after = block.length / 9 < 400000 ? openEdges(block) : 0;
  if (after > before + 1500) warnings.push(`the cut left ${after - before} stray edges in the block mesh; let the slicer repair it and check the underside`);
  return { block, label, patch, zShift, warnings };
}
