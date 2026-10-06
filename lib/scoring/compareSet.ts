// Comparing variants. Tiles are compared within a typology (the variants of one idea), with the same criteria and assumptions, showing raw values and
// the generated explanation beside any score. The fifteen typologies are NOT ranked against each other: a stepped amphitheater and a continuous hall
// are not meant to have the same qualities, so "best" only ever means "best at what its typology is about, among its own variants".
//
// A suggested selection is made only where the evidence supports it: at least two carried criteria that this typology's intent makes relevant, with
// values for every variant, on which one variant leads clearly. Otherwise the answer is "the evidence does not separate them", never a forced pick.

import type { ParsedTile } from "@/lib/types";
import { MATRIX, type MatrixKey } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
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

/** How present the quality is in a result, 0 upward (comparable between variants of one typology): the matrix measure turned so that more = more of that quality. */
const PRESENCE: Record<MatrixKey, (v: number) => number> = {
  carved: (v) => v,
  stepped: (v) => v,
  porous: (v) => v,
  continuous: (v) => 1 / (1 + v), // fewer material changes per 10 m = more continuous
  resistant: (v) => v,
  threaded: (v) => v,
  graduated: (v) => v,
  nonHierarchical: (v) => v,
  forceDriven: (v) => v,
  lightFilled: (v) => v,
  monumental: (v) => v,
  compressed: (v) => 1 - v, // a smaller narrowest/widest ratio = more compressed-then-released
};

const WORDS: Partial<Record<MatrixKey, RegExp>> = {
  stepped: /step|terrac|cascad|amphi|tier|ramp/i,
  compressed: /compress|sequen|thresh|narrow|squeez|funnel/i,
  graduated: /compress|sequen|step|terrac|thresh|gradua/i,
  monumental: /void|vertical|atrium|shaft|tower/i,
  lightFilled: /void|vertical|atrium|shaft|field|open|light/i,
  porous: /void|field|open|edge|porous|lattice/i,
  continuous: /continu|hall|linear|gallery|flow/i,
  nonHierarchical: /field|open|hall|network|continu|gallery|linear|work/i,
  resistant: /plate|contain|room within|core|inserted|mezz|retain/i,
  threaded: /thread|stack|vertical|edge|gallery|linear/i,
  carved: /carv|cave|grotto|topograph|ground|field/i,
  forceDriven: /force|flow|fold|undulat|topograph|ground/i,
};

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

export interface Pick {
  /** a suggestion exists: the evidence separates the variants */
  supported: boolean;
  tileId: string | null;
  /** the generated reason (or why there is none) */
  rationale: string;
  /** the criteria it rests on, with each variant's raw value */
  basis: { key: MatrixKey; name: string; leader: string; rows: { tile: string; id: string; headline: string; status: string }[] }[];
}

/** The variants of one typology read with the carried criteria: who leads on the criteria that typology is about. */
export function suggestPick(group: TypologyGroup, evals: Map<string, TileEvaluation>, carried: MatrixKey[]): Pick {
  if (group.tiles.length < 2) return { supported: false, tileId: group.tiles[0]?.id ?? null, rationale: "Only one variant of this typology: nothing to choose between yet.", basis: [] };
  const text = `${group.key}`;
  const relevant = carried.filter((k) => WORDS[k]?.test(text));
  const use = relevant.length >= 2 ? relevant : carried;
  const scored: { key: MatrixKey; presence: Map<string, number>; rows: Pick["basis"][number]["rows"] }[] = [];
  for (const key of use) {
    const rs = group.tiles.map((t) => ({ t, r: evals.get(t.id)?.results.find((x) => x.key === key) }));
    if (rs.some((x) => !x.r || x.r.measure.value === null || x.r.measure.status === "unavailable")) continue;
    const pres = new Map<string, number>(rs.map((x) => [x.t.id, PRESENCE[key](x.r!.measure.value!)]));
    const vs = [...pres.values()];
    if (Math.max(...vs) - Math.min(...vs) < 1e-6) continue;
    scored.push({ key, presence: pres, rows: rs.map((x) => ({ tile: shortName(x.t), id: x.t.id, headline: (x.r as MatrixResult).measure.headline, status: (x.r as MatrixResult).measure.status })) });
  }
  if (scored.length < 2) return { supported: false, tileId: null, rationale: `The variants cannot be told apart on the criteria that matter for ${group.label.toLowerCase()}: ${scored.length ? "only one carried criterion separates them" : "none of the carried criteria separates them, or they cannot be assessed for every variant"}. The evidence does not support a pick; choose by looking.`, basis: [] };
  // each variant's standing on each criterion, 0..1 within the group, then the mean
  const fit = new Map<string, number>(group.tiles.map((t) => [t.id, 0]));
  for (const s of scored) {
    const vs = [...s.presence.values()];
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    for (const t of group.tiles) fit.set(t.id, fit.get(t.id)! + (s.presence.get(t.id)! - lo) / (hi - lo));
  }
  const ranked = group.tiles.map((t) => ({ t, f: fit.get(t.id)! / scored.length })).sort((a, b) => b.f - a.f);
  const margin = ranked[0].f - ranked[1].f;
  const basis: Pick["basis"] = scored.map((s) => {
    const lead = group.tiles.reduce((a, t) => (s.presence.get(t.id)! > s.presence.get(a.id)! ? t : a), group.tiles[0]);
    return { key: s.key, name: MATRIX.find((m) => m.key === s.key)!.name, leader: shortName(lead), rows: s.rows };
  });
  if (margin < 0.15) return { supported: false, tileId: null, rationale: `${scored.length} criteria separate the variants but none leads clearly (${ranked.map((r) => `${shortName(r.t)} ${(r.f * 100).toFixed(0)}`).join(", ")} out of 100): the evidence does not support a pick.`, basis };
  const winner = ranked[0].t;
  const leads = basis.filter((b) => b.leader === shortName(winner)).map((b) => b.name);
  return {
    supported: true,
    tileId: winner.id,
    rationale: `${shortName(winner)} leads on ${leads.length ? leads.join(", ") : "the combined criteria"} among the ${group.tiles.length} variants of ${group.label.toLowerCase()} (${(ranked[0].f * 100).toFixed(0)} against ${(ranked[1].f * 100).toFixed(0)} for the next, out of 100). This weighs only the criteria this typology is about (${use.length === relevant.length ? "its own intent" : "all carried criteria, since its intent names fewer than two"}) and is a suggestion to look at, not a ranking against other typologies.`,
    basis,
  };
}
