// Composes a Board (lib/boards/types.ts) onto a full print-resolution 2D
// canvas and rasterizes it to a PNG -- page 1 is the tile renders (image +
// name tag only), page 2 keeps the identical module shape but splits it:
// image on the left, that tile's scored descriptors (lib/scoring/
// descriptors.ts) listed on the right, top 3 highlighted. Both pages share
// the exact same module geometry (lib/boards/frameShape.ts, lib/boards/
// grid.ts) so they line up if viewed side by side -- and the live preview
// (components/boards/BoardPreviewCanvas.tsx) calls these same functions,
// so what you see really is what you get.

import { scoreTile, type DescriptorResult } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";
import { renderTileToDataUrl } from "./renderTile";
import { traceModuleOutline, traceSquareOnly, DIVIDER_X, TAG_HEIGHT_FRACTION, TOP_EDGE_FRACTION } from "./frameShape";
import { squareGridLayout, squareGridCells, type GridCell } from "./grid";
import { fitText, wrapToWidth } from "./textFit";
import { DPI, shortTileLabel, type BoardConfig, type BoardSlot } from "./types";

export function ptToPx(pt: number, dpi: number = DPI): number {
  return (pt / 72) * dpi;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load rendered tile image"));
    img.src = src;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

let logoImagePromise: Promise<HTMLImageElement> | null = null;
function loadLogoImage(): Promise<HTMLImageElement> {
  if (!logoImagePromise) logoImagePromise = loadImage("/school-logo.png");
  return logoImagePromise;
}

const tintedLogoCache = new Map<string, HTMLCanvasElement>();

/** The school logo is a flat white-on-black PNG (no alpha channel), so it
 * can't just be drawn in an arbitrary color or over a non-black board --
 * this re-derives an alpha channel from each pixel's brightness (bright =
 * opaque line art, dark = transparent background) and recolors the result
 * to match the footer's one color picker. Cached per color since it's the
 * same handful of colors across every redraw of a given board. */
async function getTintedLogo(color: string): Promise<HTMLCanvasElement> {
  const cached = tintedLogoCache.get(color);
  if (cached) return cached;

  const img = await loadLogoImage();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const [r, g, b] = hexToRgb(color);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = luminance;
  }
  ctx.putImageData(imageData, 0, 0);
  tintedLogoCache.set(color, canvas);
  return canvas;
}

export interface PageGeometry {
  widthPx: number;
  heightPx: number;
  margin: number;
  titleFontSizePx: number;
  titleBottom: number;
  gapX: number;
  gapY: number;
  cells: GridCell[];
  /** Index into `cells` the caption occupies, or null if disabled. */
  captionCellIndex: number | null;
  /** Null when the footer is off. Otherwise everything needed to draw it:
   * the rule's y position, and the vertical center of the text/logo row
   * below it. */
  footer: { fontSizePx: number; lineY: number; textCenterY: number } | null;
}

/** Everything about where things go, independent of what's actually drawn
 * in each cell -- shared by both pages and by the live preview, so a
 * setting change moves things identically everywhere. */
export function computeGeometry(config: BoardConfig, dpi: number = DPI): PageGeometry {
  const widthPx = Math.round(config.widthIn * dpi);
  const heightPx = Math.round(config.heightIn * dpi);
  const margin = dpi * 0.4;
  const titleFontSizePx = config.titleFontSizePt ? ptToPx(config.titleFontSizePt, dpi) : heightPx * 0.032;
  const titleBottom = margin + titleFontSizePx * 1.8;
  const gapX = config.gapXIn * dpi;
  const gapY = config.gapYIn * dpi;

  let footer: PageGeometry["footer"] = null;
  let gridBottom = heightPx - margin;
  if (config.footer.enabled) {
    const fontSizePx = config.footerFontSizePt ? ptToPx(config.footerFontSizePt, dpi) : heightPx * 0.016;
    const gapAboveLine = fontSizePx * 0.9;
    const gapBelowLine = fontSizePx * 0.9;
    const bottomPad = fontSizePx * 0.5;
    const totalFooterHeight = gapAboveLine + gapBelowLine + fontSizePx + bottomPad;
    gridBottom = heightPx - margin - totalFooterHeight;
    const lineY = gridBottom + gapAboveLine;
    footer = { fontSizePx, lineY, textCenterY: lineY + gapBelowLine + fontSizePx / 2 };
  }

  const totalCells = config.slots.length + (config.textBox.enabled ? 1 : 0);
  const availableWidth = widthPx - margin * 2;
  const availableHeight = gridBottom - titleBottom;
  const layout = squareGridLayout(totalCells || 1, availableWidth, availableHeight, gapX, gapY);
  const cells = squareGridCells(layout, gapX, gapY).map((cell) => ({ x: cell.x + margin, y: cell.y + titleBottom, size: cell.size }));

  return {
    widthPx,
    heightPx,
    margin,
    titleFontSizePx,
    titleBottom,
    gapX,
    gapY,
    cells,
    captionCellIndex: config.textBox.enabled ? 0 : null,
    footer,
  };
}

function drawBackgroundAndTitle(ctx: CanvasRenderingContext2D, config: BoardConfig, geo: PageGeometry) {
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, geo.widthPx, geo.heightPx);
  ctx.fillStyle = config.titleColor;
  ctx.font = `600 ${geo.titleFontSizePx}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  ctx.fillText(config.name.toUpperCase(), geo.margin, geo.margin);
}

function drawCaptionCell(ctx: CanvasRenderingContext2D, cell: GridCell, config: BoardConfig, dpi: number) {
  ctx.save();
  ctx.fillStyle = config.textBox.color;
  const padding = cell.size * 0.04;
  const maxWidth = cell.size - padding * 2;
  const maxHeight = cell.size - padding * 2;
  const text = config.textBox.text || "";
  let fontSize: number;
  let lines: string[];
  if (config.captionFontSizePt) {
    fontSize = ptToPx(config.captionFontSizePt, dpi);
    ctx.font = `${fontSize}px "${config.fontFamily}"`;
    lines = wrapToWidth(ctx, text, maxWidth);
  } else {
    const fit = fitText(ctx, text, maxWidth, maxHeight, { maxFontSize: cell.size * 0.08, minFontSize: 8, maxLines: 20, fontFamily: config.fontFamily });
    fontSize = fit.fontSize;
    lines = fit.lines;
  }
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, cell.x + padding, cell.y + padding + i * fontSize * 1.3));
  ctx.restore();
}

/** The credit line along the bottom: a rule spanning the full content
 * width, the school logo + left text flush left, the right text flush
 * right -- one color for all of it. The line's length is just however
 * wide the page's margin-to-margin content area is, so it scales with the
 * board automatically; the two text blocks stay pinned to its two ends. */
async function drawFooter(ctx: CanvasRenderingContext2D, config: BoardConfig, geo: PageGeometry) {
  if (!geo.footer) return;
  const { footer } = config;
  const { fontSizePx, lineY, textCenterY } = geo.footer;

  ctx.save();
  ctx.strokeStyle = footer.color;
  ctx.lineWidth = Math.max(1, fontSizePx * 0.045);
  ctx.beginPath();
  ctx.moveTo(geo.margin, lineY);
  ctx.lineTo(geo.widthPx - geo.margin, lineY);
  ctx.stroke();
  ctx.restore();

  const logoSize = fontSizePx * 1.3;
  const logo = await getTintedLogo(footer.color);

  ctx.save();
  ctx.drawImage(logo, geo.margin, textCenterY - logoSize / 2, logoSize, logoSize);

  ctx.fillStyle = footer.color;
  ctx.font = `${fontSizePx}px "${config.fontFamily}"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(footer.leftText, geo.margin + logoSize + fontSizePx * 0.45, textCenterY);

  ctx.textAlign = "right";
  ctx.fillText(footer.rightText, geo.widthPx - geo.margin, textCenterY);
  ctx.restore();
}

function drawNameTag(ctx: CanvasRenderingContext2D, cell: GridCell, slot: BoardSlot, name: string, config: BoardConfig, dpi: number) {
  const tagTop = cell.y + cell.size;
  const tagHeight = cell.size * TAG_HEIGHT_FRACTION;
  const tagLeft = cell.x + cell.size * DIVIDER_X;
  const tagWidth = cell.x + cell.size - tagLeft;
  const padding = cell.size * 0.015;
  const text = shortTileLabel(name).toUpperCase();

  let fontSize: number;
  if (slot.nameFontSizePt) {
    fontSize = ptToPx(slot.nameFontSizePt, dpi);
  } else {
    fontSize = fitText(ctx, text, tagWidth - padding * 2, tagHeight * 0.8, { maxFontSize: tagHeight * 0.55, minFontSize: 6, maxLines: 1, fontFamily: config.fontFamily }).fontSize;
  }
  ctx.save();
  ctx.fillStyle = config.highlightColor;
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(text, cell.x + cell.size - padding, tagTop + tagHeight / 2);
  ctx.restore();
}

/** Page 1: the tile render fills the whole square (above the name tag), at
 * its own exact aspect ratio (renderTileToDataUrl fits the camera to
 * whichever axis is tighter), so nothing is cropped. */
async function drawImageModule(ctx: CanvasRenderingContext2D, cell: GridCell, slot: BoardSlot, tile: ParsedTile, config: BoardConfig, dpi: number) {
  const lineWidth = ptToPx(config.outlineWidthPt, dpi);

  const dataUrl = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    view: slot.view,
    width: Math.round(cell.size),
    height: Math.round(cell.size),
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
  traceSquareOnly(ctx, cell.x, cell.y, cell.size);
  ctx.clip();
  ctx.drawImage(img, cell.x, cell.y, cell.size, cell.size);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = lineWidth;
  traceModuleOutline(ctx, cell.x, cell.y, cell.size);
  ctx.stroke();
  ctx.restore();

  drawNameTag(ctx, cell, slot, tile.name, config, dpi);
}

/** Page 2: the tile render is shrunk into the left portion, its scored
 * descriptors listed in the right column -- same outer shape, same name
 * tag, as page 1. */
async function drawDescriptorModule(ctx: CanvasRenderingContext2D, cell: GridCell, slot: BoardSlot, tile: ParsedTile, config: BoardConfig, dpi: number) {
  const lineWidth = ptToPx(config.outlineWidthPt, dpi);
  const imageWidth = cell.size * DIVIDER_X;
  const descX = cell.x + imageWidth;
  const descWidth = cell.size - imageWidth;

  const dataUrl = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    view: slot.view,
    width: Math.round(imageWidth),
    height: Math.round(cell.size),
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
  traceSquareOnly(ctx, cell.x, cell.y, cell.size);
  ctx.clip();
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
  ctx.drawImage(img, cell.x, cell.y, imageWidth, cell.size);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = lineWidth;
  traceModuleOutline(ctx, cell.x, cell.y, cell.size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(descX, cell.y + cell.size * TOP_EDGE_FRACTION);
  ctx.lineTo(descX, cell.y + cell.size);
  ctx.stroke();
  ctx.restore();

  const results: DescriptorResult[] = scoreTile(tile);
  const topKeys = new Set(
    [...results]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.key),
  );

  const padding = descWidth * 0.08;
  const chamferInset = cell.size * 0.03;
  const listTop = cell.y + Math.max(padding, chamferInset);
  const listHeight = cell.y + cell.size - padding - listTop;
  const rowHeight = listHeight / results.length;
  const labelMaxWidth = descWidth - padding * 2;
  const barHeight = Math.max(2, rowHeight * 0.1);

  results.forEach((r, i) => {
    const rowTop = listTop + i * rowHeight;
    const highlighted = topKeys.has(r.key);
    const color = highlighted ? config.highlightColor : config.descriptorColor;
    const fit = fitText(ctx, r.label.toUpperCase(), labelMaxWidth, rowHeight * 0.55, {
      maxFontSize: rowHeight * 0.3,
      minFontSize: 6,
      maxLines: 2,
      fontWeight: highlighted ? "600" : "",
      fontFamily: config.fontFamily,
    });

    ctx.fillStyle = color;
    ctx.font = `${highlighted ? "600 " : ""}${fit.fontSize}px "${config.fontFamily}"`;
    ctx.textBaseline = "top";
    fit.lines.forEach((line, li) => ctx.fillText(line, descX + padding, rowTop + li * fit.fontSize * 1.15));

    const barY = rowTop + fit.lines.length * fit.fontSize * 1.15 + barHeight * 0.6;
    const barWidth = labelMaxWidth - fit.fontSize * 2;
    ctx.fillStyle = `${color}33`;
    ctx.fillRect(descX + padding, barY, barWidth, barHeight);
    ctx.fillStyle = color;
    ctx.fillRect(descX + padding, barY, (barWidth * r.score) / 100, barHeight);

    ctx.font = `${fit.fontSize}px "${config.fontFamily}"`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(r.score), descX + padding + barWidth + fit.fontSize * 0.4, barY + barHeight / 2);
  });

  drawNameTag(ctx, cell, slot, tile.name, config, dpi);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't rasterize the board to PNG"));
    }, "image/png");
  });
}

/** Draws one full page (1 or 2) onto an already-sized canvas context --
 * shared by the real export (full print resolution) and the live preview
 * (a smaller canvas), so they can never drift apart. */
export async function drawBoardPage(
  ctx: CanvasRenderingContext2D,
  config: BoardConfig,
  tileById: Map<string, ParsedTile>,
  page: 1 | 2,
  dpi: number = DPI,
): Promise<PageGeometry> {
  const geo = computeGeometry(config, dpi);
  drawBackgroundAndTitle(ctx, config, geo);

  for (let i = 0; i < geo.cells.length; i++) {
    const cell = geo.cells[i];
    if (geo.captionCellIndex === i) {
      if (page === 1) drawCaptionCell(ctx, cell, config, dpi);
      continue;
    }
    const slotIndex = geo.captionCellIndex !== null ? i - 1 : i;
    const slot = config.slots[slotIndex];
    const tile = slot?.tileId ? tileById.get(slot.tileId) : undefined;
    if (!slot || !tile) continue;
    if (page === 1) await drawImageModule(ctx, cell, slot, tile, config, dpi);
    else await drawDescriptorModule(ctx, cell, slot, tile, config, dpi);
  }
  await drawFooter(ctx, config, geo);
  return geo;
}

function newCanvas(widthPx: number, heightPx: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return { canvas, ctx };
}

export async function exportBoardPage1(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const { canvas, ctx } = newCanvas(Math.round(config.widthIn * DPI), Math.round(config.heightIn * DPI));
  await drawBoardPage(ctx, config, tileById, 1);
  return canvasToPngBlob(canvas);
}

export async function exportBoardPage2(config: BoardConfig, tileById: Map<string, ParsedTile>): Promise<Blob> {
  const { canvas, ctx } = newCanvas(Math.round(config.widthIn * DPI), Math.round(config.heightIn * DPI));
  await drawBoardPage(ctx, config, tileById, 2);
  return canvasToPngBlob(canvas);
}

/** Renders a page directly onto an existing on-screen <canvas>, sized to
 * `targetWidthPx` wide (height follows the board's own aspect ratio) --
 * the live preview's only path, so it is pixel-for-pixel the same drawing
 * code as the real export, just at a smaller effective DPI. */
export async function renderBoardPreview(canvas: HTMLCanvasElement, config: BoardConfig, tileById: Map<string, ParsedTile>, page: 1 | 2, targetWidthPx: number): Promise<void> {
  const dpi = targetWidthPx / config.widthIn;
  const widthPx = Math.round(targetWidthPx);
  const heightPx = Math.round(config.heightIn * dpi);
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await drawBoardPage(ctx, config, tileById, page, dpi);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
