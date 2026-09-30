import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";
import type { PlacedInstance } from "@/lib/arrange/types";

const AXIS_OF: Record<FaceName, 0 | 1 | 2> = { "+X": 0, "-X": 0, "+Y": 1, "-Y": 1, "+Z": 2, "-Z": 2 };

/** Repositions `target` flush against whichever face of its nearest
 * neighbour it's actually closest to, keeping its own rotation/mirror/scale
 * -- a quick clean-up for after a manual drag, not a re-run of the full
 * branch-matching auto-generate pass. */
export function snapToNearest(
  target: PlacedInstance,
  targetTile: ParsedTile,
  others: { instance: PlacedInstance; tile: ParsedTile }[],
): [number, number, number] | null {
  if (!others.length) return null;

  let nearest = others[0];
  let bestDist = Infinity;
  for (const o of others) {
    const dx = target.posFt[0] - o.instance.posFt[0];
    const dy = target.posFt[1] - o.instance.posFt[1];
    const dz = target.posFt[2] - o.instance.posFt[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < bestDist) {
      bestDist = d;
      nearest = o;
    }
  }

  // Which face of `nearest` the target currently sits closest to: the face
  // whose flush-contact centre along that axis is nearest the target's
  // actual current position on that axis.
  let bestFace: FaceName = "+X";
  let bestScore = Infinity;
  for (const face of FACE_NAMES) {
    const axis = AXIS_OF[face];
    const sign = face.startsWith("+") ? 1 : -1;
    const halfSum = (nearest.tile.tileFt[axis] * nearest.instance.scale) / 2 + (targetTile.tileFt[axis] * target.scale) / 2;
    const idealCenter = nearest.instance.posFt[axis] + sign * halfSum;
    const distance = Math.abs(target.posFt[axis] - idealCenter);
    if (distance < bestScore) {
      bestScore = distance;
      bestFace = face;
    }
  }

  const axis = AXIS_OF[bestFace];
  const sign = bestFace.startsWith("+") ? 1 : -1;
  const out: [number, number, number] = [...target.posFt];
  out[axis] = nearest.instance.posFt[axis] + sign * ((nearest.tile.tileFt[axis] * nearest.instance.scale) / 2 + (targetTile.tileFt[axis] * target.scale) / 2);
  for (const lateral of [0, 1, 2] as const) {
    if (lateral === axis) continue;
    out[lateral] = nearest.instance.posFt[lateral];
  }
  return out;
}
