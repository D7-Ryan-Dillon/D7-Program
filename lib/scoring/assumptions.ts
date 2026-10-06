// The assumptions the matrix measurements rest on. They are shown beside every result they affect, they can be changed (one at a time, each
// restorable to the automatic value), and they are part of the evaluation profile, so every tile in a comparison is read with the same ones.

export interface Assumptions {
  /** Threaded: program categories counted as public. Nothing about a room is public unless its category says so (or you say so). */
  publicCategories: string[];
  /** Threaded: a room's own class, "tileId:roomId" -> public or private. */
  roomClass: Record<string, "public" | "private">;
  /** Threaded: a floor within this height of the lowest floor is the ground floor, ft. */
  groundToleranceFt: number;
  /** Stepped: an extent must change by at least this much (ft) to be a setback, and hold for at least `setbackRiseFt` of height. */
  setbackRunFt: number;
  setbackRiseFt: number;
  /** Spatial density: a stretch narrower than this share of the route's typical width is a constriction; wider than `expansionRatio` times it, an expansion. */
  constrictionRatio: number;
  expansionRatio: number;
  /** Spatial density: height above the floor at which the passage width is read, ft. */
  passageHeightFt: number;
  /** Non-hierarchical: how far apart two routes must run to count as different (the width of the corridor closed off after each route, ft) and how many to look for. */
  routeBlockFt: number;
  maxRoutes: number;
  /** Graduated: enclosure classes from the open-sky share and the open horizon share along the route. */
  openSky: number;
  semiSky: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  publicCategories: ["gathering", "lobby"],
  roomClass: {},
  groundToleranceFt: 4,
  setbackRunFt: 2,
  setbackRiseFt: 3,
  constrictionRatio: 0.6,
  expansionRatio: 1.4,
  passageHeightFt: 4,
  routeBlockFt: 5,
  maxRoutes: 6,
  openSky: 0.5,
  semiSky: 0.15,
};

/** The assumptions that have a plain number, with how they are described to the user (for the settings list). */
export const ASSUMPTION_FIELDS: { key: keyof Assumptions; label: string; unit: string; hint: string; min: number; max: number; step: number }[] = [
  { key: "groundToleranceFt", label: "Ground floor tolerance", unit: "ft", hint: "Threaded: a floor this close to the lowest floor is the ground floor", min: 0, max: 12, step: 0.5 },
  { key: "setbackRunFt", label: "Smallest setback", unit: "ft", hint: "Stepped: how far an edge of the void's section must step in or out to be a setback (smaller changes are voxel noise)", min: 0.5, max: 10, step: 0.5 },
  { key: "setbackRiseFt", label: "Setback must hold", unit: "ft", hint: "Stepped: how much height a setback must hold to count as one", min: 1, max: 15, step: 0.5 },
  { key: "constrictionRatio", label: "Constriction below", unit: "× typical width", hint: "Spatial density: narrower than this share of the typical width is a constriction", min: 0.2, max: 0.9, step: 0.05 },
  { key: "expansionRatio", label: "Expansion above", unit: "× typical width", hint: "Spatial density: wider than this multiple of the typical width is an expansion", min: 1.1, max: 3, step: 0.05 },
  { key: "passageHeightFt", label: "Width read at", unit: "ft above the floor", hint: "Spatial density: height at which a passage's clear width is read", min: 1, max: 7, step: 0.5 },
  { key: "routeBlockFt", label: "Routes differ by", unit: "ft", hint: "Non-hierarchical: the walkable floor is cut into stretches this wide; two routes are independent when they share no stretch (a corridor narrower than this is one way)", min: 2.5, max: 10, step: 0.5 },
  { key: "maxRoutes", label: "Routes searched", unit: "routes", hint: "Non-hierarchical: counting stops at this many independent routes", min: 2, max: 12, step: 1 },
];

/** Settings an earlier version kept here that are now the project's shared walking rules (lib/walking.ts): never read from the assumptions again. */
export const RETIRED_ASSUMPTIONS = ["routeHeadroomFt", "routeStepFt"] as const;

export function mergeAssumptions(over: Partial<Assumptions> | undefined): Assumptions {
  const keep: Partial<Assumptions> = { ...(over ?? {}) };
  for (const k of RETIRED_ASSUMPTIONS) delete (keep as Record<string, unknown>)[k];
  return { ...DEFAULT_ASSUMPTIONS, ...keep, roomClass: { ...DEFAULT_ASSUMPTIONS.roomClass, ...(over?.roomClass ?? {}) } };
}

/** A short stable text of an assumption set, for caches. */
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)])) : v);
export const assumptionsKey = (a: Assumptions): string => JSON.stringify(stable(a));
