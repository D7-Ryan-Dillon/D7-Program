// Connectors: a stair or ramp that joins two floors a doorway apart that are more than one step (the shared walking rule, lib/walking.ts) different in height.
//
// Arrange reports such a joint as "needs a connector" (lib/arrange/walk.ts). Here the connector is BUILT: a wedge of floor (ordinary foam) laid in the LOWER
// piece's room, climbing from its floor to the height of the doorway, so that the joint then carries a real route. The wedge is not saved with the arrangement:
// what is saved is only the intent (ArrangementDoc.connectors, and the rule Program > Connectors), and the geometry is worked out again from the pieces every
// time, so it follows the pieces when they move and can never disagree with them.
//
// Because the wedge is just foam in the piece's own cells, everything downstream reads it with no change: the walking analysis (a run of standing cells that
// each step up to the next), the combined model and its smoothing, Add as tile, STL and OBJ, the movies and the Rhino mass. Nothing here touches the engine.
//
// A plan is accepted only when the program's own walking rules say so: the joint it was built for must carry a route afterwards, the piece's other joints must
// keep theirs, and the piece must still fit among its neighbours. A stair rises one riser (a step) every 2 cells (1 ft), a ramp every 4 cells (2 ft); both are
// 3 ft wide, so the clear disc and the headroom of the walking rules are met. They are proto-architectural slopes, not accessibility compliance.

import { placementFree } from "./collision";
import { contactsBetween, type PlacedBox } from "./geometry";
import { jointFromContacts } from "./joints";
import { getOcc, getWalk } from "./occupancy";
import type { Oriented } from "./orient";
import type { ConnectorChoice, Joint, ProgramRules, Rating } from "./types";
import { ARRANGE_CELL, connectorReachFt } from "./types";
import type { Connector } from "./walk";

export type ConnectorKind = "ramp" | "stair";
/** Cells of run for each riser (one step, 0.5 ft): a stair is steep, a ramp is gentle. */
export const RUN_PER_RISER: Record<ConnectorKind, number> = { stair: 2, ramp: 4 };
/** Width of the wedge, cells (3 ft: wider than the clear disc of the walking rules). */
const WIDTH = 6;
/** Cells of level floor wanted beyond the foot of the wedge, so the foot joins the room's floor. */
const LANDING = 2;

export interface ConnectorMade {
  jointId: string;
  hostId: string;
  kind: ConnectorKind;
  riseFt: number;
  runFt: number;
  widthFt: number;
  /** built because the rule is on, not because you asked for it at that joint */
  auto: boolean;
  /** the floor (zone of the piece before it was built) the wedge starts from, for the generator's reach check */
  hostZoneBefore: number;
  /** where the wedge is, in feet (for drawing it): it runs along `axis` from the doorway plane (`from`) to `to`, between lateral `l0` and `l1`, from the floor `z0` up to the doorway floor `z1` */
  wedge: { axis: 0 | 1; from: number; to: number; l0: number; l1: number; z0: number; z1: number };
}

export interface ConnectorFail {
  jointId: string;
  why: string;
}

export interface ConnectorResult {
  boxes: PlacedBox[];
  made: ConnectorMade[];
  failed: ConnectorFail[];
}

/** The wedge, in the host's own cells. */
interface Spec {
  kind: ConnectorKind;
  /** the axis the wedge runs along (0 x, 1 y), the direction away from the doorway, and the host's cell next to the doorway */
  axis: 0 | 1;
  dir: 1 | -1;
  edge: number;
  /** lateral cells [l0, l1) */
  l0: number;
  l1: number;
  /** the floor of the room and the floor of the doorway (standing cell heights) */
  zLow: number;
  zTop: number;
}

const specKey = (s: Spec) => `${s.kind[0]}${s.axis}${s.dir > 0 ? "+" : "-"}${s.edge}:${s.l0}-${s.l1}:${s.zLow}-${s.zTop}`;
const runCells = (s: Spec) => (s.zTop - s.zLow) * RUN_PER_RISER[s.kind];

const patched = new WeakMap<Oriented, Map<string, Oriented | null>>();

/** The cells of the wedge (foam where there was void), or null when it does not fit in the host's own container. */
function wedge(o: Oriented, s: Spec): number[] | null {
  const [nx, ny, nz] = o.dims;
  const ratio = RUN_PER_RISER[s.kind];
  const cells: number[] = [];
  for (let d = 0; ; d++) {
    const surface = s.zTop - Math.floor(d / ratio);
    if (surface <= s.zLow) break;
    if (surface >= nz) return null;
    const along = s.edge + s.dir * d;
    for (let l = s.l0; l < s.l1; l++) {
      const x = s.axis === 0 ? along : l;
      const y = s.axis === 0 ? l : along;
      if (x < 0 || y < 0 || x >= nx || y >= ny) return null;
      let z = surface - 1;
      for (; z >= 0; z--) {
        const i = (x * ny + y) * nz + z;
        if (o.mask && !o.mask[i]) return null; // outside the container
        if (!o.void[i]) break; // down to material: the wedge sits on it
        cells.push(i);
        if (surface - 1 - z > 24) return null; // no floor within 12 ft: not a floor to build on
      }
    }
  }
  return cells;
}

function patchedOriented(base: Oriented, s: Spec): Oriented | null {
  let m = patched.get(base);
  if (!m) patched.set(base, (m = new Map()));
  const k = specKey(s);
  if (m.has(k)) return m.get(k)!;
  const cells = wedge(base, s);
  let out: Oriented | null = null;
  if (cells) {
    const v = base.void.slice();
    for (const i of cells) v[i] = 0;
    out = { ...base, void: v };
  }
  m.set(k, out);
  return out;
}

/** Floor available along the wedge's run, cells: how far the room's floor level stays open from the doorway. */
function freeRun(host: PlacedBox, s: Spec): number {
  const [nx, ny, nz] = host.o.dims;
  const l = Math.floor((s.l0 + s.l1) / 2);
  let n = 0;
  for (let d = 0; d < 400; d++) {
    const along = s.edge + s.dir * d;
    const x = s.axis === 0 ? along : l;
    const y = s.axis === 0 ? l : along;
    if (x < 0 || y < 0 || x >= nx || y >= ny) break;
    if (host.o.void[(x * ny + y) * nz + s.zLow] === 0) break;
    n++;
  }
  return n;
}

const SLOPE: Record<ConnectorKind, string> = { stair: "stair", ramp: "ramp" };

/** What a connector at this joint would ask for: the run a stair and a ramp need for the rise, in feet. */
export function connectorNeeds(riseFt: number): { stairFt: number; rampFt: number } {
  const risers = Math.round(riseFt / ARRANGE_CELL);
  return { stairFt: risers * RUN_PER_RISER.stair * ARRANGE_CELL, rampFt: risers * RUN_PER_RISER.ramp * ARRANGE_CELL };
}

interface Try {
  box: PlacedBox;
  joint: Joint;
  spec: Spec;
}

function attempt(host: PlacedBox, other: PlacedBox, all: PlacedBox[], spec: Spec, tolFt: number, ratings: Record<string, Rating>): Try | null {
  const o2 = patchedOriented(host.o, spec);
  if (!o2) return null;
  const piece = { ...host.piece, conn: [host.piece.conn, specKey(spec)].filter(Boolean).join("+") };
  const box: PlacedBox = { ...host, piece, o: o2, occ: getOcc(o2) };
  const rest = all.filter((b) => b !== host);
  if (!placementFree(box, rest)) return null;
  const cs = contactsBetween(box, other);
  if (!cs.length) return null;
  const world = [...rest, box];
  const joint = jointFromContacts(cs, world, tolFt, ratings);
  if (!joint.connect.walkable) return null;
  // the foot of the wedge must land on the room's own walkable floor (the zone the doorway's crossing starts from), not against a wall
  {
    const [nx, ny, nz] = o2.dims;
    const along = spec.edge + spec.dir * (runCells(spec) + 1);
    const l = Math.floor((spec.l0 + spec.l1) / 2);
    const x = spec.axis === 0 ? along : l;
    const y = spec.axis === 0 ? l : along;
    if (x < 0 || y < 0 || x >= nx || y >= ny) return null;
    const wk = getWalk(box.occ);
    const i = (x * ny + y) * nz + spec.zLow;
    if (!wk.stand[i]) return null;
    const hostZones = joint.connect.crossings.map((c) => (c.aId === host.piece.id ? c.zoneA : c.zoneB));
    if (!hostZones.includes(wk.zone[i])) return null;
  }
  // the host's other joints must keep the routes they had
  for (const q of rest) {
    if (q === other) continue;
    const before = contactsBetween(host, q);
    if (!before.length) continue;
    const was = jointFromContacts(before, all, tolFt, ratings).connect.walkable;
    if (!was) continue;
    const after = contactsBetween(box, q);
    if (!after.length || !jointFromContacts(after, world, tolFt, ratings).connect.walkable) return null;
  }
  return { box, joint, spec };
}

/**
 * Builds the connectors the rule asks for: for every joint that is "needs a connector" and is not taken out, a wedge in the lower room that makes it walkable,
 * when one fits. Returns the pieces with the wedges built in (a new box for each changed piece; the pieces themselves are copies with a signature of the wedge
 * in `conn`), the connectors made, and why the others could not be.
 */
export function applyConnectors(boxes: PlacedBox[], joints: Joint[], rules: ProgramRules, choices: Record<string, ConnectorChoice>, ratings: Record<string, Rating> = {}): ConnectorResult {
  let cur = boxes.slice();
  const made: ConnectorMade[] = [];
  const failed: ConnectorFail[] = [];
  const tol = connectorReachFt(rules);
  for (const j of joints) {
    if (j.connect.kind !== "connector" || !j.connect.connector?.items?.length) continue;
    const choice = choices[j.id];
    if (choice?.off) continue;
    if (!choice && !rules.autoConnectors) continue;
    const item = [...j.connect.connector.items].sort((a, b) => a.riseFt - b.riseFt)[0];
    const res = planOne(cur, j, item, choice?.kind ?? "auto", tol, ratings);
    if ("why" in res) {
      failed.push({ jointId: j.id, why: res.why });
      continue;
    }
    cur = cur.map((b) => (b.piece.id === res.host.piece.id ? res.box : b));
    const h = res.host;
    const s = res.spec;
    const lat = s.axis === 0 ? 1 : 0;
    const from = (item.plane ?? 0) * ARRANGE_CELL;
    made.push({
      jointId: j.id,
      hostId: h.piece.id,
      kind: res.kind,
      riseFt: item.riseFt,
      runFt: runCells(s) * ARRANGE_CELL,
      widthFt: WIDTH * ARRANGE_CELL,
      auto: !choice,
      hostZoneBefore: res.zoneBefore,
      wedge: { axis: s.axis, from, to: from + s.dir * runCells(s) * ARRANGE_CELL, l0: (s.l0 + h.min[lat]) * ARRANGE_CELL, l1: (s.l1 + h.min[lat]) * ARRANGE_CELL, z0: (s.zLow + h.min[2]) * ARRANGE_CELL, z1: (s.zTop + h.min[2]) * ARRANGE_CELL },
    });
  }
  return { boxes: cur, made, failed };
}

/** The wedge for one joint, or the reason there is none. */
function planOne(all: PlacedBox[], j: Joint, item: Connector, want: "ramp" | "stair" | "auto", tolFt: number, ratings: Record<string, Rating>): { host: PlacedBox; box: PlacedBox; spec: Spec; kind: ConnectorKind; zoneBefore: number } | { why: string } {
  const A = all.find((b) => b.piece.id === j.aId);
  const B = all.find((b) => b.piece.id === j.bId);
  if (!A || !B || item.axis === undefined || item.col === undefined || item.za === undefined || item.zb === undefined || !item.lat) return { why: "the doorway could not be located" };
  const lowerIsA = item.za < item.zb;
  const host = lowerIsA ? A : B;
  const other = lowerIsA ? B : A;
  const axis = item.axis;
  const lateralAxis = axis === 0 ? 1 : 0;
  const zTop = Math.max(item.za, item.zb) - host.min[2];
  const zLow = Math.min(item.za, item.zb) - host.min[2];
  const edgeWorld = (lowerIsA ? item.col[axis] : item.col[axis] + 1) - host.min[axis];
  const dir: 1 | -1 = lowerIsA ? -1 : 1;
  const centre = Math.floor((item.lat[0] + item.lat[1] + 1) / 2) - host.min[lateralAxis];
  const kinds: ConnectorKind[] = want === "auto" ? ["ramp", "stair"] : [want];
  const risers = zTop - zLow;
  let why = "";
  for (const kind of kinds) {
    for (const off of [0, -2, 2, -4, 4]) {
      const l0 = centre - WIDTH / 2 + off;
      const spec: Spec = { kind, axis, dir, edge: edgeWorld, l0, l1: l0 + WIDTH, zLow, zTop };
      const t = attempt(host, other, all, spec, tolFt, ratings);
      if (t) {
        const bottomAlong = spec.edge + spec.dir * runCells(spec);
        const [nx, ny, nz] = host.o.dims;
        const x = axis === 0 ? Math.max(0, Math.min(nx - 1, bottomAlong)) : Math.floor((l0 + l0 + WIDTH) / 2);
        const y = axis === 0 ? Math.floor((l0 + l0 + WIDTH) / 2) : Math.max(0, Math.min(ny - 1, bottomAlong));
        const zoneBefore = getWalk(host.occ).zone[(Math.max(0, Math.min(nx - 1, x)) * ny + Math.max(0, Math.min(ny - 1, y))) * nz + zLow];
        return { host, box: t.box, spec, kind, zoneBefore };
      }
    }
    const free = freeRun(host, { kind, axis, dir, edge: edgeWorld, l0: centre - 3, l1: centre + 3, zLow, zTop });
    const need = risers * RUN_PER_RISER[kind] + LANDING;
    why = free < need ? `a ${SLOPE[kind]} up ${(risers * ARRANGE_CELL).toFixed(1)} ft needs ${(need * ARRANGE_CELL).toFixed(1)} ft of run (with a landing) in the lower room and it has ${(free * ARRANGE_CELL).toFixed(1)} ft` : `a ${SLOPE[kind]} does not fit: the way is blocked or too low in the lower room`;
  }
  return { why };
}

/** One joint's connector, tried on its own (the generator uses this to see whether a candidate can be reached by a connector). Null when none fits. */
export function connectJoint(all: PlacedBox[], j: Joint, rules: ProgramRules, choice: ConnectorChoice = { kind: "auto" }, ratings: Record<string, Rating> = {}): ConnectorResult | null {
  const r = applyConnectors(all, [j], { ...rules, autoConnectors: true }, { [j.id]: choice }, ratings);
  return r.made.length ? r : null;
}
