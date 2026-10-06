// Can a person walk from one piece into the next? Three different things are kept apart everywhere in Arrange:
//
//   contact       two pieces touch (cells face to face): they are one built thing, whether or not anyone can pass
//   void          open space meets open space across the contact: you can see and breathe through it
//   walkable      someone can stand on a floor on one side, step across, and stand on a floor on the other side
//
// An opening that merely lines up with another is NOT walkable: a route needs a floor under it, clearance around it
// (WALK in occupancy.ts: 6.5 ft headroom and a 2.5 ft clear width, proto-architecture tolerances rather than code
// compliance), a step across the joint no bigger than the level tolerance, and floors on both sides that belong to the
// tile's own circulation (a zone big enough to be a space, not a pocket). A void that links two levels (a shaft) is a
// visual connection: it becomes walkable only when a ramp or stair inside a tile joins the floors, which is already one
// zone. Joints across a horizontal plane (stacked tiles) therefore connect spaces but never carry a route; route through
// a joint beside the piece instead.

import { boxesOverlap, type Contact, type PlacedBox } from "./geometry";
import { DISC, getWalk, HEAD_CELLS, OUT, SOLID, standingAt, VOID } from "./occupancy";
import { ARRANGE_CELL } from "./types";

/** The cells of a few pieces read as one world: SOLID if any piece has material there, else VOID if any has a carved space, else OUT. */
export class World {
  constructor(public boxes: PlacedBox[]) {}

  classAt(x: number, y: number, z: number, ignore?: PlacedBox, belowZ = -Infinity): number {
    let c = OUT;
    for (const b of this.boxes) {
      if (x < b.min[0] || y < b.min[1] || z < b.min[2] || x >= b.max[0] || y >= b.max[1] || z >= b.max[2]) continue;
      if (b === ignore && z < belowZ) continue;
      const [, ny, nz] = b.occ.dims;
      const k = b.occ.cls[((x - b.min[0]) * ny + (y - b.min[1])) * nz + (z - b.min[2])];
      if (k === SOLID) return SOLID;
      if (k === VOID) c = VOID;
    }
    return c;
  }
}

/** The pieces that can matter to a route across this contact: any whose box reaches the contact's neighbourhood. */
export function nearContact(all: PlacedBox[], c: Contact): PlacedBox[] {
  const [o1, o2] = c.axis === 0 ? [1, 2] : c.axis === 1 ? [0, 2] : [0, 1];
  const min: number[] = [0, 0, 0];
  const max: number[] = [0, 0, 0];
  min[c.axis] = c.plane - 3;
  max[c.axis] = c.plane + 3;
  min[o1] = c.lo[0] - 3;
  max[o1] = c.hi[0] + 3;
  min[o2] = c.lo[1] - 3 - HEAD_CELLS;
  max[o2] = c.hi[1] + 3 + HEAD_CELLS;
  return all.filter((b) => boxesOverlap(b, { min, max }));
}

export interface Crossing {
  aId: string;
  bId: string;
  /** the zone of piece a's own floor that the route leaves from, and of piece b's that it arrives in */
  zoneA: number;
  zoneB: number;
  /** the step between the two floors, ft */
  stepFt: number;
}

/**
 * The routes across one contact patch (side-by-side contacts only): every pair of standing places, one on each side, within
 * `tolCells` of height of each other, with open space at the higher floor across the joint and clearance round both. Returns one
 * entry per pair of zones, with the smallest step found. `world` holds the pieces that can matter (a third piece beside the joint
 * can take the clearance away).
 */
export interface CrossingResult {
  crossings: Crossing[];
  /** how far the search got, to say why there is no route: a floor on a side, a pair of floors within the step, floors that are real spaces, clear room round them */
  reached: { floorA: boolean; floorB: boolean; standA: boolean; standB: boolean; paired: boolean; significant: boolean; open: boolean; clear: boolean };
}

export function crossingsOf(c: Contact, voidA: Uint8Array, voidB: Uint8Array, world: World, tolCells: number, firstOnly = false): CrossingResult {
  const reached = { floorA: false, floorB: false, standA: false, standB: false, paired: false, significant: false, open: false, clear: false };
  if (c.axis === 2) return { crossings: [], reached };
  const A = c.a;
  const B = c.b;
  const wa = getWalk(A.occ);
  const wb = getWalk(B.occ);
  if (wa.main < 0 || wb.main < 0) return { crossings: [], reached };
  const [, ayN, anz] = A.occ.dims;
  const [, bny, bnz] = B.occ.dims;
  const w = c.hi[0] - c.lo[0];
  const h = c.hi[1] - c.lo[1];
  const found = new Map<number, Crossing>();
  const zLo = c.lo[1] - tolCells;
  const zHi = c.hi[1] + tolCells;
  for (let u = 0; u < w; u++) {
    // the two columns facing each other across the plane: a on its low side, b on its high side (world cells)
    const ax: number = c.axis === 0 ? c.plane - 1 : c.lo[0] + u;
    const ay: number = c.axis === 0 ? c.lo[0] + u : c.plane - 1;
    const bx: number = c.axis === 0 ? c.plane : c.lo[0] + u;
    const by: number = c.axis === 0 ? c.lo[0] + u : c.plane;
    const aBase: number = ((ax - A.min[0]) * ayN + (ay - A.min[1])) * anz - A.min[2];
    const bBase: number = ((bx - B.min[0]) * bny + (by - B.min[1])) * bnz - B.min[2];
    // what each side offers in these columns at any height (for saying why there is no route)
    for (let zb = B.min[2]; zb < B.max[2]; zb++) {
      const ib = bBase + zb;
      if (wb.stand[ib]) reached.standB = true;
      if (zb > B.min[2] && B.occ.cls[ib] === VOID && B.occ.cls[ib - 1] === SOLID) reached.floorB = true;
    }
    for (let za = A.min[2]; za < A.max[2]; za++) {
      const ia = aBase + za;
      if (wa.stand[ia]) reached.standA = true;
      if (za > A.min[2] && A.occ.cls[ia] === VOID && A.occ.cls[ia - 1] === SOLID) reached.floorA = true;
    }
    for (let za = Math.max(zLo, A.min[2]); za < Math.min(zHi, A.max[2]); za++) {
      const ia = aBase + za;
      if (!wa.stand[ia]) continue;
      const zoneA = wa.zone[ia];
      for (let zb = Math.max(zLo, B.min[2], za - tolCells); zb < Math.min(zHi, B.max[2], za + tolCells + 1); zb++) {
        const ib = bBase + zb;
        if (!wb.stand[ib]) continue;
        reached.paired = true;
        const zoneB = wb.zone[ib];
        if (!wa.zones[zoneA].significant || !wb.zones[zoneB].significant) continue;
        reached.significant = true;
        const zm = Math.max(za, zb);
        const k = u * h + (zm - c.lo[1]);
        if (zm < c.lo[1] || zm >= c.hi[1] || !c.cells[k] || !voidA[k] || !voidB[k]) continue;
        reached.open = true;
        // clearance in the real world: the higher floor's side must be open all round, the lower side's riser is the step itself
        const cellA = (x: number, y: number, z: number) => world.classAt(x, y, z, zb > za ? B : undefined, zb);
        const cellB = (x: number, y: number, z: number) => world.classAt(x, y, z, za > zb ? A : undefined, za);
        if (!standingAt(cellA, ax, ay, za) || !standingAt(cellB, bx, by, zb)) continue;
        reached.clear = true;
        const key = zoneA * 100000 + zoneB;
        const step = Math.abs(za - zb) * ARRANGE_CELL;
        const prev = found.get(key);
        if (!prev) found.set(key, { aId: A.piece.id, bId: B.piece.id, zoneA, zoneB, stepFt: step });
        else if (step < prev.stepFt) prev.stepFt = step;
        if (firstOnly) return { crossings: [...found.values()], reached };
      }
    }
  }
  return { crossings: [...found.values()], reached };
}

export { DISC };
