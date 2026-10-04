// The full set of drawings a tile exports: a plan of every level (cut 4 ft above its floor) and sections along X and Y at a
// quarter, a half and three quarters. The same set the Grasshopper engine writes into vector/drawings/, on white paper at
// 1 inch = 10 feet.

import type { ParsedTile } from "@/lib/types";
import { buildDrawing } from "./build";
import { drawingStyle, drawingToSvg } from "./render";

export interface DrawingFile {
  path: string;
  svg: string;
  role: "drawing.plan" | "drawing.section";
  what: string;
}

const MAX_PLANS = 10;

export function drawingSet(tile: ParsedTile): DrawingFile[] {
  const out: DrawingFile[] = [];
  const style = drawingStyle("paper");
  const levels = tile.spaces?.levels ?? [];
  const pick = levels.length <= MAX_PLANS ? levels : Array.from({ length: MAX_PLANS }, (_, i) => levels[Math.round((i * (levels.length - 1)) / (MAX_PLANS - 1))]);
  for (const lv of pick) {
    const d = buildDrawing(tile, { kind: "plan", level: lv.id });
    if (!d) continue;
    out.push({
      path: `vector/drawings/plan_level_${String(lv.id).padStart(2, "0")}_z${lv.z_ft.toFixed(1)}.svg`,
      svg: drawingToSvg(d, style, { feetPerInch: 10 }),
      role: "drawing.plan",
      what: `plan of ${lv.name} cut 4 ft above its floor: foam solid, plates blue, floor tinted, void white; 1 in = 10 ft`,
    });
  }
  const cell = tile.cellFt;
  for (const axis of ["x", "y"] as const) {
    const span = tile.tileFt[axis === "x" ? 0 : 1];
    const n = tile.grid[axis === "x" ? 0 : 1];
    for (const frac of [0.25, 0.5, 0.75]) {
      const k = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
      const pos = (k + 0.5) * cell;
      const d = buildDrawing(tile, { kind: "section", axis, positionFt: Math.min(pos, span) });
      if (!d) continue;
      out.push({
        path: `vector/drawings/section_${axis}_${pos.toFixed(1).padStart(5, "0")}ft.svg`,
        svg: drawingToSvg(d, style, { feetPerInch: 10 }),
        role: "drawing.section",
        what: `section at ${axis.toUpperCase()} = ${pos.toFixed(1)} ft: foam solid, plates blue, void white, level lines in magenta; 1 in = 10 ft`,
      });
    }
  }
  return out;
}
