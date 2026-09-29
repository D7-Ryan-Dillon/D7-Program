import { FACE_NAMES, type FaceName, type ParsedTile } from "@/lib/types";
import { applyTransform, faceLayer, FACE_DELTA, isFaceOpen, OPPOSITE_FACE, type Grid3 } from "@/lib/arrange/transforms";
import { jointScore } from "@/lib/arrange/joints";
import { mulberry32, shuffled } from "@/lib/arrange/rng";
import type { Assembly, AutoGenerateSettings, Joint, PlacedInstance } from "@/lib/arrange/types";

const MIRROR_OPTIONS = ["", "x", "y", "xy"];
const ROT_OPTIONS = [0, 1, 2, 3];

interface FrontierSlot {
  instanceId: string;
  face: FaceName;
}

const posKey = (p: [number, number, number]) => p.join(",");

/**
 * Grows an assembly onward from whatever instances/joints it already has.
 * Fresh generation calls this with one random root; "regenerate marked"
 * calls it with everything kept after pruning the bad branches -- either
 * way only the open frontier is touched, nothing already placed moves.
 */
function growFrom(
  instances: PlacedInstance[],
  joints: Joint[],
  bankTiles: ParsedTile[],
  settings: AutoGenerateSettings,
  rngSeed: number,
  idCounterStart: number,
): Assembly {
  if (!bankTiles.length || !instances.length) return { instances, joints };
  const grid: Grid3 = bankTiles[0].grid;
  const cellFt = bankTiles[0].cellFt;
  const tileById = new Map(bankTiles.map((t) => [t.id, t]));
  const rng = mulberry32(rngSeed);

  const copiesUsed = new Map<string, number>();
  for (const inst of instances) copiesUsed.set(inst.tileId, (copiesUsed.get(inst.tileId) ?? 0) + 1);
  const canUse = (tileId: string) => (copiesUsed.get(tileId) ?? 0) < settings.maxCopiesPerTile;

  const occupied = new Set(instances.map((i) => posKey(i.pos)));
  const transformed = new Map<string, Uint8Array>();
  for (const inst of instances) {
    const tile = tileById.get(inst.tileId);
    if (tile?.voxels.void) transformed.set(inst.id, applyTransform(tile.voxels.void, grid, inst.mirror, inst.rot));
  }

  const frontier: FrontierSlot[] = [];
  const addFrontier = (inst: PlacedInstance) => {
    const g = transformed.get(inst.id);
    if (!g) return;
    for (const face of FACE_NAMES) {
      const layer = faceLayer(g, grid, face);
      if (!isFaceOpen(layer, cellFt)) continue;
      const delta = FACE_DELTA[face];
      const neighborPos: [number, number, number] = [inst.pos[0] + delta[0], inst.pos[1] + delta[1], inst.pos[2] + delta[2]];
      if (!occupied.has(posKey(neighborPos))) frontier.push({ instanceId: inst.id, face });
    }
  };
  for (const inst of instances) addFrontier(inst);

  const outInstances = instances.slice();
  const outJoints = joints.slice();
  let idCounter = idCounterStart;

  while (outInstances.length < settings.amount && frontier.length > 0) {
    const slotIndex = settings.spineFirst ? frontier.length - 1 : Math.floor(rng() * frontier.length);
    const slot = frontier[slotIndex];
    frontier.splice(slotIndex, 1);

    const parent = outInstances.find((i) => i.id === slot.instanceId);
    const parentG = parent && transformed.get(parent.id);
    if (!parent || !parentG) continue;

    const delta = FACE_DELTA[slot.face];
    const neighborPos: [number, number, number] = [parent.pos[0] + delta[0], parent.pos[1] + delta[1], parent.pos[2] + delta[2]];
    if (occupied.has(posKey(neighborPos))) continue;

    const parentFace = faceLayer(parentG, grid, slot.face);
    const neighborFace = OPPOSITE_FACE[slot.face];

    let best: { tileId: string; mirror: string; rot: number; score: number; g: Uint8Array } | null = null;
    for (const candidate of shuffled(rng, bankTiles.filter((t) => canUse(t.id)))) {
      if (!candidate.voxels.void) continue;
      for (const mirror of MIRROR_OPTIONS) {
        for (const rot of ROT_OPTIONS) {
          const g = applyTransform(candidate.voxels.void, grid, mirror, rot);
          const score = jointScore(parentFace, faceLayer(g, grid, neighborFace));
          if (score !== null && score >= settings.minScore && (!best || score > best.score)) {
            best = { tileId: candidate.id, mirror, rot, score, g };
          }
        }
      }
    }
    if (!best) continue; // refuse a weak match rather than forcing it

    const newId = `inst_${idCounter++}`;
    const jointId = `joint_${newId}`;
    const newInst: PlacedInstance = { id: newId, tileId: best.tileId, pos: neighborPos, mirror: best.mirror, rot: best.rot, parentJointId: jointId };
    outInstances.push(newInst);
    copiesUsed.set(best.tileId, (copiesUsed.get(best.tileId) ?? 0) + 1);
    occupied.add(posKey(neighborPos));
    transformed.set(newId, best.g);
    outJoints.push({ id: jointId, aId: parent.id, bId: newId, face: slot.face, score: best.score, rating: null });
    addFrontier(newInst);
  }

  return { instances: outInstances, joints: outJoints };
}

export function autoGenerate(bankTiles: ParsedTile[], settings: AutoGenerateSettings): Assembly {
  if (!bankTiles.length) return { instances: [], joints: [] };
  const rng = mulberry32(settings.seed);
  const rootTile = bankTiles[Math.floor(rng() * bankTiles.length)];
  const root: PlacedInstance = { id: "inst_0", tileId: rootTile.id, pos: [0, 0, 0], mirror: "", rot: 0 };
  return growFrom([root], [], bankTiles, settings, settings.seed + 1, 1);
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
  const nextIdNum = 1 + Math.max(0, ...assembly.instances.map((i) => Number(i.id.replace("inst_", "")) || 0));

  return growFrom(keptInstances, keptJoints, bankTiles, settings, settings.seed + 1000 + nonce, nextIdNum);
}
