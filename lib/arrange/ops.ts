// Edits to an arrangement, as pure functions on the document (so undo is just keeping the old one). Every edit can be
// checked with `checkEdit`, which is where the connected rule is enforced: a change that overlaps pieces or cuts a piece
// off from the main set is reported before it is accepted.

import type { ParsedTile } from "@/lib/types";
import { boxesFor, analyzeLayout } from "./layout";
import { placeBox, snapFt, toCell, toFt, type PlacedBox } from "./geometry";
import { placementFree } from "./collision";
import { orientedDims } from "./orient";
import type { ArrangementDoc, Piece, ProgramRules, Vec3 } from "./types";

let counter = 0;
export const newPieceId = (doc: ArrangementDoc): string => {
  const used = new Set(doc.pieces.map((p) => p.id));
  let id = "";
  do id = `p${(++counter).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  while (used.has(id));
  return id;
};

export const makePiece = (doc: ArrangementDoc, tileId: string, pos: Vec3, over: Partial<Piece> = {}): Piece => ({ id: newPieceId(doc), tileId, pos, rotZ: 0, mirrorX: false, scale: 1, locked: false, ...over });

export const withPiece = (doc: ArrangementDoc, piece: Piece): ArrangementDoc => ({ ...doc, pieces: [...doc.pieces, piece] });

export function removePieces(doc: ArrangementDoc, ids: Set<string>): ArrangementDoc {
  const names = { ...doc.names };
  for (const id of ids) delete names[id];
  // a connector belongs to the joint of two pieces: it goes when either does
  const connectors = doc.connectors ? Object.fromEntries(Object.entries(doc.connectors).filter(([joint]) => !joint.split("~").some((id) => ids.has(id)))) : undefined;
  return { ...doc, pieces: doc.pieces.filter((p) => !ids.has(p.id)), names, ...(connectors ? { connectors } : {}), entranceId: doc.entranceId && ids.has(doc.entranceId) ? null : doc.entranceId };
}

export function patchPieces(doc: ArrangementDoc, ids: Set<string>, patch: Partial<Piece> | ((p: Piece) => Partial<Piece>)): ArrangementDoc {
  return { ...doc, pieces: doc.pieces.map((p) => (ids.has(p.id) ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)) };
}

export function movePieces(doc: ArrangementDoc, ids: Set<string>, delta: Vec3): ArrangementDoc {
  return patchPieces(doc, ids, (p) => ({ pos: [snapFt(p.pos[0] + delta[0]), snapFt(p.pos[1] + delta[1]), snapFt(p.pos[2] + delta[2])] as Vec3 }));
}

/** The pieces that move together with `ids`: whole groups. */
export function withGroups(doc: ArrangementDoc, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set(doc.pieces.filter((p) => out.has(p.id) && p.group).map((p) => p.group!));
  for (const p of doc.pieces) if (p.group && groups.has(p.group)) out.add(p.id);
  return out;
}

function groupBounds(doc: ArrangementDoc, ids: Set<string>, tileById: Map<string, ParsedTile>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of doc.pieces) {
    if (!ids.has(p.id)) continue;
    const t = tileById.get(p.tileId);
    if (!t) continue;
    const d = orientedDims(t, p.rotZ, p.scale);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], toCell(p.pos[k]));
      max[k] = Math.max(max[k], toCell(p.pos[k]) + d[k]);
    }
  }
  return { min, max };
}

/** One quarter turn (counter-clockwise from above) of the pieces about their common centre. */
export function rotateGroup(doc: ArrangementDoc, ids: Set<string>, tileById: Map<string, ParsedTile>, turns = 1): ArrangementDoc {
  let out = doc;
  for (let k = 0; k < (((turns % 4) + 4) % 4); k++) {
    const b = groupBounds(out, ids, tileById);
    let cx = b.min[0] + b.max[0];
    const cy = b.min[1] + b.max[1];
    // the turn needs a whole-cell centre; when the group's centre falls between cells the rounding alternates (down, then up), so four turns come back exactly
    if (Math.abs(cx + cy) % 2 !== 0) cx += Math.abs(cx) % 2 !== 0 ? -1 : 1;
    out = patchPieces(out, ids, (p) => {
      const t = tileById.get(p.tileId)!;
      const d = orientedDims(t, p.rotZ, p.scale);
      const x0 = toCell(p.pos[0]);
      const y0 = toCell(p.pos[1]);
      // (x, y) -> ((cx + cy) / 2 - y, (cy - cx) / 2 + x); the box [x0, x0 + W] x [y0, y0 + D] lands at min ((cx + cy) / 2 - (y0 + D), (cy - cx) / 2 + x0)
      return { pos: [toFt((cx + cy) / 2 - (y0 + d[1])), toFt((cy - cx) / 2 + x0), p.pos[2]] as Vec3, rotZ: (p.rotZ + 1) % 4 };
    });
  }
  return out;
}

/** A mirror of the pieces in X about their common centre. */
export function mirrorGroup(doc: ArrangementDoc, ids: Set<string>, tileById: Map<string, ParsedTile>): ArrangementDoc {
  const b = groupBounds(doc, ids, tileById);
  const sum = b.min[0] + b.max[0];
  return patchPieces(doc, ids, (p) => {
    const t = tileById.get(p.tileId)!;
    const d = orientedDims(t, p.rotZ, p.scale);
    return { pos: [toFt(sum - (toCell(p.pos[0]) + d[0])), p.pos[1], p.pos[2]] as Vec3, mirrorX: !p.mirrorX, rotZ: (4 - p.rotZ) % 4 };
  });
}

export type AlignMode = "x-min" | "x-center" | "x-max" | "y-min" | "y-center" | "y-max" | "z-min" | "z-max" | "x-even" | "y-even" | "z-even";

export function alignPieces(doc: ArrangementDoc, ids: Set<string>, tileById: Map<string, ParsedTile>, mode: AlignMode): ArrangementDoc {
  const items = doc.pieces.filter((p) => ids.has(p.id) && tileById.has(p.tileId));
  if (items.length < 2) return doc;
  const axis = mode.startsWith("x") ? 0 : mode.startsWith("y") ? 1 : 2;
  const dim = (p: Piece) => orientedDims(tileById.get(p.tileId)!, p.rotZ, p.scale)[axis];
  const lo = (p: Piece) => toCell(p.pos[axis]);
  const kind = mode.slice(2);
  if (kind === "even") {
    const sorted = [...items].sort((a, b) => lo(a) - lo(b));
    const first = lo(sorted[0]);
    const last = lo(sorted[sorted.length - 1]) + dim(sorted[sorted.length - 1]);
    const gap = Math.max(0, (last - first - sorted.reduce((s, p) => s + dim(p), 0)) / (sorted.length - 1));
    const at = new Map<string, number>();
    let cur = first;
    for (const p of sorted) {
      at.set(p.id, Math.round(cur));
      cur += dim(p) + gap;
    }
    return patchPieces(doc, ids, (p) => {
      const pos: Vec3 = [...p.pos];
      pos[axis] = toFt(at.get(p.id) ?? lo(p));
      return { pos };
    });
  }
  const targetMin = Math.min(...items.map(lo));
  const targetMax = Math.max(...items.map((p) => lo(p) + dim(p)));
  return patchPieces(doc, ids, (p) => {
    const pos: Vec3 = [...p.pos];
    const v = kind === "min" ? targetMin : kind === "max" ? targetMax - dim(p) : Math.round((targetMin + targetMax - dim(p)) / 2);
    pos[axis] = toFt(v);
    return { pos };
  });
}

export function groupPieces(doc: ArrangementDoc, ids: Set<string>): ArrangementDoc {
  const g = `g${Date.now().toString(36)}`;
  return patchPieces(doc, ids, { group: g });
}
export const ungroupPieces = (doc: ArrangementDoc, ids: Set<string>): ArrangementDoc => patchPieces(doc, ids, { group: undefined });

/** A copy of a piece placed flush beside (or above) the original wherever it fits. */
export function duplicatePiece(doc: ArrangementDoc, id: string, tileById: Map<string, ParsedTile>): { doc: ArrangementDoc; id: string } | null {
  const src = doc.pieces.find((p) => p.id === id);
  const tile = src && tileById.get(src.tileId);
  if (!src || !tile) return null;
  const boxes = boxesFor(doc.pieces, tileById);
  const me = boxes.find((b) => b.piece.id === id);
  if (!me) return null;
  const dims = orientedDims(tile, src.rotZ, src.scale);
  const tries: [number, number, number][] = [[me.max[0], me.min[1], me.min[2]], [me.min[0] - dims[0], me.min[1], me.min[2]], [me.min[0], me.max[1], me.min[2]], [me.min[0], me.min[1] - dims[1], me.min[2]], [me.min[0], me.min[1], me.max[2]], [me.min[0], me.min[1], me.min[2] - dims[2]]];
  for (const t of tries) {
    const copy = makePiece(doc, src.tileId, [toFt(t[0]), toFt(t[1]), toFt(t[2])], { rotZ: src.rotZ, mirrorX: src.mirrorX, scale: src.scale });
    // the cells decide whether the copy fits: a copy may sit inside the original's notch when the shapes nest
    if (!placementFree(placeBox(copy, tile), boxes)) continue;
    return { doc: withPiece(doc, copy), id: copy.id };
  }
  return null;
}

// ---- checks --------------------------------------------------------------------------------------------------------

export interface EditCheck {
  ok: boolean;
  overlaps: [string, string][];
  /** groups of pieces not attached to the main set */
  islands: string[][];
}

export function checkEdit(doc: ArrangementDoc, tileById: Map<string, ParsedTile>, rules: ProgramRules): EditCheck {
  if (doc.pieces.length < 2) return { ok: true, overlaps: [], islands: [] };
  const l = analyzeLayout(doc, tileById, rules);
  return { ok: l.overlaps.length === 0 && l.islands.length === 0, overlaps: l.overlaps, islands: l.islands };
}

/** A box moved by a whole-cell translation (same cells, new place). */
const shifted = (b: PlacedBox, t: [number, number, number]): PlacedBox => ({
  ...b,
  piece: { ...b.piece, pos: [b.piece.pos[0] + toFt(t[0]), b.piece.pos[1] + toFt(t[1]), b.piece.pos[2] + toFt(t[2])] },
  min: [b.min[0] + t[0], b.min[1] + t[1], b.min[2] + t[2]],
  max: [b.max[0] + t[0], b.max[1] + t[1], b.max[2] + t[2]],
});

/** Moves each island group the shortest way that makes it touch the main set without any piece claiming another's cells; null if some island cannot be re-attached. */
export function reattachIslands(doc: ArrangementDoc, islands: string[][], tileById: Map<string, ParsedTile>, rules: ProgramRules): ArrangementDoc | null {
  let out = doc;
  for (const isle of islands) {
    const ids = new Set(isle);
    const all = boxesFor(out.pieces, tileById);
    const mine = all.filter((b) => ids.has(b.piece.id));
    const rest = all.filter((b) => !ids.has(b.piece.id));
    if (!rest.length || !mine.length) return null;
    const options: { t: [number, number, number]; len: number }[] = [];
    for (const m of mine)
      for (const q of rest)
        for (const axis of [0, 1, 2] as const) {
          const [o1, o2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
          // sideways shifts that leave the two boxes overlapping on the other two axes: keep as is, line up an edge or the centre
          const lateral = (o: number) => {
            const opts = new Set<number>([0, q.min[o] - m.min[o], q.max[o] - m.max[o], Math.round((q.min[o] + q.max[o] - m.min[o] - m.max[o]) / 2)]);
            return [...opts].filter((d) => Math.min(m.max[o] + d, q.max[o]) - Math.max(m.min[o] + d, q.min[o]) >= 2);
          };
          for (const plus of [true, false]) {
            for (const d1 of lateral(o1))
              for (const d2 of lateral(o2)) {
                const t: [number, number, number] = [0, 0, 0];
                t[axis] = plus ? q.max[axis] - m.min[axis] : q.min[axis] - m.max[axis];
                t[o1] = d1;
                t[o2] = d2;
                const moved = mine.map((b) => shifted(b, t));
                if (moved.some((mv) => !placementFree(mv, rest))) continue;
                options.push({ t, len: Math.hypot(...t) });
              }
          }
        }
    // nearest first; the first that leaves the group attached (really touching, by cells) wins
    options.sort((a, b) => a.len - b.len);
    let placed: ArrangementDoc | null = null;
    const seen = new Set<string>();
    let tested = 0;
    for (const o of options) {
      const k = o.t.join(",");
      if (seen.has(k)) continue;
      seen.add(k);
      const next = movePieces(out, ids, [toFt(o.t[0]), toFt(o.t[1]), toFt(o.t[2])]);
      const l = analyzeLayout(next, tileById, rules);
      if (!l.islands.some((g) => g.some((id) => ids.has(id)))) {
        placed = next;
        break;
      }
      if (++tested >= 12) break;
    }
    if (!placed) return null;
    out = placed;
  }
  return checkEdit(out, tileById, rules).ok ? out : null;
}
