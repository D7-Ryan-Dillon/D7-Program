// Plain-language helpers for the sentences the Analysis writes about a tile: numbers with units, counts in words, lists,
// and the names of rooms and levels as the tile's own data gives them ("upper hall", "the 12 ft floor").

import type { LevelInfo, RoomInfo } from "@/lib/tiles/types";

export const num = (n: number, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d });
export const ft = (n: number, d = 0) => `${num(n, d)} ft`;
export const ft2 = (n: number) => `${num(n)} ft²`;
export const ft3 = (n: number) => `${num(n)} ft³`;
/** A fixed number of decimals ("1.00"), for ratios where the trailing zeros mean something. */
export const fix = (n: number, d = 2) => n.toFixed(d);
export const pct = (frac: number, d = 0) => `${num(frac * 100, d)}%`;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export const numberWord = (n: number) => WORDS[n] ?? String(n);

/** "3 openings", "1 opening" */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "three floors", "one floor" */
export const countWord = (n: number, one: string, many = `${one}s`) => `${numberWord(n)} ${n === 1 ? one : many}`;

export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "upper hall" from a room (the part of its name before the dimensions). */
export const roomShort = (r: RoomInfo) => r.name.split(",")[0];

/** The heights of some levels read out: "at 2, 7 and 12 ft"; more than five become "from 2 to 19 ft". */
export function levelHeights(levels: LevelInfo[]): string {
  const z = levels.map((l) => (l.kind === "flat" ? l.z_ft : (l.z_min_ft + l.z_max_ft) / 2));
  const fmt = (v: number) => num(Math.round(v * 2) / 2, Math.round(v * 2) % 2 ? 1 : 0);
  if (z.length > 5) return `from ${fmt(Math.min(...z))} to ${fmt(Math.max(...z))} ft`;
  return `at ${list(z.map(fmt))} ft`;
}

/** How a share reads in words, for sentences ("about a third", "most of it"). */
export function shareWord(frac: number): string {
  if (frac >= 0.9) return "nearly all of it";
  if (frac >= 0.65) return "most of it";
  if (frac >= 0.45) return "about half";
  if (frac >= 0.28) return "about a third";
  if (frac >= 0.12) return "a small part";
  return "very little";
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function sentence(parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .map((p) => p.trim())
    .join(" ");
}
