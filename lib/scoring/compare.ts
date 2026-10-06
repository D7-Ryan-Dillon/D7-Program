// The sentence a Compare row adds under a descriptor: how the tiles differ, in their own measured terms.

import type { DescriptorResult } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";

/** A short, readable name for a tile in a sentence: its typology when the engine wrote one, else its name. */
export function shortName(tile: ParsedTile): string {
  const t = tile.meta?.typology ?? tile.guessed.typology;
  if (t) return t.charAt(0).toUpperCase() + t.slice(1);
  return tile.name.replace(/_v\d+$/i, "").replace(/_/g, " ");
}

export function compareSentence(entries: { tile: ParsedTile; result: DescriptorResult }[]): string {
  if (entries.length < 2) return "";
  const sorted = [...entries].sort((a, b) => b.result.score - a.result.score);
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  const spread = hi.result.score - lo.result.score;
  const label = hi.result.label.toLowerCase();
  const say = (e: { tile: ParsedTile; result: DescriptorResult }) => `${shortName(e.tile)} reads ${e.result.qualitative.reading} (${e.result.quant.headline})`;
  if (spread < 8) return `Much the same ${label} in all: ${entries.map(say).join("; ")}.`;
  // the factor the two differ on most
  let driver: { label: string; hi: string; lo: string } | null = null;
  let best = 0;
  for (const dh of hi.result.drivers) {
    const dl = lo.result.drivers.find((x) => x.label === dh.label);
    if (dl && Math.abs(dh.pts - dl.pts) > best) {
      best = Math.abs(dh.pts - dl.pts);
      driver = { label: dh.label, hi: dh.value, lo: dl.value };
    }
  }
  return `${say(hi)}; ${say(lo)}.${driver && best >= 20 ? ` The difference comes mostly from ${driver.label.toLowerCase()}: ${driver.hi} against ${driver.lo}.` : ""}`;
}

/**
 * The sentence a Compare row adds under a descriptor, from the matrix measurements: each tile's own value with its status, and where they differ the
 * difference in the measure itself. It does not say which is "better": that depends on what the typology is about.
 */
export function compareMatrix(entries: { tile: ParsedTile; result: import("@/lib/scoring/matrixEval").MatrixResult }[]): string {
  if (entries.length < 2) return "";
  const say = (e: (typeof entries)[number]) => `${shortName(e.tile)}: ${e.result.measure.headline}${e.result.measure.status === "measured" ? "" : ` (${e.result.measure.status === "unavailable" ? "not assessable" : e.result.measure.status})`}`;
  const vals = entries.map((e) => e.result.measure.value);
  const real = vals.filter((v): v is number => v !== null);
  const note =
    real.length < entries.length
      ? " Not every tile can be assessed on this criterion, so the rest are not compared with it."
      : real.length >= 2 && Math.max(...real) - Math.min(...real) < 1e-9
        ? " The values are the same."
        : real.length >= 2
          ? ` The difference is ${Math.round((Math.max(...real) - Math.min(...real)) * 100) / 100} ${entries[0].result.measure.unit.split(" (")[0]}.`
          : "";
  return `${entries.map(say).join("; ")}.${note}`;
}
