// What the Arrange tab works with. An arrangement is a list of PIECES (a tile, a position, an orientation) plus a few
// facts about them (the entrance, names, ratings). Everything else -- joints, validity, the whole-building analysis, the
// smoothed model -- is computed from the pieces, so the saved form stays small and can never disagree with itself.

export const ARRANGE_CELL = 0.5; // ft: the voxel size of every tile that can be placed; positions are multiples of it

export type Category = "gathering" | "office" | "lobby" | "other";
export const PROGRAM_CATEGORIES: Exclude<Category, "other">[] = ["gathering", "office", "lobby"];
export const CATEGORY_LABEL: Record<Category, string> = { gathering: "Gathering", office: "Workspace", lobby: "Lobby", other: "Other" };

export type Vec3 = [number, number, number];

export interface Piece {
  id: string;
  tileId: string;
  /** Low corner of the piece's box, feet (a multiple of ARRANGE_CELL). */
  pos: Vec3;
  /** Quarter turns about the vertical axis, after the optional X mirror. */
  rotZ: number;
  mirrorX: boolean;
  /** Uniform scale (Advanced); 1 = the tile's own size. */
  scale: number;
  locked: boolean;
  /** Pieces sharing a group id move and select together. */
  group?: string;
}

export type Rating = "good" | "bad";

/** The part of an arrangement that edits change (and undo restores). */
export interface ArrangementDoc {
  pieces: Piece[];
  /** The piece whose lowest outside opening is the way in (null = proposed automatically). */
  entranceId: string | null;
  /** The user's (or the auto-namer's) name for each piece's space, by piece id. */
  names: Record<string, string>;
  /** Joint ratings by joint id (the two piece ids). */
  ratings: Record<string, Rating>;
}

export const emptyDoc = (): ArrangementDoc => ({ pieces: [], entranceId: null, names: {}, ratings: {} });

// ---- rules -------------------------------------------------------------------------------------------------------

export type RuleLevel = "preferred" | "allowed" | "avoid" | "never";
export const RULE_LEVELS: RuleLevel[] = ["preferred", "allowed", "avoid", "never"];

export interface Adjacency {
  side: RuleLevel;
  stacked: RuleLevel;
}

export interface CountRange {
  min: number;
  /** 0 = no limit */
  max: number;
}

export type LevelTolerance = "exact" | "riser" | "ramp";

export interface ProgramRules {
  /** Keyed by pairKey of two categories, e.g. "gathering|lobby". */
  adjacency: Record<string, Adjacency>;
  /** Per-tile overrides: this pair of tiles is always at this level (never = hard). */
  tilePairs: { a: string; b: string; level: RuleLevel }[];
  counts: {
    total: CountRange;
    perCategory: Record<string, CountRange>;
    perTile: Record<string, CountRange>;
    /** 0 = no limit */
    maxCopies: number;
  };
  limits: {
    /** ft, 0 = no limit */
    maxHeightFt: number;
    maxFootprintFt: number;
    maxOverhangFt: number;
  };
  levelTolerance: LevelTolerance;
  /** The most a step may rise when ramps are allowed, ft. */
  rampRiseFt: number;
  /** The order a route should move through the categories, entrance first. */
  sequenceOrder: Exclude<Category, "other">[];
}

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export const defaultRules = (): ProgramRules => ({
  adjacency: {
    [pairKey("lobby", "gathering")]: { side: "preferred", stacked: "allowed" },
    [pairKey("gathering", "office")]: { side: "preferred", stacked: "allowed" },
    [pairKey("lobby", "office")]: { side: "allowed", stacked: "allowed" },
    [pairKey("gathering", "gathering")]: { side: "allowed", stacked: "allowed" },
    [pairKey("office", "office")]: { side: "allowed", stacked: "allowed" },
    [pairKey("lobby", "lobby")]: { side: "avoid", stacked: "allowed" },
  },
  tilePairs: [],
  counts: { total: { min: 0, max: 0 }, perCategory: {}, perTile: {}, maxCopies: 3 },
  limits: { maxHeightFt: 0, maxFootprintFt: 0, maxOverhangFt: 0 },
  levelTolerance: "riser",
  rampRiseFt: 4,
  sequenceOrder: ["lobby", "gathering", "office"],
});

export const LEVEL_TOLERANCE_FT: Record<LevelTolerance, number> = { exact: 0.5, riser: 1.5, ramp: 4 };
/** How far two floors may differ and still count as one walkable level. */
export const toleranceFt = (rules: ProgramRules) => (rules.levelTolerance === "ramp" ? Math.max(rules.rampRiseFt, 1.5) : LEVEL_TOLERANCE_FT[rules.levelTolerance]);

// ---- generating --------------------------------------------------------------------------------------------------

/** Independent weights, 0 to 100 each. Circulation, sequence and joint quality are always on (not here). */
export interface Priorities {
  floors: number;
  program: number;
  daylight: number;
  compactness: number;
  variety: number;
  vertical: number;
  openness: number;
  structure: number;
}

export const defaultPriorities = (): Priorities => ({ floors: 60, program: 50, daylight: 40, compactness: 40, variety: 50, vertical: 30, openness: 30, structure: 50 });

export const PRIORITY_LABELS: { key: keyof Priorities; label: string; hint: string }[] = [
  { key: "floors", label: "Continuous floors", hint: "floors that meet at the same height across joints" },
  { key: "program", label: "Program fit", hint: "follow the adjacency rules (preferred beside preferred)" },
  { key: "daylight", label: "Daylight", hint: "spaces that open to the outside" },
  { key: "compactness", label: "Compactness", hint: "a tight mass rather than a sprawl" },
  { key: "variety", label: "Variety of tiles", hint: "use many different tiles" },
  { key: "vertical", label: "Vertical mix", hint: "more levels, pieces stacked above each other" },
  { key: "openness", label: "Openness to outside", hint: "more opening area on the outer faces" },
  { key: "structure", label: "Structural soundness", hint: "no hanging or poorly supported pieces" },
];

export type ShapeKind = "compact" | "spineV" | "spineH" | "courtyard" | "stepped" | "cascade" | "slab" | "village" | "bridge" | "free";

export const SHAPES: { key: ShapeKind; label: string; hint: string }[] = [
  { key: "compact", label: "Compact / chunks", hint: "clusters of pieces packed tightly" },
  { key: "spineV", label: "Spine, vertical", hint: "a tower: pieces stacked, a few beside" },
  { key: "spineH", label: "Spine, horizontal", hint: "a long bar along one direction" },
  { key: "courtyard", label: "Courtyard", hint: "a ring of pieces around an open middle" },
  { key: "stepped", label: "Stepped", hint: "terraces rising along a direction" },
  { key: "cascade", label: "Cascade / slope", hint: "heights falling steadily along a direction" },
  { key: "slab", label: "Slab", hint: "wide layers stacked" },
  { key: "village", label: "Village", hint: "several small towers on a shared base" },
  { key: "bridge", label: "Bridge", hint: "a raised span across a gap" },
  { key: "free", label: "Free-form", hint: "no overall shape, just good joints" },
];

export interface GenSettings {
  amount: number;
  seed: number;
  shape: ShapeKind;
  /** 0 +X, 1 +Y, 2 -X, 3 -Y: the direction stepped, cascade and the horizontal spine run in. */
  direction: number;
  /** The lowest joint score accepted (relaxed in steps when nothing fits). */
  minScore: number;
  /** true: Generate keeps using `seed` (same settings, same result). Default: every Generate picks a new random seed. */
  seedLocked?: boolean;
}

export const defaultGen = (): GenSettings => ({ amount: 8, seed: 1, shape: "compact", direction: 0, minScore: 40 });

// ---- site, smoothing, joints, warnings ---------------------------------------------------------------------------

export interface Site {
  enabled: boolean;
  /** low corner on the ground, ft */
  min: [number, number];
  size: [number, number];
  /** ft, 0 = no limit */
  maxHeight: number;
}

export const defaultSite = (): Site => ({ enabled: false, min: [-20, -20], size: [120, 120], maxHeight: 0 });

export interface SmoothSettings {
  /** Close gaps between openings that miss each other by up to this much, ft. */
  toleranceFt: number;
  /** Foam fragments smaller than this are offered for removal, ft3 (0 = every disconnected fragment). */
  minFoamFt3: number;
  /** Sealed void pockets smaller than this are offered for filling, ft3. */
  minVoidFt3: number;
  /** Floaters the user approved (removed) and rejected (kept), by key. */
  approved: string[];
  rejected: string[];
}

export const defaultSmooth = (): SmoothSettings => ({ toleranceFt: 1, minFoamFt3: 0, minVoidFt3: 6, approved: [], rejected: [] });

export interface JointParts {
  /** void against void (the program's long-standing rule), 0-100 or null when nothing opens onto the joint */
  void: number | null;
  /** floors meeting at the same height */
  floors: number | null;
  /** foam touching foam */
  foam: number | null;
  /** an opening that is a route end meeting one on the other side */
  circulation: number | null;
}

export interface Joint {
  id: string;
  aId: string;
  bId: string;
  /** The axis the two pieces touch across (0 x, 1 y, 2 z); a is the lower side. */
  axis: 0 | 1 | 2;
  /** feet: the contact rectangle (zero thickness along `axis`) */
  min: Vec3;
  max: Vec3;
  areaFt2: number;
  parts: JointParts;
  score: number | null;
  /** the old void-on-void number, for comparison */
  legacy: number | null;
  /** at least one opening of 4 ft2 or more meets an opening on the other side */
  walkable: boolean;
  /** the largest floor height difference across the joint, ft (null: no floors meet) */
  floorStepFt: number | null;
  rating: Rating | null;
}

export type WarningKind = "disconnected" | "unreachable" | "never" | "overlap" | "level" | "dead-end" | "hanging" | "site" | "counts" | "limit" | "tile";

export interface ArrangeWarning {
  id: string;
  kind: WarningKind;
  severity: "error" | "warn" | "info";
  message: string;
  pieceIds: string[];
  jointId?: string;
}

export const ratingFor = (score: number | null): "sealed" | "poor" | "partial" | "interlocks" => (score === null ? "sealed" : score >= 90 ? "interlocks" : score >= 60 ? "partial" : "poor");

export function aggregateScore(scores: (number | null)[]): number | null {
  const real = scores.filter((s): s is number => s !== null);
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

/** A saved arrangement, kept with the project like the Builder's saved objects. */
export interface SavedArrangement {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  doc: ArrangementDoc;
  /** the tile ids the arrangement uses, so a missing tile can be reported when reopening */
  gen: GenSettings;
  priorities: Priorities;
  rules: ProgramRules;
  site: Site;
  smooth: SmoothSettings;
  /** Small PNG data URL */
  thumb?: string;
  /** the id of the bank tile this was added as (so "Add as tile" can update rather than duplicate) */
  tileId?: string;
}

/** The shape the legacy smooth (lib/exporters/csgFuse.ts, untouched) still takes: a piece placed by its centre. */
export interface PlacedInstance {
  id: string;
  tileId: string;
  gridPos: [number, number, number];
  /** feet: the centre of the piece's box */
  posFt: Vec3;
  scale: number;
  /** letters x/y/z */
  mirror: string;
  rotZ: number;
  tilt?: { axis: "x" | "y"; steps: number };
  parentJointId?: string;
}
