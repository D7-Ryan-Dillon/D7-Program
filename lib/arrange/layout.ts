// The layout of an arrangement read as a graph: which pieces touch, which touches are walkable, what is attached to what.
// This is where the connected rule lives: every piece must touch the main set, and every piece must be reachable on foot
// from the entrance.

import type { ParsedTile } from "@/lib/types";
import { boxesOverlap, boundsOfBoxes, findContacts, placeBox, toFt, type Contact, type PlacedBox } from "./geometry";
import { jointFromContact } from "./joints";
import { categoryOf, FACE_AXIS, FACE_KEYS, FACE_SIGN, getFacts, type FaceKey, type Patch } from "./orient";
import { toleranceFt, type ArrangementDoc, type Joint, type Piece, type ProgramRules, type Vec3 } from "./types";

export interface Exposed {
  pieceId: string;
  face: FaceKey;
  patch: Patch;
  /** feet: the centre of the opening, on the face */
  point: Vec3;
}

export interface Layout {
  boxes: PlacedBox[];
  byId: Map<string, PlacedBox>;
  contacts: Contact[];
  joints: Joint[];
  overlaps: [string, string][];
  entranceId: string | null;
  /** pieces joined (touching) to the entrance piece, itself included */
  attached: Set<string>;
  /** groups of pieces that touch each other but not the main set */
  islands: string[][];
  /** pieces reachable on foot from the entrance */
  reachable: Set<string>;
  /** attached but with no walkable link from the entrance */
  unreachable: string[];
  /** walkable neighbours: piece id -> [neighbour id, joint] */
  walk: Map<string, { id: string; joint: Joint }[]>;
  /** every opening on an outside face (not covered by a neighbour) */
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

/** Openings on outside faces: a patch whose centre is not covered by any contact on that face. */
export function exposedPatches(boxes: PlacedBox[], contacts: Contact[]): Exposed[] {
  const out: Exposed[] = [];
  const onFace = new Map<string, Contact[]>();
  for (const c of contacts) {
    const add = (b: PlacedBox, face: FaceKey) => {
      const k = `${b.piece.id}|${face}`;
      onFace.set(k, [...(onFace.get(k) ?? []), c]);
    };
    add(c.a, c.axis === 0 ? "x+" : c.axis === 1 ? "y+" : "z+");
    add(c.b, c.axis === 0 ? "x-" : c.axis === 1 ? "y-" : "z-");
  }
  for (const b of boxes) {
    const facts = getFacts(b.tile, b.piece.rotZ, b.piece.mirrorX, b.piece.scale);
    for (const face of FACE_KEYS) {
      const axis = FACE_AXIS[face];
      const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      const cs = onFace.get(`${b.piece.id}|${face}`) ?? [];
      for (const patch of facts.patches[face]) {
        const wu = b.min[o1] + patch.cu;
        const wv = b.min[o2] + patch.cv;
        if (cs.some((c) => wu >= c.lo[0] && wu <= c.hi[0] && wv >= c.lo[1] && wv <= c.hi[1])) continue;
        const p: Vec3 = [0, 0, 0];
        p[axis] = toFt(FACE_SIGN[face] < 0 ? b.min[axis] : b.max[axis]);
        p[o1] = toFt(wu);
        p[o2] = toFt(wv);
        out.push({ pieceId: b.piece.id, face, patch, point: p });
      }
    }
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

export function analyzeLayout(doc: ArrangementDoc, tileById: Map<string, ParsedTile>, rules: ProgramRules): Layout {
  const boxes = boxesFor(doc.pieces, tileById);
  const byId = new Map(boxes.map((b) => [b.piece.id, b]));
  const tol = toleranceFt(rules);
  const overlaps: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i], boxes[j])) overlaps.push([boxes[i].piece.id, boxes[j].piece.id]);
  const contacts = findContacts(boxes);
  const joints = contacts.map((c) => jointFromContact(c, tol, doc.ratings));

  // physical attachment: any contact (even a sealed one) holds two pieces together
  const touch = new Map<string, string[]>();
  for (const b of boxes) touch.set(b.piece.id, []);
  for (const c of contacts) {
    touch.get(c.a.piece.id)!.push(c.b.piece.id);
    touch.get(c.b.piece.id)!.push(c.a.piece.id);
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

  // walking: a joint with an opening that meets an opening
  const walk = new Map<string, { id: string; joint: Joint }[]>();
  for (const b of boxes) walk.set(b.piece.id, []);
  const walkEdges = new Map<string, string[]>();
  for (const b of boxes) walkEdges.set(b.piece.id, []);
  for (const j of joints)
    if (j.walkable) {
      walk.get(j.aId)!.push({ id: j.bId, joint: j });
      walk.get(j.bId)!.push({ id: j.aId, joint: j });
      walkEdges.get(j.aId)!.push(j.bId);
      walkEdges.get(j.bId)!.push(j.aId);
    }
  const reachable = new Set<string>();
  if (entranceId) flood(entranceId, walkEdges, reachable);
  const unreachable = [...attached].filter((id) => !reachable.has(id));

  return { boxes, byId, contacts, joints, overlaps, entranceId, attached, islands, reachable, unreachable, walk, exposed: exposedPatches(boxes, contacts), bounds: boundsOfBoxes(boxes) };
}

/** The pieces that would be cut off from the main set if `removed` were taken away (not counting the removed ones). */
export function orphansIfRemoved(layout: Layout, removed: Set<string>): string[] {
  const left = layout.boxes.filter((b) => !removed.has(b.piece.id));
  if (!left.length) return [];
  const touch = new Map<string, string[]>();
  for (const b of left) touch.set(b.piece.id, []);
  for (const c of layout.contacts) {
    if (removed.has(c.a.piece.id) || removed.has(c.b.piece.id)) continue;
    touch.get(c.a.piece.id)!.push(c.b.piece.id);
    touch.get(c.b.piece.id)!.push(c.a.piece.id);
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
