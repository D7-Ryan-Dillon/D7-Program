// The results of the Analysis as things you can hand in: a table of every tile against the carried criteria (CSV and an
// image), and an annotated diagram per descriptor (the plan or section with the measure drawn on it, the number and the
// sentence beside it), as one sheet or one image each.

import { buildDrawing, planSpecs, type Drawing, type DrawingSpec } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, drawingStyle, type Ground } from "@/lib/drawing/render";
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

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't write the image."))), "image/png"));

/** The results table as an image: tiles down the side, carried criteria across, score and reading in each cell. */
export async function resultsImage(rows: ResultRow[], keys: DescriptorKey[], ground: Ground): Promise<Blob> {
  const style = drawingStyle(ground);
  const labels = new Map(rows[0]?.results.map((r) => [r.key, r.label]) ?? []);
  const nameW = 300;
  const colW = 190;
  const rowH = 92;
  const headH = 74;
  const pad = 24;
  const canvas = document.createElement("canvas");
  canvas.width = pad * 2 + nameW + colW * keys.length;
  canvas.height = pad * 2 + headH + rowH * rows.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.font = "600 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = style.muted;
  keys.forEach((k, i) => {
    const lines = wrap(ctx, (labels.get(k) ?? k).toUpperCase(), colW - 14);
    lines.slice(0, 3).forEach((l, n) => ctx.fillText(l, pad + nameW + i * colW + 6, pad + 8 + n * 16));
  });
  ctx.strokeStyle = style.frame;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(pad, pad + headH);
  ctx.lineTo(canvas.width - pad, pad + headH);
  ctx.stroke();
  ctx.globalAlpha = 1;
  rows.forEach(({ tile, results }, r) => {
    const y = pad + headH + r * rowH;
    ctx.fillStyle = style.text;
    ctx.font = "600 15px system-ui, sans-serif";
    wrap(ctx, shortName(tile), nameW - 16).slice(0, 2).forEach((l, n) => ctx.fillText(l, pad, y + 10 + n * 19));
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = style.muted;
    ctx.fillText(tile.meta?.variant ?? "", pad, y + 52);
    keys.forEach((k, i) => {
      const res = results.find((x) => x.key === k);
      if (!res) return;
      const x = pad + nameW + i * colW + 6;
      ctx.fillStyle = style.text;
      ctx.font = "600 26px system-ui, sans-serif";
      ctx.fillText(String(res.score), x, y + 6);
      ctx.fillStyle = style.accent;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(res.qualitative.reading, x + 52, y + 12);
      ctx.fillStyle = style.muted;
      ctx.font = "11px ui-monospace, Menlo, monospace";
      wrap(ctx, res.quant.headline, colW - 16).slice(0, 3).forEach((l, n) => ctx.fillText(l, x, y + 42 + n * 14));
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
export async function descriptorDiagram(tile: ParsedTile, result: DescriptorResult, ground: Ground): Promise<Blob> {
  const sheet = document.createElement("canvas");
  sheet.width = 1200;
  sheet.height = 520;
  paintDiagram(sheet, tile, result, ground, 1);
  return toBlob(sheet);
}

function paintDiagram(canvas: HTMLCanvasElement, tile: ParsedTile, result: DescriptorResult, ground: Ground, scale: number, at = { x: 0, y: 0 }, width = 1200, height = 520) {
  const style = drawingStyle(ground);
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
  let y = at.y + 22;
  ctx.textBaseline = "top";
  ctx.fillStyle = style.muted;
  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.fillText(`${shortName(tile).toUpperCase()}${tile.meta?.variant ? "  ·  " + tile.meta.variant : ""}`, tx, y);
  y += 22;
  ctx.fillStyle = style.text;
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillText(result.label, tx, y);
  const scoreW = ctx.measureText(result.label).width;
  ctx.fillStyle = style.accent;
  ctx.fillText(String(result.score), tx + scoreW + 16, y);
  y += 40;
  ctx.fillStyle = style.accent;
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`${result.qualitative.reading}   (${result.qualitative.scale.join("  ›  ")})`, tx, y);
  y += 26;
  ctx.fillStyle = style.text;
  ctx.font = "600 13px ui-monospace, Menlo, monospace";
  wrap(ctx, result.quant.headline, tw).forEach((l) => {
    ctx.fillText(l, tx, y);
    y += 18;
  });
  y += 6;
  ctx.fillStyle = style.muted;
  ctx.font = "11px ui-monospace, Menlo, monospace";
  for (const s of result.quant.supporting) {
    wrap(ctx, `${s.label}: ${s.value}`, tw).forEach((l) => {
      ctx.fillText(l, tx, y);
      y += 15;
    });
  }
  y += 10;
  ctx.fillStyle = style.text;
  ctx.font = "13px system-ui, sans-serif";
  wrap(ctx, result.explanation, tw).forEach((l) => {
    if (y < at.y + height - 14) ctx.fillText(l, tx, y);
    y += 18;
  });
  ctx.restore();
}

/** Every descriptor's annotated diagram on one sheet (two columns). */
export async function diagramSheet(tile: ParsedTile, results: DescriptorResult[], ground: Ground): Promise<Blob> {
  const w = 1200;
  const h = 520;
  const cols = 2;
  const canvas = document.createElement("canvas");
  canvas.width = cols * w;
  canvas.height = Math.ceil(results.length / cols) * h;
  results.forEach((r, i) => paintDiagram(canvas, tile, r, ground, 1, { x: (i % cols) * w, y: Math.floor(i / cols) * h }, w, h));
  return toBlob(canvas);
}
