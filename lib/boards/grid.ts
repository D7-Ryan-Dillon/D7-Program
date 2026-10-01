// A board's grid adapts to how many tiles are on it -- no visible gridlines,
// just a near-square arrangement that reflows as slots are added/removed.

import { MAX_TILES, MIN_TILES } from "./types";

export interface GridLayout {
  columns: number;
  rows: number;
}

export function clampSlotCount(count: number): number {
  return Math.max(MIN_TILES, Math.min(MAX_TILES, count));
}

/** Near-square grid: as close to sqrt(n) columns as possible, biased to a
 * slightly wider-than-tall layout (common for a landscape board). */
export function gridLayoutFor(count: number): GridLayout {
  const n = Math.max(1, count);
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  return { columns, rows };
}
