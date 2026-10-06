// What a board prints under a descriptor's bar: the matrix measurement with its unit, and its status when it is not a plain measurement. One function,
// so the board, the Analysis tab and the exports say the same.

import { STATUS_LABEL } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
import { barOf, type BarSpec } from "@/lib/scoring/bars";
import { typologyKey } from "@/lib/scoring/compareSet";
import type { ParsedTile } from "@/lib/types";

export const boardTextFor = (r: MatrixResult): string => `${r.measure.headline}${r.measure.status === "measured" ? "" : ` [${STATUS_LABEL[r.measure.status]}]`}`;

/** The bar of every descriptor of every tile, from the same evaluation as the Analysis tab (strength band on the app's scale, fit to the tile's typology, status), for the Boards descriptor pages. */
export function descriptorBars(evals: Map<string, TileEvaluation>, tiles: ParsedTile[]): Record<string, Record<string, BarSpec>> {
  const out: Record<string, Record<string, BarSpec>> = {};
  const byId = new Map(tiles.map((t) => [t.id, t]));
  for (const [id, e] of evals) {
    const t = byId.get(id);
    out[id] = {};
    for (const r of e.results) out[id][r.key] = barOf(r, t ? typologyKey(t) : undefined);
  }
  return out;
}

export function descriptorText(evals: Map<string, TileEvaluation>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, e] of evals) {
    out[id] = {};
    for (const r of e.results) out[id][r.key] = boardTextFor(r);
  }
  return out;
}
