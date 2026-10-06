// The results of the Analysis as things you can hand in, from the same evaluation the Analysis tab and the Boards read (lib/scoring/matrixEval.ts):
// a table of every tile against the carried criteria (CSV and an image: the value with its unit, how it was obtained, the reading), and an annotated
// diagram per descriptor (a plan or section with the measure drawn on it, the matrix's own words, the value, the reading), as one sheet or one image each.

import { buildDrawing, planSpecs, type Drawing, type DrawingSpec } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, drawingStyle, type Ground, type DrawingStyle } from "@/lib/drawing/render";
import { drawBlock } from "@/lib/textBlock";
import { shortName } from "@/lib/scoring/compare";
import { STATUS_LABEL, type MatrixKey } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
import type { ParsedTile } from "@/lib/types";

export interface ResultRow {
  tile: ParsedTile;
  ev: TileEvaluation;
  /** the reading to show for a criterion: yours when you wrote one */
  reading: (r: MatrixResult) => string;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per tile; per carried criterion: the value, its unit, the status, the headline and the reading. */
export function resultsCsv(rows: ResultRow[], keys: MatrixKey[]): string {
  const names = new Map(rows[0]?.ev.results.map((r) => [r.key, r.criterion.name]) ?? []);
  const head = ["tile", "category", "typology", ...keys.flatMap((k) => [`${names.get(k) ?? k} value`, `${names.get(k) ?? k} unit`, `${names.get(k) ?? k} status`, `${names.get(k) ?? k} result`, `${names.get(k) ?? k} reading`])];
  const lines = [head.map(csvCell).join(",")];
  for (const { tile, ev, reading } of rows) {
    const cells: (string | number)[] = [tile.name, tile.meta?.category ?? tile.guessed.category ?? "", tile.meta?.typology ?? tile.guessed.typology ?? ""];
    for (const k of keys) {
      const r = ev.results.find((x) => x.key === k);
      cells.push(r?.measure.value === null || r === undefined ? "" : Math.round(r.measure.value * 1000) / 1000, r?.measure.unit ?? "", r ? STATUS_LABEL[r.measure.status] : "", r?.measure.headline ?? "", r ? reading(r) : "");
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't write the image."))), "image/png"));

const MONO = "ui-monospace, Menlo, Consolas, 'Courier New', monospace";
const SANS = "system-ui, sans-serif";
const styleOf = (g: Ground | DrawingStyle): DrawingStyle => (typeof g === "string" ? drawingStyle(g) : g);

/** The results table as an image: tiles down the side, carried criteria across, the value, its status and the reading in each cell. */
export async function resultsImage(rows: ResultRow[], keys: MatrixKey[], ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const style = styleOf(ground);
  const names = new Map(rows[0]?.ev.results.map((r) => [r.key, r.criterion.name]) ?? []);
  const nameW = 280;
  const colW = 300;
  const rowH = 190;
  const headH = 74;
  const pad = 24;
  const canvas = document.createElement("canvas");
  const W = pad * 2 + nameW + colW * keys.length;
  const H = pad * 2 + headH + rowH * rows.length;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  keys.forEach((k, i) => {
    drawBlock(ctx, (names.get(k) ?? k).toUpperCase(), pad + nameW + i * colW + 6, pad + 4, colW - 18, headH - 12, { max: 13, min: 7, maxLines: 4, weight: "600", family: MONO, color: style.muted });
  });
  ctx.strokeStyle = style.frame;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(pad, pad + headH);
  ctx.lineTo(W - pad, pad + headH);
  ctx.stroke();
  ctx.globalAlpha = 1;
  rows.forEach(({ tile, ev, reading }, r) => {
    const y = pad + headH + r * rowH;
    drawBlock(ctx, shortName(tile), pad, y + 8, nameW - 16, 48, { max: 15, min: 8, maxLines: 3, weight: "600", family: SANS, color: style.text });
    drawBlock(ctx, tile.meta?.variant ?? "", pad, y + 60, nameW - 16, 18, { max: 11, min: 7, family: MONO, color: style.muted });
    keys.forEach((k, i) => {
      const res = ev.results.find((x) => x.key === k);
      if (!res) return;
      const x = pad + nameW + i * colW + 6;
      const w = colW - 18;
      const h1 = drawBlock(ctx, res.measure.headline, x, y + 6, w, 54, { max: 13, min: 8, maxLines: 3, weight: "600", family: MONO, color: style.text });
      drawBlock(ctx, STATUS_LABEL[res.measure.status].toUpperCase(), x, y + 8 + h1, w, 14, { max: 10, min: 7, family: MONO, color: res.measure.status === "measured" ? style.accent : style.muted });
      drawBlock(ctx, reading(res), x, y + 26 + h1, w, rowH - 32 - h1, { max: 11, min: 6, maxLines: 8, family: SANS, color: style.muted });
    });
  });
  return toBlob(canvas);
}

/** The drawing that shows a descriptor best: a plan through the level it names, or a section along its route or through its room. */
export function diagramSpec(tile: ParsedTile, result: MatrixResult): DrawingSpec {
  const ev = result.evidence;
  const spaces = tile.spaces;
  const route = ev.routePoints?.length ? { points_ft: ev.routePoints } : spaces?.main_route;
  if ((ev.route || ev.routePoints?.length) && route && route.points_ft.length > 1) {
    const a = route.points_ft[0];
    const b = route.points_ft[route.points_ft.length - 1];
    const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    // a section parallel to the route, through its middle
    const mid = route.points_ft[Math.floor(route.points_ft.length / 2)];
    return alongX ? { kind: "section", axis: "y", positionFt: mid[1] } : { kind: "section", axis: "x", positionFt: mid[0] };
  }
  if (ev.levels?.length) return { kind: "plan", level: ev.levels[0] };
  const room = ev.rooms?.length ? spaces?.rooms.find((r) => r.id === ev.rooms![0]) : undefined;
  if (room) return { kind: "section", axis: "x", positionFt: room.centroid_ft[0] };
  const specs = planSpecs(tile);
  return specs.length ? specs[0].spec : { kind: "section", axis: "x", positionFt: tile.tileFt[0] / 2 };
}

export function diagramDrawing(tile: ParsedTile, result: MatrixResult): Drawing | null {
  return buildDrawing(tile, diagramSpec(tile, result), { ...result.evidence });
}

/** One annotated diagram: the drawing with the measure lit, then the descriptor, its status, the value, the reading and the matrix's own words. */
export async function descriptorDiagram(tile: ParsedTile, result: MatrixResult, reading: string, ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const sheet = document.createElement("canvas");
  sheet.width = Math.round(1200 * scale);
  sheet.height = Math.round(560 * scale);
  paintDiagram(sheet, tile, result, reading, ground, scale);
  return toBlob(sheet);
}

function paintDiagram(canvas: HTMLCanvasElement, tile: ParsedTile, result: MatrixResult, reading: string, ground: Ground | DrawingStyle, scale: number, at = { x: 0, y: 0 }, width = 1200, height = 560) {
  const style = styleOf(ground);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = style.bg;
  ctx.fillRect(at.x, at.y, width, height);
  const drawing = diagramDrawing(tile, result);
  const drawW = width * 0.46;
  if (drawing) {
    const unit = drawingSize(drawing, { pxPerFt: 1, caption: false });
    const pxPerFt = Math.min((drawW - 24) / unit.width, (height - 24) / unit.height);
    const fitted = drawingSize(drawing, { pxPerFt, caption: false });
    drawToCanvas(ctx, { ...drawing, labels: [] }, style, { pxPerFt, caption: false, background: false }, { x: at.x + 12 + (drawW - 24 - fitted.width) / 2, y: at.y + 12 + (height - 24 - fitted.height) / 2 });
  }
  const tx = at.x + drawW + 8;
  const tw = width - drawW - 28;
  const bottom = at.y + height - 14;
  let y = at.y + 20;
  const m = result.measure;
  ctx.textBaseline = "top";
  y += drawBlock(ctx, `${shortName(tile).toUpperCase()}${tile.meta?.variant ? "  ·  " + tile.meta.variant : ""}  ·  ${result.criterion.group.toUpperCase()}`, tx, y, tw, 18, { max: 10, min: 6, family: MONO, color: style.muted }) + 6;
  const status = STATUS_LABEL[m.status].toUpperCase();
  ctx.font = `600 11px ${MONO}`;
  const sw = ctx.measureText(status).width + 8;
  const nameH = drawBlock(ctx, result.criterion.name, tx, y, tw - sw - 12, 60, { max: 26, min: 12, maxLines: 2, weight: "600", family: SANS, color: style.text });
  drawBlock(ctx, status, tx + tw - sw, y + 6, sw, 16, { max: 11, min: 11, weight: "600", family: MONO, color: m.status === "measured" ? style.accent : style.muted, align: "right" });
  y += Math.max(nameH, 26) + 8;
  y += drawBlock(ctx, m.headline, tx, y, tw, 52, { max: 14, min: 7, maxLines: 3, weight: "600", family: MONO, color: style.text }) + 3;
  if (m.value !== null) y += drawBlock(ctx, m.unit, tx, y, tw, 28, { max: 10, min: 6, maxLines: 2, family: MONO, color: style.muted }) + 6;
  const sup = m.supporting.slice(0, 5).map((s) => `${s.label}: ${s.value}`);
  for (const line of sup) y += drawBlock(ctx, line, tx, y, tw, 26, { max: 10, min: 6, maxLines: 2, family: MONO, color: style.muted }) + 2;
  y += 6;
  const rest = bottom - y;
  const readH = Math.max(34, rest * 0.4);
  y += drawBlock(ctx, reading, tx, y, tw, readH, { max: 12, min: 6, maxLines: 8, family: SANS, color: style.text }) + 6;
  const c = result.criterion;
  drawBlock(ctx, `Matrix: ${c.qualitative}  ${c.quantitative}  Precedent: ${c.precedent}`, tx, y, tw, Math.max(20, bottom - y), { max: 10, min: 5, maxLines: 8, family: SANS, color: style.muted });
  ctx.restore();
}

/** Every descriptor's annotated diagram on one sheet (two columns). */
export async function diagramSheet(tile: ParsedTile, results: MatrixResult[], reading: (r: MatrixResult) => string, ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const w = 1200;
  const h = 560;
  const cols = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cols * w * scale);
  canvas.height = Math.round(Math.ceil(results.length / cols) * h * scale);
  results.forEach((r, i) => paintDiagram(canvas, tile, r, reading(r), ground, scale, { x: (i % cols) * w, y: Math.floor(i / cols) * h }, w, h));
  return toBlob(canvas);
}
