// The evaluation profile: what a comparison set of tiles is read with, kept so every tile in it is read the same way.
//
//   adopted     the criteria carried forward for this phase and why (suggested automatically when the first tiles arrive, with the basis they were
//               suggested from). New tiles are evaluated against it at once. When the tiles change what would be suggested, the change is SHOWN
//               (never applied silently) and one click adopts it and recomputes the whole set.
//   overrides   everything you changed, each independent of the others and each restorable to automatic: pins on or off, the reason text, an
//               interpretation, a threshold or assumption, a route, a room's class, the tile picked for a typology. Overrides survive recomputation.
// Nothing here has to be touched for the analysis, the comparison, the boards or the exports to work.

import type { ParsedTile } from "@/lib/types";
import { DEFAULT_ASSUMPTIONS, mergeAssumptions, type Assumptions } from "@/lib/scoring/assumptions";
import { MATRIX, STATUS_RELIABILITY, type MatrixKey } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
import type { RouteOverride0 } from "@/lib/scoring/voxelFacts";
import { shortName } from "@/lib/scoring/compare";

export interface Adopted {
  keys: MatrixKey[];
  /** why each carried criterion is carried / each set aside is set aside, as generated at adoption */
  reasons: Partial<Record<MatrixKey, string>>;
  setAside: Partial<Record<MatrixKey, string>>;
  /** the tiles (ids) it was suggested from */
  basis: string[];
  at: number;
}

export interface Overrides {
  pins: Partial<Record<MatrixKey, "on" | "off">>;
  /** a reason you wrote (replaces the generated one) */
  reasons: Partial<Record<MatrixKey, string>>;
  /** an interpretation you wrote, by tile id */
  interpretations: Record<string, Partial<Record<MatrixKey, string>>>;
  /** assumptions or thresholds you changed (only the changed ones: deleting a field restores the automatic value) */
  assumptions: Partial<Assumptions>;
  /** a route you chose, by tile id */
  routes: Record<string, RouteOverride0>;
  /** the tile you chose for a typology, by typology key, and why */
  picks: Record<string, string>;
  pickReasons: Record<string, string>;
  /** the spatial intention you wrote for a typology (replaces the generated line), by typology key */
  intentions: Record<string, string>;
}

export interface EvaluationProfile {
  version: 1;
  adopted: Adopted | null;
  overrides: Overrides;
  /** what was carried over from an older project, in words (shown once) */
  migration?: { notes: string[]; dismissed?: boolean };
}

export const emptyOverrides = (): Overrides => ({ pins: {}, reasons: {}, interpretations: {}, assumptions: {}, routes: {}, picks: {}, pickReasons: {}, intentions: {} });
export const defaultProfile = (): EvaluationProfile => ({ version: 1, adopted: null, overrides: emptyOverrides() });

/** The assumptions in force: the automatic ones with your changes on top. */
export const effectiveAssumptions = (p: EvaluationProfile): Assumptions => mergeAssumptions(p.overrides.assumptions);

// ---- suggesting the criteria --------------------------------------------------------------------------------------------------------------------

/** Words in a typology or name that say what a tile is about, and the criteria they make relevant (the spatial intentions of the typologies). */
export const INTENT: { words: RegExp; keys: MatrixKey[]; why: string }[] = [
  { words: /step|terrac|cascad|amphi|tier|ramp/i, keys: ["stepped", "graduated"], why: "stepped or terraced" },
  { words: /compress|sequen|thresh|narrow|squeez|funnel/i, keys: ["compressed", "graduated", "nonHierarchical"], why: "a sequence of compression and release" },
  { words: /void|vertical|atrium|shaft|tower|field/i, keys: ["monumental", "lightFilled", "porous"], why: "a void or vertical space" },
  { words: /continu|hall|linear|gallery|edge|flow/i, keys: ["continuous", "nonHierarchical", "threaded"], why: "a continuous or linear space" },
  { words: /plate|contain|room within|core|inserted|mezz/i, keys: ["resistant", "threaded", "carved"], why: "a retained or inserted element" },
  { words: /topograph|ground|field|fold|undulat|carv|cave|grotto/i, keys: ["carved", "porous", "forceDriven"], why: "a carved or landscape-like space" },
  { words: /open|work|deep|plan/i, keys: ["lightFilled", "porous", "nonHierarchical"], why: "an open workspace" },
];

export interface CriterionStat {
  key: MatrixKey;
  name: string;
  /** share of tiles it could be assessed for (any status but not assessable / not applicable) */
  availability: number;
  /** how good the evidence is when it exists, 0..1 (measured 1 ... assumed 0.45) */
  reliability: number;
  /** how much it tells the tiles apart, 0..1 (spread of the measured values) */
  spread: number;
  /** how many of the tiles' typologies make it relevant, 0..1 */
  relevance: number;
  /** the strongest overlap with another criterion's values across tiles, 0..1 (only trusted with six or more tiles) */
  overlap: { with: MatrixKey; r: number } | null;
  /** the combined usefulness, 0..1 */
  value: number;
  /** the tiles' values, for the explanation */
  values: { tile: string; value: number | null; unit: string }[];
}

const correlation = (a: number[], b: number[]): number => {
  const n = a.length;
  if (n < 6) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
};

/** Relative spread of some values, 0..1: their range over their typical size (so 0.5 ft against 2 ft counts as much as 5 against 20). */
const relSpread = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const scale = Math.max(Math.abs(hi), Math.abs(lo), 1e-9);
  return Math.max(0, Math.min(1, (hi - lo) / scale));
};

export function criterionStats(tiles: ParsedTile[], evals: TileEvaluation[]): CriterionStat[] {
  const n = tiles.length;
  const base = MATRIX.map((m) => {
    const rs = evals.map((e) => e.results.find((r) => r.key === m.key)!);
    const ok = rs.map((r) => r.measure.status !== "unavailable" && r.measure.status !== "not-applicable" && r.measure.value !== null);
    const vals = rs.map((r, i) => (ok[i] ? r.measure.value! : NaN));
    const finite = vals.filter((v) => Number.isFinite(v));
    const rel = rs.filter((_, i) => ok[i]).map((r) => STATUS_RELIABILITY[r.measure.status]);
    const intent = tiles.map((t) => INTENT.some((i) => i.keys.includes(m.key) && i.words.test(`${t.meta?.typology ?? ""} ${t.guessed.typology ?? ""} ${t.name}`)));
    return {
      key: m.key,
      name: m.name,
      vals,
      availability: n ? finite.length / n : 0,
      reliability: rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : 0,
      spread: n < 2 ? 0.5 : relSpread(finite),
      relevance: n ? intent.filter(Boolean).length / n : 0,
      unit: rs[0]?.measure.unit ?? "",
    };
  });
  return base.map((b) => {
    let overlap: CriterionStat["overlap"] = null;
    for (const o of base) {
      if (o.key === b.key) continue;
      const a: number[] = [];
      const c: number[] = [];
      b.vals.forEach((v, i) => {
        if (Number.isFinite(v) && Number.isFinite(o.vals[i])) {
          a.push(v);
          c.push(o.vals[i]);
        }
      });
      const r = Math.abs(correlation(a, c));
      if (!overlap || r > overlap.r) overlap = { with: o.key, r };
    }
    const evidence = b.availability * (0.4 + 0.6 * b.reliability);
    const value = 0.34 * b.spread + 0.22 * b.relevance + 0.44 * evidence;
    return { key: b.key, name: b.name, availability: b.availability, reliability: b.reliability, spread: b.spread, relevance: b.relevance, overlap, value, values: tiles.map((t, i) => ({ tile: shortName(t), value: Number.isFinite(b.vals[i]) ? b.vals[i] : null, unit: b.unit })) };
  });
}

export interface Suggestion {
  keys: MatrixKey[];
  reasons: Partial<Record<MatrixKey, string>>;
  setAside: Partial<Record<MatrixKey, string>>;
  stats: CriterionStat[];
}

const fmt = (v: number | null) => (v === null ? "n/a" : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

/**
 * Which criteria to carry forward and which to set aside for this phase, with reasons. A criterion is carried when it can be assessed for most
 * of the tiles, is backed by evidence worth trusting, tells the tiles apart, matches what the typologies are about, and does not repeat another
 * one already carried. There is no minimum number. A tile's score never enters: criteria are not chosen because they make tiles look good.
 */
export function suggestCriteria(tiles: ParsedTile[], evals: TileEvaluation[]): Suggestion {
  const stats = criterionStats(tiles, evals);
  const order = [...stats].sort((a, b) => b.value - a.value);
  const keys: MatrixKey[] = [];
  const reasons: Suggestion["reasons"] = {};
  const setAside: Suggestion["setAside"] = {};
  const ENOUGH = 0.42;
  for (const s of order) {
    const rs = evals.map((e) => e.results.find((r) => r.key === s.key)!);
    const status = [...new Set(rs.map((r) => r.measure.status))].join(", ");
    const tag = `${Math.round(s.availability * 100)}% of the tiles can be assessed; evidence is ${status}`;
    if (!tiles.length) {
      setAside[s.key] = "No tiles yet.";
      continue;
    }
    if (s.availability < 0.5) {
      setAside[s.key] = `Can be assessed for only ${Math.round(s.availability * 100)}% of the tiles from the files they carry (${status}), so it cannot compare them yet.`;
      continue;
    }
    const dup = s.overlap && s.overlap.r >= 0.85 && keys.includes(s.overlap.with);
    if (dup) {
      setAside[s.key] = `It moves together with ${MATRIX.find((m) => m.key === s.overlap!.with)!.name} (r = ${s.overlap!.r.toFixed(2)}), which is already carried: the two would repeat each other.`;
      continue;
    }
    if (s.value < ENOUGH) {
      const why = tiles.length >= 2 && s.spread < 0.15 ? `It hardly differs across these tiles (${s.values.map((v) => `${v.tile} ${fmt(v.value)}`).slice(0, 3).join(", ")}), so it cannot help choose between them` : s.reliability < 0.6 ? `It rests on weak evidence (${status})` : "It adds little beyond the criteria already carried";
      setAside[s.key] = `${why}; it stays visible in the analysis and can be pinned on.`;
      continue;
    }
    keys.push(s.key);
    const lead = tiles.length >= 2 && s.spread >= 0.25 ? `Tells these tiles apart: ${s.values.filter((v) => v.value !== null).slice(0, 3).map((v) => `${v.tile} ${fmt(v.value)}`).join(", ")}${s.values.length > 3 ? ", …" : ""}.` : s.relevance >= 0.3 ? "Matches what several of these typologies are about." : "Can be read in these tiles.";
    reasons[s.key] = `${lead} ${tag}.`;
  }
  const canon = MATRIX.map((m) => m.key);
  keys.sort((a, b) => canon.indexOf(a) - canon.indexOf(b));
  return { keys, reasons, setAside, stats };
}

/** What carrying forward now means: the adopted criteria with your pins applied, and the reasons (yours first). */
export function effectiveCriteria(profile: EvaluationProfile): { keys: MatrixKey[]; reasons: Partial<Record<MatrixKey, string>>; setAside: Partial<Record<MatrixKey, string>> } {
  const ad = profile.adopted;
  const pins = profile.overrides.pins;
  const set = new Set<MatrixKey>(ad?.keys ?? []);
  for (const [k, v] of Object.entries(pins) as [MatrixKey, "on" | "off"][]) if (v === "on") set.add(k);
  for (const [k, v] of Object.entries(pins) as [MatrixKey, "on" | "off"][]) if (v === "off") set.delete(k);
  const canon = MATRIX.map((m) => m.key);
  const keys = canon.filter((k) => set.has(k));
  const reasons: Partial<Record<MatrixKey, string>> = {};
  const setAside: Partial<Record<MatrixKey, string>> = {};
  for (const k of canon) {
    const mine = profile.overrides.reasons[k];
    if (set.has(k)) reasons[k] = mine ?? (pins[k] === "on" && !ad?.keys.includes(k) ? "Pinned on." : (ad?.reasons[k] ?? ""));
    else setAside[k] = mine ?? (pins[k] === "off" ? "Switched off." : (ad?.setAside[k] ?? ""));
  }
  return { keys, reasons, setAside };
}

export interface SuggestionDiff {
  add: MatrixKey[];
  remove: MatrixKey[];
  /** the suggestion differs from the adopted criteria */
  changed: boolean;
}

export function diffSuggestion(profile: EvaluationProfile, s: Suggestion): SuggestionDiff {
  const cur = new Set(profile.adopted?.keys ?? []);
  const next = new Set(s.keys);
  const add = s.keys.filter((k) => !cur.has(k));
  const remove = [...cur].filter((k) => !next.has(k));
  return { add, remove, changed: add.length > 0 || remove.length > 0 };
}

export const adoptFrom = (s: Suggestion, tiles: ParsedTile[]): Adopted => ({ keys: s.keys, reasons: s.reasons, setAside: s.setAside, basis: tiles.map((t) => t.id), at: Date.now() });

/** A tile's interpretation as it should be shown: yours when you wrote one, else the generated text. */
export const interpretationFor = (profile: EvaluationProfile, tileId: string, r: MatrixResult): { text: string; edited: boolean } => {
  const mine = profile.overrides.interpretations[tileId]?.[r.key];
  return mine ? { text: mine, edited: true } : { text: r.interpretation.text, edited: false };
};

// ---- the overrides, as pure functions (the hook and the tests use the same ones): each changes one thing and leaves everything else alone --------------

type Ov = EvaluationProfile["overrides"];
const over = (p: EvaluationProfile, f: (o: Ov) => Ov): EvaluationProfile => ({ ...p, overrides: f(p.overrides) });
const setOrDelete = <T,>(rec: Record<string, T>, key: string, value: T | undefined | null): Record<string, T> => {
  const out = { ...rec };
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) delete out[key];
  else out[key] = value;
  return out;
};

export const withPin = (p: EvaluationProfile, k: MatrixKey, v: "on" | "off" | null) => over(p, (o) => ({ ...o, pins: setOrDelete(o.pins as Record<string, "on" | "off">, k, v) as Ov["pins"] }));
export const withReason = (p: EvaluationProfile, k: MatrixKey, text: string) => over(p, (o) => ({ ...o, reasons: setOrDelete(o.reasons as Record<string, string>, k, text) as Ov["reasons"] }));
export const withInterpretation = (p: EvaluationProfile, tileId: string, k: MatrixKey, text: string) =>
  over(p, (o) => {
    const mine = setOrDelete((o.interpretations[tileId] ?? {}) as Record<string, string>, k, text);
    return { ...o, interpretations: setOrDelete(o.interpretations as Record<string, Record<string, string>>, tileId, Object.keys(mine).length ? mine : null) as Ov["interpretations"] };
  });
export const withAssumption = <K extends keyof Assumptions>(p: EvaluationProfile, field: K, value: Assumptions[K]) => over(p, (o) => ({ ...o, assumptions: { ...o.assumptions, [field]: value } }));
export const withoutAssumption = (p: EvaluationProfile, field: keyof Assumptions) =>
  over(p, (o) => {
    const a = { ...o.assumptions };
    delete a[field];
    return { ...o, assumptions: a };
  });
export const withRoomClass = (p: EvaluationProfile, tileId: string, roomId: number, cls: "public" | "private" | null) =>
  over(p, (o) => {
    const roomClass = setOrDelete((o.assumptions.roomClass ?? {}) as Record<string, "public" | "private">, `${tileId}:${roomId}`, cls);
    const a: Partial<Assumptions> = { ...o.assumptions, roomClass };
    if (!Object.keys(roomClass).length) delete a.roomClass;
    return { ...o, assumptions: a };
  });
export const withRoute = (p: EvaluationProfile, tileId: string, r: RouteOverride0 | null) => over(p, (o) => ({ ...o, routes: setOrDelete(o.routes as Record<string, RouteOverride0>, tileId, r && (r.from || r.to) ? r : null) }));
export const withPick = (p: EvaluationProfile, typology: string, tileId: string | null) => over(p, (o) => ({ ...o, picks: setOrDelete(o.picks, typology, tileId) }));
export const withPickReason = (p: EvaluationProfile, typology: string, text: string) => over(p, (o) => ({ ...o, pickReasons: setOrDelete(o.pickReasons, typology, text) }));
export const withIntention = (p: EvaluationProfile, typology: string, text: string) => over(p, (o) => ({ ...o, intentions: setOrDelete(o.intentions, typology, text) }));

// ---- migrating an older project -----------------------------------------------------------------------------------------------------------------

interface LegacyCriteria {
  manual?: boolean;
  keys?: string[];
  pins?: Record<string, "on" | "off">;
  notes?: Record<string, string>;
}

/**
 * The first version of the carry-forward saved `criteria`. Its pins and the reasons you wrote are kept (they are your overrides); the list it carried
 * is not converted, because the scores it chose from were an older blend, not the matrix measurements; a fresh suggestion replaces it. Spatial density,
 * which is not one of the twelve, is not turned into Compressed-then-released.
 */
export function migrateLegacy(legacy: unknown): EvaluationProfile | null {
  const l = legacy as LegacyCriteria | null | undefined;
  if (!l || typeof l !== "object") return null;
  const valid = new Set<string>(MATRIX.map((m) => m.key));
  const p = defaultProfile();
  const notes: string[] = [];
  for (const [k, v] of Object.entries(l.pins ?? {})) {
    if (valid.has(k)) p.overrides.pins[k as MatrixKey] = v;
    else if (k === "spatialDensity") notes.push("Your pin on Spatial density was dropped: it is now a supplemental reading, not one of the matrix's twelve descriptors.");
  }
  for (const [k, v] of Object.entries(l.notes ?? {})) {
    if (valid.has(k) && v) p.overrides.reasons[k as MatrixKey] = v;
  }
  if (l.manual && l.keys?.length) {
    notes.push(`The list you edited by hand (${l.keys.length} criteria) was written against the older scores and is not carried over as it stood; the criteria are suggested again from the matrix measurements${l.keys.includes("spatialDensity") ? ", and Spatial density (not a matrix descriptor) is no longer a criterion. It was not converted into Compressed-then-released" : ""}. Your pins and written reasons were kept.`);
  } else if (l.keys?.includes("spatialDensity")) notes.push("Spatial density is no longer among the criteria: it is not one of the matrix's twelve. It was not converted into Compressed-then-released.");
  if (Object.keys(l.pins ?? {}).length || Object.keys(l.notes ?? {}).length || notes.length) {
    notes.unshift("Earlier scores (a 0-100 blend of proxies) are unchanged and still shown as the app's presence index; the matrix measurements are new, so nothing was relabelled.");
    p.migration = { notes };
  }
  return p;
}

export { DEFAULT_ASSUMPTIONS };
