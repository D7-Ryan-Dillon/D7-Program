import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";
import { applyTransform, faceLayer, FACE_DELTA, isFaceOpen, OPPOSITE_FACE, type Grid3, type Tilt } from "@/lib/arrange/transforms";
import { computeBranches, type FaceBranch } from "@/lib/arrange/branches";
import { jointScore } from "@/lib/arrange/joints";
import { mulberry32, shuffled } from "@/lib/arrange/rng";
import type { Assembly, AutoGenerateSettings, Joint, PlacedInstance } from "@/lib/arrange/types";

const MIRROR_OPTIONS = ["", "x", "y", "xy"];
const ROT_OPTIONS = [0, 1, 2, 3];
const TILT_OPTIONS: (Tilt | undefined)[] = [undefined, { axis: "x", steps: 1 }, { axis: "x", steps: 2 }, { axis: "x", steps: 3 }, { axis: "y", steps: 1 }, { axis: "y", steps: 3 }];
const AXIS_OF: Record<FaceName, 0 | 1 | 2> = { "+X": 0, "-X": 0, "+Y": 1, "-Y": 1, "+Z": 2, "-Z": 2 };
// How much to relax minScore, and how many extra fresh roots to try, when
// the strict pass falls short of `amount` -- bounded so a demanding bank
// can't make this run away, while still giving the amount slider a real
// chance to be honoured (see growAssembly's caller loop).
const RELAXATION_STEPS = [0.75, 0.5];

interface FrontierSlot {
  instanceId: string;
  face: FaceName;
  branch: FaceBranch;
}

/** Tracks one dominant chain while `spineFirst` is on: growth keeps
 * extending the current tip's own biggest remaining opening until the
 * chain reaches its target length, then falls through to the normal
 * area-weighted pick across the whole frontier for the rest of the run --
 * a legible backbone-then-branches read instead of an undifferentiated
 * cluster, without ever forcing a placement that doesn't actually fit. */
interface SpineState {
  tipInstanceId: string | null;
  length: number;
  targetLength: number;
}

// Roughly 40% of the requested piece count reads as a real backbone without
// leaving too little of the run for it to branch off of -- bounded so a
// tiny `amount` doesn't force a spine and a huge one doesn't spine out
// dozens of pieces before ever branching.
const SPINE_FRACTION = 0.4;
const SPINE_MIN_LENGTH = 3;
const SPINE_MAX_LENGTH = 10;

function spineTargetLength(amount: number): number {
  return Math.min(SPINE_MAX_LENGTH, Math.max(SPINE_MIN_LENGTH, Math.round(amount * SPINE_FRACTION)));
}

function weightedPickIndex<T>(rng: () => number, items: T[], weightOf: (item: T) => number): number {
  const total = items.reduce((sum, item) => sum + Math.max(weightOf(item), 1e-6), 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(weightOf(items[i]), 1e-6);
    if (r <= 0) return i;
  }
  return items.length - 1;
}

/** Weighted-random pick among the top `topK` of `items` by `scoreOf` -- a
 * seeded nudge toward the best-fitting options without always taking the
 * single best, which would make every generation with the same bank read
 * as one rigid shape rather than a family of plausible ones. */
function weightedPickTop<T>(rng: () => number, items: T[], scoreOf: (item: T) => number, topK: number): T {
  const sorted = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
  const pool = sorted.slice(0, Math.min(topK, sorted.length));
  const total = pool.reduce((sum, item) => sum + Math.max(scoreOf(item), 1e-6), 0);
  let r = rng() * total;
  for (const item of pool) {
    r -= Math.max(scoreOf(item), 1e-6);
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

/** Picks which frontier slot to fill next: the active spine's own biggest
 * remaining socket while a spine is extending, otherwise an area-weighted
 * random pick across the whole frontier -- bigger, more architecturally
 * significant openings tend to grow first either way, just with an extra
 * single-chain bias on top while spineFirst is on. A failed placement at
 * the chosen slot just falls through to the next-biggest one on the next
 * call; this only decides which slot gets *tried*, never whether a
 * candidate for it exists. */
function pickFrontierIndex(frontier: FrontierSlot[], rng: () => number, spine: SpineState | null): number {
  if (spine?.tipInstanceId) {
    let bestIndex = -1;
    let bestArea = -Infinity;
    for (let i = 0; i < frontier.length; i++) {
      if (frontier[i].instanceId === spine.tipInstanceId && frontier[i].branch.areaCells > bestArea) {
        bestArea = frontier[i].branch.areaCells;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) return bestIndex;
    spine.tipInstanceId = null; // the tip has no sockets left -- the spine ends here
  }
  return weightedPickIndex(rng, frontier, (s) => s.branch.areaCells);
}

const posKey = (p: [number, number, number]) => p.join(",");

function scaleFor(settings: AutoGenerateSettings, rng: () => number): number {
  const { scaleMin, scaleMax } = settings;
  if (scaleMax <= scaleMin) return scaleMin;
  return scaleMin + rng() * (scaleMax - scaleMin);
}

function tiltOptionsFor(settings: AutoGenerateSettings): (Tilt | undefined)[] {
  return settings.allowTiltRotation ? TILT_OPTIONS : [undefined];
}

/** World placement for a new instance attached to `parent` on `face`,
 * aligning the new instance's own biggest branch on its touching face with
 * the parent branch being grown from -- so the two openings' centres line
 * up, not just the tiles' bounding boxes. Purely analytical (from already-
 * computed branch centroids + each tile's cellFt), no geometry loading. */
function computeChildPosFt(
  parent: PlacedInstance,
  parentTileFt: [number, number, number],
  parentCellFt: number,
  childTileFt: [number, number, number],
  childCellFt: number,
  childScale: number,
  face: FaceName,
  parentBranch: FaceBranch,
  childBranch: FaceBranch | null,
): [number, number, number] {
  const axis = AXIS_OF[face];
  const sign = face.startsWith("+") ? 1 : -1;
  const out: [number, number, number] = [...parent.posFt];
  out[axis] = parent.posFt[axis] + sign * ((parentTileFt[axis] * parent.scale) / 2 + (childTileFt[axis] * childScale) / 2);

  for (const lateral of [0, 1, 2] as const) {
    if (lateral === axis) continue;
    const parentLocalFt = (parentBranch.centroidCell[lateral] + 0.5) * parentCellFt - parentTileFt[lateral] / 2;
    const childLocalFt = childBranch ? (childBranch.centroidCell[lateral] + 0.5) * childCellFt - childTileFt[lateral] / 2 : 0;
    out[lateral] = parent.posFt[lateral] + parentLocalFt * parent.scale - childLocalFt * childScale;
  }
  return out;
}

interface GrowContext {
  bankTiles: ParsedTile[];
  settings: AutoGenerateSettings;
  grid: Grid3;
  tileById: Map<string, ParsedTile>;
  copiesUsed: Map<string, number>;
  occupied: Set<string>;
  transformed: Map<string, Uint8Array>;
  rng: () => number;
}

/** Offers one frontier slot per real branch on each of `inst`'s open faces,
 * except faces in `excludeFaces` -- used both for a freshly-placed instance
 * (excluding only the face it just attached through) and for rebuilding
 * frontier on a resumed/kept instance (excluding every face that already
 * has a surviving child, so regrowth can't duplicate an existing neighbour;
 * see growAssembly's regenerate path). */
function addFrontier(ctx: GrowContext, inst: PlacedInstance, frontier: FrontierSlot[], excludeFaces?: ReadonlySet<FaceName> | FaceName) {
  const g = ctx.transformed.get(inst.id);
  const tile = ctx.tileById.get(inst.tileId);
  if (!g || !tile) return;
  const excluded = typeof excludeFaces === "string" ? new Set([excludeFaces]) : excludeFaces;
  for (const face of FACE_NAMES) {
    if (excluded?.has(face)) continue;
    const layer = faceLayer(g, ctx.grid, face);
    if (!isFaceOpen(layer, tile.cellFt)) continue;
    for (const branch of computeBranches(layer, face, ctx.grid)) {
      frontier.push({ instanceId: inst.id, face, branch });
    }
  }
}

// How many of the best-fitting candidates at a socket to weight-pick among,
// instead of always taking the single best -- so a generation reads as one
// plausible member of a family of arrangements, not one rigid shape that's
// identical for a given bank+seed except for growth order.
const CANDIDATE_POOL = 3;

function growOnce(
  instances: PlacedInstance[],
  joints: Joint[],
  ctx: GrowContext,
  frontier: FrontierSlot[],
  targetAmount: number,
  minScore: number,
  idCounterStart: number,
  spine: SpineState | null,
): { instances: PlacedInstance[]; joints: Joint[]; idCounter: number } {
  const outInstances = instances.slice();
  const outJoints = joints.slice();
  const byId = new Map(outInstances.map((i) => [i.id, i]));
  let idCounter = idCounterStart;
  const { rng, settings, bankTiles, tileById, grid } = ctx;
  const canUse = (tileId: string) => (ctx.copiesUsed.get(tileId) ?? 0) < settings.maxCopiesPerTile;

  while (outInstances.length < targetAmount && frontier.length > 0) {
    const slotIndex = pickFrontierIndex(frontier, rng, spine);
    const slot = frontier[slotIndex];
    frontier.splice(slotIndex, 1);

    const parent = byId.get(slot.instanceId);
    const parentTile = parent && tileById.get(parent.tileId);
    const parentG = parent && ctx.transformed.get(parent.id);
    if (!parent || !parentTile || !parentG) continue;

    const parentFaceLayer = faceLayer(parentG, grid, slot.face);
    const neighborFace = OPPOSITE_FACE[slot.face];
    const neighborGridPos: [number, number, number] = [
      parent.gridPos[0] + FACE_DELTA[slot.face][0],
      parent.gridPos[1] + FACE_DELTA[slot.face][1],
      parent.gridPos[2] + FACE_DELTA[slot.face][2],
    ];
    const occKey = `${posKey(neighborGridPos)}|${slot.face}|${Math.round(slot.branch.centroidCell[0])},${Math.round(slot.branch.centroidCell[1])},${Math.round(slot.branch.centroidCell[2])}`;
    if (ctx.occupied.has(occKey)) continue;

    const evaluated: { tileId: string; mirror: string; rotZ: number; tilt?: Tilt; score: number; g: Uint8Array; childBranch: FaceBranch | null }[] = [];
    for (const candidate of shuffled(rng, bankTiles.filter((t) => canUse(t.id)))) {
      if (!candidate.voxels.void) continue;
      for (const mirror of MIRROR_OPTIONS) {
        for (const tilt of tiltOptionsFor(settings)) {
          for (const rotZ of ROT_OPTIONS) {
            const g = applyTransform(candidate.voxels.void, grid, mirror, rotZ, tilt);
            const candidateFace = faceLayer(g, grid, neighborFace);
            const score = jointScore(parentFaceLayer, candidateFace);
            if (score === null || score < minScore) continue;
            const childBranch = computeBranches(candidateFace, neighborFace, grid)[0] ?? null;
            evaluated.push({ tileId: candidate.id, mirror, rotZ, tilt, score, g, childBranch });
          }
        }
      }
    }
    if (!evaluated.length) continue; // nothing lined up well enough -- leave this socket unfilled rather than force a bad join

    const best = weightedPickTop(rng, evaluated, (c) => c.score, CANDIDATE_POOL);

    const candidateTile = tileById.get(best.tileId)!;
    const childScale = scaleFor(settings, rng);
    const posFt = computeChildPosFt(parent, parentTile.tileFt, parentTile.cellFt, candidateTile.tileFt, candidateTile.cellFt, childScale, slot.face, slot.branch, best.childBranch);

    const newId = `inst_${idCounter++}`;
    const jointId = `joint_${newId}`;
    const newInst: PlacedInstance = {
      id: newId,
      tileId: best.tileId,
      gridPos: neighborGridPos,
      posFt,
      scale: childScale,
      mirror: best.mirror,
      rotZ: best.rotZ,
      tilt: best.tilt,
      parentJointId: jointId,
    };
    outInstances.push(newInst);
    byId.set(newId, newInst);
    ctx.copiesUsed.set(best.tileId, (ctx.copiesUsed.get(best.tileId) ?? 0) + 1);
    ctx.occupied.add(occKey);
    ctx.transformed.set(newId, best.g);
    outJoints.push({ id: jointId, aId: parent.id, bId: newId, face: slot.face, score: best.score, rating: null });
    addFrontier(ctx, newInst, frontier, neighborFace);

    // The spine only advances on an actual placement -- a failed attempt at
    // the tip's biggest socket just falls through to its next-biggest one
    // on the next pickFrontierIndex call, no bookkeeping needed here for that.
    if (spine?.tipInstanceId === parent.id) {
      spine.length++;
      spine.tipInstanceId = spine.length >= spine.targetLength ? null : newInst.id;
    }
  }

  return { instances: outInstances, joints: outJoints, idCounter };
}

function buildContext(bankTiles: ParsedTile[], settings: AutoGenerateSettings, seed: number, instances: PlacedInstance[]): GrowContext {
  const grid: Grid3 = bankTiles[0].grid;
  const tileById = new Map(bankTiles.map((t) => [t.id, t]));
  const copiesUsed = new Map<string, number>();
  for (const inst of instances) copiesUsed.set(inst.tileId, (copiesUsed.get(inst.tileId) ?? 0) + 1);
  const occupied = new Set<string>();
  const transformed = new Map<string, Uint8Array>();
  for (const inst of instances) {
    const tile = tileById.get(inst.tileId);
    if (tile?.voxels.void) transformed.set(inst.id, applyTransform(tile.voxels.void, grid, inst.mirror, inst.rotZ, inst.tilt));
  }
  return { bankTiles, settings, grid, tileById, copiesUsed, occupied, transformed, rng: mulberry32(seed) };
}

/** Grows (or re-grows) an assembly, relaxing minScore in bounded steps if
 * the strict pass falls short of `amount`. Every placement attaches to a
 * real open socket on something already placed -- if the frontier runs dry
 * (nothing left fits well enough anywhere), growth simply stops short of
 * `amount` rather than forcing a piece in. A composition with a handful
 * fewer pieces than asked for is a much better result than one padded out
 * with stray pieces floating disconnected from everything else. */
function growAssembly(bankTiles: ParsedTile[], settings: AutoGenerateSettings, seed: number, seedInstances: PlacedInstance[], seedJoints: Joint[]): Assembly {
  const ctx = buildContext(bankTiles, settings, seed, seedInstances);
  let instances = seedInstances;
  let joints = seedJoints;
  let idCounter = 1 + Math.max(0, ...seedInstances.map((i) => Number(i.id.replace("inst_", "")) || 0));

  // A resumed assembly (regenerate) may already have surviving children on
  // some of its kept instances' faces -- those faces must not be re-offered
  // (see addFrontier's doc comment), unlike a truly fresh instance, which
  // has none yet.
  const usedFaces = new Map<string, Set<FaceName>>();
  for (const j of seedJoints) {
    const set = usedFaces.get(j.aId) ?? new Set<FaceName>();
    set.add(j.face);
    usedFaces.set(j.aId, set);
  }
  const frontier: FrontierSlot[] = [];
  for (const inst of instances) addFrontier(ctx, inst, frontier, usedFaces.get(inst.id));

  // Seeded from whichever open socket is currently biggest -- the seed
  // instance's own biggest socket on a fresh autoGenerate() call, or a
  // just-freed socket's parent on a regenerate -- so both cases pick up
  // the same "start from the most significant opening" rule.
  const spine: SpineState | null = settings.spineFirst
    ? {
        tipInstanceId: frontier.length > 0 ? frontier.reduce((best, s) => (s.branch.areaCells > best.branch.areaCells ? s : best), frontier[0]).instanceId : null,
        length: 0,
        targetLength: spineTargetLength(settings.amount),
      }
    : null;

  const thresholds = [settings.minScore, ...RELAXATION_STEPS.map((f) => settings.minScore * f)];

  for (const minScore of thresholds) {
    const grown = growOnce(instances, joints, ctx, frontier, settings.amount, minScore, idCounter, spine);
    instances = grown.instances;
    joints = grown.joints;
    idCounter = grown.idCounter;
    if (instances.length >= settings.amount || frontier.length === 0) break;
  }

  return { instances, joints };
}

export function autoGenerate(bankTiles: ParsedTile[], settings: AutoGenerateSettings): Assembly {
  if (!bankTiles.length || settings.amount <= 0) return { instances: [], joints: [] };
  const rng = mulberry32(settings.seed);
  const rootTile = bankTiles[Math.floor(rng() * bankTiles.length)];
  if (!rootTile.voxels.void) return { instances: [], joints: [] };
  const root: PlacedInstance = {
    id: "inst_0",
    tileId: rootTile.id,
    gridPos: [0, 0, 0],
    posFt: [0, 0, 0],
    scale: scaleFor(settings, rng),
    mirror: "",
    rotZ: 0,
  };
  return growAssembly(bankTiles, settings, settings.seed + 1, [root], []);
}

/** Removes the branch that grew from each bad joint (and everything downstream of it), then regrows only those frontier slots. */
export function regenerateMarked(assembly: Assembly, bankTiles: ParsedTile[], badJointIds: Set<string>, settings: AutoGenerateSettings, nonce: number): Assembly {
  const childOfJoint = new Map(assembly.joints.map((j) => [j.id, j.bId]));
  const toRemove = new Set<string>();
  const stack = [...badJointIds].map((jid) => childOfJoint.get(jid)).filter((x): x is string => !!x);
  while (stack.length) {
    const id = stack.pop()!;
    if (toRemove.has(id)) continue;
    toRemove.add(id);
    for (const j of assembly.joints) if (j.aId === id) stack.push(j.bId);
  }

  const keptInstances = assembly.instances.filter((i) => !toRemove.has(i.id));
  const keptJoints = assembly.joints.filter((j) => !toRemove.has(j.bId) && !badJointIds.has(j.id));

  return growAssembly(bankTiles, settings, settings.seed + 1000 + nonce, keptInstances, keptJoints);
}
