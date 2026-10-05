// A one-page report of an arrangement as a PNG: a picture, the numbers of the whole, the sequence of spaces, the weakest joints, the
// descriptors and what to fix. Everything is shown: the page grows in height to hold every space and every warning, and each piece
// of text is wrapped and sized to its own box (lib/textBlock.ts), never squeezed. Colours come from the palette.

import type { WholeSummary, Sequence } from "./whole";
import type { ArrangeWarning, Joint } from "./types";
import { CATEGORY_LABEL } from "./types";
import { BOARD_FONT, drawBlock, fitBlock } from "@/lib/textBlock";
import { defaultPalette, type Palette } from "@/lib/boardPalette";

export interface ReportInput {
  /** output resolution as a multiple of the 1654 px wide page (default 1) */
  scale?: number;
  title: string;
  picture: Blob | null;
  summary: WholeSummary | null;
  sequence: { name: string; category: string; score: number | null }[];
  joints: Joint[];
  warnings: ArrangeWarning[];
  names: (id: string) => string;
  palette?: Palette;
}

const W = 1654; // A4 landscape at 200 dpi
const MIN_H = 1169;
const M = 60;

const loadImage = (blob: Blob) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = rej;
    img.src = url;
  });

/** Draws the whole page on \`ctx\` and returns the y it ended at (so the page can be made exactly tall enough). */
async function paint(ctx: CanvasRenderingContext2D, inp: ReportInput, P: Palette, fullH: number): Promise<number> {
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, fullH);
  const rule = (y: number) => {
    ctx.strokeStyle = P.frame;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const heading = (t: string, x: number, y: number, w: number) => drawBlock(ctx, t, x, y, w, 26, { max: 18, min: 11, weight: "600", color: P.heading });

  drawBlock(ctx, inp.title.toUpperCase(), M, 40, W - 2 * M, 56, { max: 44, min: 18, weight: "600", color: P.accent });
  drawBlock(ctx, `Arrangement report · ${new Date().toLocaleDateString()}`, M, 106, W - 2 * M, 26, { max: 18, min: 11, color: P.muted });
  rule(146);

  // the picture, kept in its own aspect
  const picW = 760;
  const picH = 470;
  ctx.strokeStyle = P.frame;
  ctx.strokeRect(M, 176, picW, picH);
  if (inp.picture) {
    const img = await loadImage(inp.picture);
    const s = Math.min(picW / img.width, picH / img.height);
    ctx.drawImage(img, M + (picW - img.width * s) / 2, 176 + (picH - img.height * s) / 2, img.width * s, img.height * s);
  }

  // the numbers: label left, value right, each wrapped to its own half; a row grows when its text needs two lines
  const colX = 880;
  const colW = W - M - colX;
  let y = 176;
  y += heading("THE WHOLE", colX, y, colW) + 12;
  const stat = (k: string, v: string, tone: string = P.text) => {
    const lw = colW * 0.5 - 8;
    const vw = colW * 0.5 - 8;
    const lb = fitBlock(ctx, k, lw, 60, { max: 18, min: 11, maxLines: 2 });
    const vb = fitBlock(ctx, v, vw, 60, { max: 18, min: 11, maxLines: 3 });
    drawBlock(ctx, k, colX, y, lw, 60, { max: 18, min: 11, maxLines: 2, color: P.muted });
    drawBlock(ctx, v, colX + colW - vw, y, vw, 60, { max: 18, min: 11, maxLines: 3, color: tone, align: "right" });
    y += Math.max(lb.height, vb.height) + 10;
  };
  const s = inp.summary;
  if (s) {
    stat("Pieces", String(s.pieces));
    stat("Connected", s.attachedAll ? "one mass" : `${s.islands} detached`, s.attachedAll ? P.good : P.bad);
    stat("Walkable from the entrance", s.walkableAll ? "all pieces" : `${s.unreachable} cut off`, s.walkableAll ? P.good : P.warn);
    stat("Floor levels", String(s.levels));
    stat("Longest route", s.mainRouteFt === null ? "none" : `${s.mainRouteFt.toFixed(0)} ft`);
    stat("Rooms", `${s.rooms} in ${s.roomComponents} group${s.roomComponents === 1 ? "" : "s"}`);
    stat("Floor in daylight", `${Math.round(s.litFloor * 100)}%`);
    stat("Void share", `${Math.round(s.voidShare * 100)}%`);
    stat("Height · footprint", `${s.heightFt.toFixed(0)} ft · ${s.footprintFt[0].toFixed(0)} × ${s.footprintFt[1].toFixed(0)} ft`);
    stat("Floating foam", s.foamPieces <= 1 ? "none" : `${s.foamPieces - 1} piece(s)`, s.foamPieces <= 1 ? P.good : P.warn);
    stat("Mix", Object.entries(s.categories).map(([k, n]) => `${n} ${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]?.toLowerCase() ?? k}`).join(", "));
  } else drawBlock(ctx, "(no analysis yet)", colX, y, colW, 26, { max: 18, min: 11, color: P.muted });

  // the sequence: every space, in as many rows as it takes
  let top = Math.max(176 + picH, y) + 34;
  rule(top);
  top += 34;
  top += heading("SEQUENCE OF SPACES", M, top, 600) + 14;
  const n = inp.sequence.length;
  const cols = Math.max(1, Math.min(8, n));
  const gap = 30;
  const cw = (W - 2 * M - (cols - 1) * gap) / cols;
  const ch = 84;
  inp.sequence.forEach((st, i) => {
    const cx = M + (i % cols) * (cw + gap);
    const cy = top + Math.floor(i / cols) * (ch + 16);
    ctx.strokeStyle = i === 0 ? P.heading : P.frame;
    ctx.strokeRect(cx, cy, cw, ch);
    drawBlock(ctx, String(i + 1), cx + 10, cy + 6, 40, 18, { max: 14, min: 10, color: P.muted });
    drawBlock(ctx, st.name, cx + 10, cy + 24, cw - 20, 36, { max: 16, min: 9, maxLines: 2, color: P.text });
    drawBlock(ctx, st.category, cx + 10, cy + 62, cw - 20, 18, { max: 12, min: 8, color: P.muted });
    const next = inp.sequence[i + 1];
    if (next && (i + 1) % cols !== 0) drawBlock(ctx, next.score === null ? "·" : next.score.toFixed(0), cx + cw + 2, cy + ch / 2 - 8, gap - 4, 18, { max: 14, min: 9, color: next.score !== null && next.score >= 60 ? P.good : P.warn, align: "center" });
  });
  top += Math.ceil(n / cols) * (ch + 16) + 8;

  // joints, descriptors and what to fix, side by side, each as tall as it needs to be
  rule(top);
  top += 34;
  let jy = top;
  jy += heading("WEAKEST JOINTS", M, jy, 420) + 10;
  [...inp.joints]
    .filter((j) => j.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 8)
    .forEach((j) => {
      const label = `${inp.names(j.aId)} · ${inp.names(j.bId)}`;
      const h = drawBlock(ctx, label, M, jy, 360, 40, { max: 15, min: 9, maxLines: 2, color: P.text });
      drawBlock(ctx, j.score!.toFixed(0), M + 370, jy, 50, 20, { max: 15, min: 10, color: (j.score ?? 0) >= 60 ? P.good : P.warn, align: "right" });
      jy += Math.max(h, 20) + 8;
    });
  let dy = top;
  if (s) {
    heading("DESCRIPTORS", 520, dy, 640);
    const rows = Math.ceil(s.descriptors.length / 2);
    s.descriptors.forEach((d, i) => {
      const col = i < rows ? 0 : 1;
      const row = i % rows;
      const x = 520 + col * 330;
      const yy = top + 36 + row * 40;
      drawBlock(ctx, d.label, x, yy, 230, 30, { max: 14, min: 8, maxLines: 2, color: P.muted });
      ctx.fillStyle = P.frame;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, yy + 30, 250, 5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = d.score >= 66 ? P.heading : P.muted;
      ctx.fillRect(x, yy + 30, (250 * d.score) / 100, 5);
      drawBlock(ctx, String(d.score), x + 262, yy, 40, 20, { max: 14, min: 9, color: P.text, align: "right" });
    });
    dy = top + 36 + rows * 40;
  }
  let fy = top;
  fy += heading("TO FIX", 1220, fy, 374) + 10;
  const issues = inp.warnings.filter((w) => w.severity !== "info");
  if (!issues.length) fy += drawBlock(ctx, "Nothing is broken.", 1220, fy, 374, 24, { max: 15, min: 10, color: P.good });
  issues.forEach((w) => {
    const h = drawBlock(ctx, w.message, 1220, fy, 374, 120, { max: 13, min: 9, maxLines: 6, color: w.severity === "error" ? P.bad : P.muted });
    fy += h + 10;
  });
  return Math.max(jy, dy, fy) + 50;
}

export async function buildReport(inp: ReportInput): Promise<Blob> {
  const scale = inp.scale ?? 1;
  const P = { ...defaultPalette(), ...inp.palette };
  // first a dry run on a tall scratch page to learn how tall the real one must be, then the real page
  const scratch = document.createElement("canvas");
  scratch.width = W;
  scratch.height = 6000;
  const sctx = scratch.getContext("2d")!;
  const endY = await paint(sctx, inp, P, 6000);
  const H = Math.max(MIN_H, Math.ceil(endY));
  const c = document.createElement("canvas");
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  await paint(ctx, inp, P, H);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the report."))), "image/png"));
}

export { BOARD_FONT };
export type { Sequence };
