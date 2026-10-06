// The layout of an arrangement read as a graph: which pieces touch, which touches carry a walkable route, what is attached to
// what. This is where the connected rule lives: every piece must touch the main set (physical contact), and every piece must be
// reachable on foot from the entrance (floors, clearance and steps; see lib/arrange/walk.ts). Collisions are read from the cells
// the pieces occupy, so shaped tiles may share part of their boxes when they fit (lib/arrange/collision.ts).

import type { ParsedTile } from "@/lib/types";
import { boundsOfBoxes, findContacts, nearPairs, placeBox, toFt, type Contact, type PlacedBox } from "./geometry";
import { collide, findCollisions, findNested, violates, type Collision } from "./collision";
import { groupByPair, jointFromContacts } from "./joints";
import { categoryOf, FACE_AXIS, FACE_KEYS, FACE_SIGN, type FaceKey, type Patch } from "./orient";
import { getWalk, HEAD_CELLS, OUT, type Feature } from "./occupancy";
import { toleranceFt, type ArrangementDoc, type Joint, type Piece, type ProgramRules, type Vec3 } from "./types";

export interface Exposed {
  pieceId: string;
  face: FaceKey;
  /** the opening's cells in the face layer's own (u, v) cells, from the box's low corner */
  patch: Patch;
  /** the plane the opening faces across, in world cells (a box face, or the wall of a notch or step) */
  plane: number;
  /** feet: the centre of the opening, on its plane */
  point: Vec3;
  /** local cell indices of the piece (void cells of the opening) */
  idx: Int32Array;
}

export interface PieceReach {
  /** floor area (ft2) of the piece's real spaces (zones big enough to be a space) */
  totalFt2: number;
  /** of that, the area a person can walk to from the entrance */
  reachedFt2: number;
  /** its main floor is reachable */
  main: boolean;
}

export interface Layout {
  boxes: PlacedBox[];
  byId: Map<string, PlacedBox>;
  contacts: Contact[];
  joints: Joint[];
  /** pairs whose pieces claim the same cells in a way the policy rejects (solid on solid, material in a carved space) */
  overlaps: [string, string][];
  /** the same, with the counts */
  collisions: Collision[];
  /** pairs whose bounding boxes overlap but whose cells do not: valid nested fits */
  nested: [string, string][];
  entranceId: string | null;
  /** pieces joined (touching) to the entrance piece, itself included */
  attached: Set<string>;
  /** groups of pieces that touch each other but not the main set */
  islands: string[][];
  /** pieces whose main floor can be walked to from the entrance */
  reachable: Set<string>;
  /** attached but with no walkable route from the entrance to their main floor */
  unreachable: string[];
  /** floors (piece#zone) a person can reach from the entrance */
  reachedZones: Set<string>;
  /** how much of each piece's floor is reachable */
  reach: Map<string, PieceReach>;
  /** walkable neighbours: piece id -> [neighbour id, joint] */
  walk: Map<string, { id: string; joint: Joint }[]>;
  /** every opening on an outside surface (not covered by a neighbour) */
  exposed: Exposed[];
  /** pieces' bounding box, cells */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export function boxesFor(pieces: Piece[], tileById: Map<string, ParsedTile>): PlacedBox[] {
  const out: PlacedBox[] = [];
  for (const p of pieces) {
    const t = tileById.get(p.tileId);
    if (t?.voxels.void) out.push(placeBox(p, t));
  }
  return out;
}

const MIN_OPENING_CELLS = 16; // 4 ft2

/** A patch in a face layer from some of a piece's cells (local indices). */
function patchOf(face: FaceKey, dims: [number, number, number], cells: number[]): Patch {
  const [, ny, nz] = dims;
  const axis = FACE_AXIS[face];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, su = 0, sv = 0;
  for (const i of cells) {
    const z = i % nz;
    const y = ((i - z) / nz) % ny;
    const x = ((i - z) / nz - y) / ny;
    const [u, v] = axis === 0 ? [y, z] : axis === 1 ? [x, z] : [x, y];
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
    su += u;
    sv += v;
  }
  return { u0, u1: u1 + 1, v0, v1: v1 + 1, cu: su / cells.length + 0.5, cv: sv / cells.length + 0.5, cells: cells.length };
}

/**
 * Openings on outside surfaces: the openings of each piece's container (void cells on its surface, in a plane: a box face, a
 * notch wall, a step) minus the cells another piece occupies in front of them. A partly covered opening keeps its uncovered part.
 */
export function exposedPatches(boxes: PlacedBox[]): Exposed[] {
  const out: Exposed[] = [];
  const near = new Map<number, PlacedBox[]>();
  for (const [i, j] of nearPairs(boxes, 1)) {
    (near.get(i) ?? near.set(i, []).get(i)!).push(boxes[j]);
    (near.get(j) ?? near.set(j, []).get(j)!).push(boxes[i]);
  }
  boxes.forEach((b, bi) => {
    const others = near.get(bi) ?? [];
    const [, ny, nz] = b.occ.dims;
    for (const face of FACE_KEYS) {
      const axis = FACE_AXIS[face];
      const sign = FACE_SIGN[face];
      const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      for (const f of b.occ.features[face] as Feature[]) {
        let parts: { idx: number[]; patch: Patch }[];
        if (!others.length) parts = [{ idx: Array.from(f.idx), patch: f }];
        else {
          // keep the cells with nothing in front of them
          const free: number[] = [];
          for (const i of f.idx) {
            const z = i % nz;
            const y = ((i - z) / nz) % ny;
            const x = ((i - z) / nz - y) / ny;
            const w: [number, number, number] = [b.min[0] + x, b.min[1] + y, b.min[2] + z];
            w[axis] += sign;
            let covered = false;
            for (const o of others) {
              if (w[0] < o.min[0] || w[1] < o.min[1] || w[2] < o.min[2] || w[0] >= o.max[0] || w[1] >= o.max[1] || w[2] >= o.max[2]) continue;
              const [, ony, onz] = o.occ.dims;
              if (o.occ.cls[((w[0] - o.min[0]) * ony + (w[1] - o.min[1])) * onz + (w[2] - o.min[2])] !== OUT) {
                covered = true;
                break;
              }
            }
            if (!covered) free.push(i);
          }
          if (free.length === f.idx.length) parts = [{ idx: free, patch: f }];
          else parts = splitOpenings(face, b.occ.dims, free);
        }
        for (const p of parts) {
          if (p.idx.length < MIN_OPENING_CELLS) continue;
          const point: Vec3 = [0, 0, 0];
          point[axis] = toFt(b.min[axis] + f.plane);
          point[o1] = toFt(b.min[o1] + p.patch.cu);
          point[o2] = toFt(b.min[o2] + p.patch.cv);
          out.push({ pieceId: b.piece.id, face, patch: p.patch, plane: b.min[axis] + f.plane, point, idx: Int32Array.from(p.idx) });
        }
      }
    }
  });
  return out;
}

/** The connected pieces (4-neighbour in the face layer) of a set of opening cells. */
function splitOpenings(face: FaceKey, dims: [number, number, number], cells: number[]): { idx: number[]; patch: Patch }[] {
  const [, ny, nz] = dims;
  const axis = FACE_AXIS[face];
  const h = axis === 2 ? ny : nz;
  const key = (i: number) => {
    const z = i % nz;
    const y = ((i - z) / nz) % ny;
    const x = ((i - z) / nz - y) / ny;
    const [u, v] = axis === 0 ? [y, z] : axis === 1 ? [x, z] : [x, y];
    return u * h + v;
  };
  const at = new Map<number, number>(cells.map((i) => [key(i), i]));
  const seen = new Set<number>();
  const out: { idx: number[]; patch: Patch }[] = [];
  for (const start of at.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const members: number[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      members.push(at.get(k)!);
      const u = Math.floor(k / h);
      for (const nk of [k - h, k + h, k - 1, k + 1]) {
        if (!at.has(nk) || seen.has(nk)) continue;
        if ((nk === k - 1 || nk === k + 1) && Math.floor(nk / h) !== u) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    out.push({ idx: members, patch: patchOf(face, dims, members) });
  }
  return out;
}

/** The piece the entrance is on when the user has not chosen: a Lobby at the lowest level, else the lowest piece. */
export function proposeEntrance(boxes: PlacedBox[]): string | null {
  if (!boxes.length) return null;
  const rank = (b: PlacedBox) => (categoryOf(b.tile) === "lobby" ? 0 : 1) * 1000 + b.min[2] * 2 + (b.min[0] + b.min[1]) * 0.001;
  return [...boxes].sort((a, b) => rank(a) - rank(b))[0].piece.id;
}

/** The ground-level way in on the entrance piece (the lowest outside side-face opening), feet. */
export function entrancePoint(layout: Layout): Vec3 | null {
  const b = layout.entranceId ? layout.byId.get(layout.entranceId) : null;
  if (!b) return null;
  const mine = layout.exposed.filter((e) => e.pieceId === b.piece.id && FACE_AXIS[e.face] !== 2);
  if (!mine.length) return [toFt((b.min[0] + b.max[0]) / 2), toFt((b.min[1] + b.max[1]) / 2), toFt(b.min[2]) + 3];
  const best = [...mine].sort((a, c) => a.point[2] - c.point[2] || c.patch.cells - a.patch.cells)[0];
  return best.point;
}

const zoneKey = (id: string, zone: number) => `${id}#${zone}`;

/** The floors of the entrance piece that open to the outside: zones with a standing place near an uncovered side opening, else its main floor. */
function entryZones(b: PlacedBox, exposed: Exposed[]): number[] {
  const wk = getWalk(b.occ);
  if (wk.main < 0) return [];
  const [nx, ny, nz] = b.occ.dims;
  const found = new Set<number>();
  for (const e of exposed) {
    if (e.pieceId !== b.piece.id || FACE_AXIS[e.face] === 2) continue;
    for (const i of e.idx) {
      const z = i % nz;
      const y = ((i - z) / nz) % ny;
      const x = ((i - z) / nz - y) / ny;
      for (let dx = -3; dx <= 3; dx++)
        for (let dy = -3; dy <= 3; dy++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
          for (let Z = Math.max(1, z - HEAD_CELLS); Z <= z; Z++) {
            const k = (X * ny + Y) * nz + Z;
            if (wk.stand[k] && wk.zones[wk.zone[k]].significant) found.add(wk.zone[k]);
          }
        }
    }
  }
  return found.size ? [...found] : [wk.main];
}

export function analyzeLayout(doc: ArrangementDoc, tileById: Map<string, ParsedTile>, rules: ProgramRules): Layout {
  const boxes = boxesFor(doc.pieces, tileById);
  const byId = new Map(boxes.map((b) => [b.piece.id, b]));
  const tol = toleranceFt(rules);
  const collisions = findCollisions(boxes).filter((c) => violates(c));
  const overlaps: [string, string][] = collisions.map((c) => [c.aId, c.bId]);
  const nested = findNested(boxes);
  const contacts = findContacts(boxes);
  const joints = groupByPair(contacts).map((g) => jointFromContacts(g, boxes, tol, doc.ratings));

  // physical attachment: any contact (even a sealed one) holds two pieces together
  const touch = new Map<string, string[]>();
  for (const b of boxes) touch.set(b.piece.id, []);
  for (const j of joints) {
    touch.get(j.aId)!.push(j.bId);
    touch.get(j.bId)!.push(j.aId);
  }
  const flood = (start: string, edges: Map<string, string[]>, seen: Set<string>) => {
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const n of edges.get(id) ?? []) if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    return comp;
  };
  // the main set is the biggest group of touching pieces (the one holding the chosen entrance when it ties); smaller groups are islands
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const b of boxes) if (!seen.has(b.piece.id)) groups.push(flood(b.piece.id, touch, seen));
  const chosen = doc.entranceId && byId.has(doc.entranceId) ? doc.entranceId : null;
  const main = [...groups].sort((a, b) => b.length - a.length || (chosen && b.includes(chosen) ? 1 : 0) - (chosen && a.includes(chosen) ? 1 : 0))[0] ?? [];
  const attached = new Set<string>(main);
  const islands = groups.filter((g) => g !== main);
  // the entrance lives in the main set: the chosen piece if it is there, else a proposed one
  const entranceId = chosen && attached.has(chosen) ? chosen : proposeEntrance(boxes.filter((b) => attached.has(b.piece.id)));
  const exposed = exposedPatches(boxes);

  // walking: floors (each piece's own zones) joined by routes across joints, flooded from the floors of the entrance that open outside
  const reachedZones = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const j of joints)
    for (const x of j.connect.crossings) {
      const a = zoneKey(x.aId, x.zoneA);
      const b = zoneKey(x.bId, x.zoneB);
      (edges.get(a) ?? edges.set(a, []).get(a)!).push(b);
      (edges.get(b) ?? edges.set(b, []).get(b)!).push(a);
    }
  const entry = entranceId ? byId.get(entranceId) : undefined;
  if (entry) {
    const stack: string[] = [];
    for (const z of entryZones(entry, exposed)) {
      const k = zoneKey(entry.piece.id, z);
      reachedZones.add(k);
      stack.push(k);
    }
    while (stack.length) {
      const k = stack.pop()!;
      for (const n of edges.get(k) ?? []) if (!reachedZones.has(n)) {
        reachedZones.add(n);
        stack.push(n);
      }
    }
  }
  const reach = new Map<string, PieceReach>();
  const reachable = new Set<string>();
  for (const b of boxes) {
    const wk = getWalk(b.occ);
    let total = 0;
    let got = 0;
    for (const z of wk.zones) {
      if (!z.significant) continue;
      total += z.areaFt2;
      if (reachedZones.has(zoneKey(b.piece.id, z.id))) got += z.areaFt2;
    }
    const mainReached = wk.main >= 0 && reachedZones.has(zoneKey(b.piece.id, wk.main));
    reach.set(b.piece.id, { totalFt2: total, reachedFt2: got, main: mainReached });
    if (mainReached || b.piece.id === entranceId) reachable.add(b.piece.id); // the piece the entrance is on is where the walk starts
  }
  const unreachable = [...attached].filter((id) => !reachable.has(id));

  // the piece-to-piece view of the routes (for the sequence of spaces): joints with a route between floors that can be reached
  const walk = new Map<string, { id: string; joint: Joint }[]>();
  for (const b of boxes) walk.set(b.piece.id, []);
  for (const j of joints) {
    if (!j.connect.crossings.some((x) => reachedZones.has(zoneKey(x.aId, x.zoneA)) && reachedZones.has(zoneKey(x.bId, x.zoneB)))) continue;
    walk.get(j.aId)!.push({ id: j.bId, joint: j });
    walk.get(j.bId)!.push({ id: j.aId, joint: j });
  }

  return { boxes, byId, contacts, joints, overlaps, collisions, nested, entranceId, attached, islands, reachable, unreachable, reachedZones, reach, walk, exposed, bounds: boundsOfBoxes(boxes) };
}

/** The pieces that would be cut off from the main set if `removed` were taken away (not counting the removed ones). */
export function orphansIfRemoved(layout: Layout, removed: Set<string>): string[] {
  const left = layout.boxes.filter((b) => !removed.has(b.piece.id));
  if (!left.length) return [];
  const touch = new Map<string, string[]>();
  for (const b of left) touch.set(b.piece.id, []);
  for (const j of layout.joints) {
    if (removed.has(j.aId) || removed.has(j.bId)) continue;
    touch.get(j.aId)!.push(j.bId);
    touch.get(j.bId)!.push(j.aId);
  }
  // the biggest group of touching pieces is the main set; the rest are orphaned
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const b of left) {
    if (seen.has(b.piece.id)) continue;
    const comp: string[] = [];
    const stack = [b.piece.id];
    seen.add(b.piece.id);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const n of touch.get(id) ?? []) if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    groups.push(comp);
  }
  const main = [...groups].sort((a, b) => b.length - a.length)[0];
  return groups.filter((g) => g !== main).flat();
}

/** Pieces with no physical link to the main set after a change, computed on a candidate document. */
export function islandsOf(doc: ArrangementDoc, tileById: Map<string, ParsedTile>, rules: ProgramRules): { islands: string[][]; overlaps: [string, string][] } {
  const l = analyzeLayout(doc, tileById, rules);
  return { islands: l.islands, overlaps: l.overlaps };
}

export { collide };
