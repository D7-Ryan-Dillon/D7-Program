// What a viewport (or a board slot) remembers about its drawing: plan or section, which level, where, on which ground.
// Kept plain and serialisable so it is saved with the project like every other view setting.

import type { ParsedTile } from "@/lib/types";
import { buildDrawing, planSpecs, type Drawing, type DrawingHighlight, type DrawingSpec } from "./build";
import type { Ground } from "./render";

export type DrawMode = "model" | "plan" | "section";

export interface DrawState {
  /** model = the 3D view; plan / section = the automatic drawings */
  mode: DrawMode;
  /** plan: a level id of the tile (null = its first level) */
  level: number | null;
  axis: "x" | "y";
  /** section position in feet (null = the middle) */
  pos: number | null;
  ground: Ground;
  /** room names and areas on a plan */
  labels: boolean;
  /** the main route through the tile, drawn over the plan or section */
  route: boolean;
}

export const defaultDrawState = (): DrawState => ({ mode: "model", level: null, axis: "x", pos: null, ground: "dark", labels: true, route: false });

/** The drawing a state asks for, on this tile. Null in "model" mode. */
export function specFromState(tile: ParsedTile, draw: DrawState): DrawingSpec | null {
  if (draw.mode === "model") return null;
  if (draw.mode === "plan") {
    const levels = tile.spaces?.levels ?? [];
    const level = levels.find((l) => l.id === draw.level) ?? levels[0];
    return level ? { kind: "plan", level: level.id } : { kind: "plan", cutFt: tile.tileFt[2] / 2 };
  }
  const span = tile.tileFt[draw.axis === "x" ? 0 : 1];
  return { kind: "section", axis: draw.axis, positionFt: draw.pos ?? span / 2 };
}

export function drawingFromState(tile: ParsedTile, draw: DrawState, highlight?: DrawingHighlight): Drawing | null {
  const spec = specFromState(tile, draw);
  if (!spec) return null;
  const d = buildDrawing(tile, spec, { ...highlight, route: highlight?.route || draw.route });
  if (d && !draw.labels) d.labels = [];
  return d;
}

export { planSpecs };
