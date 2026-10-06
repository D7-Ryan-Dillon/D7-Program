// The evaluation framework: Assignment 1 Part 3's matrix, kept word for word. It is the authority for what each descriptor MEANS;
// everything else in lib/scoring is how the app measures or approximates it, and says so (matrixEval.ts).
//
//   Descriptor   the spatial quality
//   Qualitative  how that quality is perceived
//   Quantitative the measurement used to evaluate it
//   Precedent    the original reference supporting the criterion
//
// The wording below is the project's own and is not edited by the app: boards and exports quote it as it stands. The twelfth descriptor is the project's
// "Spatial density" (the matrix's "compressed-then-released" quality, renamed by the team on purpose): its criteria are the passage-width ratio below,
// never occupancy, rooms per volume or a solid-to-void ratio.

export type MatrixKey =
  | "carved" | "stepped" | "porous" | "continuous" | "resistant"
  | "threaded" | "graduated" | "nonHierarchical" | "forceDriven"
  | "lightFilled" | "monumental" | "spatialDensity";

export type MatrixGroup = "Formal / geometrical" | "Organizational / spatial" | "Experiential / atmospheric";

export interface MatrixCriterion {
  key: MatrixKey;
  group: MatrixGroup;
  /** the descriptor, as the matrix names it */
  name: string;
  /** how the quality is perceived */
  qualitative: string;
  /** the measurement used to evaluate it */
  quantitative: string;
  /** the reference that supports the criterion */
  precedent: string;
}

export const MATRIX: MatrixCriterion[] = [
  // FORMAL / GEOMETRICAL
  { key: "carved", group: "Formal / geometrical", name: "Carved", qualitative: "Perceived sense the void was subtracted from solid mass.", quantitative: "Percentage of void surface that is seamless versus paneled.", precedent: "Gilder Center’s unbroken shotcrete." },
  { key: "stepped", group: "Formal / geometrical", name: "Stepped / Terraced", qualitative: "Legibility of successive setbacks in section.", quantitative: "Number of distinct setback increments per building height.", precedent: "Namba Parks canyon section." },
  { key: "porous", group: "Formal / geometrical", name: "Porous", qualitative: "Perceived visual permeability across levels.", quantitative: "Percentage of void wall area occupied by openings/bridges versus solid.", precedent: "Gilder Center’s bridges and vaulted openings." },
  { key: "continuous", group: "Formal / geometrical", name: "Continuous", qualitative: "Absence of perceptible material joints.", quantitative: "Number of visible seams per 10 m of surface.", precedent: "Shotcrete versus panel systems." },
  { key: "resistant", group: "Formal / geometrical", name: "Retained / Resistant", qualitative: "Clarity that one element resists the surrounding erosion.", quantitative: "Percentage of floor area/volume occupied by the retained solid.", precedent: "Namba Parks tower; office cores at Valley." },
  // ORGANIZATIONAL / SPATIAL
  { key: "threaded", group: "Organizational / spatial", name: "Threaded", qualitative: "Sense that public program is encountered continuously, not just at entry.", quantitative: "Number of public program instances located above ground floor.", precedent: "Valley aboveground circulation and shops." },
  { key: "graduated", group: "Organizational / spatial", name: "Graduated", qualitative: "Smoothness of transition between enclosed and open zones.", quantitative: "Number of discrete enclosure “steps” from private to public.", precedent: "Distance to get from outside to the office at Valley." },
  { key: "nonHierarchical", group: "Organizational / spatial", name: "Non-hierarchical Circulation", qualitative: "Degree to which multiple paths feel equally valid.", quantitative: "Number of distinct routes from entry to a given destination.", precedent: "Gilder Center’s bridge network." },
  { key: "forceDriven", group: "Organizational / spatial", name: "Force-driven", qualitative: "Legibility of the generating force in the final form.", quantitative: "Measurable input used to generate geometry, such as required sun-hours or pedestrian counts.", precedent: "Namba Parks and Valley force diagrams." },
  // EXPERIENTIAL / ATMOSPHERIC
  { key: "lightFilled", group: "Experiential / atmospheric", name: "Light-filled", qualitative: "Perceived brightness/quality of daylight at the void’s base.", quantitative: "Skylight area as a percentage of void floor area below it.", precedent: "Gilder Center’s oval skylights; Valley’s grotto skylights/reflecting pools." },
  { key: "monumental", group: "Experiential / atmospheric", name: "Monumental", qualitative: "Perceived significance communicated by scale.", quantitative: "Void height-to-width ratio, or void volume as a percentage of total building volume.", precedent: "Gilder Center’s five-story atrium." },
  { key: "spatialDensity", group: "Experiential / atmospheric", name: "Spatial density", qualitative: "Perceived contrast between narrowest and widest moments.", quantitative: "Ratio of narrowest to widest passage width along the sequence.", precedent: "Gilder Center entrance to exhibit threshold." },
];

export const MATRIX_KEYS: MatrixKey[] = MATRIX.map((m) => m.key);
export const matrixOf = (key: string): MatrixCriterion | undefined => MATRIX.find((m) => m.key === key);

/** How a number came to be. Shown beside every measurement; a result is never presented as better evidence than its status. */
export type MatrixStatus = "measured" | "inferred" | "proxy" | "assumed" | "unavailable" | "not-applicable";

export const STATUS_LABEL: Record<MatrixStatus, string> = {
  measured: "measured",
  inferred: "inferred",
  proxy: "proxy",
  assumed: "assumed",
  unavailable: "not assessable",
  "not-applicable": "not applicable",
};

export const STATUS_HELP: Record<MatrixStatus, string> = {
  measured: "counted or measured directly from the tile's geometry in the way the matrix describes",
  inferred: "worked out from the geometry and the recipe by a stated rule, not counted literally",
  proxy: "the matrix's measurement cannot be taken literally at this stage; an adapted measurement stands in for it (what it measures, and what it cannot show, are stated)",
  assumed: "relies on an assumption that is visible and can be changed (for example, which program categories are public)",
  unavailable: "the files do not contain what the matrix measurement needs; nothing is substituted",
  "not-applicable": "the criterion does not apply to this tile",
};

/** Evidence quality, best first (used when criteria are suggested: a criterion backed by better evidence is worth more). */
export const STATUS_RELIABILITY: Record<MatrixStatus, number> = { measured: 1, inferred: 0.75, proxy: 0.6, assumed: 0.45, unavailable: 0, "not-applicable": 0 };
