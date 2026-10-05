// The results of the Analysis as things you can hand in: a table of every tile against the carried criteria (CSV and an
// image), and an annotated diagram per descriptor (the plan or section with the measure drawn on it, the number and the
// sentence beside it), as one sheet or one image each.

import { buildDrawing, planSpecs, type Drawing, type DrawingSpec } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, drawingStyle, type Ground, type DrawingStyle } from "@/lib/drawing/render";
import { drawBlock } from "@/lib/textBlock";
import type { DescriptorResult } from "@/lib/scoring/descriptors";
import { shortName } from "@/lib/scoring/compare";
import type { DescriptorKey } from "@/lib/scoring/descriptors";
import type { ParsedTile } from "@/lib/types";

export interface ResultRow {
  tile: ParsedTile;
  results: DescriptorResult[];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per tile; per carried criterion: score, reading, headline quantity. */
export function resultsCsv(rows: ResultRow[], keys: DescriptorKey[]): string {
  const labels = new Map(rows[0]?.results.map((r) => [r.key, r.label]) ?? []);
  const head = ["tile", "category", "typology", ...keys.flatMap((k) => [`${labels.get(k) ?? k} score`, `${labels.get(k) ?? k} reading`, `${labels.get(k) ?? k} measure`])];
  const lines = [head.map(csvCell).join(",")];
  for (const { tile, results } of rows) {
    const cells: (string | number)[] = [tile.name, tile.meta?.category ?? tile.guessed.category ?? "", tile.meta?.typology ?? tile.guessed.typology ?? ""];
    for (const k of keys) {
      const r = results.find((x) => x.key === k);
      cells.push(r ? r.score : "", r ? r.qualitative.reading : "", r ? r.quant.headline : "");
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't write the image."))), "image/png"));

/** The results table as an image: tiles down the side, carried criteria across, score and reading in each cell. */
const MONO = "ui-monospace, Menlo, monospace";
const SANS = "system-ui, sans-serif";
const styleOf = (g: Ground | DrawingStyle): DrawingStyle => (typeof g === "string" ? drawingStyle(g) : g);

export async function resultsImage(rows: ResultRow[], keys: DescriptorKey[], ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const style = styleOf(ground);
  const labels = new Map(rows[0]?.results.map((r) => [r.key, r.label]) ?? []);
  const nameW = 300;
  const colW = 190;
  const rowH = 92;
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
  ctx.font = "600 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = style.muted;
  keys.forEach((k, i) => {
    drawBlock(ctx, (labels.get(k) ?? k).toUpperCase(), pad + nameW + i * colW + 6, pad + 4, colW - 14, headH - 12, { max: 13, min: 7, maxLines: 4, weight: "600", family: MONO, color: style.muted });
  });
  ctx.strokeStyle = style.frame;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(pad, pad + headH);
  ctx.lineTo(W - pad, pad + headH);
  ctx.stroke();
  ctx.globalAlpha = 1;
  rows.forEach(({ tile, results }, r) => {
    const y = pad + headH + r * rowH;
    drawBlock(ctx, shortName(tile), pad, y + 8, nameW - 16, 44, { max: 15, min: 8, maxLines: 3, weight: "600", family: SANS, color: style.text });
    drawBlock(ctx, tile.meta?.variant ?? "", pad, y + 56, nameW - 16, 18, { max: 11, min: 7, family: MONO, color: style.muted });
    keys.forEach((k, i) => {
      const res = results.find((x) => x.key === k);
      if (!res) return;
      const x = pad + nameW + i * colW + 6;
      drawBlock(ctx, String(res.score), x, y + 4, 48, 34, { max: 26, min: 14, weight: "600", family: SANS, color: style.text });
      drawBlock(ctx, res.qualitative.reading, x + 52, y + 10, colW - 66, 30, { max: 13, min: 7, maxLines: 2, family: SANS, color: style.accent });
      drawBlock(ctx, res.quant.headline, x, y + 40, colW - 16, rowH - 46, { max: 11, min: 6, maxLines: 5, family: MONO, color: style.muted });
    });
  });
  return toBlob(canvas);
}

/** The drawing that shows a descriptor best: a plan through the level it names, or a section along its route or through its room. */
export function diagramSpec(tile: ParsedTile, result: DescriptorResult): DrawingSpec {
  const ev = result.evidence;
  const spaces = tile.spaces;
  const route = spaces?.main_route;
  if (ev.route && route && route.points_ft.length > 1) {
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

export function diagramDrawing(tile: ParsedTile, result: DescriptorResult): Drawing | null {
  return buildDrawing(tile, diagramSpec(tile, result), { ...result.evidence });
}

/** One annotated diagram: the drawing with the measure lit, then the descriptor, its score, the quantity and the sentence. */
export async function descriptorDiagram(tile: ParsedTile, result: DescriptorResult, ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const sheet = document.createElement("canvas");
  sheet.width = Math.round(1200 * scale);
  sheet.height = Math.round(520 * scale);
  paintDiagram(sheet, tile, result, ground, scale);
  return toBlob(sheet);
}

function paintDiagram(canvas: HTMLCanvasElement, tile: ParsedTile, result: DescriptorResult, ground: Ground | DrawingStyle, scale: number, at = { x: 0, y: 0 }, width = 1200, height = 520) {
  const style = styleOf(ground);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = style.bg;
  ctx.fillRect(at.x, at.y, width, height);
  const drawing = diagramDrawing(tile, result);
  const drawW = width * 0.5;
  if (drawing) {
    const unit = drawingSize(drawing, { pxPerFt: 1, caption: false });
    const pxPerFt = Math.min((drawW - 24) / unit.width, (height - 24) / unit.height);
    const fitted = drawingSize(drawing, { pxPerFt, caption: false });
    drawToCanvas(ctx, { ...drawing, labels: [] }, style, { pxPerFt, caption: false, background: false }, { x: at.x + 12 + (drawW - 24 - fitted.width) / 2, y: at.y + 12 + (height - 24 - fitted.height) / 2 });
  }
  const tx = at.x + drawW + 8;
  const tw = width - drawW - 28;
  const bottom = at.y + height - 14;
  let y = at.y + 22;
  ctx.textBaseline = "top";
  y += drawBlock(ctx, `${shortName(tile).toUpperCase()}${tile.meta?.variant ? "  ·  " + tile.meta.variant : ""}`, tx, y, tw, 20, { max: 11, min: 7, family: MONO, color: style.muted }) + 6;
  // the name of the measure and its score on one line: the name takes the room the score leaves
  const scoreText = String(result.score);
  ctx.font = `600 26px ${SANS}`;
  const scoreW = ctx.measureText(scoreText).width;
  const nameH = drawBlock(ctx, result.label, tx, y, tw - scoreW - 20, 64, { max: 26, min: 12, maxLines: 2, weight: "600", family: SANS, color: style.text });
  drawBlock(ctx, scoreText, tx + tw - scoreW, y, scoreW + 2, 34, { max: 26, min: 26, weight: "600", family: SANS, color: style.accent, align: "right" });
  y += Math.max(nameH, 34) + 8;
  y += drawBlock(ctx, `${result.qualitative.reading}   (${result.qualitative.scale.join("  ›  ")})`, tx, y, tw, 48, { max: 14, min: 7, maxLines: 2, family: SANS, color: style.accent }) + 10;
  y += drawBlock(ctx, result.quant.headline, tx, y, tw, 70, { max: 13, min: 7, maxLines: 3, weight: "600", family: MONO, color: style.text }) + 8;
  const budget = bottom - y;
  // the supporting numbers get at most 40% of what is left, the explanation the rest
  const sup = result.quant.supporting.map((s) => `${s.label}: ${s.value}`);
  const perLine = sup.length ? Math.min(30, (budget * 0.4) / sup.length) : 0;
  for (const line of sup) y += drawBlock(ctx, line, tx, y, tw, perLine, { max: 11, min: 6, maxLines: 2, family: MONO, color: style.muted }) + 3;
  y += 8;
  drawBlock(ctx, result.explanation, tx, y, tw, Math.max(20, bottom - y), { max: 13, min: 6, maxLines: 14, family: SANS, color: style.text });
  ctx.restore();
}

/** Every descriptor's annotated diagram on one sheet (two columns). */
export async function diagramSheet(tile: ParsedTile, results: DescriptorResult[], ground: Ground | DrawingStyle, scale = 1): Promise<Blob> {
  const w = 1200;
  const h = 520;
  const cols = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cols * w * scale);
  canvas.height = Math.round(Math.ceil(results.length / cols) * h * scale);
  results.forEach((r, i) => paintDiagram(canvas, tile, r, ground, scale, { x: (i % cols) * w, y: Math.floor(i / cols) * h }, w, h));
  return toBlob(canvas);
}
