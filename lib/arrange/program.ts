// The program rules (which kinds of tile may touch, how many of each) and the warnings an arrangement raises. The same
// functions serve the generator (hard "never" rules are absolute there) and the Warnings list.

import type { ParsedTile } from "@/lib/types";
import { WALK } from "./occupancy";
import { CATEGORY_LABEL, pairKey, type Adjacency, type ArrangeWarning, type ArrangementDoc, type Joint, type ProgramRules, type RuleLevel, type Site } from "./types";
import { categoryOf } from "./orient";
import { classAt, toFt } from "./geometry";
import { describeCollision } from "./collision";
import { OUT, SOLID } from "./occupancy";
import type { Layout } from "./layout";

export function ruleBetween(rules: ProgramRules, a: ParsedTile, b: ParsedTile, stacked: boolean): RuleLevel {
  const override = rules.tilePairs.find((p) => (p.a === a.id && p.b === b.id) || (p.a === b.id && p.b === a.id));
  if (override) return override.level;
  const adj: Adjacency | undefined = rules.adjacency[pairKey(categoryOf(a), categoryOf(b))];
  if (!adj) return "allowed";
  return stacked ? adj.stacked : adj.side;
}

/** +1 preferred, 0 allowed, -1 avoid, -Infinity never. */
export const ruleValue = (l: RuleLevel) => (l === "preferred" ? 1 : l === "allowed" ? 0 : l === "avoid" ? -1 : -Infinity);

/**
 * The share of a piece's footprint with material directly under it (0..1); the ground is the lowest level of the arrangement.
 * Read from the cells: for each column the piece really occupies, is the cell under its lowest cell material of another piece?
 * (A shaped piece's footprint is not its box, and a notch is not unsupported.)
 */
export function supportFraction(layout: Pick<Layout, "boxes" | "bounds">, id: string): number {
  const b = layout.boxes.find((x) => x.piece.id === id);
  if (!b || !layout.bounds) return 1;
  if (b.min[2] <= layout.bounds.min[2]) return 1;
  const [nx, ny, nz] = b.occ.dims;
  const others = layout.boxes.filter((o) => o !== b && o.min[2] < b.min[2] + 1 && o.max[0] > b.min[0] - 1 && o.min[0] < b.max[0] + 1 && o.max[1] > b.min[1] - 1 && o.min[1] < b.max[1] + 1);
  let columns = 0;
  let held = 0;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      let z0 = -1;
      for (let z = 0; z < nz; z++) if (b.occ.cls[(x * ny + y) * nz + z] !== OUT) {
        z0 = z;
        break;
      }
      if (z0 < 0) continue;
      columns++;
      const wx = b.min[0] + x;
      const wy = b.min[1] + y;
      const wz = b.min[2] + z0 - 1;
      if (wz < layout.bounds.min[2]) {
        held++;
        continue;
      }
      if (others.some((o) => classAt(o, wx, wy, wz) === SOLID)) held++;
    }
  return columns ? Math.min(1, held / columns) : 1;
}

const count = (arr: string[]) => {
  const m = new Map<string, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

export function evaluateProgram(layout: Layout, doc: ArrangementDoc, rules: ProgramRules, site: Site, tileById: Map<string, ParsedTile>): ArrangeWarning[] {
  const out: ArrangeWarning[] = [];
  const name = (id: string) => doc.names[id] || tileById.get(doc.pieces.find((p) => p.id === id)?.tileId ?? "")?.name || id;
  let n = 0;
  const add = (w: Omit<ArrangeWarning, "id">) => out.push({ ...w, id: `w${n++}` });

  for (const c of layout.collisions) {
    if (!layout.overlaps.some(([a, b]) => a === c.aId && b === c.bId)) continue;
    add({ kind: "overlap", severity: "error", message: `${name(c.aId)} and ${name(c.bId)} claim the same space: ${describeCollision(c, 0.125)}.`, pieceIds: [c.aId, c.bId] });
  }
  for (const [a, b] of layout.nested) add({ kind: "overlap", severity: "info", message: `${name(a)} and ${name(b)} nest: their bounding boxes overlap but their cells fit.`, pieceIds: [a, b] });
  for (const isle of layout.islands) add({ kind: "disconnected", severity: "error", message: `${isle.length === 1 ? name(isle[0]) : `${isle.length} pieces (${name(isle[0])}...)`} not attached to the main set.`, pieceIds: isle });
  if (layout.unreachable.length) add({ kind: "unreachable", severity: "warn", message: `${layout.unreachable.length} attached piece${layout.unreachable.length > 1 ? "s have" : " has"} no walkable route from the entrance to ${layout.unreachable.length > 1 ? "their" : "its"} main floor (a floor to stand on, ${WALK.widthFt} ft clear width and ${WALK.headroomFt} ft headroom, steps of no more than ${WALK.stepFt} ft or real stair or ramp geometry).`, pieceIds: layout.unreachable });
  for (const [id, r] of layout.reach) {
    if (r.main && r.totalFt2 > 0 && r.reachedFt2 < r.totalFt2 * 0.98) add({ kind: "partial", severity: "info", message: `${name(id)}: ${(r.totalFt2 - r.reachedFt2).toFixed(0)} ft2 of its ${r.totalFt2.toFixed(0)} ft2 of floor cannot be reached on foot (another level or pocket with no stair or ramp to it).`, pieceIds: [id] });
  }

  for (const j of layout.joints) {
    const a = layout.byId.get(j.aId)!;
    const b = layout.byId.get(j.bId)!;
    const level = ruleBetween(rules, a.tile, b.tile, j.axis === 2);
    const pair = `${name(j.aId)} / ${name(j.bId)}`;
    if (level === "never") add({ kind: "never", severity: "error", message: `${pair}: ${CATEGORY_LABEL[categoryOf(a.tile)]} may never touch ${CATEGORY_LABEL[categoryOf(b.tile)]} ${j.axis === 2 ? "stacked" : "side by side"}.`, pieceIds: [j.aId, j.bId], jointId: j.id });
    if (j.connect.kind === "connector" && j.connect.connector) add({ kind: "connector", severity: "warn", message: `${pair}: the floors are ${j.connect.connector.riseFt.toFixed(1)} ft apart across a clear doorway. That needs a stair or ramp connector, which is not there: the joint is not walkable.`, pieceIds: [j.aId, j.bId], jointId: j.id });
    else if (j.floorStepFt !== null && j.floorStepFt > WALK.stepFt + 1e-6 && !j.connect.walkable) add({ kind: "level", severity: "warn", message: `${pair}: floors differ by up to ${j.floorStepFt.toFixed(1)} ft across the joint (more than one ${WALK.stepFt} ft step).`, pieceIds: [j.aId, j.bId], jointId: j.id });
    if (j.legacy !== null && j.legacy < 50) add({ kind: "dead-end", severity: "info", message: `${pair}: openings dead-end into foam (${j.legacy.toFixed(0)}% matched).`, pieceIds: [j.aId, j.bId], jointId: j.id });
    if (j.connect.kind === "void" && j.connect.why) add({ kind: "sealed", severity: "info", message: `${pair}: open space continues across the joint but nobody can walk it: ${j.connect.why}.`, pieceIds: [j.aId, j.bId], jointId: j.id });
  }

  for (const b of layout.boxes) {
    const frac = supportFraction(layout, b.piece.id);
    const above = layout.bounds ? toFt(b.min[2] - layout.bounds.min[2]) : 0;
    // a piece one storey or less above the lowest one is simply raised and held by its neighbours; higher up with nothing under it is a real overhang
    if (frac < 0.25 && above > 10.01) add({ kind: "hanging", severity: "warn", message: `${name(b.piece.id)} hangs ${above.toFixed(0)} ft up: only ${(frac * 100).toFixed(0)}% of it has something below.`, pieceIds: [b.piece.id] });
    else if (frac < 0.25 && above > 0.01) add({ kind: "hanging", severity: "info", message: `${name(b.piece.id)} is raised ${above.toFixed(1)} ft and held by its neighbours.`, pieceIds: [b.piece.id] });
    else if (rules.limits.maxOverhangFt > 0) {
      const w = (b.max[0] - b.min[0]) * 0.5;
      if ((1 - frac) * w > rules.limits.maxOverhangFt) add({ kind: "hanging", severity: "warn", message: `${name(b.piece.id)} overhangs about ${((1 - frac) * w).toFixed(0)} ft, more than the ${rules.limits.maxOverhangFt} ft allowed.`, pieceIds: [b.piece.id] });
    }
    if (site.enabled) {
      const out2 = toFt(b.min[0]) < site.min[0] - 1e-6 || toFt(b.min[1]) < site.min[1] - 1e-6 || toFt(b.max[0]) > site.min[0] + site.size[0] + 1e-6 || toFt(b.max[1]) > site.min[1] + site.size[1] + 1e-6 || (site.maxHeight > 0 && toFt(b.max[2]) > site.maxHeight + 1e-6);
      if (out2) add({ kind: "site", severity: "warn", message: `${name(b.piece.id)} is outside the site limit.`, pieceIds: [b.piece.id] });
    }
  }

  // counts and limits
  const total = doc.pieces.length;
  const c = rules.counts;
  if (c.total.min > 0 && total < c.total.min) add({ kind: "counts", severity: "warn", message: `${total} pieces; at least ${c.total.min} wanted.`, pieceIds: [] });
  if (c.total.max > 0 && total > c.total.max) add({ kind: "counts", severity: "warn", message: `${total} pieces; at most ${c.total.max} allowed.`, pieceIds: [] });
  const perTile = count(doc.pieces.map((p) => p.tileId));
  const perCat = count(doc.pieces.map((p) => categoryOf(tileById.get(p.tileId) ?? ({ guessed: {} } as ParsedTile))));
  if (c.maxCopies > 0) for (const [id, k] of perTile) if (k > c.maxCopies) add({ kind: "counts", severity: "warn", message: `${tileById.get(id)?.name ?? id}: ${k} copies, at most ${c.maxCopies} allowed.`, pieceIds: doc.pieces.filter((p) => p.tileId === id).map((p) => p.id) });
  for (const [cat, r] of Object.entries(c.perCategory)) {
    const k = perCat.get(cat) ?? 0;
    if (r.min > 0 && k < r.min) add({ kind: "counts", severity: "warn", message: `${CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}: ${k} pieces, at least ${r.min} wanted.`, pieceIds: [] });
    if (r.max > 0 && k > r.max) add({ kind: "counts", severity: "warn", message: `${CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}: ${k} pieces, at most ${r.max} allowed.`, pieceIds: [] });
  }
  for (const [id, r] of Object.entries(c.perTile)) {
    const k = perTile.get(id) ?? 0;
    const tn = tileById.get(id)?.name ?? id;
    if (r.min > 0 && k < r.min) add({ kind: "counts", severity: "warn", message: `${tn}: ${k} pieces, at least ${r.min} wanted.`, pieceIds: [] });
    if (r.max > 0 && k > r.max) add({ kind: "counts", severity: "warn", message: `${tn}: ${k} pieces, at most ${r.max} allowed.`, pieceIds: doc.pieces.filter((p) => p.tileId === id).map((p) => p.id) });
  }
  if (layout.bounds) {
    const h = toFt(layout.bounds.max[2] - layout.bounds.min[2]);
    const fx = toFt(layout.bounds.max[0] - layout.bounds.min[0]);
    const fy = toFt(layout.bounds.max[1] - layout.bounds.min[1]);
    if (rules.limits.maxHeightFt > 0 && h > rules.limits.maxHeightFt + 1e-6) add({ kind: "limit", severity: "warn", message: `Height ${h.toFixed(0)} ft is over the ${rules.limits.maxHeightFt} ft limit.`, pieceIds: [] });
    if (rules.limits.maxFootprintFt > 0 && Math.max(fx, fy) > rules.limits.maxFootprintFt + 1e-6) add({ kind: "limit", severity: "warn", message: `Footprint ${Math.max(fx, fy).toFixed(0)} ft is over the ${rules.limits.maxFootprintFt} ft limit.`, pieceIds: [] });
  }
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/** Why a joint is the colour it is, for the Joints panel. */
export const jointNote = (j: Joint): string => {
  const p = j.parts;
  const bits: string[] = [];
  if (p.void !== null) bits.push(`void ${p.void.toFixed(0)}`);
  if (p.floors !== null) bits.push(`floors ${p.floors.toFixed(0)}`);
  if (p.circulation !== null) bits.push(`routes ${p.circulation.toFixed(0)}`);
  if (p.foam !== null) bits.push(`foam ${p.foam.toFixed(0)}`);
  const c = j.connect;
  bits.push(c.walkable ? `walkable${c.stepFt ? ` (step ${c.stepFt.toFixed(1)} ft)` : ""}` : c.kind === "void" ? "open, not walkable" : "touching");
  return bits.join(" · ");
};
