// A board's modules are always square and the same proportion -- only
// their *size* changes with how many are on the board. This finds the
// largest uniform square (plus its name tag, which extends further down)
// that still lets `count` of them, arranged in some columns x rows grid,
// fit inside the available area.

import { TAG_HEIGHT_FRACTION } from "./frameShape";
import { MAX_TILES, MIN_TILES } from "./types";

export interface SquareGridLayout {
  columns: number;
  rows: number;
  /** Side length of each square module (excludes the name tag below it). */
  squareSize: number;
  /** squareSize * (1 + TAG_HEIGHT_FRACTION) -- the module's full footprint. */
  cellHeight: number;
  /** Left/top offset so the whole grid is centered in the available area. */
  offsetX: number;
  offsetY: number;
}

export function clampSlotCount(count: number): number {
  return Math.max(MIN_TILES, Math.min(MAX_TILES, count));
}

/** The layout for an exact columns x rows grid, or null if nothing fits. */
export function fixedGridLayout(columns: number, rows: number, availableWidth: number, availableHeight: number, gapX: number, gapY: number, tagHeight: number = TAG_HEIGHT_FRACTION): SquareGridLayout | null {
  const sizeFromWidth = (availableWidth - gapX * (columns - 1)) / columns;
  const sizeFromHeight = (availableHeight - gapY * (rows - 1)) / (rows * (1 + tagHeight));
  const squareSize = Math.min(sizeFromWidth, sizeFromHeight);
  if (squareSize <= 0) return null;
  const cellHeight = squareSize * (1 + tagHeight);
  const gridWidth = columns * squareSize + gapX * (columns - 1);
  const gridHeight = rows * cellHeight + gapY * (rows - 1);
  return { columns, rows, squareSize, cellHeight, offsetX: (availableWidth - gridWidth) / 2, offsetY: (availableHeight - gridHeight) / 2 };
}

export function squareGridLayout(count: number, availableWidth: number, availableHeight: number, gapX: number, gapY: number, tagHeight: number = TAG_HEIGHT_FRACTION): SquareGridLayout {
  const n = Math.max(1, count);
  let best: SquareGridLayout | null = null;

  for (let columns = 1; columns <= n; columns++) {
    const candidate = fixedGridLayout(columns, Math.ceil(n / columns), availableWidth, availableHeight, gapX, gapY, tagHeight);
    if (candidate && (!best || candidate.squareSize > best.squareSize)) best = candidate;
  }

  return (
    best ?? {
      columns: 1,
      rows: 1,
      squareSize: Math.max(1, Math.min(availableWidth, availableHeight)),
      cellHeight: Math.max(1, Math.min(availableWidth, availableHeight)) * (1 + tagHeight),
      offsetX: 0,
      offsetY: 0,
    }
  );
}

export interface GridCell {
  x: number;
  y: number;
  size: number;
}

export function squareGridCells(layout: SquareGridLayout, gapX: number, gapY: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      cells.push({
        x: layout.offsetX + c * (layout.squareSize + gapX),
        y: layout.offsetY + r * (layout.cellHeight + gapY),
        size: layout.squareSize,
      });
    }
  }
  return cells;
}
