// Help while building: the best neighbours for a piece or an open face (suggest next / fill the gap), and better tiles
// to put in a piece's place (auto replace). All use the generator's own candidate machinery, so a suggestion is always a
// placement the generator itself would accept (a walkable joint, no overlap, the rules obeyed).

import type { ParsedTile } from "@/lib/types";
import { toCell, toFt } from "./geometry";
import { analyzeLayout, type Exposed } from "./layout";
import { allowedByCounts, assemblyScore, placeAgainst, scoreCandidate, stateOf, type Candidate, type GenContext } from "./generate";
import { isPlaceable, orientedDims } from "./orient";
import { makePiece, patchPieces, removePieces } from "./ops";
import type { ArrangementDoc, Piece, Vec3 } from "./types";

export interface Suggestion {
  candidate: Candidate;
  tile: ParsedTile;
  /** a line of words on what makes it good */
  note: string;
}

const note = (c: Candidate): string => {
  const p = c.primary.parts;
  const bits: string[] = [`joint ${c.primary.score?.toFixed(0) ?? "-"}`];
  if (p.floors !== null) bits.push(`floors ${p.floors.toFixed(0)}`);
  if (c.joints.length > 1) bits.push(`${c.joints.length} joints`);
  return bits.join(" · ");
};

/** The best tile + orientation + position for each given open face, scored; the top `limit` distinct ones. */
export function suggestFor(ctx: GenContext, doc: ArrangementDoc, slots: Exposed[], limit = 5): Suggestion[] {
  const st = stateOf(doc.pieces, ctx);
  const found: Suggestion[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    for (const tile of ctx.bank) {
      if (!isPlaceable(tile) || !allowedByCounts(tile, st, ctx, doc.pieces.length)) continue;
      for (let rot = 0; rot < 4; rot++)
        for (const mirror of [false, true])
          for (let patch = 0; patch < 2; patch++)
            for (const level of [null, 0, 1, 2, 10, 18, 26]) {
              const c = placeAgainst(ctx, st, slot, tile, rot, mirror, patch, level, 0);
              if (!c) continue;
              const k = `${tile.id}|${c.piece.pos.join(",")}|${rot}|${mirror}`;
              if (seen.has(k)) continue;
              seen.add(k);
              c.score = scoreCandidate(ctx, st, c);
              found.push({ candidate: c, tile, note: note(c) });
            }
    }
  }
  found.sort((a, b) => b.candidate.score - a.candidate.score);
  // one suggestion per tile first, then the rest, so the list shows variety
  const out: Suggestion[] = [];
  const tiles = new Set<string>();
  for (const s of found) if (!tiles.has(s.tile.id)) {
    tiles.add(s.tile.id);
    out.push(s);
  }
  for (const s of found) if (out.length < limit && !out.includes(s)) out.push(s);
  return out.slice(0, limit);
}

/** Suggestions for a piece: every open face it has. */
export function suggestNext(ctx: GenContext, doc: ArrangementDoc, pieceId: string | null, limit = 5): Suggestion[] {
  const layout = analyzeLayout(doc, ctx.tileById, ctx.rules);
  const slots = layout.exposed.filter((e) => (pieceId ? e.pieceId === pieceId : true)).sort((a, b) => b.patch.cells - a.patch.cells).slice(0, 6);
  return suggestFor(ctx, doc, slots, limit);
}

export function applySuggestion(doc: ArrangementDoc, s: Suggestion): { doc: ArrangementDoc; id: string } {
  const c = s.candidate;
  const piece = makePiece(doc, c.piece.tileId, c.piece.pos, { rotZ: c.piece.rotZ, mirrorX: c.piece.mirrorX, scale: c.piece.scale });
  return { doc: { ...doc, pieces: [...doc.pieces, piece] }, id: piece.id };
}

export interface Replacement {
  tile: ParsedTile;
  piece: Piece;
  doc: ArrangementDoc;
  /** whole-arrangement score (higher is better) */
  score: number;
  delta: number;
}

/** Other tiles in this piece's place, ranked by how the whole arrangement scores; only options that leave the arrangement connected and overlap-free are offered. */
export function betterTiles(ctx: GenContext, doc: ArrangementDoc, pieceId: string, limit = 5): { current: number; options: Replacement[] } {
  const cur = doc.pieces.find((p) => p.id === pieceId);
  if (!cur) return { current: 0, options: [] };
  const current = assemblyScore(doc, ctx);
  const oldTile = ctx.tileById.get(cur.tileId);
  const oldDims = oldTile ? orientedDims(oldTile, cur.rotZ, cur.scale) : [0, 0, 0];
  const out: Replacement[] = [];
  for (const tile of ctx.bank) {
    if (tile.id === cur.tileId || !isPlaceable(tile)) continue;
    let bestForTile: Replacement | null = null;
    for (let rot = 0; rot < 4; rot++)
      for (const mirror of [false, true]) {
        const d = orientedDims(tile, rot, cur.scale);
        // keep the old centre (so a bigger or smaller piece grows or shrinks about it), then try the same low corner
        const centred: Vec3 = [toFt(toCell(cur.pos[0]) + Math.round((oldDims[0] - d[0]) / 2)), toFt(toCell(cur.pos[1]) + Math.round((oldDims[1] - d[1]) / 2)), cur.pos[2]];
        for (const pos of [cur.pos, centred]) {
          const next = patchPieces(doc, new Set([pieceId]), { tileId: tile.id, rotZ: rot, mirrorX: mirror, pos });
          const layout = analyzeLayout(next, ctx.tileById, ctx.rules);
          if (layout.overlaps.length || layout.islands.length) continue;
          const score = assemblyScore(next, ctx);
          if (!bestForTile || score > bestForTile.score) bestForTile = { tile, piece: next.pieces.find((p) => p.id === pieceId)!, doc: next, score, delta: score - current };
        }
      }
    if (bestForTile) out.push(bestForTile);
  }
  out.sort((a, b) => b.score - a.score);
  return { current, options: out.slice(0, limit) };
}

export { removePieces };
