// Which row/column of the 3x5 catalogue each tile lands in. Rows are the
// three categories, columns the typology number 1-5. Two tiles of the same
// typology (a V1 and a V2) stack into extra rows inside their category;
// tiles that don't parse to a known category/number get rows of their own at
// the bottom.

import { CATALOGUE_CATEGORIES, CATALOGUE_COLUMNS } from "./types";

export interface CatalogueRow {
  /** Index into CATALOGUE_CATEGORIES, or -1 for the "other" rows. */
  category: number;
  /** Slot index per column (null = empty). */
  items: (number | null)[];
}

export function categoryIndex(category: string): number {
  return CATALOGUE_CATEGORIES.findIndex((c) => category.startsWith(c));
}

export function planCatalogue(tags: { category: string; number: number | null }[], placeholders: boolean): CatalogueRow[] {
  const cols = CATALOGUE_COLUMNS;
  const buckets: number[][][] = CATALOGUE_CATEGORIES.map(() => Array.from({ length: cols }, () => []));
  const others: number[] = [];
  tags.forEach((t, i) => {
    const cat = categoryIndex(t.category);
    if (cat >= 0 && t.number !== null && t.number >= 1 && t.number <= cols) buckets[cat][t.number - 1].push(i);
    else others.push(i);
  });

  const rows: CatalogueRow[] = [];
  buckets.forEach((cells, cat) => {
    const depth = Math.max(0, ...cells.map((c) => c.length));
    const count = depth > 0 ? depth : placeholders ? 1 : 0;
    for (let k = 0; k < count; k++) rows.push({ category: cat, items: cells.map((c) => c[k] ?? null) });
  });
  for (let k = 0; k < others.length; k += cols) {
    const chunk = others.slice(k, k + cols);
    rows.push({ category: -1, items: Array.from({ length: cols }, (_, c) => chunk[c] ?? null) });
  }
  return rows;
}
