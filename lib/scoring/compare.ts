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
