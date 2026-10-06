// The at-a-glance bar of a descriptor: how strongly the tile shows it, on the app's own four-word scale (from the measurement, not the older 0-100 index), and
// how close the measurement is to what the tile's typology prefers. Shared by the Analysis cards, the overview strip and the Boards descriptor pages.

import { fitOf, preferenceFor, type PreferenceOverride } from "@/lib/scoring/compareSet";
import type { MatrixResult } from "@/lib/scoring/matrixEval";
import type { MatrixKey } from "@/lib/scoring/matrix";

export interface BarSpec {
  key: MatrixKey;
  /** the matrix's name for the descriptor */
  label: string;
  /** the scale position, 0 .. steps-1 (null: not assessable) */
  index: number | null;
  steps: number;
  /** the app's word for that position ("faint", "marked", ...), when it has one */
  word: string | null;
  /** 0..1 fill (null: not assessable) */
  fill: number | null;
  /** measured and inferred bars are solid; a proxy or an assumption is drawn lighter and hatched so it never reads as stronger evidence than it is */
  solid: boolean;
  status: string;
  /** closeness to the typology's target, 0..1 (null: the typology has no preference, or not assessable) */
  fit: number | null;
  value: number | null;
  unit: string;
  headline: string;
}

/** The bar for one result. `typology` is the tile's typology key (compareSet.typologyKey) and `overrides` your own preferences, if any. */
export function barOf(result: MatrixResult, typology?: string, overrides?: Partial<Record<MatrixKey, PreferenceOverride>>): BarSpec {
  const m = result.measure;
  const scale = result.interpretation.scale;
  const idx = result.interpretation.index;
  const assessable = m.status !== "unavailable" && m.status !== "not-applicable" && m.value !== null;
  const steps = scale?.length ?? 4;
  let index: number | null = null;
  if (assessable && idx !== undefined) index = Math.max(0, Math.min(steps - 1, idx));
  let fit: number | null = null;
  if (assessable && typology && m.value !== null) fit = fitOf(preferenceFor(typology, result.key, overrides?.[result.key]).pref, m.value);
  return {
    key: result.key,
    label: result.criterion.name,
    index,
    steps,
    word: index !== null && scale ? (scale[index] ?? null) : null,
    fill: index === null ? null : (index + 1) / steps,
    solid: m.status === "measured" || m.status === "inferred",
    status: m.status,
    fit,
    value: m.value,
    unit: m.unit,
    headline: m.headline,
  };
}

/** Which of a row of results (the same descriptor read for several tiles) is highest and lowest, when they are at least two bands apart. */
export function spreadMarks(bars: BarSpec[]): ("high" | "low" | null)[] {
  const idx = bars.map((b) => b.index);
  const known = idx.filter((v): v is number => v !== null);
  if (known.length < 2) return bars.map(() => null);
  const hi = Math.max(...known);
  const lo = Math.min(...known);
  if (hi - lo < 2) return bars.map(() => null);
  return idx.map((v) => (v === hi ? "high" : v === lo ? "low" : null));
}
