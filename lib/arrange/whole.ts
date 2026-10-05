// The arrangement read as one building: the sequence of spaces from the entrance, the names of those spaces, the numbers
// of the whole (levels, routes, daylight, structure, print checks, descriptors) and the evidence behind each.

import type { ParsedTile } from "@/lib/types";
import { scoreTile, type DescriptorResult } from "@/lib/scoring/descriptors";
import { printChecks, type Check } from "@/lib/tiles/checks";
import { toFt } from "./geometry";
import type { Layout } from "./layout";
import { categoryOf } from "./orient";
import { CATEGORY_LABEL, type ArrangementDoc, type Joint, type ProgramRules, type Vec3 } from "./types";
import type { SmoothReport } from "./smooth";

// ---- the sequence --------------------------------------------------------------------------------------------------

export interface SequenceStep {
  pieceId: string;
  /** the joint to the previous step (none for the entrance) */
  joint: Joint | null;
}

export interface Sequence {
  steps: SequenceStep[];
  /** reachable pieces not on the main chain */
  branches: string[];
  /** hops from the entrance, per piece */
  depth: Map<string, number>;
  /** 0-100: how well the main chain reads as a sequence */
  quality: number;
}

const voidCells = (layout: Layout, id: string) => {
  const o = layout.byId.get(id)!.o;
  let n = 0;
  for (let i = 0; i < o.void.length; i++) n += o.void[i];
  return n;
};

export function buildSequence(layout: Layout, rules: ProgramRules): Sequence {
  const empty: Sequence = { steps: [], branches: [], depth: new Map(), quality: 0 };
  const start = layout.entranceId;
  if (!start || !layout.byId.has(start)) return empty;
  const depth = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, { id: string; joint: Joint }>();
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const n of layout.walk.get(id) ?? []) {
      if (depth.has(n.id)) continue;
      depth.set(n.id, depth.get(id)! + 1);
      parent.set(n.id, { id, joint: n.joint });
      queue.push(n.id);
    }
  }
  // the main chain ends at the farthest piece (ties: the one with the most space)
  let far = start;
  for (const id of depth.keys()) {
    const d = depth.get(id)!;
    const fd = depth.get(far)!;
    if (d > fd || (d === fd && voidCells(layout, id) > voidCells(layout, far))) far = id;
  }
  const chain: SequenceStep[] = [];
  for (let id: string | undefined = far; id; id = parent.get(id)?.id) chain.unshift({ pieceId: id, joint: parent.get(id)?.joint ?? null });
  const onChain = new Set(chain.map((s) => s.pieceId));
  const branches = [...depth.keys()].filter((id) => !onChain.has(id));

  // quality: length of the chain against the pieces reached, categories in the wanted order, the space varying (compress, release), no stray dead ends
  const total = depth.size;
  const lengthScore = total > 1 ? Math.min(1, chain.length / Math.max(2, total * 0.6)) : 0;
  const order = rules.sequenceOrder;
  let orderOk = 0;
  let orderN = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = order.indexOf(categoryOf(layout.byId.get(chain[i - 1].pieceId)!.tile) as never);
    const b = order.indexOf(categoryOf(layout.byId.get(chain[i].pieceId)!.tile) as never);
    if (a < 0 || b < 0) continue;
    orderN++;
    if (b >= a) orderOk++;
  }
  const orderScore = orderN ? orderOk / orderN : 0.7;
  const sizes = chain.map((s) => voidCells(layout, s.pieceId));
  const med = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)] || 1;
  let flips = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > med !== sizes[i - 1] > med) flips++;
  const variation = sizes.length > 2 ? Math.min(1, flips / (sizes.length - 1)) : 0.5;
  let strays = 0;
  for (const id of depth.keys()) if (id !== start && id !== far && (layout.walk.get(id)?.length ?? 0) === 1) strays++;
  const strayScore = total > 2 ? 1 - Math.min(1, strays / Math.max(1, total - 2)) : 1;
  const quality = Math.round(100 * (0.35 * lengthScore + 0.25 * orderScore + 0.2 * variation + 0.2 * strayScore));
  return { steps: chain, branches, depth, quality };
}

// ---- names ---------------------------------------------------------------------------------------------------------

const KIND_WORD: Record<string, string> = { shaft: "void", gallery: "gallery", terrace: "terrace", hall: "hall", cave: "grotto", "low room": "low room", room: "room" };

const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** A name for each piece's space: the tile's typology (or its category and main room kind), numbered when repeated, the entrance first. */
export function autoNames(layout: Layout, seq: Sequence, tileById: Map<string, ParsedTile>): Record<string, string> {
  const order = [...seq.steps.map((s) => s.pieceId), ...layout.boxes.map((b) => b.piece.id).filter((id) => !seq.steps.some((s) => s.pieceId === id))];
  const used = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const id of order) {
    const b = layout.byId.get(id);
    const tile = b && tileById.get(b.piece.tileId);
    if (!b || !tile) continue;
    const cat = categoryOf(tile);
    let base: string;
    if (tile.meta?.typology) base = titleCase(tile.meta.typology);
    else {
      const main = [...(tile.spaces?.rooms ?? [])].sort((a, c) => c.volume_ft3 - a.volume_ft3)[0];
      base = `${CATEGORY_LABEL[cat]}${main ? ` ${KIND_WORD[main.kind] ?? "room"}` : ""}`;
    }
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out[id] = (id === layout.entranceId ? "Entry: " : "") + (n === 1 ? base : `${base} ${n}`);
  }
  return out;
}

// ---- the numbers ---------------------------------------------------------------------------------------------------

export interface WholeSummary {
  pieces: number;
  attachedAll: boolean;
  walkableAll: boolean;
  islands: number;
  unreachable: number;
  levels: number;
  levelHeights: number[];
  rooms: number;
  roomComponents: number;
  deadEnds: number;
  loops: number;
  mainRouteFt: number | null;
  litFloor: number;
  skyFloor: number;
  voidShare: number;
  heightFt: number;
  footprintFt: [number, number];
  floatingFt3: number;
  foamPieces: number;
  thin1ft: number;
  checks: Check[];
  descriptors: DescriptorResult[];
  categories: Record<string, number>;
}

export function summarizeWhole(tile: ParsedTile, layout: Layout, tileById: Map<string, ParsedTile>, ratio = 120): WholeSummary {
  const sp = tile.spaces;
  const st = tile.structure;
  const cats: Record<string, number> = {};
  for (const b of layout.boxes) cats[categoryOf(b.tile)] = (cats[categoryOf(b.tile)] ?? 0) + 1;
  void tileById;
  return {
    pieces: layout.boxes.length,
    attachedAll: layout.islands.length === 0,
    walkableAll: layout.islands.length === 0 && layout.unreachable.length === 0,
    islands: layout.islands.length,
    unreachable: layout.unreachable.length,
    levels: sp?.levels.length ?? 0,
    levelHeights: (sp?.levels ?? []).map((l) => l.z_ft),
    rooms: sp?.rooms.length ?? 0,
    roomComponents: sp?.graph.components ?? 0,
    deadEnds: sp?.graph.dead_ends ?? 0,
    loops: sp?.graph.loops ?? 0,
    mainRouteFt: sp?.main_route?.length_ft ?? null,
    litFloor: sp?.daylight.lit_floor_fraction ?? 0,
    skyFloor: sp?.daylight.sky_floor_fraction ?? 0,
    voidShare: tile.metrics?.void_fraction ?? 0,
    heightFt: tile.tileFt[2],
    footprintFt: [tile.tileFt[0], tile.tileFt[1]],
    floatingFt3: st?.floating_ft3 ?? 0,
    foamPieces: st?.foam_pieces ?? 0,
    thin1ft: st?.thin_share?.["1"] ?? st?.thin_share?.["1.0"] ?? 0,
    checks: printChecks(tile, ratio),
    descriptors: scoreTile(tile),
    categories: cats,
  };
}

// ---- evidence ------------------------------------------------------------------------------------------------------

export interface EvidenceItem {
  key: string;
  label: string;
  detail: string;
  polylines?: Vec3[][];
  planes?: number[];
  boxes?: { min: Vec3; max: Vec3 }[];
  pieces?: string[];
}

/** What to light up in 3D for each finding. `origin` is the composite's low corner (the tile's coordinates start there). */
export function evidenceFor(tile: ParsedTile, layout: Layout, origin: Vec3, seq: Sequence, smooth: SmoothReport | null): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const sp = tile.spaces;
  const add = (p: Vec3): Vec3 => [origin[0] + p[0], origin[1] + p[1], origin[2] + p[2]];
  const route = sp?.routes && sp.routes.length ? [...sp.routes].sort((a, b) => b.length_ft - a.length_ft)[0] : null;
  if (route) out.push({ key: "route", label: "Longest route", detail: `${route.length_ft.toFixed(0)} ft through ${route.rooms.length} room${route.rooms.length === 1 ? "" : "s"}, ${route.bends} bends`, polylines: [route.points_ft.map((p) => add(p as Vec3))] });
  if (sp?.levels.length) out.push({ key: "levels", label: "Floor levels", detail: `${sp.levels.length}: ${sp.levels.map((l) => `${(origin[2] + l.z_ft).toFixed(1)} ft`).join(", ")}`, planes: sp.levels.map((l) => origin[2] + l.z_ft) });
  if (sp && sp.graph.components > 1 && sp.rooms.length) {
    // rooms not joined to the biggest group of rooms
    const parent = sp.rooms.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const at = new Map(sp.rooms.map((r, i) => [r.id, i]));
    for (const c of sp.connections) {
      const a = at.get(c.rooms[0]);
      const b = at.get(c.rooms[1]);
      if (a !== undefined && b !== undefined) parent[find(a)] = find(b);
    }
    const sizes = new Map<number, number>();
    sp.rooms.forEach((r, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + r.volume_ft3));
    const mainRoot = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const cut = sp.rooms.filter((_, i) => find(i) !== mainRoot);
    if (cut.length) out.push({ key: "cutoff", label: "Cut-off rooms", detail: `${cut.length} room${cut.length === 1 ? "" : "s"} not joined to the main space`, boxes: cut.map((r) => ({ min: add(r.bbox_min_ft as Vec3), max: add(r.bbox_max_ft as Vec3) })) });
  }
  const stray = [...seq.depth.keys()].filter((id) => id !== layout.entranceId && id !== seq.steps[seq.steps.length - 1]?.pieceId && (layout.walk.get(id)?.length ?? 0) === 1);
  if (stray.length) out.push({ key: "dead-ends", label: "Dead-end pieces", detail: `${stray.length} piece${stray.length === 1 ? "" : "s"} reached by only one joint`, pieces: stray });
  if (smooth && smooth.floaters.length) out.push({ key: "floaters", label: "Fragments and pockets", detail: `${smooth.floaters.length} found by smoothing (floating foam, tiny sealed pockets)`, boxes: smooth.floaters.map((f) => ({ min: f.min, max: f.max })) });
  void toFt;
  return out;
}

/** The pieces' own names, with the auto names filling any gap. */
export function namesFor(doc: ArrangementDoc, auto: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of doc.pieces) out[p.id] = doc.names[p.id] || auto[p.id] || p.id;
  return out;
}
