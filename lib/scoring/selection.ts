// Picks which descriptors ("criteria") a project carries forward -- the
// Assignment 2 Part 3 step. Works from how the project's own tiles actually
// score: a criterion is worth carrying when it tells the tiles apart, is
// measured rather than inferred, and isn't a near-duplicate of one already
// picked. The metric list is whatever scoreTile() returns, so descriptors
// added later (e.g. architectural readings) are picked up without changes
// here.

import type { ParsedTile } from "@/lib/types";
import { DESCRIPTOR_META, scoreTile, type DescriptorKey, type DescriptorResult } from "@/lib/scoring/descriptors";
import { clamp } from "@/lib/scoring/utils";

export const MIN_CRITERIA = 6;
export const MAX_CRITERIA = 12;

export type CriterionPin = "on" | "off";

export interface CriteriaState {
  /** Wanted number of carried criteria while the selection is automatic. */
  count: number;
  /** true once the user has hand-edited the list; then `keys` is the list. */
  manual: boolean;
  keys: DescriptorKey[];
  /** "on" = always carried, "off" = never carried. Unlisted = automatic. */
  pins: Partial<Record<DescriptorKey, CriterionPin>>;
  /** Hand-edited reasoning text, overriding the generated one. */
  notes: Partial<Record<DescriptorKey, string>>;
}

export function defaultCriteriaState(): CriteriaState {
  return { count: 8, manual: false, keys: [], pins: {}, notes: {} };
}

export interface DescriptorStat {
  key: DescriptorKey;
  label: string;
  scores: number[];
  mean: number;
  min: number;
  max: number;
  std: number;
  /** true when any tile's reading of this descriptor was inferred, not measured. */
  approximate: boolean;
}

const scoreCache = new WeakMap<ParsedTile, DescriptorResult[]>();
export function scoreTileCached(tile: ParsedTile): DescriptorResult[] {
  let hit = scoreCache.get(tile);
  if (!hit) {
    hit = scoreTile(tile);
    scoreCache.set(tile, hit);
  }
  return hit;
}

/** Every descriptor's scores across `tiles`, in the canonical descriptor order. */
export function computeStats(tiles: ParsedTile[]): DescriptorStat[] {
  const perTile = tiles.map(scoreTileCached);
  return DESCRIPTOR_META.map((t, i) => {
    const scores = perTile.map((r) => r[i].score);
    const n = scores.length || 1;
    const mean = scores.reduce((a, b) => a + b, 0) / n;
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return {
      key: t.key,
      label: t.label,
      scores,
      mean,
      min: scores.length ? Math.min(...scores) : 0,
      max: scores.length ? Math.max(...scores) : 0,
      std: Math.sqrt(variance),
      approximate: perTile.some((r) => r[i].approximate),
    };
  });
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  // With only a handful of tiles a correlation says nothing (4 points correlate by chance).
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
}

/** How worth carrying a descriptor is on its own, 0-1. */
function baseValue(s: DescriptorStat): number {
  const measured = s.approximate ? 0 : 1;
  const presence = clamp(s.mean / 100, 0, 1);
  if (s.scores.length >= 2) return 0.55 * clamp(s.std / 25, 0, 1) + 0.25 * presence + 0.2 * measured;
  return 0.6 * presence + 0.4 * measured;
}

/** The strongest `count` descriptors for these tiles: every pinned-on one, then
 * the best of the rest by value, each penalised for overlapping one already
 * picked. Never includes a pinned-off one. */
export function autoSelect(stats: DescriptorStat[], count: number, pins: CriteriaState["pins"]): DescriptorKey[] {
  const want = clamp(count, MIN_CRITERIA, MAX_CRITERIA);
  const picked: DescriptorStat[] = stats.filter((s) => pins[s.key] === "on");
  const pool = stats.filter((s) => pins[s.key] !== "on" && pins[s.key] !== "off");
  while (picked.length < want && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((s, i) => {
      const overlap = picked.reduce((m, p) => Math.max(m, Math.abs(correlation(s.scores, p.scores))), 0);
      const v = baseValue(s) - 0.45 * overlap;
      if (v > bestScore) {
        bestScore = v;
        best = i;
      }
    });
    picked.push(pool.splice(best, 1)[0]);
  }
  const order = stats.map((s) => s.key);
  return picked.map((s) => s.key).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export interface ResolvedCriteria {
  keys: DescriptorKey[];
  /** Why each carried descriptor is carried (generated, or the user's own text). */
  reasons: Partial<Record<DescriptorKey, string>>;
  /** Why each not-carried descriptor was set aside. */
  setAside: Partial<Record<DescriptorKey, string>>;
}

const range = (s: DescriptorStat) => `${Math.round(s.min)}-${Math.round(s.max)}`;

function describeOverlap(s: DescriptorStat, others: DescriptorStat[]): string {
  let best: DescriptorStat | null = null;
  let bestR = 0;
  for (const o of others) {
    if (o.key === s.key) continue;
    const r = Math.abs(correlation(s.scores, o.scores));
    if (r > bestR) {
      bestR = r;
      best = o;
    }
  }
  return best && bestR >= 0.8 ? ` It tracks ${best.label} closely (r=${bestR.toFixed(2)}), so the two overlap.` : "";
}

function carriedReason(s: DescriptorStat, carried: DescriptorStat[], how: "auto" | "manual" | "pinned"): string {
  const prefix = how === "pinned" ? "Pinned on. " : how === "manual" ? "Added by hand. " : "";
  const n = s.scores.length;
  const lead =
    n >= 2 && s.std >= 10
      ? `Tells these tiles apart (scores ${range(s)}, average ${Math.round(s.mean)}).`
      : s.mean >= 40
        ? `Reads clearly in these tiles (average ${Math.round(s.mean)}).`
        : `Present in these tiles, though modestly (average ${Math.round(s.mean)}).`;
  const how2 = s.approximate ? " Partly inferred from design intent rather than measured, so read it with care." : " Measured directly from the geometry.";
  return prefix + lead + how2 + describeOverlap(s, carried);
}

function setAsideReason(s: DescriptorStat, carried: DescriptorStat[], pin: CriterionPin | undefined): string {
  if (pin === "off") return "Switched off by hand.";
  const n = s.scores.length;
  if (n >= 2 && s.std < 6) return `Barely changes across these tiles (${range(s)}), so it can't help choose between them.`;
  const overlap = describeOverlap(s, carried).trim();
  if (overlap) return overlap;
  if (s.approximate) return "Largely inferred from design intent rather than measured.";
  return "Outranked by stronger, more distinguishing criteria for this set of tiles.";
}

function clampKeys(keys: DescriptorKey[], stats: DescriptorStat[], pins: CriteriaState["pins"]): DescriptorKey[] {
  const valid = new Set(stats.map((s) => s.key));
  let out = [...new Set(keys)].filter((k) => valid.has(k) && pins[k] !== "off");
  for (const s of stats) if (pins[s.key] === "on" && !out.includes(s.key)) out.push(s.key);
  if (out.length < MIN_CRITERIA) {
    const fill = autoSelect(stats, MAX_CRITERIA, pins).filter((k) => !out.includes(k));
    out = [...out, ...fill].slice(0, Math.max(MIN_CRITERIA, out.length));
  }
  const order = stats.map((s) => s.key);
  return out.slice(0, MAX_CRITERIA).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function resolveCriteria(state: CriteriaState, stats: DescriptorStat[]): ResolvedCriteria {
  const keys = state.manual ? clampKeys(state.keys, stats, state.pins) : autoSelect(stats, state.count, state.pins);
  const carried = stats.filter((s) => keys.includes(s.key));
  const autoKeys = new Set(autoSelect(stats, keys.length, state.pins));
  const reasons: ResolvedCriteria["reasons"] = {};
  const setAside: ResolvedCriteria["setAside"] = {};
  for (const s of stats) {
    if (keys.includes(s.key)) {
      const how = state.pins[s.key] === "on" ? "pinned" : state.manual && !autoKeys.has(s.key) ? "manual" : "auto";
      reasons[s.key] = state.notes[s.key]?.trim() || carriedReason(s, carried, how);
    } else {
      setAside[s.key] = setAsideReason(s, carried, state.pins[s.key]);
    }
  }
  return { keys, reasons, setAside };
}
