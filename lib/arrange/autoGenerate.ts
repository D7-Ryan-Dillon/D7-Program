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
const MAX_EXTRA_ROOTS = 8;

interface FrontierSlot {
  instanceId: string;
  face: FaceName;
  branch: FaceBranch;
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

function growOnce(
  instances: PlacedInstance[],
  joints: Joint[],
  ctx: GrowContext,
  frontier: FrontierSlot[],
  targetAmount: number,
  minScore: number,
  idCounterStart: number,
): { instances: PlacedInstance[]; joints: Joint[]; idCounter: number } {
  const outInstances = instances.slice();
  const outJoints = joints.slice();
  const byId = new Map(outInstances.map((i) => [i.id, i]));
  let idCounter = idCounterStart;
  const { rng, settings, bankTiles, tileById, grid } = ctx;
  const canUse = (tileId: string) => (ctx.copiesUsed.get(tileId) ?? 0) < settings.maxCopiesPerTile;

  while (outInstances.length < targetAmount && frontier.length > 0) {
    const slotIndex = settings.spineFirst ? frontier.length - 1 : Math.floor(rng() * frontier.length);
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

    let best: { tileId: string; mirror: string; rotZ: number; tilt?: Tilt; score: number; g: Uint8Array; childBranch: FaceBranch | null } | null = null;
    for (const candidate of shuffled(rng, bankTiles.filter((t) => canUse(t.id)))) {
      if (!candidate.voxels.void) continue;
      for (const mirror of MIRROR_OPTIONS) {
        for (const tilt of tiltOptionsFor(settings)) {
          for (const rotZ of ROT_OPTIONS) {
            const g = applyTransform(candidate.voxels.void, grid, mirror, rotZ, tilt);
            const candidateFace = faceLayer(g, grid, neighborFace);
            const score = jointScore(parentFaceLayer, candidateFace);
            if (score === null || score < minScore) continue;
            if (!best || score > best.score) {
              const childBranch = computeBranches(candidateFace, neighborFace, grid)[0] ?? null;
              best = { tileId: candidate.id, mirror, rotZ, tilt, score, g, childBranch };
            }
          }
        }
      }
    }
    if (!best) continue; // refuse a weak match rather than forcing it

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

/** Grows (or re-grows) an assembly, relaxing minScore in bounded steps and
 * planting fresh, non-colliding roots if the frontier runs dry, so the
 * `amount` the user asked for is actually honoured whenever the bank has
 * enough eligible tiles/copies to reach it -- rather than silently stopping
 * the moment the strict frontier dries up. */
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

  const thresholds = [settings.minScore, ...RELAXATION_STEPS.map((f) => settings.minScore * f)];
  let extraRoots = 0;
  let bankExhausted = false;

  for (const minScore of thresholds) {
    if (bankExhausted) break; // every eligible tile is already at maxCopiesPerTile -- a looser score can't place more
    // growOnce's own while-loop only ever stops short of `amount` because
    // its frontier ran dry (every slot either got filled or, failing to
    // find any candidate at `minScore`, was discarded) -- so whenever we
    // land here still short, planting a fresh root is always the right
    // next move, not just sometimes.
    while (instances.length < settings.amount) {
      const grown = growOnce(instances, joints, ctx, frontier, settings.amount, minScore, idCounter);
      instances = grown.instances;
      joints = grown.joints;
      idCounter = grown.idCounter;
      if (instances.length >= settings.amount) return { instances, joints };

      if (extraRoots >= MAX_EXTRA_ROOTS) break;
      const eligible = bankTiles.filter((t) => (ctx.copiesUsed.get(t.id) ?? 0) < settings.maxCopiesPerTile && t.voxels.void);
      if (!eligible.length) {
        bankExhausted = true;
        break;
      }
      extraRoots++;
      const rootTile = eligible[Math.floor(ctx.rng() * eligible.length)];
      const root: PlacedInstance = {
        id: `inst_${idCounter++}`,
        tileId: rootTile.id,
        gridPos: [extraRoots * 6, 0, 0], // spaced well clear of the grid-unit collision radius other roots use
        posFt: [extraRoots * rootTile.tileFt[0] * 6, 0, 0],
        scale: scaleFor(settings, ctx.rng),
        mirror: "",
        rotZ: 0,
      };
      instances = [...instances, root];
      ctx.copiesUsed.set(rootTile.id, (ctx.copiesUsed.get(rootTile.id) ?? 0) + 1);
      ctx.transformed.set(root.id, applyTransform(rootTile.voxels.void!, ctx.grid, "", 0));
      addFrontier(ctx, root, frontier);
    }
    if (extraRoots >= MAX_EXTRA_ROOTS) break; // no point relaxing further once the bank itself is the limit
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
