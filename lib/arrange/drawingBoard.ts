// All the plans and sections of a tile (or an arrangement) on one board, with its information: a title, the key numbers and a legend,
// every drawing at the same scale with its own caption, in the palette's colours. Text is fitted to its box (lib/textBlock.ts).

import type { ParsedTile } from "@/lib/types";
import { buildDrawing, type Drawing } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize } from "@/lib/drawing/render";
import { paletteStyle, type Palette } from "@/lib/boardPalette";
import { drawBlock } from "@/lib/textBlock";

export interface DrawingBoardOptions {
  title: string;
  /** key numbers shown beside the title, as [label, value] */
  info: [string, string][];
  palette: Palette;
  /** board width in pixels (the height follows the content) */
  widthPx: number;
  /** drawings per row */
  columns: number;
  /** room labels on the plans */
  labels: boolean;
  /** at most this many plans (levels are picked evenly) */
  maxPlans?: number;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the board."))), "image/png"));

function collect(tile: ParsedTile, maxPlans: number): { plans: Drawing[]; sections: Drawing[] } {
  const levels = tile.spaces?.levels ?? [];
  const pick = levels.length <= maxPlans ? levels : Array.from({ length: maxPlans }, (_, i) => levels[Math.round((i * (levels.length - 1)) / (maxPlans - 1))]);
  const plans = pick.map((lv) => buildDrawing(tile, { kind: "plan", level: lv.id })).filter((d): d is Drawing => !!d);
  const sections: Drawing[] = [];
  for (const axis of ["x", "y"] as const) {
    const span = tile.tileFt[axis === "x" ? 0 : 1];
    const n = tile.grid[axis === "x" ? 0 : 1];
    for (const frac of [0.25, 0.5, 0.75]) {
      const k = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
      const d = buildDrawing(tile, { kind: "section", axis, positionFt: Math.min((k + 0.5) * tile.cellFt, span) });
      if (d) sections.push(d);
    }
  }
  return { plans, sections };
}

/** The board as a PNG; null when the tile has nothing to draw. */
export async function buildDrawingBoard(tile: ParsedTile, o: DrawingBoardOptions): Promise<Blob | null> {
  const { plans, sections } = collect(tile, o.maxPlans ?? 9);
  if (!plans.length && !sections.length) return null;
  const P = o.palette;
  const style = paletteStyle(P);
  const W = Math.max(1200, o.widthPx);
  const k = W / 3300; // everything is laid out for 3300 px and scaled with the board
  const M = 90 * k;
  const gap = 36 * k;
  const cols = Math.max(1, Math.min(6, Math.round(o.columns)));
  const cellW = (W - 2 * M - (cols - 1) * gap) / cols;
  // one scale for every drawing: the widest drawing fills its cell
  const all = [...plans, ...sections];
  const widest = Math.max(...all.map((d) => drawingSize(d, { pxPerFt: 1, ruler: true, caption: false }).width));
  const s = cellW / widest;
  const captionH = 96 * k;

  type Row = { drawings: Drawing[]; h: number };
  const rowsOf = (list: Drawing[]): Row[] => {
    const rows: Row[] = [];
    for (let i = 0; i < list.length; i += cols) {
      const drawings = list.slice(i, i + cols);
      rows.push({ drawings, h: Math.max(...drawings.map((d) => drawingSize(d, { pxPerFt: s, ruler: true, caption: false }).height)) + captionH });
    }
    return rows;
  };
  const planRows = rowsOf(plans);
  const sectionRows = rowsOf(sections);
  const headerH = 330 * k;
  const bandH = 90 * k;
  const H = Math.ceil(headerH + (plans.length ? bandH + planRows.reduce((a, r) => a + r.h + gap, 0) : 0) + (sections.length ? bandH + sectionRows.reduce((a, r) => a + r.h + gap, 0) : 0) + M);

  const c = document.createElement("canvas");
  c.width = Math.round(W);
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // header: title, date and scale; key numbers; the legend
  drawBlock(ctx, o.title.toUpperCase(), M, M * 0.7, W * 0.62 - M, 120 * k, { max: 110 * k, min: 30 * k, weight: "600", color: P.accent, maxLines: 2 });
  drawBlock(ctx, `Plans and sections · ${new Date().toLocaleDateString()} · every drawing at one scale`, M, M * 0.7 + 150 * k, W * 0.62 - M, 50 * k, { max: 40 * k, min: 18 * k, color: P.muted });
  const infoX = M;
  const infoW = (W * 0.62 - M) / Math.max(1, Math.min(4, o.info.length));
  o.info.slice(0, 8).forEach(([label, value], i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = infoX + col * infoW;
    const y = M * 0.7 + 215 * k + row * 62 * k;
    drawBlock(ctx, label, x, y, infoW - 20 * k, 24 * k, { max: 22 * k, min: 11 * k, color: P.muted });
    drawBlock(ctx, value, x, y + 24 * k, infoW - 20 * k, 34 * k, { max: 30 * k, min: 12 * k, weight: "600", color: P.text });
  });
  const legend: [string, string][] = [
    ["Foam", P.foam],
    ["Floor plate", P.plate],
    ["Branch", P.branch],
    ["Floor", P.tint],
    ["Level line", P.accent],
  ];
  const lx = W * 0.68;
  drawBlock(ctx, "LEGEND", lx, M * 0.7, W - lx - M, 40 * k, { max: 30 * k, min: 12 * k, weight: "600", color: P.heading });
  legend.forEach(([label, color], i) => {
    const y = M * 0.7 + 60 * k + i * 44 * k;
    ctx.fillStyle = color;
    ctx.fillRect(lx, y, 56 * k, 30 * k);
    ctx.strokeStyle = P.frame;
    ctx.strokeRect(lx, y, 56 * k, 30 * k);
    drawBlock(ctx, label, lx + 76 * k, y, W - lx - M - 76 * k, 32 * k, { max: 26 * k, min: 11 * k, color: P.text });
  });
  // a scale bar of 10 ft at the common scale
  const barY = M * 0.7 + 60 * k + legend.length * 44 * k + 16 * k;
  ctx.fillStyle = P.text;
  ctx.fillRect(lx, barY, 10 * s, 6 * k);
  drawBlock(ctx, "10 ft", lx + 10 * s + 14 * k, barY - 10 * k, 200 * k, 30 * k, { max: 24 * k, min: 11 * k, color: P.muted });
  ctx.strokeStyle = P.frame;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(M, headerH - 30 * k);
  ctx.lineTo(W - M, headerH - 30 * k);
  ctx.stroke();
  ctx.globalAlpha = 1;

  let y = headerH;
  const band = (text: string) => {
    drawBlock(ctx, text, M, y, W - 2 * M, 60 * k, { max: 44 * k, min: 14 * k, weight: "600", color: P.heading });
    y += bandH;
  };
  const place = (rows: Row[]) => {
    for (const r of rows) {
      r.drawings.forEach((d, i) => {
        const x = M + i * (cellW + gap);
        drawToCanvas(ctx, d, style, { pxPerFt: s, labels: o.labels, ruler: true, caption: false, background: false }, { x, y });
        const sz = drawingSize(d, { pxPerFt: s, ruler: true, caption: false });
        drawBlock(ctx, d.title, x, y + sz.height + 6 * k, cellW, 44 * k, { max: 38 * k, min: 12 * k, weight: "600", color: P.text });
        drawBlock(ctx, d.subtitle, x, y + sz.height + 6 * k + 44 * k, cellW, 38 * k, { max: 28 * k, min: 11 * k, color: P.muted, maxLines: 1 });
      });
      y += r.h + gap;
    }
  };
  if (plans.length) {
    band("PLANS");
    place(planRows);
  }
  if (sections.length) {
    band("SECTIONS");
    place(sectionRows);
  }
  return toBlob(c);
}
