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
import { createTileRenderer, createTileRig, renderTileToDataUrl, type TileRenderOptions, type TileRig } from "@/lib/renderTile";
import { traceModuleOutline, traceSquareOnly, DIVIDER_X, TOP_EDGE_FRACTION, type TagGeometry } from "./frameShape";
import { squareGridLayout, squareGridCells, fixedGridLayout, type GridCell } from "./grid";
import { fitText, wrapToWidth } from "./textFit";
import { planCatalogue } from "./catalogue";
import { resolveTag, tileLabelText } from "./tileLabel";
import { CATALOGUE_COLUMNS, DPI, type BoardConfig, type BoardDrawing, type BoardSlot, type BoardTextBox } from "./types";
import { drawingFromState } from "@/lib/drawing/state";
import { drawToCanvas, drawingSize, drawingStyle, groundFor } from "@/lib/drawing/render";

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
  /** Index into `cells` of each slot's tile, in slot order. */
  slotCellIndex: number[];
  /** Catalogue cells with no tile yet, drawn as dashed placeholders. */
  placeholders: GridCell[];
  /** Catalogue row/column labels, already laid out. */
  labels: { text: string; x: number; y: number; width: number; height: number; align: "left" | "center" }[];
  /** The name tag's geometry (fractions of the module side). */
  tag: TagGeometry;
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
export function tagGeometry(config: BoardConfig): TagGeometry {
  return { startX: 1 - config.nameTag.widthFraction, height: config.nameTag.heightFraction };
}

export function computeGeometry(config: BoardConfig, dpi: number = DPI, tileById?: Map<string, ParsedTile>): PageGeometry {
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

  const tag = tagGeometry(config);
  const availableWidth = widthPx - margin * 2;
  const availableHeight = gridBottom - titleBottom;
  const base = { widthPx, heightPx, margin, titleFontSizePx, titleBottom, gapX, gapY, footer, tag };

  if (config.catalogue.enabled) {
    const c = config.catalogue;
    const tags = config.slots.map((slot) => resolveTag((slot.tileId ? tileById?.get(slot.tileId)?.name : undefined) ?? "", slot));
    const rows = planCatalogue(tags, c.placeholders);
    const rowBand = c.showRowLabels ? c.rowBandIn * dpi : 0;
    const colBand = c.showColumnLabels ? c.columnBandIn * dpi : 0;
    const layout = fixedGridLayout(CATALOGUE_COLUMNS, Math.max(1, rows.length), availableWidth - rowBand, availableHeight - colBand, gapX, gapY, tag.height);
    if (layout) {
      const cells = squareGridCells(layout, gapX, gapY).map((cell) => ({ x: cell.x + margin + rowBand, y: cell.y + titleBottom + colBand, size: cell.size }));
      const slotCellIndex = config.slots.map(() => 0);
      const placeholders: GridCell[] = [];
      rows.forEach((row, r) =>
        row.items.forEach((slotIndex, col) => {
          const cell = cells[r * CATALOGUE_COLUMNS + col];
          if (!cell) return;
          if (slotIndex !== null) slotCellIndex[slotIndex] = r * CATALOGUE_COLUMNS + col;
          else if (c.placeholders && row.category >= 0) placeholders.push(cell);
        }),
      );
      const labels: PageGeometry["labels"] = [];
      if (c.showRowLabels) {
        let r = 0;
        while (r < rows.length) {
          const cat = rows[r].category;
          let end = r;
          while (end + 1 < rows.length && rows[end + 1].category === cat) end++;
          if (cat >= 0) {
            const count = end - r + 1;
            labels.push({ text: c.rowLabels[cat] ?? "", x: margin, y: cells[r * CATALOGUE_COLUMNS].y, width: Math.max(0, rowBand - gapX / 2), height: count * layout.cellHeight + (count - 1) * gapY, align: "left" });
          }
          r = end + 1;
        }
      }
      if (c.showColumnLabels) {
        for (let col = 0; col < CATALOGUE_COLUMNS; col++) labels.push({ text: c.columnLabels[col] ?? "", x: cells[col].x, y: titleBottom, width: cells[col].size, height: colBand, align: "center" });
      }
      return { ...base, cells, slotCellIndex, placeholders, labels, captionCellIndex: null };
    }
  }

  // one caption cell is held on both pages when either page has a caption, so the tiles stay in the same place on page 1 and page 2
  const hasCaption = config.textBox.enabled || config.textBox2.enabled;
  const captionOffset = hasCaption ? 1 : 0;
  const totalCells = config.slots.length + captionOffset;
  const layout = squareGridLayout(totalCells || 1, availableWidth, availableHeight, gapX, gapY, tag.height);
  const cells = squareGridCells(layout, gapX, gapY).map((cell) => ({ x: cell.x + margin, y: cell.y + titleBottom, size: cell.size }));

  return {
    ...base,
    cells,
    slotCellIndex: config.slots.map((_, i) => i + captionOffset),
    placeholders: [],
    labels: [],
    captionCellIndex: hasCaption ? 0 : null,
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

function drawCaptionCell(ctx: CanvasRenderingContext2D, cell: GridCell, config: BoardConfig, dpi: number, box: BoardTextBox) {
  ctx.save();
  ctx.fillStyle = box.color;
  const padding = cell.size * 0.04;
  const maxWidth = cell.size - padding * 2;
  const maxHeight = cell.size - padding * 2;
  const text = box.text || "";
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

/** The caption box of the page being drawn, when that page has one on. */
function drawPageCaption(ctx: CanvasRenderingContext2D, geo: PageGeometry, config: BoardConfig, dpi: number, page: 1 | 2) {
  const box = page === 1 ? config.textBox : config.textBox2;
  if (box.enabled && geo.captionCellIndex !== null) drawCaptionCell(ctx, geo.cells[geo.captionCellIndex], config, dpi, box);
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
  const nt = config.nameTag;
  const tagTop = cell.y + cell.size;
  const tagHeight = cell.size * nt.heightFraction;
  const tagLeft = cell.x + cell.size * (1 - nt.widthFraction);
  const tagWidth = cell.x + cell.size - tagLeft;
  const padding = cell.size * 0.015;
  const text = tileLabelText(name, slot, nt).toUpperCase();
  const maxLines = Math.max(1, Math.round(nt.maxLines));

  let fontSize: number;
  let lines: string[];
  if (slot.nameFontSizePt) {
    fontSize = ptToPx(slot.nameFontSizePt, dpi);
    ctx.font = `${fontSize}px "${config.fontFamily}"`;
    lines = maxLines > 1 ? wrapToWidth(ctx, text, tagWidth - padding * 2).slice(0, maxLines) : [text];
  } else {
    // Room for the tag's own slanted left side, so text never runs into it.
    const fit = fitText(ctx, text, tagWidth - padding * 2 - tagHeight * 0.4, tagHeight * 0.86, {
      maxFontSize: tagHeight * 0.55,
      minFontSize: Math.max(2, ptToPx(nt.minFontPt, dpi)),
      maxLines,
      fontFamily: config.fontFamily,
    });
    fontSize = fit.fontSize;
    lines = fit.lines;
  }
  ctx.save();
  ctx.fillStyle = config.highlightColor;
  ctx.font = `${fontSize}px "${config.fontFamily}"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  const lineHeight = fontSize * 1.15;
  const firstY = tagTop + tagHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cell.x + cell.size - padding, firstY + i * lineHeight));
  ctx.restore();
}

/** The pixel box a tile's render occupies inside its module: page 1 fills
 * the whole square (above the name tag); page 2 shrinks it into the left
 * portion beside the descriptor list. */
function moduleImageSize(cell: GridCell, page: 1 | 2): { width: number; height: number } {
  return { width: page === 1 ? cell.size : cell.size * DIVIDER_X, height: cell.size };
}

/** Everything about how one slot's tile is rendered -- shared by the still
 * export, the live preview and the turntable animation, so a setting can't
 * mean different things in different places. */
function tileRenderOptions(slot: BoardSlot, tile: ParsedTile, config: BoardConfig, dpi: number, width: number, height: number): TileRenderOptions {
  const o = slot.overrides;
  return {
    glbUrl: tile.glbUrl,
    view: slot.view,
    customCamera: o?.customCamera,
    width,
    height,
    backgroundColor: config.backgroundColor,
    foamColor: o?.foamColor ?? config.foamColor,
    voidColor: o?.voidColor ?? config.voidColor,
    foamOpacity: o?.foamOpacity ?? config.foamOpacity,
    voidOpacity: o?.voidOpacity ?? config.voidOpacity,
    foamVisible: true,
    voidVisible: true,
    clip: o?.clip,
    foamOutline: o?.foamOutline ?? config.foamOutline,
    voidOutline: o?.voidOutline ?? config.voidOutline,
    facetLines: o?.facetLines ?? config.facetLines,
    pxPerPt: dpi / 72,
  };
}

/** What a slot shows: the board's setting with the slot's own changes on top. */
export function slotDrawing(slot: BoardSlot, config: BoardConfig): BoardDrawing {
  return { ...config.drawing, ...slot.drawing };
}

/** The slot's plan or section drawn to fill a module image, on the board's own background (ink and poche contrast with it);
 * null when the slot shows the 3D render. */
function drawingImage(slot: BoardSlot, tile: ParsedTile, config: BoardConfig, width: number, height: number): HTMLCanvasElement | null {
  const bd = slotDrawing(slot, config);
  if (bd.mode === "model") return null;
  const levels = tile.spaces?.levels ?? [];
  const level = bd.level === 0 ? levels[levels.length - 1]?.id : (bd.level ?? levels[0]?.id ?? null);
  const ground = groundFor(config.backgroundColor);
  const d = drawingFromState(tile, { mode: bd.mode, level: level ?? null, axis: bd.axis, pos: bd.pos, ground, labels: bd.labels, route: false });
  if (!d) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const style = { ...drawingStyle(ground) };
  if (ground === "dark") style.foam = config.foamColor;
  const opts = { pxPerFt: 1, caption: false, ruler: false, background: false, labels: bd.labels };
  const unit = drawingSize(d, opts);
  const pxPerFt = Math.min((canvas.width * 0.9) / unit.width, (canvas.height * 0.9) / unit.height);
  const fitted = drawingSize(d, { ...opts, pxPerFt });
  drawToCanvas(ctx, d, style, { ...opts, pxPerFt }, { x: (canvas.width - fitted.width) / 2, y: (canvas.height - fitted.height) / 2 });
  return canvas;
}

/** Lays a rendered tile into its module, clipped to the module's square.
 * (Page 2 first fills the square with the board colour, as the descriptor
 * column to the right of the image has none of its own.) */
function paintModuleImage(ctx: CanvasRenderingContext2D, cell: GridCell, image: CanvasImageSource, page: 1 | 2, config: BoardConfig) {
  const { width, height } = moduleImageSize(cell, page);
  ctx.save();
  traceSquareOnly(ctx, cell.x, cell.y, cell.size);
  ctx.clip();
  if (page === 2) {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
  }
  ctx.drawImage(image, cell.x, cell.y, width, height);
  ctx.restore();
}

/** The static part of a module that sits on top of its tile render: the
 * frame outline and name tag, plus -- on page 2 -- the divider and the
 * scored descriptor list. Nothing here depends on the render, which is what
 * lets the turntable animation draw it once. */
function drawModuleChrome(ctx: CanvasRenderingContext2D, cell: GridCell, slot: BoardSlot, tile: ParsedTile, config: BoardConfig, dpi: number, page: 1 | 2) {
  const lineWidth = ptToPx(config.outlineWidthPt, dpi);

  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.lineWidth = lineWidth;
  traceModuleOutline(ctx, cell.x, cell.y, cell.size, tagGeometry(config));
  ctx.stroke();
  if (page === 2) {
    const descX = cell.x + cell.size * DIVIDER_X;
    ctx.beginPath();
    ctx.moveTo(descX, cell.y + cell.size * TOP_EDGE_FRACTION);
    ctx.lineTo(descX, cell.y + cell.size);
    ctx.stroke();
  }
  ctx.restore();

  if (page === 2) drawDescriptorList(ctx, cell, tile, config);
  drawNameTag(ctx, cell, slot, tile.name, config, dpi);
}

function drawDescriptorList(ctx: CanvasRenderingContext2D, cell: GridCell, tile: ParsedTile, config: BoardConfig) {
  const imageWidth = cell.size * DIVIDER_X;
  const descX = cell.x + imageWidth;
  const descWidth = cell.size - imageWidth;

  const all: DescriptorResult[] = scoreTile(tile);
  const wanted = config.descriptorKeys;
  const results = wanted ? wanted.map((k) => all.find((r) => r.key === k)).filter((r): r is DescriptorResult => !!r) : all;
  if (!results.length) return;
  const topKeys = new Set(
    config.highlight.enabled
      ? [...results]
          .sort((a, b) => b.score - a.score)
          .slice(0, config.highlight.count)
          .map((r) => r.key)
      : [],
  );

  const padding = descWidth * 0.08;
  const chamferInset = cell.size * 0.03;
  const listTop = cell.y + Math.max(padding, chamferInset);
  const listHeight = cell.y + cell.size - padding - listTop;
  const rowHeight = listHeight / results.length;
  const labelMaxWidth = descWidth - padding * 2;
  const barHeight = Math.max(2, rowHeight * 0.1);

  // one label size for the whole list (the smallest any row needs), so the rows read as a set and none runs past the frame
  const labelSize = Math.min(
    ...results.map((r) =>
      fitText(ctx, r.label.toUpperCase(), labelMaxWidth, rowHeight * 0.55, {
        maxFontSize: rowHeight * 0.3,
        minFontSize: 6,
        maxLines: 2,
        fontWeight: topKeys.has(r.key) ? "600" : "",
        fontFamily: config.fontFamily,
      }).fontSize,
    ),
  );

  results.forEach((r, i) => {
    const rowTop = listTop + i * rowHeight;
    const highlighted = topKeys.has(r.key);
    const color = highlighted ? config.highlightColor : config.descriptorColor;
    const fit = fitText(ctx, r.label.toUpperCase(), labelMaxWidth, rowHeight * 0.55, {
      maxFontSize: labelSize,
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

    // the measured quantity under the bar (switched on in the descriptor page settings), when the row is tall enough to hold it
    const small = fit.fontSize * 0.62;
    const textY = barY + barHeight + small * 0.55;
    if (config.descriptorHeadlines && small >= 5 && textY + small < rowTop + rowHeight) {
      ctx.font = `${small}px "${config.fontFamily}"`;
      ctx.fillStyle = `${color}b3`;
      ctx.textBaseline = "top";
      let text = r.quant.headline;
      while (text.length > 4 && ctx.measureText(text).width > labelMaxWidth) text = text.slice(0, -2);
      ctx.fillText(text === r.quant.headline ? text : `${text.trimEnd()}…`, descX + padding, textY);
    }
  });
}

async function drawModule(ctx: CanvasRenderingContext2D, cell: GridCell, slot: BoardSlot, tile: ParsedTile, config: BoardConfig, dpi: number, page: 1 | 2) {
  const { width, height } = moduleImageSize(cell, page);
  const flat = drawingImage(slot, tile, config, width, height);
  if (flat) {
    paintModuleImage(ctx, cell, flat, page, config);
    drawModuleChrome(ctx, cell, slot, tile, config, dpi, page);
    return;
  }
  const dataUrl = await renderTileToDataUrl(tileRenderOptions(slot, tile, config, dpi, Math.round(width), Math.round(height)));
  const img = await loadImage(dataUrl);
  paintModuleImage(ctx, cell, img, page, config);
  drawModuleChrome(ctx, cell, slot, tile, config, dpi, page);
}

interface Module {
  cell: GridCell;
  slot: BoardSlot;
  tile: ParsedTile;
}

/** The cells that actually hold a tile (the caption cell and empty slots
 * are skipped), in drawing order. */
function boardModules(config: BoardConfig, geo: PageGeometry, tileById: Map<string, ParsedTile>): Module[] {
  const out: Module[] = [];
  config.slots.forEach((slot, i) => {
    const tile = slot.tileId ? tileById.get(slot.tileId) : undefined;
    const cell = geo.cells[geo.slotCellIndex[i]];
    if (tile && cell) out.push({ cell, slot, tile });
  });
  return out;
}

/** The catalogue's dashed placeholders and row/column labels (nothing when
 * the catalogue layout is off). */
function drawCatalogueFurniture(ctx: CanvasRenderingContext2D, config: BoardConfig, geo: PageGeometry, dpi: number) {
  const c = config.catalogue;
  if (!c.enabled) return;
  const sample = geo.cells[0]?.size ?? 100;
  ctx.save();
  ctx.strokeStyle = config.descriptorColor;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = ptToPx(config.outlineWidthPt, dpi);
  ctx.setLineDash([sample * 0.03, sample * 0.02]);
  for (const cell of geo.placeholders) {
    traceModuleOutline(ctx, cell.x, cell.y, cell.size, geo.tag);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = c.labelColor;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const label of geo.labels) {
    if (!label.text || label.width <= 0 || label.height <= 0) continue;
    let fontSize: number;
    let lines: string[];
    if (c.labelFontPt) {
      fontSize = ptToPx(c.labelFontPt, dpi);
      ctx.font = `${fontSize}px "${config.fontFamily}"`;
      lines = wrapToWidth(ctx, label.text, label.width * 0.95);
    } else {
      const fit = fitText(ctx, label.text, label.width * 0.92, label.height * 0.9, { maxFontSize: sample * 0.09, minFontSize: 6, maxLines: 3, fontFamily: config.fontFamily });
      fontSize = fit.fontSize;
      lines = fit.lines;
    }
    ctx.font = `${fontSize}px "${config.fontFamily}"`;
    ctx.textAlign = label.align;
    const x = label.align === "center" ? label.x + label.width / 2 : label.x;
    const lineHeight = fontSize * 1.2;
    const firstY = label.y + label.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, x, firstY + i * lineHeight));
  }
  ctx.restore();
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
  const geo = computeGeometry(config, dpi, tileById);
  drawBackgroundAndTitle(ctx, config, geo);
  drawCatalogueFurniture(ctx, config, geo, dpi);
  drawPageCaption(ctx, geo, config, dpi, page);
  for (const m of boardModules(config, geo, tileById)) await drawModule(ctx, m.cell, m.slot, m.tile, config, dpi, page);
  await drawFooter(ctx, config, geo);
  return geo;
}

function newCanvas(widthPx: number, heightPx: number, willReadFrequently = false): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : undefined);
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

export interface BoardAnimation {
  /** Even pixel dimensions (video codecs need them). */
  width: number;
  height: number;
  frameCount: number;
  /** Frame i of the loop: every tile turned 360 * i / frameCount degrees.
   * Frame frameCount would equal frame 0, so it is never drawn. */
  renderFrame(i: number): void;
  /** The composed frame, for the encoders. */
  canvas: HTMLCanvasElement;
  dispose(): void;
}

const evenUp = (n: number) => Math.ceil(n / 2) * 2;

/** Builds a turntable source for one page: the background, title, footer,
 * module frames, name tags and (page 2) descriptor lists are drawn once into
 * two static layers; each frame then only re-aims the tiles' cameras
 * (lib/renderTile.ts TileRig) and composites -- everything below the tile
 * images and everything above them. One shared WebGL renderer serves every
 * tile (they are all the same size), so a 12-tile board uses one context. */
export async function createBoardAnimation(
  config: BoardConfig,
  tileById: Map<string, ParsedTile>,
  page: 1 | 2,
  frameCount: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BoardAnimation> {
  const dpi = config.animation.widthPx / config.widthIn;
  const geo = computeGeometry(config, dpi, tileById);
  const width = evenUp(geo.widthPx);
  const height = evenUp(geo.heightPx);
  const modules = boardModules(config, geo, tileById);
  if (!modules.length) throw new Error("Add at least one tile to the board first.");

  const under = newCanvas(width, height);
  under.ctx.fillStyle = config.backgroundColor;
  under.ctx.fillRect(0, 0, width, height);
  drawBackgroundAndTitle(under.ctx, config, geo);
  drawCatalogueFurniture(under.ctx, config, geo, dpi);
  drawPageCaption(under.ctx, geo, config, dpi, page);
  await drawFooter(under.ctx, config, geo);

  const over = newCanvas(width, height);
  for (const m of modules) drawModuleChrome(over.ctx, m.cell, m.slot, m.tile, config, dpi, page);

  const size = moduleImageSize(modules[0].cell, page);
  const renderer = createTileRenderer(Math.round(size.width), Math.round(size.height), false);
  const rigs: (TileRig | null)[] = [];
  const statics: (HTMLCanvasElement | null)[] = [];
  const release = () => {
    rigs.forEach((r) => r?.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    for (const m of modules) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      // a plan or section does not turn: it is drawn once and held for every frame
      const flat = drawingImage(m.slot, m.tile, config, size.width, size.height);
      statics.push(flat);
      rigs.push(flat ? null : await createTileRig(renderer, tileRenderOptions(m.slot, m.tile, config, dpi, Math.round(size.width), Math.round(size.height))));
      onProgress?.(rigs.length, modules.length);
    }
  } catch (err) {
    release();
    throw err;
  }

  const frame = newCanvas(width, height, true);
  return {
    width,
    height,
    frameCount,
    canvas: frame.canvas,
    renderFrame(i: number) {
      const angle = (360 * i) / frameCount;
      frame.ctx.drawImage(under.canvas, 0, 0);
      modules.forEach((m, k) => {
        const rig = rigs[k];
        if (rig) {
          rig.renderAt(angle);
          paintModuleImage(frame.ctx, m.cell, renderer.domElement, page, config);
        } else if (statics[k]) paintModuleImage(frame.ctx, m.cell, statics[k]!, page, config);
      });
      frame.ctx.drawImage(over.canvas, 0, 0);
    },
    dispose: release,
  };
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
