// Comparing variants. Tiles are compared within a typology (the variants of one idea), with the same criteria and assumptions. The fifteen
// typologies are NOT ranked against each other: a stepped amphitheater and a continuous hall are not meant to have the same qualities.
//
// Three different things are kept apart, because a bigger number is not better architecture:
//
//   STRENGTH     how strongly a spatial quality is present (the measurement and the scale word it falls on). Descriptive: it never says "better".
//   FIT          how close that value is to what THIS typology is about: a target range, "more up to a point", "less up to a point", or nothing at
//                all where no preference can be defended (more setbacks, more retained mass, a bigger generating dose are not better by themselves).
//                The rules are SYSTEM ASSUMPTIONS informed by the typology's name and category: shown beside every comparison, not assignment
//                requirements, and each can be overridden for a typology and restored.
//   USABILITY    whether the space can be used: floor reached on foot, void reached, floor zones and levels joined to the way in (the shared walking
//                rules). Always shown with any recommendation; a variant cannot be recommended over another that is clearly more usable without
//                saying so.
//
// A pick is made only where the evidence supports it: decisive criteria (measured or inferred, with a rule) that the typology is about, assessable
// for every variant, on which one variant is meaningfully closer to the target and not meaningfully worse on any other decisive criterion, with no
// usability disadvantage. Proxies and assumptions are supporting evidence only: they can add to a tradeoff but never decide. Otherwise the answer is a
// tie or a tradeoff, and the tradeoffs are written out. A missing result is never a zero: a criterion that cannot be assessed for one variant is not
// used to compare any, and is listed as such. Nothing is normalised to the variants' own minimum and maximum, so a tiny difference never becomes
// decisive because it was stretched over 0..1.

import type { ParsedTile } from "@/lib/types";
import { MATRIX, type MatrixKey, type MatrixStatus } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
import type { UsableSpace } from "@/lib/scoring/usable";
import { shortName } from "@/lib/scoring/compare";
import { INTENT } from "@/lib/scoring/profile";

/** The typology a tile is a variant of: the engine's typology (or the one guessed from the name) without any "V2" suffix. */
export function typologyKey(tile: ParsedTile): string {
  const t = tile.meta?.typology ?? tile.guessed.typology ?? tile.name;
  return t.replace(/_v\d+$/i, "").replace(/[_\s]+/g, " ").trim().toLowerCase();
}

export interface TypologyGroup {
  key: string;
  label: string;
  tiles: ParsedTile[];
}

export function typologyGroups(tiles: ParsedTile[]): TypologyGroup[] {
  const m = new Map<string, TypologyGroup>();
  for (const t of tiles) {
    const k = typologyKey(t);
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, label: shortName(t), tiles: [] }));
    g.tiles.push(t);
  }
  return [...m.values()];
}

// ---- the preference rules ---------------------------------------------------------------------------------------------------------------------------

export type PreferenceMode = "higher" | "lower" | "target" | "descriptive";

/** What counts as a good value of a criterion for a typology. `lo` and `hi` are in the measurement's own unit. */
export interface Preference {
  mode: PreferenceMode;
  /** target: the range that fits fully. higher: fit rises from lo to hi and stays full above (more stops mattering at hi). lower: full up to lo, none at hi. */
  lo?: number;
  hi?: number;
  /** why, in words (shown beside the comparison) */
  why: string;
}

/** What you may set per typology and criterion (saved with the project): the same shape, without the generated reason. */
export interface PreferenceOverride {
  mode: PreferenceMode;
  lo?: number;
  hi?: number;
  why?: string;
}

export type PreferenceSource = "system assumption" | "your override";

/** The smallest difference in a criterion's measurement that is real rather than voxel noise: below it two variants are the same on that criterion. */
const RESOLUTION: Record<MatrixKey, number> = {
  carved: 4, // % points
  stepped: 0.3, // setbacks per 10 ft
  porous: 3,
  continuous: 4, // % points of continuity
  resistant: 8, // % of the plan
  threaded: 1,
  graduated: 1,
  nonHierarchical: 1,
  forceDriven: 5, // % points of the dose
  lightFilled: 2,
  monumental: 0.15,
  spatialDensity: 0.07,
};

/** A fit difference smaller than this is not a difference (0..1 fit scale). */
const MEANINGFUL_FIT = 0.15;
/** How much clearer the leader must be, in weighted fit, before a pick is made. */
const PICK_MARGIN = 0.15;
/** A usable-floor share difference that counts as a real usability difference. */
const USABLE_GAP = 0.15;

interface RuleSet {
  /** words in the typology (name and category) that make the criterion relevant to it, and what is preferred then */
  about: Preference;
  /** what to say when the typology is not about it */
  otherwise: Preference;
}

const none = (why: string): Preference => ({ mode: "descriptive", why });

/** The system's default preferences per criterion: informed by whether the typology is about the quality, and always a range, never "as much as possible". */
const RULES: Record<MatrixKey, RuleSet> = {
  carved: {
    about: { mode: "target", lo: 40, hi: 65, why: "A typology about carving wants a hollowed mass: about 40 to 65% of the block carved void; less is a solid with pockets, more is a shell." },
    otherwise: none("This typology is not about carving, so how hollow it is is described, not preferred."),
  },
  stepped: {
    about: { mode: "target", lo: 1.5, hi: 6, why: "Setbacks read as legible terraces at roughly 1.5 to 6 per 10 ft of height; fewer is a plain section, many more is noise rather than more terracing." },
    otherwise: none("More setbacks do not make a better building unless the typology is about stepping, so the count is described, not preferred."),
  },
  porous: {
    about: { mode: "target", lo: 10, hi: 40, why: "A porous typology wants visible openness across levels without losing its walls: about 10 to 40% of the void's wall area open." },
    otherwise: none("Openness is not preferred for this typology: walls and openings are both legitimate."),
  },
  continuous: {
    about: { mode: "higher", lo: 60, hi: 95, why: "A continuous typology wants its space and its walkable floor to be one connected body: about 60% rising to 95% or more of each in one piece." },
    otherwise: none("Continuity of space is not preferred for this typology: separate rooms and one connected space are both legitimate."),
  },
  resistant: {
    about: { mode: "target", lo: 30, hi: 150, why: "A typology built around retained floors wants them present and legible without taking over: about 30 to 150% of the plan (up to one and a half floors' worth), the ground slab not counted." },
    otherwise: none("More retained floor is not better by itself: it is described, not preferred."),
  },
  threaded: {
    about: { mode: "higher", lo: 0, hi: 2, why: "A typology about meeting public program above the ground floor wants at least two instances; more adds nothing to the quality (this rests on an assumption about which program is public)." },
    otherwise: none("Public program above ground is not preferred for this typology."),
  },
  graduated: {
    about: { mode: "target", lo: 1, hi: 3, why: "A graduated typology wants a smooth transition in a few steps (about 1 to 3 enclosure steps from the way in outward); none is uniform, many is fussy (a proxy: private and public are not assigned)." },
    otherwise: none("The number of enclosure steps is not preferred for this typology."),
  },
  nonHierarchical: {
    about: { mode: "target", lo: 2, hi: 5, why: "A typology about choice of path wants at least two distinct routes; beyond about five more routes do not feel more equally valid." },
    otherwise: none("The number of routes is not preferred for this typology."),
  },
  forceDriven: {
    about: none("A larger generating input is not a more legible force: the dose is described, never preferred."),
    otherwise: none("A larger generating input is not a more legible force: the dose is described, never preferred."),
  },
  lightFilled: {
    about: { mode: "target", lo: 4, hi: 30, why: "A light-filled typology wants a clear roof opening over its floor (about 4 to 30% of it, unglazed in the model); far more is a courtyard, not a lit room. Not a daylight simulation." },
    otherwise: none("Roof opening is not preferred for this typology."),
  },
  monumental: {
    about: { mode: "higher", lo: 0.8, hi: 2.5, why: "A vertical or monumental typology wants a tall void relative to its width (a ratio of about 0.8 up to 2.5); beyond that it is a slot, not a bigger space." },
    otherwise: none("Height-to-width is not preferred for this typology."),
  },
  spatialDensity: {
    about: { mode: "target", lo: 0.1, hi: 0.5, why: "A typology about compression and release wants a clear contrast between its narrowest and widest passage (a ratio of about 0.1 to 0.5); a ratio near 1 is no contrast, near 0 is a crack." },
    otherwise: none("Contrast of passage widths is not preferred for this typology."),
  },
};

/** Typologies whose name says the opposite of the general rule for one criterion (a flat plate wants no terraces, an open hall wants an even width). */
const SPECIAL: { words: RegExp; key: MatrixKey; pref: Preference }[] = [
  { words: /flat|deep.?plan|slab|open hall|continuous hall/i, key: "stepped", pref: { mode: "target", lo: 0, hi: 1, why: "A flat or open plan wants a plain section: at most about 1 setback per 10 ft." } },
  { words: /open hall|flat|deep.?plan|continuous|linear|gallery/i, key: "spatialDensity", pref: { mode: "target", lo: 0.65, hi: 1, why: "An open or continuous typology wants an even width along its route (a ratio near 1), not a squeeze." } },
  { words: /cascad|terrac|amphi|tier|step/i, key: "stepped", pref: { mode: "target", lo: 2, hi: 8, why: "A stepped or terraced typology wants its setbacks legible: roughly 2 to 8 per 10 ft of height." } },
];

const WORDS: Partial<Record<MatrixKey, RegExp>> = {
  stepped: /step|terrac|cascad|amphi|tier|ramp|flat|deep.?plan|slab/i,
  spatialDensity: /compress|sequen|thresh|narrow|squeez|funnel|open hall|flat|deep.?plan|continuous|linear|gallery/i,
  graduated: /compress|sequen|step|terrac|thresh|gradua/i,
  monumental: /void|vertical|atrium|shaft|tower/i,
  lightFilled: /void|vertical|atrium|shaft|field|open|light/i,
  porous: /void|field|open|edge|porous|lattice/i,
  continuous: /continu|hall|linear|gallery|flow/i,
  nonHierarchical: /field|open|hall|network|continu|gallery|linear|work/i,
  resistant: /plate|contain|room within|core|inserted|mezz|retain/i,
  threaded: /thread|stack|vertical|edge|gallery|linear/i,
  carved: /carv|cave|grotto|topograph|ground|field/i,
};

/** The rule in force for one criterion of one typology: your override if you set one, else the system's assumption for this typology. */
export function preferenceFor(typology: string, key: MatrixKey, override?: PreferenceOverride): { pref: Preference; source: PreferenceSource } {
  if (override) return { pref: { mode: override.mode, lo: override.lo, hi: override.hi, why: override.why ?? "set by you for this typology" }, source: "your override" };
  const special = SPECIAL.find((s) => s.key === key && s.words.test(typology));
  if (special) return { pref: special.pref, source: "system assumption" };
  const about = WORDS[key]?.test(typology) ?? false;
  return { pref: about ? RULES[key].about : RULES[key].otherwise, source: "system assumption" };
}

/** How close a value is to what the rule prefers, 0..1; null where the rule has no preference. Absolute, never relative to the other variants. */
export function fitOf(pref: Preference, v: number): number | null {
  if (pref.mode === "descriptive" || pref.lo === undefined || pref.hi === undefined) return null;
  const { lo, hi } = pref;
  if (pref.mode === "higher") return v >= hi ? 1 : v <= lo ? 0 : (v - lo) / (hi - lo);
  if (pref.mode === "lower") return v <= lo ? 1 : v >= hi ? 0 : 1 - (v - lo) / (hi - lo);
  // target: full inside the range, falling to nothing over one range-width (at least half the top of the range) outside it
  if (v >= lo && v <= hi) return 1;
  const fall = Math.max(hi - lo, Math.abs(hi) * 0.5, 1e-6);
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / fall);
}

/** The preference as a short phrase for the screen and the boards. */
export function describePreference(p: Preference): string {
  if (p.mode === "descriptive") return "described, not preferred";
  if (p.mode === "target") return `target ${p.lo}–${p.hi}`;
  if (p.mode === "higher") return `more up to ${p.hi}`;
  return `less, full to ${p.lo}`;
}

// ---- the comparison ---------------------------------------------------------------------------------------------------------------------------------

export type Role = "decisive" | "supporting" | "descriptive";

const roleOf = (status: MatrixStatus, pref: Preference): Role => (pref.mode === "descriptive" ? "descriptive" : status === "measured" || status === "inferred" ? "decisive" : "supporting");

export interface VariantRow {
  tile: string;
  id: string;
  headline: string;
  status: MatrixStatus;
  /** how strongly the quality is present, in the measurement's own scale words (descriptive: not a judgement) */
  strength: string;
  value: number | null;
  /** how close to the target, 0..1 (null: no preference, or not assessable) */
  fit: number | null;
  /** where it stands against the rule, in words */
  against: "within" | "near" | "outside" | "no preference" | "not assessable";
}

export interface CriterionComparison {
  key: MatrixKey;
  name: string;
  pref: Preference;
  source: PreferenceSource;
  role: Role;
  /** what the rule is, in a phrase */
  rule: string;
  rows: VariantRow[];
  /** the variant meaningfully closest to the target on this criterion (null: no preference, not assessable for every variant, or no meaningful difference) */
  leader: string | null;
  /** why this criterion was not used to compare (when it was not) */
  notUsed: string | null;
}

export interface UsabilityRow {
  tile: string;
  id: string;
  available: boolean;
  /** the share of the floor that can be reached on foot (null: no floor), and of the carved void */
  usableShare: number | null;
  reachableVoidShare: number | null;
  zonesReached: number;
  zones: number;
  levelsReached: number;
  levelsTotal: number;
  problems: string[];
}

export type Verdict = "pick" | "tradeoff" | "tie" | "single" | "insufficient";

export interface Pick {
  /** a variant is recommended: the evidence supports it */
  supported: boolean;
  tileId: string | null;
  verdict: Verdict;
  /** the generated reason (or why there is none), always followed by the usability of the variants */
  rationale: string;
  /** who leads on what, and what each costs: written out whenever no variant is justified, and kept beside a pick */
  tradeoffs: string[];
  basis: CriterionComparison[];
  usability: UsabilityRow[];
  /** the rules the comparison used, labelled as the system's assumptions or yours */
  assumptions: string[];
}

const pct0 = (v: number) => `${Math.round(v * 100)}%`;

export function usabilityOf(tile: ParsedTile, u: UsableSpace | undefined): UsabilityRow {
  const name = tile.name;
  if (!u || !u.available) return { tile: name, id: tile.id, available: false, usableShare: null, reachableVoidShare: null, zonesReached: 0, zones: 0, levelsReached: 0, levelsTotal: 0, problems: [u?.reason || "usable space could not be read"] };
  const usableShare = u.floorFt2 > 0 ? u.usableFt2 / u.floorFt2 : null;
  const reachableVoidShare = u.voidFt3 > 0 ? u.reachableVoidFt3 / u.voidFt3 : null;
  const problems: string[] = [];
  if (u.floorFt2 <= 0) problems.push("no floor was found");
  else if (u.usableFt2 <= 0) problems.push("none of its floor can be reached on foot");
  else {
    if (usableShare! < 0.5) problems.push(`only ${pct0(usableShare!)} of its floor can be reached on foot`);
    if (u.cutOffFt2 > 12) problems.push(`${Math.round(u.cutOffFt2)} ft² of floor is cut off from the way in`);
    if (u.tightFt2 > 12) problems.push(`${Math.round(u.tightFt2)} ft² of floor is too narrow or too low to use`);
  }
  if (u.zones > 0 && u.zonesReached < u.zones) problems.push(`${u.zones - u.zonesReached} of ${u.zones} floor zones are not joined to the way in`);
  if (u.levelsTotal > 1 && u.levelsReached < u.levelsTotal) problems.push(`${u.levelsReached} of ${u.levelsTotal} levels can be reached on foot`);
  return { tile: name, id: tile.id, available: true, usableShare, reachableVoidShare, zonesReached: u.zonesReached, zones: u.zones, levelsReached: u.levelsReached, levelsTotal: u.levelsTotal, problems };
}

const usabilityLine = (rows: UsabilityRow[]): string =>
  `Usability: ${rows.map((r) => `${r.tile} ${r.usableShare === null ? "no floor read" : `${pct0(r.usableShare)} of its floor reached on foot`}${r.problems.length ? ` (${r.problems.join("; ")})` : ""}`).join("; ")}.`;

const stronger = (r: MatrixResult): string => {
  const sc = r.interpretation.scale;
  const i = r.interpretation.index;
  return sc && i !== undefined && sc[i] ? sc[i] : r.measure.status === "unavailable" ? "not assessable" : "no scale";
};

/** The variants of one typology read with the carried criteria. `overrides` are the preferences you set for this typology (by criterion). */
export function suggestPick(group: TypologyGroup, evals: Map<string, TileEvaluation>, carried: MatrixKey[], overrides: Partial<Record<MatrixKey, PreferenceOverride>> = {}): Pick {
  const usability = group.tiles.map((t) => usabilityOf(t, evals.get(t.id)?.usable));
  const typology = group.key;
    if (group.tiles.length < 2) return { supported: false, tileId: group.tiles[0]?.id ?? null, verdict: "single", rationale: `Only one variant of this typology: nothing to choose between yet. ${usabilityLine(usability)}`, tradeoffs: [], basis: [], usability, assumptions: [] };

  // ---- every carried criterion, with its rule, read for every variant (a missing result is missing, never zero)
  const basis: CriterionComparison[] = carried.map((key) => {
    const { pref, source } = preferenceFor(typology, key, overrides[key]);
    const rs = group.tiles.map((t) => ({ t, r: evals.get(t.id)?.results.find((x) => x.key === key) }));
    const missing = rs.filter((x) => !x.r || x.r.measure.value === null || x.r.measure.status === "unavailable" || x.r.measure.status === "not-applicable");
    const status = rs.reduce<MatrixStatus>((worst, x) => (x.r && ["proxy", "assumed"].includes(x.r.measure.status) ? x.r.measure.status : worst), "measured");
    const role = roleOf(status, pref);
    const rows: VariantRow[] = rs.map(({ t, r }) => {
      const v = r && r.measure.value !== null && r.measure.status !== "unavailable" && r.measure.status !== "not-applicable" ? r.measure.value : null;
      const fit = v === null ? null : fitOf(pref, v);
      const against: VariantRow["against"] = v === null ? "not assessable" : fit === null ? "no preference" : fit >= 0.999 ? "within" : fit >= 0.6 ? "near" : "outside";
      return { tile: t.name, id: t.id, headline: r ? r.measure.headline : "not assessed", status: r?.measure.status ?? "unavailable", strength: r ? stronger(r) : "not assessable", value: v, fit, against };
    });
    let notUsed: string | null = null;
    if (pref.mode === "descriptive") notUsed = "no preference can be defended for this typology: described only";
    else if (missing.length) notUsed = `not assessable for ${missing.map((x) => x.t.name).join(", ")}, so it is not used to compare any of them (a missing result is not a zero)`;
    // the variant meaningfully closest to the target on this criterion
    let leader: string | null = null;
    if (!notUsed) {
      const withFit = rows.filter((r) => r.fit !== null);
      const best = withFit.reduce((a, b) => (b.fit! > a.fit! ? b : a), withFit[0]);
      const real = withFit.filter((r) => r !== best && Math.abs(r.value! - best.value!) >= RESOLUTION[key] && best.fit! - r.fit! >= MEANINGFUL_FIT);
      if (real.length === withFit.length - 1) leader = best.tile;
    }
    return { key, name: MATRIX.find((m) => m.key === key)!.name, pref, source, role, rule: describePreference(pref), rows, leader, notUsed };
  });
  const assumptions = basis.filter((b) => b.pref.mode !== "descriptive").map((b) => `${b.name}: ${b.rule} (${b.source}) — ${b.pref.why}`);

  const used = basis.filter((b) => !b.notUsed);
  const decisive = used.filter((b) => b.role === "decisive");
  const supporting = used.filter((b) => b.role === "supporting");
  const tradeoffs: string[] = [];
  const unusedNote = basis.filter((b) => b.notUsed && b.pref.mode !== "descriptive").map((b) => `${b.name} ${b.notUsed}.`);

  // usability: a real gap in the share of floor that can be used decides nothing by itself, but it is always said and it blocks a pick
  const rank = usability.filter((u) => u.usableShare !== null).sort((a, b) => b.usableShare! - a.usableShare!);
  const usabilityGap = rank.length >= 2 && rank[0].usableShare! - rank[rank.length - 1].usableShare! >= USABLE_GAP ? { best: rank[0], worst: rank[rank.length - 1] } : null;
  if (usabilityGap) tradeoffs.push(`${usabilityGap.best.tile} is the more usable: ${pct0(usabilityGap.best.usableShare!)} of its floor can be reached on foot against ${pct0(usabilityGap.worst.usableShare!)} for ${usabilityGap.worst.tile}.`);
  const blocked = usability.filter((u) => u.problems.length && (u.usableShare === null || u.usableShare < 0.5));

  if (!decisive.length || used.length < 2) {
    const why = decisive.length && used.length < 2 ? `only one criterion (${used[0].name}) has a preference that can be assessed for every variant of ${group.label.toLowerCase()}, which is not enough to choose between them` : used.length ? `only proxy or assumed measurements bear on ${group.label.toLowerCase()} here (${used.map((b) => b.name).join(", ")}), and those are not enough to decide` : `none of the carried criteria has a defensible preference for ${group.label.toLowerCase()} that can be assessed for every variant`;
    return { supported: false, tileId: null, verdict: "insufficient", rationale: `The evidence does not support a pick: ${why}. The variants are described, not ranked; choose by looking. ${[...unusedNote].join(" ")} ${usabilityLine(usability)}`.replace(/\s+/g, " ").trim(), tradeoffs: [...describeLeads(basis), ...tradeoffs], basis, usability, assumptions };
  }

  // ---- weighted fit per variant on the criteria that can decide (supporting ones count for half and can only add to a tradeoff, never carry one)
  const total = group.tiles.map((t) => {
    let sum = 0;
    let w = 0;
    for (const b of [...decisive, ...supporting]) {
      const row = b.rows.find((r) => r.id === t.id)!;
      const wt = b.role === "decisive" ? 1 : 0.5;
      sum += (row.fit ?? 0) * wt;
      w += wt;
    }
    let dsum = 0;
    for (const b of decisive) dsum += b.rows.find((r) => r.id === t.id)!.fit ?? 0;
    return { t, fit: w ? sum / w : 0, decisiveFit: decisive.length ? dsum / decisive.length : 0 };
  });
  const ranked = [...total].sort((a, b) => b.fit - a.fit);
  const lead = ranked[0];
  const next = ranked[1];
  const margin = lead.fit - next.fit;
  // does the leader fall behind another variant on any single decisive criterion, by a real amount?
  const behind = decisive.filter((b) => {
    const mine = b.rows.find((r) => r.id === lead.t.id)!;
    return b.rows.some((r) => r.id !== lead.t.id && r.fit !== null && mine.fit !== null && r.fit - mine.fit >= MEANINGFUL_FIT && Math.abs((r.value ?? 0) - (mine.value ?? 0)) >= RESOLUTION[b.key]);
  });
  const leads = describeLeads(basis);
  const supportingNote = supporting.length ? ` Proxy or assumed evidence (${supporting.map((b) => b.name).join(", ")}) counts for half and cannot decide on its own.` : "";

  if (margin < PICK_MARGIN || decisive.every((b) => !b.leader)) {
    // is it a true tie (the same on everything) or do the variants each win somewhere?
    const anyLeader = used.some((b) => b.leader);
    return {
      supported: false,
      tileId: null,
      verdict: anyLeader ? "tradeoff" : "tie",
      rationale: `${anyLeader ? "Each variant is closer to the target on something, and none is clearly ahead" : "The variants are the same on every criterion that has a preference (any differences are smaller than the measurement can tell apart)"}: the evidence does not support a pick.${supportingNote} ${unusedNote.join(" ")} ${usabilityLine(usability)}`.replace(/\s+/g, " ").trim(),
      tradeoffs: [...leads, ...tradeoffs],
      basis,
      usability,
      assumptions,
    };
  }
  if (behind.length) {
    return {
      supported: false,
      tileId: null,
      verdict: "tradeoff",
      rationale: `${lead.t.name} is closest to the typology's targets overall, but another variant is clearly closer on ${behind.map((b) => b.name).join(", ")}: a tradeoff, not a winner.${supportingNote} ${unusedNote.join(" ")} ${usabilityLine(usability)}`.replace(/\s+/g, " ").trim(),
      tradeoffs: [...leads, ...tradeoffs],
      basis,
      usability,
      assumptions,
    };
  }
  const leaderUse = usability.find((u) => u.id === lead.t.id)!;
  if ((usabilityGap && usabilityGap.best.id !== lead.t.id) || (blocked.some((u) => u.id === lead.t.id) && usability.some((u) => !blocked.includes(u)))) {
    return {
      supported: false,
      tileId: null,
      verdict: "tradeoff",
      rationale: `${lead.t.name} is closest to the typology's targets, but it is the less usable: ${leaderUse.problems.join("; ") || "another variant can be reached on foot more fully"}. A recommendation is not justified while another variant is clearly more usable.${supportingNote} ${usabilityLine(usability)}`.replace(/\s+/g, " ").trim(),
      tradeoffs: [...leads, ...tradeoffs],
      basis,
      usability,
      assumptions,
    };
  }
  const winsOn = decisive.filter((b) => b.leader === lead.t.name).map((b) => b.name);
  return {
    supported: true,
    tileId: lead.t.id,
    verdict: "pick",
    rationale: `${lead.t.name} is the suggested variant of ${group.label.toLowerCase()}: it is closest to the targets on ${winsOn.length ? winsOn.join(", ") : "the criteria that bear on this typology"} (${(lead.fit * 100).toFixed(0)} against ${(next.fit * 100).toFixed(0)} out of 100 for ${next.t.name}), and no other variant is clearly better on a decisive criterion.${supportingNote} The targets are the system's assumptions for this typology (see below), not requirements of the assignment, and this is a suggestion to look at, not a ranking against other typologies. ${unusedNote.join(" ")} ${usabilityLine(usability)}`.replace(/\s+/g, " ").trim(),
    tradeoffs: [...leads, ...tradeoffs],
    basis,
    usability,
    assumptions,
  };
}

/** Who leads on what, in a line each: the tradeoffs written out. */
function describeLeads(basis: CriterionComparison[]): string[] {
  const out: string[] = [];
  for (const b of basis) {
    if (b.notUsed) continue;
    if (b.leader) {
      const lead = b.rows.find((r) => r.tile === b.leader)!;
      const rest = b.rows.filter((r) => r.tile !== b.leader).map((r) => `${r.tile} ${r.headline}`);
      out.push(`${b.name} (${b.rule}, ${b.source}): ${b.leader} is closer — ${lead.headline} against ${rest.join("; ")}${b.role === "supporting" ? " [proxy or assumed: counts for half]" : ""}.`);
    } else out.push(`${b.name} (${b.rule}): no meaningful difference between the variants.`);
  }
  return out;
}

// ---- what the typology is about, in words ----------------------------------------------------------------------------------------------------------------

/** A line on what the typology is about, from its name and category and what that makes relevant. Generated, not a record of the design intent: write the real one and it is used instead. */
export function intentionText(group: TypologyGroup, written?: string): { text: string; written: boolean } {
  if (written && written.trim()) return { text: written.trim(), written: true };
  const tile = group.tiles[0];
  const cat = tile?.meta?.category ?? tile?.guessed.category;
  const hits = INTENT.filter((i) => i.words.test(`${group.key} ${tile?.name ?? ""}`));
  const catWord = cat === "gathering" ? "a place to gather" : cat === "office" ? "a workspace" : cat === "lobby" ? "an entry and threshold" : cat === "assembly" ? "an assembled building" : "";
  if (!hits.length && !catWord) return { text: `No spatial intention is recorded for ${group.label.toLowerCase()}: the criteria are chosen from the evidence alone.`, written: false };
  const names = [...new Set(hits.flatMap((h) => h.keys))].map((k) => MATRIX.find((m) => m.key === k)?.name).filter(Boolean);
  return {
    text: `${group.label} reads from its name as ${[catWord, ...hits.map((h) => h.why)].filter(Boolean).join(" and ")}${names.length ? `, so ${names.slice(0, 5).join(", ")} are the criteria it is most about` : ""}. This is read from the name and category; write the intention to replace it.`,
    written: false,
  };
}
