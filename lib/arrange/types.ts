import type { FaceName } from "@/lib/types";

export interface PlacedInstance {
  id: string;
  tileId: string;
  /** Which grid slot this instance nominally occupies, for frontier/occupancy
   * bookkeeping only (HANDOFF section 5 units: 1 = one tile-width). Not used
   * directly for rendering -- see posFt. */
  gridPos: [number, number, number];
  /** Real world placement of this instance's own centre, in feet -- accounts
   * for `scale` and, where a matched branch/opening drove the join, a
   * lateral nudge so the two openings' centres actually line up rather than
   * just the tiles' bounding boxes. */
  posFt: [number, number, number];
  /** Uniform scale applied to this instance at render/placement time. */
  scale: number;
  /** Letters x/y/z, applied before rotation. */
  mirror: string;
  /** Quarter turns about the vertical (Z) axis, 0-3 -- always available. */
  rotZ: number;
  /** An additional quarter-turn tip about X or Y, applied before rotZ --
   * only ever set when the generator's "allow tilt rotation" setting is on. */
  tilt?: { axis: "x" | "y"; steps: 1 | 2 | 3 };
  parentJointId?: string;
}

export interface Joint {
  id: string;
  aId: string;
  bId: string;
  /** The face on `a` that touches `b`. */
  face: FaceName;
  score: number | null;
  rating: "good" | "bad" | null;
}

export interface Assembly {
  instances: PlacedInstance[];
  joints: Joint[];
}

export interface AutoGenerateSettings {
  amount: number;
  maxCopiesPerTile: number;
  seed: number;
  spineFirst: boolean;
  minScore: number;
  /** Uniform per-instance scale is drawn from [scaleMin, scaleMax] -- 1/1 by
   * default (every piece at its native 20 ft size). */
  scaleMin: number;
  scaleMax: number;
  /** When true, a piece may also be tipped a quarter turn onto its side (in
   * addition to always being free to spin about the vertical axis) --
   * roughly doubles the orientations tried per socket, so it's opt-in. */
  allowTiltRotation: boolean;
}

export const DEFAULT_SETTINGS: AutoGenerateSettings = {
  amount: 6,
  maxCopiesPerTile: 3,
  seed: 1,
  spineFirst: true,
  minScore: 55,
  scaleMin: 1,
  scaleMax: 1,
  allowTiltRotation: false,
};
