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
  /** the finished picture's size in pixels; give both and the page lays itself out to fill that shape, give one and the other follows the content */
  widthPx?: number;
  heightPx?: number;
  title: string;
  picture: Blob | null;
  summary: WholeSummary | null;
  sequence: { name: string; category: string; score: number | null }[];
  joints: Joint[];
  warnings: ArrangeWarning[];
  names: (id: string) => string;
  palette?: Palette;
}

const BASE_W = 1654; // A4 landscape at 200 dpi: the design width the proportions below come from
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
function paint(ctx: CanvasRenderingContext2D, inp: ReportInput, P: Palette, W: number, fullH: number, img: HTMLImageElement | null): number {
  const u = W / BASE_W; // horizontal geometry follows the page width; text keeps its own size and shrinks only to fit
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
  const picW = Math.round(760 * u);
  const picH = Math.round(Math.min(470 * Math.max(0.8, u), picW * 0.62));
  ctx.strokeStyle = P.frame;
  ctx.strokeRect(M, 176, picW, picH);
  if (img) {
    const s = Math.min(picW / img.width, picH / img.height);
    ctx.drawImage(img, M + (picW - img.width * s) / 2, 176 + (picH - img.height * s) / 2, img.width * s, img.height * s);
  }

  // the numbers: label left, value right, each wrapped to its own half; a row grows when its text needs two lines
  const colX = Math.round(880 * u);
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
  top += heading("SEQUENCE OF SPACES", M, top, Math.round(600 * u)) + 14;
  const n = inp.sequence.length;
  const cols = Math.max(1, Math.min(8, n, Math.floor((W - 2 * M) / 150)));
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
  jy += heading("WEAKEST JOINTS", M, jy, Math.round(420 * u)) + 10;
  [...inp.joints]
    .filter((j) => j.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 8)
    .forEach((j) => {
      const label = `${inp.names(j.aId)} · ${inp.names(j.bId)}`;
      const h = drawBlock(ctx, label, M, jy, Math.round(360 * u), 40, { max: 15, min: 9, maxLines: 2, color: P.text });
      drawBlock(ctx, j.score!.toFixed(0), M + Math.round(370 * u), jy, 50, 20, { max: 15, min: 10, color: (j.score ?? 0) >= 60 ? P.good : P.warn, align: "right" });
      jy += Math.max(h, 20) + 8;
    });
  let dy = top;
  if (s) {
    heading("DESCRIPTORS", Math.round(520 * u), dy, Math.round(640 * u));
    const rows = Math.ceil(s.descriptors.length / 2);
    s.descriptors.forEach((d, i) => {
      const col = i < rows ? 0 : 1;
      const row = i % rows;
      const x = Math.round(520 * u) + col * Math.round(330 * u);
      const yy = top + 36 + row * 40;
      drawBlock(ctx, d.label, x, yy, Math.round(230 * u), 30, { max: 14, min: 8, maxLines: 2, color: P.muted });
      ctx.fillStyle = P.frame;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, yy + 30, Math.round(250 * u), 5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = d.score >= 66 ? P.heading : P.muted;
      ctx.fillRect(x, yy + 30, (Math.round(250 * u) * d.score) / 100, 5);
      drawBlock(ctx, String(d.score), x + Math.round(262 * u), yy, 40, 20, { max: 14, min: 9, color: P.text, align: "right" });
    });
    dy = top + 36 + rows * 40;
  }
  let fy = top;
  const fx = Math.round(1220 * u);
  const fw = W - M - fx;
  fy += heading("TO FIX", fx, fy, fw) + 10;
  const issues = inp.warnings.filter((w) => w.severity !== "info");
  if (!issues.length) fy += drawBlock(ctx, "Nothing is broken.", fx, fy, fw, 24, { max: 15, min: 10, color: P.good });
  issues.forEach((w) => {
    const h = drawBlock(ctx, w.message, fx, fy, fw, 120, { max: 13, min: 9, maxLines: 6, color: w.severity === "error" ? P.bad : P.muted });
    fy += h + 10;
  });
  return Math.max(jy, dy, fy) + 50;
}

/** Where the page ends when laid out at width `w` (a dry run on a tiny canvas: only text is measured). */
function naturalHeight(inp: ReportInput, P: Palette, w: number, img: HTMLImageElement | null): number {
  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  return Math.ceil(paint(probe.getContext("2d")!, inp, P, w, 8, img));
}

export async function buildReport(inp: ReportInput): Promise<Blob> {
  const P = { ...defaultPalette(), ...inp.palette };
  const img = inp.picture ? await loadImage(inp.picture) : null;
  const both = !!inp.widthPx && !!inp.heightPx;
  const outW = Math.round(inp.widthPx ?? BASE_W * (inp.scale ?? 1));
  let vw = BASE_W; // the page's own width in layout units
  let vh: number;
  if (both) {
    // the layout works out its own shape: find the page width whose natural height has the shape asked for, then scale to fill
    const aspect = outW / Math.round(inp.heightPx!);
    let lo = 800;
    let hi = 3600;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (mid / naturalHeight(inp, P, mid, img) < aspect) lo = mid;
      else hi = mid;
    }
    vw = Math.round((lo + hi) / 2);
    let s = Math.min(outW / vw, Math.round(inp.heightPx!) / naturalHeight(inp, P, vw, img));
    // the page is laid out at exactly the shape asked for; if the content still runs over, scale down a little and lay out again
    for (let k = 0; k < 4; k++) {
      vw = outW / s;
      vh = Math.round(inp.heightPx!) / s;
      if (naturalHeight(inp, P, vw, img) <= vh) break;
      s *= 0.94;
    }
    vw = outW / s;
    vh = Math.round(inp.heightPx!) / s;
  } else {
    vh = Math.max(naturalHeight(inp, P, vw, img), 0);
  }
  const scale = outW / vw;
  const outH = both ? Math.round(inp.heightPx!) : Math.round(vh * scale);
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  paint(ctx, inp, P, vw, both ? vh : vh, img);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the report."))), "image/png"));
}

export { BOARD_FONT };
export type { Sequence };
