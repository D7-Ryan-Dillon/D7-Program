import type { FaceName } from "@/lib/types";

export interface PlacedInstance {
  id: string;
  tileId: string;
  /** Position in whole tile units (1 = one tile-width along that axis), per HANDOFF section 5. */
  pos: [number, number, number];
  /** Letters x/y/z, applied before rotation. */
  mirror: string;
  /** Quarter turns about the vertical (Z) axis, 0-3. */
  rot: number;
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
}

export const DEFAULT_SETTINGS: AutoGenerateSettings = {
  amount: 6,
  maxCopiesPerTile: 3,
  seed: 1,
  spineFirst: true,
  minScore: 55,
};
