// Auto-fill for the cube/hex builder: picks a tile AND a quarter-turn for every
// face so that neighbouring faces actually meet sensibly -- where two faces
// share an edge, the solid/void pattern along that edge should agree -- while
// still giving a different set each time it runs (weighted random, not "best
// match"). Which faces touch, and along which edges, is worked out from the
// same face mapping the loft uses (volumeField's `coordinates`, inverted at
// depth 0), so cubes and hex prisms need no special cases.

import { faceMask, hexSidePose, HEX_APOTHEM, type SectionTrace, type VolumeFaceName, type VolumeShape } from "./volumeField";
import { rotateMask } from "./rotateTrace";

const MASK = 112;
const SAMPLES = 24;
const INSET = 2; // px in from the very edge, so antialiasing at the border doesn't decide it

type Vec3 = [number, number, number];

/** The 3D point (unit cube local space) at a face's (u, v) on its surface. */
function surfacePoint(face: VolumeFaceName, shape: VolumeShape, u: number, v: number): Vec3 {
  if (shape === "hex-prism" && face.startsWith("side")) {
    const { angle } = hexSidePose(Number(face.slice(4)) - 1);
    const tangent = u - 0.5;
    const wx = HEX_APOTHEM * Math.cos(angle) - tangent * Math.sin(angle);
    const wz = HEX_APOTHEM * Math.sin(angle) + tangent * Math.cos(angle);
    return [(wx + 1) / 2, 1 - v, (wz + 1) / 2];
  }
  switch (face) {
    case "front":
      return [u, 1 - v, 0];
    case "back":
      return [1 - u, 1 - v, 1];
    case "left":
      return [0, 1 - v, u];
    case "right":
      return [1, 1 - v, 1 - u];
    case "top":
      return [u, 1, v];
    default:
      return [u, 0, 1 - v]; // bottom
  }
}

const EDGES: { name: string; at: (t: number) => [number, number] }[] = [
  { name: "top", at: (t) => [t, 0] },
  { name: "bottom", at: (t) => [t, 1] },
  { name: "left", at: (t) => [0, t] },
  { name: "right", at: (t) => [1, t] },
];

const near = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-3;

export interface FaceLink {
  a: VolumeFaceName;
  b: VolumeFaceName;
  /** Edge sample positions (u, v) on each face, paired up so index i of `aEdge` meets index i of `bEdge`. */
  aEdge: [number, number][];
  bEdge: [number, number][];
}

/** Every pair of faces that share an edge, with matching sample points along it. */
export function faceLinks(faces: readonly VolumeFaceName[], shape: VolumeShape): FaceLink[] {
  const links: FaceLink[] = [];
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++)
      for (const ea of EDGES) {
        const a0 = surfacePoint(faces[i], shape, ...ea.at(0));
        const a1 = surfacePoint(faces[i], shape, ...ea.at(1));
        for (const eb of EDGES) {
          const b0 = surfacePoint(faces[j], shape, ...eb.at(0));
          const b1 = surfacePoint(faces[j], shape, ...eb.at(1));
          const same = near(a0, b0) && near(a1, b1);
          const reversed = near(a0, b1) && near(a1, b0);
          if (!same && !reversed) continue;
          const ts = Array.from({ length: SAMPLES }, (_, k) => (k + 0.5) / SAMPLES);
          links.push({ a: faces[i], b: faces[j], aEdge: ts.map((t) => ea.at(t)), bEdge: ts.map((t) => eb.at(reversed ? 1 - t : t)) });
        }
      }
  return links;
}

const maskCache = new Map<SectionTrace, Uint8Array>();
function maskOf(trace: SectionTrace): Uint8Array {
  let m = maskCache.get(trace);
  if (!m) {
    m = faceMask(trace, MASK);
    maskCache.set(trace, m);
  }
  return m;
}

function at(mask: Uint8Array, [u, v]: [number, number]): number {
  const clamp = (n: number) => Math.min(MASK - 1 - INSET, Math.max(INSET, Math.round(n * (MASK - 1))));
  return mask[clamp(v) * MASK + clamp(u)];
}

/** Share of edge samples where two masks agree (both solid or both void). */
function agreement(ma: Uint8Array, ea: [number, number][], mb: Uint8Array, eb: [number, number][]): number {
  let same = 0;
  for (let i = 0; i < ea.length; i++) if (at(ma, ea[i]) === at(mb, eb[i])) same++;
  return same / ea.length;
}

export interface FillTile {
  name: string;
  proposal: SectionTrace;
}

export interface FillFace {
  tile: string;
  turns: number;
}

/**
 * A fresh set of {tile, quarter-turns} for every face not in `locked`.
 * `current` holds whatever is on the faces now (locked faces keep it).
 * Faces are filled one at a time, each choosing among every tile x 4 turns by
 * how well it meets the neighbours already placed, with a penalty for reusing
 * a tile, then a weighted random pick -- sensible, but never the same twice.
 */
export function autoFill(
  faces: readonly VolumeFaceName[],
  shape: VolumeShape,
  pool: FillTile[],
  current: Partial<Record<VolumeFaceName, FillFace>>,
  locked: Partial<Record<VolumeFaceName, boolean>>,
  rng: () => number = Math.random,
): Partial<Record<VolumeFaceName, FillFace>> {
  const result: Partial<Record<VolumeFaceName, FillFace>> = {};
  for (const f of faces) if (locked[f] && current[f]) result[f] = current[f];
  if (!pool.length) return result;

  const links = faceLinks(faces, shape);
  const byName = new Map(pool.map((t) => [t.name, t]));
  const maskFor = (face: FillFace) => {
    const t = byName.get(face.tile);
    return t ? rotateMask(maskOf(t.proposal), MASK, face.turns) : null;
  };
  const turnedCache = new Map<string, Uint8Array>();
  const candidateMask = (tile: FillTile, turns: number) => {
    const key = `${tile.name}:${turns}`;
    let m = turnedCache.get(key);
    if (!m) {
      m = rotateMask(maskOf(tile.proposal), MASK, turns);
      turnedCache.set(key, m);
    }
    return m;
  };

  const remaining = faces.filter((f) => !result[f]);
  const used = new Map<string, number>();
  for (const f of faces) if (result[f]) used.set(result[f]!.tile, (used.get(result[f]!.tile) ?? 0) + 1);

  while (remaining.length) {
    // Next face: the one with the most already-placed neighbours (ties random),
    // so every choice after the first has something to match against.
    const neighbours = (f: VolumeFaceName) => links.filter((l) => (l.a === f && result[l.b]) || (l.b === f && result[l.a])).length;
    const best = Math.max(...remaining.map(neighbours));
    const front = remaining.filter((f) => neighbours(f) === best);
    const face = front[Math.floor(rng() * front.length)];
    remaining.splice(remaining.indexOf(face), 1);

    const myLinks = links.filter((l) => (l.a === face && result[l.b]) || (l.b === face && result[l.a]));
    const scored: { tile: FillTile; turns: number; weight: number }[] = [];
    for (const tile of pool) {
      for (let turns = 0; turns < 4; turns++) {
        const mask = candidateMask(tile, turns);
        let score = 0.5;
        if (myLinks.length) {
          score = 0;
          for (const l of myLinks) {
            const mine = l.a === face ? l.aEdge : l.bEdge;
            const theirs = l.a === face ? l.bEdge : l.aEdge;
            const other = result[l.a === face ? l.b : l.a]!;
            const om = maskFor(other);
            score += om ? agreement(mask, mine, om, theirs) : 0.5;
          }
          score /= myLinks.length;
        }
        score -= 0.12 * (used.get(tile.name) ?? 0);
        // Sharper than linear so good matches dominate, but every decent one has a chance.
        scored.push({ tile, turns, weight: Math.exp(score * 9) * (0.6 + rng() * 0.8) });
      }
    }
    const total = scored.reduce((s, c) => s + c.weight, 0);
    let r = rng() * total;
    let pick = scored[scored.length - 1];
    for (const c of scored) {
      r -= c.weight;
      if (r <= 0) {
        pick = c;
        break;
      }
    }
    result[face] = { tile: pick.tile.name, turns: pick.turns };
    used.set(pick.tile.name, (used.get(pick.tile.name) ?? 0) + 1);
  }
  return result;
}
