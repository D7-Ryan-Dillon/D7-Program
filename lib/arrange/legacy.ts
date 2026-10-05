// Adapts pieces to the older centre-placed form the legacy smooth (lib/exporters/csgFuse.ts) and the OBJ export take.

import type { ParsedTile } from "@/lib/types";
import { orientedDims } from "./orient";
import { toFt } from "./geometry";
import type { Piece, PlacedInstance } from "./types";

export function piecesToInstances(pieces: Piece[], tileById: Map<string, ParsedTile>): PlacedInstance[] {
  const out: PlacedInstance[] = [];
  for (const p of pieces) {
    const t = tileById.get(p.tileId);
    if (!t) continue;
    const d = orientedDims(t, p.rotZ, p.scale);
    out.push({
      id: p.id,
      tileId: p.tileId,
      gridPos: [0, 0, 0],
      posFt: [p.pos[0] + toFt(d[0]) / 2, p.pos[1] + toFt(d[1]) / 2, p.pos[2] + toFt(d[2]) / 2],
      scale: p.scale,
      mirror: p.mirrorX ? "x" : "",
      rotZ: p.rotZ,
    });
  }
  return out;
}
