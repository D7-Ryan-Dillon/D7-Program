// Composes a Board (lib/boards/types.ts) onto a full print-resolution 2D
// canvas and rasterizes it to a PNG -- page 1 is the tile renders, page 2
// is each tile's scored descriptors (lib/scoring/descriptors.ts), top 3
// highlighted. Both pages share the exact same grid geometry so they line
// up if printed/viewed side by side.

import { scoreTile, type DescriptorResult } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";
import { renderTileToDataUrl } from "./renderTile";
import { traceCutCorner, chamferFor } from "./cutCorner";
import { gridLayoutFor } from "./grid";
import { DPI, type BoardConfig } from "./types";

interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load rendered tile image"));
    img.src = src;
  });
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cell: Cell) {
  const scale = Math.max(cell.width / img.width, cell.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = cell.x + (cell.width - w) / 2;
  const y = cell.y + (cell.height - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

interface BoardLayout {
  widthPx: number;
  heightPx: number;
  margin: number;
  titleSize: number;
  titleBottom: number;
  gap: number;
  columns: number;
  rows: number;
  cells: Cell[];
}

function computeLayout(config: BoardConfig): BoardLayout {
  const widthPx = Math.round(config.widthIn * DPI);
  const heightPx = Math.round(config.heightIn * DPI);
  const margin = DPI * 0.4;
  const titleSize = heightPx * 0.032;
  const titleBottom = margin + titleSize * 1.8;
  const gap = DPI * 0.15;

  const totalCells = config.slots.length + (config.textBox.enabled ? 1 : 0);
  const { columns, rows } = gridLayoutFor(totalCells || 1);
  const gridWidth = widthPx - margin * 2;
  const gridHeight = heightPx - titleBottom - margin;
  const cellWidth = (gridWidth - gap * (columns - 1)) / columns;
  const cellHeight = (gridHeight - gap * (rows - 1)) / rows;

  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      cells.push({ x: margin + c * (cellWidth + gap), y: titleBottom + r * (cellHeight + gap), width: cellWidth, height: cellHeight });
    }
  }
  return { widthPx, heightPx, margin, titleSize, titleBottom, gap, columns, rows, cells };
}

function drawTitle(ctx: CanvasRenderingContext2D, config: BoardConfig, layout: BoardLayout) {
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, layout.widthPx, layout.heightPx);
  ctx.fillStyle = config.titleColor;
  ctx.font = `600 ${layout.titleSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  ctx.fillText(config.name.toUpperCase(), layout.margin, layout.margin);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBoxCell(ctx: CanvasRenderingContext2D, cell: Cell, config: BoardConfig) {
  const chamfer = chamferFor(cell.width, cell.height);
  ctx.save();
  ctx.strokeStyle = config.textBox.color;
  ctx.lineWidth = DPI * 0.012;
  traceCutCorner(ctx, cell.x, cell.y, cell.width, cell.height, chamfer);
  ctx.stroke();
  ctx.fillStyle = config.textBox.color;
  const fontSize = Math.max(12, cell.height * 0.07);
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  const padding = cell.width * 0.06;
  const lines = wrapText(ctx, config.textBox.text || "", cell.width - padding * 2);
  lines.forEach((line, i) => ctx.fillText(line, cell.x + padding, cell.y + padding + i * fontSize * 1.3));
  ctx.restore();
}

async function drawTileCell(ctx: CanvasRenderingContext2D, cell: Cell, tile: ParsedTile, viewKey: BoardConfig["slots"][number]["view"], config: BoardConfig) {
  const chamfer = chamferFor(cell.width, cell.height);
  const renderSize = Math.round(Math.max(512, Math.min(2400, Math.max(cell.width, cell.height))));
  const dataUrl = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    view: viewKey,
    size: renderSize,
    backgroundColor: config.backgroundColor,
    foamColor: config.foamColor,
    voidColor: config.voidColor,
    foamOpacity: config.foamOpacity,
    voidOpacity: config.voidOpacity,
    foamVisible: true,
    voidVisible: true,
  });
  const img = await loadImage(dataUrl);

  const labelHeight = cell.height * 0.055;
  const imageCell: Cell = { x: cell.x, y: cell.y, width: cell.width, height: cell.height - labelHeight };

  ctx.save();
  traceCutCorner(ctx, imageCell.x, imageCell.y, imageCell.width, imageCell.height, chamfer);
  ctx.clip();
  drawImageCover(ctx, img, imageCell);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = Math.max(1, DPI * 0.006);
  traceCutCorner(ctx, imageCell.x, imageCell.y, imageCell.width, imageCell.height, chamfer);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = config.descriptorColor;
  ctx.font = `${Math.max(10, labelHeight * 0.6)}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  ctx.fillText(tile.name.toUpperCase(), cell.x, cell.y + imageCell.height + labelHeight * 0.2);
}

function drawDescriptorCell(ctx: CanvasRenderingContext2D, cell: Cell, tile: ParsedTile, config: BoardConfig) {
  const chamfer = chamferFor(cell.width, cell.height);
  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = Math.max(1, DPI * 0.006);
  traceCutCorner(ctx, cell.x, cell.y, cell.width, cell.height, chamfer);
  ctx.stroke();
  ctx.restore();

  const results: DescriptorResult[] = scoreTile(tile);
  const topKeys = new Set(
    [...results]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.key),
  );

  const padding = cell.width * 0.05;
  const headerSize = Math.max(11, cell.height * 0.045);
  ctx.fillStyle = config.descriptorColor;
  ctx.font = `600 ${headerSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  ctx.fillText(tile.name.toUpperCase(), cell.x + padding, cell.y + padding);

  const listTop = cell.y + padding + headerSize * 1.6;
  const listHeight = cell.y + cell.height - padding - listTop;
  const rowHeight = listHeight / results.length;
  const labelSize = Math.max(9, rowHeight * 0.42);
  const barX = cell.x + cell.width * 0.5;
  const barWidth = cell.width * 0.32;
  const barHeight = Math.max(2, rowHeight * 0.14);

  results.forEach((r, i) => {
    const y = listTop + i * rowHeight;
    const highlighted = topKeys.has(r.key);
    const color = highlighted ? config.highlightColor : config.descriptorColor;
    ctx.fillStyle = color;
    ctx.font = `${highlighted ? "600 " : ""}${labelSize}px "${config.fontFamily}"`;
    ctx.textBaseline = "middle";
    ctx.fillText(r.label.toUpperCase(), cell.x + padding, y + rowHeight * 0.45);

    const barY = y + rowHeight * 0.45 - barHeight / 2;
    ctx.fillStyle = `${color}33`;
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, (barWidth * r.score) / 100, barHeight);

    ctx.font = `${labelSize}px "${config.fontFamily}"`;
    ctx.textAlign = "right";
    ctx.fillText(String(r.score), cell.x + cell.width - padding, y + rowHeight * 0.45);
    ctx.textAlign = "left";
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't rasterize the board to PNG"));
    }, "image/png");
  });
}

export async function exportBoardPage1(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const layout = computeLayout(config);
  const canvas = document.createElement("canvas");
  canvas.width = layout.widthPx;
  canvas.height = layout.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  drawTitle(ctx, config, layout);

  let cellIndex = 0;
  if (config.textBox.enabled) {
    drawTextBoxCell(ctx, layout.cells[cellIndex], config);
    cellIndex++;
  }
  for (const slot of config.slots) {
    const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
    const cell = layout.cells[cellIndex];
    cellIndex++;
    if (!tile || !cell) continue;
    await drawTileCell(ctx, cell, tile, slot.view, config);
  }
  return canvasToPngBlob(canvas);
}

export async function exportBoardPage2(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const layout = computeLayout(config);
  const canvas = document.createElement("canvas");
  canvas.width = layout.widthPx;
  canvas.height = layout.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  drawTitle(ctx, config, layout);

  let cellIndex = config.textBox.enabled ? 1 : 0;
  for (const slot of config.slots) {
    const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
    const cell = layout.cells[cellIndex];
    cellIndex++;
    if (!tile || !cell) continue;
    drawDescriptorCell(ctx, cell, tile, config);
  }
  return canvasToPngBlob(canvas);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
