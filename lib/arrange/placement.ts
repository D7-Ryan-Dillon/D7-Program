// Where a placed piece's mesh goes: tile glTF space -> the arrangement's Z-up feet. The arrangement scene works in feet
// with Z up (a root group turns it to three's Y up), so pieces, joints, the site and the camera share one coordinate system.

import * as THREE from "three";
import type { ParsedTile } from "@/lib/types";
import type { Piece } from "./types";

const M_TO_FT = 3.280839895013123;

/** Tile glTF coordinates -> the tile's own feet (Z up, origin at its low corner). Engine tiles: metres, Y up, y flipped. Builder tiles: feet, Y up. */
export function glbToFt(tile: ParsedTile): THREE.Matrix4 {
  const builder = !!tile.schema?.startsWith("section-field") || tile.engineVersion === "section-field-builder";
  return builder ? new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1) : new THREE.Matrix4().set(M_TO_FT, 0, 0, 0, 0, 0, -M_TO_FT, 0, 0, M_TO_FT, 0, 0, 0, 0, 0, 1);
}

/** The tile's own feet -> the arrangement's feet: mirror in X, quarter turns about Z, scale, then to the piece's low corner. */
export function pieceFtMatrix(tile: ParsedTile, piece: Pick<Piece, "pos" | "rotZ" | "mirrorX" | "scale">): THREE.Matrix4 {
  const [W, D] = tile.tileFt;
  const k = ((piece.rotZ % 4) + 4) % 4;
  const [W2, D2] = k % 2 === 1 ? [D, W] : [W, D];
  const m = new THREE.Matrix4();
  m.multiply(new THREE.Matrix4().makeTranslation(piece.pos[0], piece.pos[1], piece.pos[2]));
  m.multiply(new THREE.Matrix4().makeScale(piece.scale, piece.scale, piece.scale));
  m.multiply(new THREE.Matrix4().makeTranslation(W2 / 2, D2 / 2, 0));
  m.multiply(new THREE.Matrix4().makeRotationZ((k * Math.PI) / 2));
  if (piece.mirrorX) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  m.multiply(new THREE.Matrix4().makeTranslation(-W / 2, -D / 2, 0));
  return m;
}

/** glTF space of a tile -> the arrangement's feet. */
export const pieceMatrix = (tile: ParsedTile, piece: Pick<Piece, "pos" | "rotZ" | "mirrorX" | "scale">): THREE.Matrix4 => pieceFtMatrix(tile, piece).multiply(glbToFt(tile));
