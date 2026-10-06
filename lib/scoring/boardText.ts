// What a board prints under a descriptor's bar: the matrix measurement with its unit, and its status when it is not a plain measurement. One function,
// so the board, the Analysis tab and the exports say the same.

import { STATUS_LABEL } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";

export const boardTextFor = (r: MatrixResult): string => `${r.measure.headline}${r.measure.status === "measured" ? "" : ` [${STATUS_LABEL[r.measure.status]}]`}`;

export function descriptorText(evals: Map<string, TileEvaluation>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, e] of evals) {
    out[id] = {};
    for (const r of e.results) out[id][r.key] = boardTextFor(r);
  }
  return out;
}
