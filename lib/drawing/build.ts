// Plan and section drawings of a tile, made from its voxels as soon as it loads (no setup): poche (foam and plates solid,
// void white), the floors of a level tinted, room labels, level lines. Everything is in feet, u to the right and v up, so
// the same Drawing is drawn on screen, printed on a board and written as SVG (lib/drawing/render.ts).
//
// Outlines come from the smoothed void field (voxels.voidSmooth) traced at its half level, so they are smooth and a floor
// plate's flat top stays flat; without it the binary void is used.

import type { ParsedTile } from "@/lib/types";
import type { LevelInfo } from "@/lib/tiles/types";
import { traceCells, traceField, type Ring } from "./contour";

/** Plans are cut this far above the level's floor (the architectural convention). */
export const PLAN_CUT_FT = 4.0;

export interface DrawingSpec {
  kind: "plan" | "section";
  /** plan: a level id from tile.spaces.levels (or cutFt for any height) */
  level?: number;
  cutFt?: number;
  /** section: along x (looking along +x, across is y) or along y (across is x), at this position in feet */
  axis?: "x" | "y";
  positionFt?: number;
}

/** What to emphasise (the Evidence button in Analysis): rooms by id, a level, the main route. */
export interface DrawingHighlight {
  rooms?: number[];
  levels?: number[];
  route?: boolean;
  /** a floor-supported route (tile coordinates, ft): drawn instead of the main route */
  routePoints?: number[][];
  /** boxes to mark (tile coordinates, ft): problem areas, constrictions */
  regions?: { min: number[]; max: number[] }[];
}

export interface DrawingLabel {
  x: number;
  y: number;
  text: string;
}

export interface Drawing {
  spec: DrawingSpec;
  title: string;
  subtitle: string;
  widthFt: number;
  heightFt: number;
  foam: Ring[];
  plates: Ring[];
  branches: Ring[];
  tint: Ring[];
  /** translucent overlays for highlighted rooms / levels */
  emphasis: Ring[];
  labels: DrawingLabel[];
  /** section: horizontal lines at each level */
  levelLines: { z: number; text: string }[];
  /** plan: the main route as a polyline (u, v) */
  route: number[][] | null;
}

/** A 2D array stored as (i along u, j along v). */
type Slice = { w: number; h: number; at: (i: number, j: number) => number };

function slice(tile: ParsedTile, source: Uint8Array, spec: DrawingSpec, level?: LevelInfo, scale = 1): Slice | null {
  const [nx, ny, nz] = tile.grid;
  const cell = tile.cellFt;
  if (spec.kind === "plan") {
    const z = spec.cutFt ?? (level ? level.z_ft + PLAN_CUT_FT : tile.tileFt[2] / 2);
    const k = Math.min(nz - 1, Math.max(0, Math.floor(z / cell)));
    return { w: nx, h: ny, at: (i, j) => source[(i * ny + j) * nz + k] / scale };
  }
  const pos = spec.positionFt ?? tile.tileFt[spec.axis === "x" ? 0 : 1] / 2;
  if (spec.axis === "x") {
    const k = Math.min(nx - 1, Math.max(0, Math.floor(pos / cell)));
    return { w: ny, h: nz, at: (i, j) => source[(k * ny + i) * nz + j] / scale };
  }
  const k = Math.min(ny - 1, Math.max(0, Math.floor(pos / cell)));
  return { w: nx, h: nz, at: (i, j) => source[(i * ny + k) * nz + j] / scale };
}

/** Foam as a 0..1 field: 1 - smoothed void when the tile has it, else the binary void. */
function foamSlice(tile: ParsedTile, spec: DrawingSpec, level?: LevelInfo): Slice | null {
  const v = tile.voxels;
  if (v.voidSmooth) {
    const s = slice(tile, v.voidSmooth, spec, level, 255);
    return s && { ...s, at: (i, j) => 1 - s.at(i, j) };
  }
  if (!v.void) return null;
  const s = slice(tile, v.void, spec, level, 1);
  return s && { ...s, at: (i, j) => 1 - s.at(i, j) };
}

/** The outline (along cell edges) of a binary voxel layer of the slice: plates, branches, rooms. They are clipped to the smooth foam outline when drawn. */
function maskRings(tile: ParsedTile, source: Uint8Array | undefined, spec: DrawingSpec, level?: LevelInfo, pick?: (v: number) => boolean): Ring[] {
  if (!source) return [];
  const s = slice(tile, source, spec, level, 1);
  if (!s) return [];
  const test = pick ?? ((v: number) => v > 0);
  return traceCells((i, j) => test(s.at(i, j)), s.w, s.h, tile.cellFt);
}

const rings = (s: Slice | null, cell: number, level = 0.5): Ring[] => (s ? traceField(s.at, s.w, s.h, level, cell) : []);

/** The levels a tile has, for the plan picker (a tile with none gets a single mid-height plan). */
export function planSpecs(tile: ParsedTile): { spec: DrawingSpec; label: string }[] {
  const levels = tile.spaces?.levels ?? [];
  if (!levels.length) return [{ spec: { kind: "plan", cutFt: tile.tileFt[2] / 2 }, label: "Plan" }];
  return levels.map((l) => ({ spec: { kind: "plan" as const, level: l.id }, label: l.name.replace(/^the /, "") }));
}

export function buildDrawing(tile: ParsedTile, spec: DrawingSpec, highlight?: DrawingHighlight): Drawing | null {
  const cell = tile.cellFt;
  const levels = tile.spaces?.levels ?? [];
  const level = spec.kind === "plan" && spec.level !== undefined ? levels.find((l) => l.id === spec.level) : undefined;
  const foam = foamSlice(tile, spec, level);
  if (!foam) return null;
  const widthFt = spec.kind === "plan" ? tile.tileFt[0] : spec.axis === "x" ? tile.tileFt[1] : tile.tileFt[0];
  const heightFt = spec.kind === "plan" ? tile.tileFt[1] : tile.tileFt[2];
  const [nx, ny, nz] = tile.grid;

  // the floors of the level, seen below the cut
  let tint: Ring[] = [];
  if (spec.kind === "plan" && level && tile.voxels.void) {
    const vd = tile.voxels.void;
    const [k0, k1] = level.layers;
    const field = {
      w: nx,
      h: ny,
      at: (i: number, j: number) => {
        for (let k = k0; k <= k1; k++) if (k > 0 && vd[(i * ny + j) * nz + k] && !vd[(i * ny + j) * nz + k - 1]) return 1;
        return 0;
      },
    };
    tint = traceCells((i, j) => field.at(i, j) > 0, nx, ny, cell);
  }

  // emphasis: highlighted rooms (their void in this slice) and levels
  let emphasis: Ring[] = [];
  if (highlight?.rooms?.length && tile.voxels.rooms) {
    const set = new Set(highlight.rooms);
    emphasis = maskRings(tile, tile.voxels.rooms, spec, level, (v) => set.has(v));
  }
  if (highlight?.levels?.length && spec.kind === "plan" && tile.voxels.void) {
    const vd = tile.voxels.void;
    const ids = new Set(highlight.levels);
    const hl = levels.filter((l) => ids.has(l.id));
    emphasis = [
      ...emphasis,
      ...traceCells(
        (i, j) => {
          for (const l of hl) for (let k = l.layers[0]; k <= l.layers[1]; k++) if (k > 0 && vd[(i * ny + j) * nz + k] && !vd[(i * ny + j) * nz + k - 1]) return true;
          return false;
        },
        nx,
        ny,
        cell,
      ),
    ];
  }

  const labels: DrawingLabel[] = [];
  if (spec.kind === "plan" && level) {
    for (const r of tile.spaces?.rooms ?? []) {
      if (r.level_ids.includes(level.id)) labels.push({ x: r.centroid_ft[0], y: r.centroid_ft[1], text: `${r.kind} ${Math.round(r.floor_area_ft2)} ft²` });
    }
  }
  const levelLines =
    spec.kind === "section"
      ? levels.map((l) => ({ z: l.kind === "flat" ? l.z_ft : (l.z_min_ft + l.z_max_ft) / 2, text: l.kind === "flat" ? l.z_ft.toFixed(1) : `${Math.round(l.z_min_ft)}-${Math.round(l.z_max_ft)}` }))
      : [];
  let route: number[][] | null = null;
  const main = tile.spaces?.main_route;
  const line = highlight?.routePoints?.length ? highlight.routePoints : main && highlight?.route ? main.points_ft : null;
  if (spec.kind === "plan" && line) route = line.map((p) => [p[0], p[1]]);
  if (spec.kind === "section" && line) route = line.map((p) => [spec.axis === "x" ? p[1] : p[0], p[2]]);
  // regions (a constriction, a floor with no way to it): a box on a plan, the box seen across the section's line on a section
  if (highlight?.regions?.length) {
    const near = (lo: number, hi: number, at: number) => at >= lo - 2 && at <= hi + 2;
    for (const r of highlight.regions) {
      if (spec.kind === "plan") emphasis = [...emphasis, [[r.min[0], r.min[1]], [r.max[0], r.min[1]], [r.max[0], r.max[1]], [r.min[0], r.max[1]]]];
      else {
        const k = spec.axis === "x" ? 0 : 1;
        if (!near(r.min[k], r.max[k], spec.positionFt ?? 0)) continue;
        const u = spec.axis === "x" ? 1 : 0;
        emphasis = [...emphasis, [[r.min[u], r.min[2]], [r.max[u], r.min[2]], [r.max[u], r.max[2]], [r.min[u], r.max[2]]]];
      }
    }
  }

  const posText = spec.kind === "section" ? `${spec.axis!.toUpperCase()} = ${(spec.positionFt ?? widthFt / 2).toFixed(1)} ft` : level ? `${level.name}, cut at ${(level.z_ft + PLAN_CUT_FT).toFixed(1)} ft` : `cut at ${(spec.cutFt ?? 0).toFixed(1)} ft`;
  return {
    spec,
    title: `${tile.name}`,
    subtitle: `${spec.kind === "plan" ? "Plan" : "Section"}: ${posText}`,
    widthFt,
    heightFt,
    foam: rings(foam, cell),
    plates: maskRings(tile, tile.voxels.plates, spec, level),
    branches: maskRings(tile, tile.voxels.struts, spec, level),
    tint,
    emphasis,
    labels,
    levelLines,
    route,
  };
}
