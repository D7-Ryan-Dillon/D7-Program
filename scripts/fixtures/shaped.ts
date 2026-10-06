// Small synthetic tiles with real shaped containers, built the way the engine exports them (void.u8, plates.u8, mask.u8 on the
// 0.5 ft grid), then read by the app's own analysis pipeline. They stand in for engine output so the interlocking geometry can be
// tested without Rhino. Units here are CELLS (1 cell = 0.5 ft); a 10 ft floor-to-floor is 20 cells.
//
//   L        a gathering tile whose container is an L: a 20 x 20 ft footprint with a 10 x 10 ft notch cut out of one corner
//            (the cells of the notch are OUTSIDE the container: mask 0). Doorways open into the two notch walls and the two arm ends.
//   cube     a plain 10 x 10 x 10 ft office tile with a doorway on each side; it is exactly the size of L's notch
//   step     a two-storey tile whose upper storey is half the footprint: a stepped section, with a doorway in the step wall
//   riser    a one-storey tile that stands on the step beside the upper storey
//   ...and a few for the failure cases (a solid block, a stacked pair joined by a shaft, a tile with a low doorway, a pocket).

import { analyzeTile } from "../../lib/tiles/analyze";
import type { ParsedTile } from "../../lib/types";

export const CELL = 0.5;

export interface Vox {
  dims: [number, number, number];
  /** 1 = void; cells outside the container may hold anything (the app must use the mask) */
  void: Uint8Array;
  mask: Uint8Array;
  plates: Uint8Array;
}

export const vox = (nx: number, ny: number, nz: number): Vox => ({ dims: [nx, ny, nz], void: new Uint8Array(nx * ny * nz), mask: new Uint8Array(nx * ny * nz).fill(1), plates: new Uint8Array(nx * ny * nz) });

type Box = [number, number, number, number, number, number]; // x0 y0 z0 x1 y1 z1, upper bounds exclusive

function each(v: Vox, b: Box, f: (i: number) => void) {
  const [, ny, nz] = v.dims;
  for (let x = b[0]; x < b[3]; x++) for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) f((x * ny + y) * nz + z);
}
/** Carved space inside the container. */
export const carve = (v: Vox, b: Box) => each(v, b, (i) => {
  v.void[i] = 1;
  v.plates[i] = 0;
});
/** Material (foam), optionally a floor plate. */
export const solid = (v: Vox, b: Box, plate = 0) => each(v, b, (i) => {
  v.void[i] = 0;
  v.plates[i] = plate;
});
/** Outside the container. `trap`: leave void = 1 there, as an exporter that does not blank the outside might. */
export const outside = (v: Vox, b: Box, trap = false) => each(v, b, (i) => {
  v.mask[i] = 0;
  v.void[i] = trap ? 1 : 0;
  v.plates[i] = 0;
});

export interface Spec {
  id: string;
  category: "gathering" | "office" | "lobby";
  typology: string;
}

/** A tile from voxels: the app's own analysis supplies its levels, rooms and structure, like the real pipeline. */
export function tileOf(spec: Spec, v: Vox): ParsedTile {
  const [nx, ny, nz] = v.dims;
  const masked = v.void.map((x, i) => (x && v.mask[i] ? 1 : 0)) as Uint8Array;
  const a = analyzeTile({ void: masked, grid: v.dims, cell: CELL, plates: v.plates, mask: v.mask });
  return {
    id: spec.id,
    name: spec.id,
    sourceFolderName: spec.id,
    schema: "erosion-tile/4",
    tileFt: [nx * CELL, ny * CELL, nz * CELL],
    cellFt: CELL,
    grid: v.dims,
    config: {},
    metrics: {} as ParsedTile["metrics"],
    glbUrl: "",
    voxels: { void: v.void, mask: v.mask, plates: v.plates },
    guessed: { category: spec.category, typology: spec.typology },
    meta: { category: spec.category, typology: spec.typology },
    spaces: a.spaces,
    structure: a.structure,
  } as ParsedTile;
}

const W = 2; // wall thickness, cells (1 ft)
const FLOOR = 2; // floor slab, cells
const DOOR_W = 8; // doorway width, cells (4 ft)
const DOOR_H = 14; // doorway height, cells (7 ft)

/** A doorway through a wall: a box of void from the room to the outside of the container. */
function door(v: Vox, axis: 0 | 1, _unused: number, from: number, to: number, lo: number, z0: number, h = DOOR_H, w = DOOR_W) {
  // axis 0: the doorway runs along x from `from` to `to`, y in [lo, lo + w); axis 1: along y, x in [lo, lo + w)
  const b: Box = axis === 0 ? [from, lo, z0, to, lo + w, z0 + h] : [lo, from, z0, lo + w, to, z0 + h];
  carve(v, b);
}

/** L: 20 x 20 ft footprint, NE quadrant (10 x 10 ft) outside the container; one 10 ft storey. */
export function L(id = "L_gather", category: Spec["category"] = "gathering", trap = true, height = 20): ParsedTile {
  const v = vox(40, 40, height);
  const H = height;
  const doorH = height === 20 ? DOOR_H : H - FLOOR - W; // a taller L has doorways as high as its rooms
  solid(v, [0, 0, 0, 40, 40, H]); // everything starts as foam
  outside(v, [20, 20, 0, 40, 40, H], trap); // then the notch is cut out of the container (with void = 1 left in it, to prove the mask is what counts)
  // the two arms of the L: along x (y < 20) and along y (x < 20), walls and slabs left as foam
  carve(v, [W, W, FLOOR, 40 - W, 20 - W, H - W]);
  carve(v, [W, W, FLOOR, 20 - W, 40 - W, H - W]);
  solid(v, [0, 0, 0, 40, 20, FLOOR], 1);
  solid(v, [0, 20, 0, 20, 40, FLOOR], 1);
  // a doorway through each wall that faces the notch (so a piece standing in the notch can walk in), and one at the end of each arm
  door(v, 0, 0, 20 - W, 20, 22, FLOOR, doorH); // into the notch wall x = 20 (faces +x), y 22..30
  door(v, 1, 0, 20 - W, 20, 22, FLOOR, doorH); // into the notch wall y = 20 (faces +y), x 22..30
  door(v, 0, 0, 40 - W, 40, 6, FLOOR, doorH); // end of the x arm (faces +x), y 6..14
  door(v, 1, 0, 40 - W, 40, 6, FLOOR, doorH); // end of the y arm (faces +y), x 6..14
  door(v, 0, 0, 0, W, 6, FLOOR, doorH); // west end
  door(v, 1, 0, 0, W, 6, FLOOR, doorH); // south end
  return tileOf({ id, category, typology: "L-shaped container with a notch" }, v);
}

/** cube: 10 x 10 x 10 ft, a doorway at floor level in each of the four sides. */
export function cube(id = "cube_office", category: Spec["category"] = "office", doors: { lowH?: number } = {}): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  const h = doors.lowH ?? DOOR_H;
  door(v, 0, 0, 0, W, 2, FLOOR, h);
  door(v, 0, 0, 20 - W, 20, 2, FLOOR, h);
  door(v, 1, 0, 0, W, 2, FLOOR, h);
  door(v, 1, 0, 20 - W, 20, 2, FLOOR, h);
  return tileOf({ id, category, typology: doors.lowH ? "low doorways" : "plain cube" }, v);
}

/** cubeTall: a 10 x 10 x 13 ft tile with tall doorways (as high as the room), for the rise-by-ramp case. */
export function cubeTall(id = "cube_tall"): ParsedTile {
  const v = vox(20, 20, 26);
  solid(v, [0, 0, 0, 20, 20, 26]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 26 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  const h = 26 - FLOOR - W;
  door(v, 0, 0, 0, W, 2, FLOOR, h);
  door(v, 0, 0, 20 - W, 20, 2, FLOOR, h);
  door(v, 1, 0, 0, W, 2, FLOOR, h);
  door(v, 1, 0, 20 - W, 20, 2, FLOOR, h);
  return tileOf({ id, category: "office", typology: "tall cube" }, v);
}

/** step: 20 ft (x) by 10 ft (y), two storeys; the upper storey covers only x < 10 ft. A stepped section, floors at 1 ft and 11 ft. */
export function step(id = "step_gather", category: Spec["category"] = "gathering"): ParsedTile {
  const v = vox(40, 20, 40);
  outside(v, [20, 0, 20, 40, 20, 40]);
  solid(v, [0, 0, 0, 40, 20, 20]);
  solid(v, [0, 0, 20, 20, 20, 40]);
  // lower storey, full width; upper storey over x < 20 (cells)
  carve(v, [W, W, FLOOR, 40 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 40, 20, FLOOR], 1);
  carve(v, [W, W, 20 + FLOOR, 20 - W, 20 - W, 40 - W]);
  solid(v, [0, 0, 20, 20, 20, 20 + FLOOR], 1);
  // the doorway in the step wall (faces +x) at the upper floor, y 6..14; and one at the lower storey's far end
  carve(v, [20 - W, 6, 20 + FLOOR, 20, 14, 20 + FLOOR + DOOR_H]);
  door(v, 0, 0, 40 - W, 40, 6, FLOOR);
  door(v, 0, 0, 0, W, 6, FLOOR);
  return tileOf({ id, category, typology: "stepped section" }, v);
}

/** riser: 10 x 10 x 10 ft, stands on the lower roof of `step`; a doorway in its -x wall at its floor. */
export function riser(id = "riser_office", category: Spec["category"] = "office"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  door(v, 0, 0, 0, W, 6, FLOOR);
  door(v, 0, 0, 20 - W, 20, 6, FLOOR);
  return tileOf({ id, category, typology: "single storey on a step" }, v);
}

/** A solid block 10 x 10 x 10 ft: no void at all. */
export function block(id = "block"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  return tileOf({ id, category: "office", typology: "solid block" }, v);
}

/** Two 10 ft cubes' worth of tile joined by a shaft: `lower` has a hole in its roof, `upper` a hole in its floor. They connect by void only. */
export function shaft(id: string, which: "lower" | "upper"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  // a doorway in one side so the room can be entered
  door(v, 0, 0, 0, W, 6, FLOOR);
  if (which === "lower") carve(v, [6, 6, 18, 14, 14, 20]); // a hole in the roof
  else carve(v, [6, 6, 0, 14, 14, FLOOR]); // a hole in the floor (the floor slab is the plate, the hole makes a shaft)
  return tileOf({ id, category: "gathering", typology: `shaft ${which}` }, v);
}

/** A tile whose only doorway leads into a closet too small to be a space; the big room behind has no door. */
export function pocket(id = "pocket"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W + 6, W, FLOOR, 20 - W, 20 - W, 20 - W]); // the big room, walled off by 3 ft of foam from the closet
  carve(v, [W, 6, FLOOR, W + 5, 12, 20 - W]); // the closet: 2.5 ft x 3 ft
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  door(v, 0, 0, 0, W, 6, FLOOR, DOOR_H, 6);
  return tileOf({ id, category: "gathering", typology: "doorway into a closet" }, v);
}

/**
 * corridor: 40 ft long, 12 ft wide, 10 ft tall: a 4 ft passage, then a neck (3 ft by default), then a 10 ft chamber, entered at one end. For reading passage
 * widths. `neckFt` makes the neck narrower (2 ft is too narrow to walk: the walking rules need a 2.5 ft clear width); `lowFt` a neck whose ceiling is that
 * high above the floor (5.5 ft is too low to walk under: the rules need 6.5 ft). Both are the cases an Analysis that used its own, looser, thresholds used
 * to pass and Arrange failed.
 */
export function corridor(id = "corridor", category: Spec["category"] = "gathering", o: { neckFt?: number; lowFt?: number } = {}): ParsedTile {
  const v = vox(80, 24, 20);
  solid(v, [0, 0, 0, 80, 24, 20]);
  const mid = 12;
  const neck = Math.round(((o.neckFt ?? 3) * 2) / 2) * 2; // cells: 3 ft = 6
  const band = (x0: number, x1: number, width: number, top = 18) => carve(v, [x0, mid - width / 2, FLOOR, x1, mid + width / 2, top]);
  band(2, 26, 8);
  band(26, 38, neck, o.lowFt ? FLOOR + Math.round(o.lowFt * 2) : 18);
  band(38, 78, 20);
  solid(v, [0, 0, 0, 80, 24, FLOOR], 1);
  carve(v, [0, 8, FLOOR, W, 16, FLOOR + DOOR_H]); // the way in, at the end
  return tileOf({ id, category, typology: "passage, neck and chamber" }, v);
}

export type RampKind = "ramp" | "stair" | "sheer" | "lowCeiling" | "broken";

/**
 * rampHall: 36 x 10 x 15 ft. Entered at its west end at floor level (floor top 1 ft); its east end has a doorway at the UPPER floor, `riseFt` higher.
 * What lies between them is the point:
 *   ramp        a floor that climbs one 6 in riser every 2 ft (1 : 4): continuous, supported geometry
 *   stair       one 6 in riser every 1 ft (1 : 2)
 *   sheer       the same rise as one bare jump: a wall of `riseFt` with nothing to climb it
 *   lowCeiling  the ramp with a lintel across it that leaves 5.5 ft of headroom: too low to walk under
 *   broken      the ramp with one riser missing (a 1 ft jump in the middle of it)
 * Meant to be entered from the west and left through the east doorway into a tile whose floor is as high as the upper floor.
 */
export function rampHall(id: string, kind: RampKind, riseFt = 3): ParsedTile {
  const nx = 72;
  const ny = 20;
  const nz = 30;
  const v = vox(nx, ny, nz);
  solid(v, [0, 0, 0, nx, ny, nz]);
  carve(v, [W, W, FLOOR, nx - W, ny - W, nz - W]);
  const R = Math.round(riseFt * 2); // risers
  const x0 = 24;
  const per = kind === "stair" ? 2 : 4; // cells of run per riser
  const fh = (x: number): number => {
    if (x < x0) return FLOOR;
    if (kind === "sheer") return FLOOR + R;
    let n = Math.floor((x - x0) / per) + 1;
    if (kind === "broken" && n >= Math.round(R / 2)) n += 1; // one riser is a double riser: a 1 ft jump
    return FLOOR + Math.min(n, R);
  };
  solid(v, [0, 0, 0, nx, ny, FLOOR], 1);
  for (let x = W; x < nx - W; x++) solid(v, [x, W, 0, x + 1, ny - W, fh(x)], 1);
  if (kind === "lowCeiling") {
    const xl = x0 + 10;
    solid(v, [xl, W, fh(xl) + 11, xl + 4, ny - W, nz - W]); // 5.5 ft of clear height at the lintel
  }
  const up = FLOOR + R;
  carve(v, [0, 6, FLOOR, W, 14, FLOOR + DOOR_H]); // the way in, at floor level
  carve(v, [nx - W, 6, up, nx, 14, up + DOOR_H]); // the way out, at the upper floor
  return tileOf({ id, category: "gathering", typology: `hall with a ${kind}` }, v);
}

/** skylit: a 10 ft cube with a doorway and an opening in its roof (an unglazed hole to the sky). */
export function skylit(id = "skylit", category: Spec["category"] = "gathering"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  carve(v, [6, 6, 18, 14, 14, 20]); // the roof opening
  door(v, 0, 0, 0, W, 6, FLOOR);
  return tileOf({ id, category, typology: "room with a roof opening" }, v);
}

/** closed: a room with no opening at all: nobody can come in. */
export function closed(id = "closed", category: Spec["category"] = "office"): ParsedTile {
  const v = vox(20, 20, 20);
  solid(v, [0, 0, 0, 20, 20, 20]);
  carve(v, [W, W, FLOOR, 20 - W, 20 - W, 20 - W]);
  solid(v, [0, 0, 0, 20, 20, FLOOR], 1);
  return tileOf({ id, category, typology: "sealed room" }, v);
}

/** the L again with its notch filled with foam and no mask (the container is the whole box): the denominators must differ from the real L. */
export function Lfilled(id = "L_filled"): ParsedTile {
  const t = L(id, "gathering", false);
  const v = { ...t.voxels };
  const n = 40 * 40 * 20;
  const vd = new Uint8Array(n);
  const mask = t.voxels.mask!;
  for (let i = 0; i < n; i++) vd[i] = mask[i] && t.voxels.void![i] ? 1 : 0;
  return { ...t, voxels: { void: vd, plates: v.plates }, spaces: undefined, structure: undefined } as ParsedTile;
}
