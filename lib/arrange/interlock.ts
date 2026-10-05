// The assignment's interlock test as a button: 2, 4 or 8 copies of one tile placed by repeat, mirror or shift, with every
// joint scored. It is built in a separate preview and never touches the working arrangement.
//   repeat  copies side by side (2: a pair along X; 4: a 2 x 2; 8: a 2 x 2 x 2)
//   mirror  the neighbour is the mirror image (in X, then in Y; a vertical mirror would turn floors into ceilings, so
//           the upper layer of 8 repeats the lower)
//   shift   neighbours offset by half a tile (2: a pair; 4: a brick of 2 rows; 8: two such layers, the upper one offset)

import type { ParsedTile } from "@/lib/types";
import { toFt } from "./geometry";
import { analyzeLayout } from "./layout";
import { orientedDims } from "./orient";
import { makePiece, withPiece } from "./ops";
import { aggregateScore, defaultRules, emptyDoc, type ArrangementDoc, type ProgramRules, type Vec3 } from "./types";

export type InterlockPattern = "repeat" | "mirror" | "shift";
export type InterlockCount = 2 | 4 | 8;
export const INTERLOCK_PATTERNS: InterlockPattern[] = ["repeat", "mirror", "shift"];
export const INTERLOCK_COUNTS: InterlockCount[] = [2, 4, 8];

export function interlockDoc(tile: ParsedTile, pattern: InterlockPattern, count: InterlockCount): ArrangementDoc {
  const [W, D, H] = orientedDims(tile, 0, 1);
  let doc = emptyDoc();
  const place = (cx: number, cy: number, layer: number, over: { mirrorX?: boolean; rotZ?: number } = {}, shiftCells: [number, number] = [0, 0]) => {
    const pos: Vec3 = [toFt(cx * W + shiftCells[0]), toFt(cy * D + shiftCells[1]), toFt(layer * H)];
    doc = withPiece(doc, makePiece(doc, tile.id, pos, over));
  };
  const cols = count === 2 ? 2 : 2;
  const rows = count === 2 ? 1 : 2;
  const layers = count === 8 ? 2 : 1;
  for (let layer = 0; layer < layers; layer++)
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        if (pattern === "repeat") place(cx, cy, layer);
        else if (pattern === "mirror") {
          // a mirror in X for odd columns; a mirror in Y (= mirror X turned half a turn) for odd rows
          const mx = cx % 2 === 1;
          const my = cy % 2 === 1;
          const over = mx && my ? { mirrorX: false, rotZ: 2 } : mx ? { mirrorX: true, rotZ: 0 } : my ? { mirrorX: true, rotZ: 2 } : {};
          place(cx, cy, layer, over);
        } else {
          // brick: odd rows are offset by half a tile in X; a pair is offset by half a tile in Y
          if (count === 2) place(cx, cy, layer, {}, [0, cx === 1 ? Math.round(D / 2) : 0]);
          else place(cx, cy, layer, {}, [cy % 2 === 1 ? Math.round(W / 2) : 0, layer === 1 ? Math.round(D / 2) : 0]);
        }
      }
  return doc;
}

export interface InterlockResult {
  pattern: InterlockPattern;
  count: InterlockCount;
  doc: ArrangementDoc;
  overall: number | null;
  worst: number | null;
  joints: number;
  connected: boolean;
  walkable: boolean;
}

export function runInterlock(tile: ParsedTile, pattern: InterlockPattern, count: InterlockCount, rules: ProgramRules = defaultRules()): InterlockResult {
  const doc = interlockDoc(tile, pattern, count);
  const l = analyzeLayout(doc, new Map([[tile.id, tile]]), rules);
  const scores = l.joints.map((j) => j.score);
  const real = scores.filter((s): s is number => s !== null);
  return { pattern, count, doc, overall: aggregateScore(scores), worst: real.length ? Math.min(...real) : null, joints: l.joints.length, connected: l.islands.length === 0 && l.overlaps.length === 0, walkable: l.unreachable.length === 0 && l.islands.length === 0 };
}

export const runAllInterlock = (tile: ParsedTile, rules?: ProgramRules): InterlockResult[] => INTERLOCK_PATTERNS.flatMap((p) => INTERLOCK_COUNTS.map((c) => runInterlock(tile, p, c, rules)));

export function interlockCsv(tile: ParsedTile, rows: InterlockResult[]): string {
  const head = "tile,pattern,copies,overall,worst joint,joints,connected,walkable";
  return [head, ...rows.map((r) => [JSON.stringify(tile.name), r.pattern, r.count, r.overall?.toFixed(1) ?? "sealed", r.worst?.toFixed(1) ?? "", r.joints, r.connected, r.walkable].join(","))].join("\n");
}
