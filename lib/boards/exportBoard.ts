// Composes a Board (lib/boards/types.ts) onto a full print-resolution 2D
// canvas and rasterizes it to a PNG -- page 1 is the tile renders (image +
// name tag only), page 2 is the same frame with the image shrunk into the
// right portion and each tile's scored descriptors (lib/scoring/
// descriptors.ts) listed on the left, top 3 highlighted. Both pages share
// the exact same grid geometry so they line up if viewed side by side.

import { scoreTile, type DescriptorResult } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";
import { renderTileToDataUrl } from "./renderTile";
import { traceFrame, frameMetricsFor, frameContentHeight } from "./cutCorner";
import { gridLayoutFor } from "./grid";
import { DPI, type BoardConfig } from "./types";

interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}

function ptToPx(pt: number): number {
  return (pt / 72) * DPI;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load rendered tile image"));
    img.src = src;
  });
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
  const gap = config.gapIn * DPI;

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

function drawBackgroundAndTitle(ctx: CanvasRenderingContext2D, config: BoardConfig, layout: BoardLayout) {
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

/** No frame, no border -- just the caption text, per spec. */
function drawTextBoxCell(ctx: CanvasRenderingContext2D, cell: Cell, config: BoardConfig) {
  ctx.save();
  ctx.fillStyle = config.textBox.color;
  const fontSize = Math.max(12, cell.height * 0.07);
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  const padding = cell.width * 0.04;
  const lines = wrapText(ctx, config.textBox.text || "", cell.width - padding * 2);
  lines.forEach((line, i) => ctx.fillText(line, cell.x + padding, cell.y + padding + i * fontSize * 1.3));
  ctx.restore();
}

function drawNameTag(ctx: CanvasRenderingContext2D, cell: Cell, mainHeight: number, name: string, config: BoardConfig) {
  const tagTop = cell.y + mainHeight;
  const tagHeight = cell.height - mainHeight;
  const fontSize = Math.max(10, tagHeight * 0.4);
  ctx.fillStyle = config.highlightColor;
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(name.toUpperCase(), cell.x + cell.width - cell.width * 0.03, tagTop + tagHeight / 2);
  ctx.textAlign = "left";
}

/** Page 1: the tile render fills the whole frame above the name tag, at
 * its own exact aspect ratio (renderTileToDataUrl fits the camera to
 * whichever axis is tighter), so nothing is cropped. */
async function drawImageCell(ctx: CanvasRenderingContext2D, cell: Cell, tile: ParsedTile, viewKey: BoardConfig["slots"][number]["view"], config: BoardConfig) {
  const metrics = frameMetricsFor(cell.width, cell.height);
  const mainHeight = frameContentHeight(cell.height, metrics);
  const lineWidth = ptToPx(config.outlineWidthPt);

  const dataUrl = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    view: viewKey,
    width: Math.round(cell.width),
    height: Math.round(mainHeight),
    backgroundColor: config.backgroundColor,
    foamColor: config.foamColor,
    voidColor: config.voidColor,
    foamOpacity: config.foamOpacity,
    voidOpacity: config.voidOpacity,
    foamVisible: true,
    voidVisible: true,
  });
  const img = await loadImage(dataUrl);

  ctx.save();
  traceFrame(ctx, cell.x, cell.y, cell.width, cell.height, metrics);
  ctx.clip();
  ctx.drawImage(img, cell.x, cell.y, cell.width, mainHeight);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = lineWidth;
  traceFrame(ctx, cell.x, cell.y, cell.width, cell.height, metrics);
  ctx.stroke();
  ctx.restore();

  drawNameTag(ctx, cell, mainHeight, tile.name, config);
}

/** Page 2: descriptors fill the left portion, the tile render is shrunk
 * into the right portion -- same outer frame and name tag as page 1. */
async function drawDescriptorCell(ctx: CanvasRenderingContext2D, cell: Cell, tile: ParsedTile, viewKey: BoardConfig["slots"][number]["view"], config: BoardConfig) {
  const metrics = frameMetricsFor(cell.width, cell.height);
  const mainHeight = frameContentHeight(cell.height, metrics);
  const lineWidth = ptToPx(config.outlineWidthPt);

  const imageWidth = cell.width * 0.34;
  const imageX = cell.x + cell.width - imageWidth;
  const descWidth = cell.width - imageWidth;

  const dataUrl = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    view: viewKey,
    width: Math.round(imageWidth),
    height: Math.round(mainHeight),
    backgroundColor: config.backgroundColor,
    foamColor: config.foamColor,
    voidColor: config.voidColor,
    foamOpacity: config.foamOpacity,
    voidOpacity: config.voidOpacity,
    foamVisible: true,
    voidVisible: true,
  });
  const img = await loadImage(dataUrl);

  ctx.save();
  traceFrame(ctx, cell.x, cell.y, cell.width, cell.height, metrics);
  ctx.clip();
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
  ctx.drawImage(img, imageX, cell.y, imageWidth, mainHeight);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = lineWidth;
  traceFrame(ctx, cell.x, cell.y, cell.width, cell.height, metrics);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(imageX, cell.y);
  ctx.lineTo(imageX, cell.y + mainHeight);
  ctx.stroke();
  ctx.restore();

  const results: DescriptorResult[] = scoreTile(tile);
  const topKeys = new Set(
    [...results]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.key),
  );

  const padding = descWidth * 0.06;
  const listTop = cell.y + Math.max(padding, metrics.chamfer + padding * 0.4);
  const listHeight = cell.y + mainHeight - listTop - padding * 0.5;
  const rowHeight = listHeight / results.length;
  const labelSize = Math.max(9, rowHeight * 0.3);
  const barWidth = descWidth - padding * 2 - labelSize * 2.6;
  const barHeight = Math.max(2, rowHeight * 0.12);

  results.forEach((r, i) => {
    const rowTop = listTop + i * rowHeight;
    const highlighted = topKeys.has(r.key);
    const color = highlighted ? config.highlightColor : config.descriptorColor;

    ctx.fillStyle = color;
    ctx.font = `${highlighted ? "600 " : ""}${labelSize}px "${config.fontFamily}"`;
    ctx.textBaseline = "top";
    ctx.fillText(r.label.toUpperCase(), cell.x + padding, rowTop);

    const barY = rowTop + labelSize * 1.5;
    ctx.fillStyle = `${color}33`;
    ctx.fillRect(cell.x + padding, barY, barWidth, barHeight);
    ctx.fillStyle = color;
    ctx.fillRect(cell.x + padding, barY, (barWidth * r.score) / 100, barHeight);

    ctx.font = `${labelSize}px "${config.fontFamily}"`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(r.score), cell.x + padding + barWidth + labelSize * 0.5, barY + barHeight / 2);
  });

  drawNameTag(ctx, cell, mainHeight, tile.name, config);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't rasterize the board to PNG"));
    }, "image/png");
  });
}

function newCanvas(layout: BoardLayout): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = layout.widthPx;
  canvas.height = layout.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return { canvas, ctx };
}

export async function exportBoardPage1(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const layout = computeLayout(config);
  const { canvas, ctx } = newCanvas(layout);
  drawBackgroundAndTitle(ctx, config, layout);

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
    await drawImageCell(ctx, cell, tile, slot.view, config);
  }
  return canvasToPngBlob(canvas);
}

export async function exportBoardPage2(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const layout = computeLayout(config);
  const { canvas, ctx } = newCanvas(layout);
  drawBackgroundAndTitle(ctx, config, layout);

  let cellIndex = config.textBox.enabled ? 1 : 0;
  for (const slot of config.slots) {
    const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
    const cell = layout.cells[cellIndex];
    cellIndex++;
    if (!tile || !cell) continue;
    await drawDescriptorCell(ctx, cell, tile, slot.view, config);
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
