// A one-page report of an arrangement as a PNG: a picture, the numbers of the whole, the sequence of spaces, the weakest
// joints, the descriptors and what to fix. Black ground, grey text, magenta / orange / soft pink accents, like the rest.

import type { WholeSummary, Sequence } from "./whole";
import type { ArrangeWarning, Joint } from "./types";
import { CATEGORY_LABEL } from "./types";

export interface ReportInput {
  /** output resolution as a multiple of the 1600 x 1000 page (default 1) */
  scale?: number;
  title: string;
  picture: Blob | null;
  summary: WholeSummary | null;
  sequence: { name: string; category: string; score: number | null }[];
  joints: Joint[];
  warnings: ArrangeWarning[];
  names: (id: string) => string;
}

const W = 1654; // A4 landscape at 200 dpi
const H = 1169;
const PINK = "#e8a6c8";
const ORANGE = "#db7228";
const MAGENTA = "#c43383";
const GREY = "#9a9a9a";

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

export async function buildReport(inp: ReportInput): Promise<Blob> {
  const scale = inp.scale ?? 1;
  const c = document.createElement("canvas");
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const font = (px: number, weight = "") => `${weight} ${px}px "Arkitech", "Orbitron", system-ui, sans-serif`;
  const text = (s: string, x: number, y: number, px: number, color = "#e6e6e6", weight = "", align: CanvasTextAlign = "left", maxW?: number) => {
    ctx.font = font(px, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y, maxW);
  };
  const rule = (y: number) => {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(W - 60, y);
    ctx.stroke();
  };

  text(inp.title.toUpperCase(), 60, 90, 40, MAGENTA, "600");
  text(`Arrangement report · ${new Date().toLocaleDateString()}`, 60, 124, 18, GREY);
  rule(146);

  // the picture
  const picW = 760;
  const picH = 470;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(60, 176, picW, picH);
  if (inp.picture) {
    const img = await loadImage(inp.picture);
    const s = Math.min(picW / img.width, picH / img.height);
    ctx.drawImage(img, 60 + (picW - img.width * s) / 2, 176 + (picH - img.height * s) / 2, img.width * s, img.height * s);
  }

  // the numbers
  const s = inp.summary;
  let y = 196;
  const colX = 880;
  text("THE WHOLE", colX, y, 18, ORANGE, "600");
  y += 34;
  const stat = (k: string, v: string, tone: string = "#e6e6e6") => {
    text(k, colX, y, 18, GREY);
    text(v, W - 60, y, 18, tone, "", "right");
    y += 30;
  };
  if (s) {
    stat("Pieces", String(s.pieces));
    stat("Connected", s.attachedAll ? "one mass" : `${s.islands} detached`, s.attachedAll ? PINK : "#ff269e");
    stat("Walkable from the entrance", s.walkableAll ? "all pieces" : `${s.unreachable} cut off`, s.walkableAll ? PINK : ORANGE);
    stat("Floor levels", String(s.levels));
    stat("Longest route", s.mainRouteFt === null ? "none" : `${s.mainRouteFt.toFixed(0)} ft`);
    stat("Rooms", `${s.rooms} in ${s.roomComponents} group${s.roomComponents === 1 ? "" : "s"}`);
    stat("Floor in daylight", `${Math.round(s.litFloor * 100)}%`);
    stat("Void share", `${Math.round(s.voidShare * 100)}%`);
    stat("Height · footprint", `${s.heightFt.toFixed(0)} ft · ${s.footprintFt[0].toFixed(0)} × ${s.footprintFt[1].toFixed(0)} ft`);
    stat("Floating foam", s.foamPieces <= 1 ? "none" : `${s.foamPieces - 1} piece(s)`, s.foamPieces <= 1 ? PINK : ORANGE);
    stat("Mix", Object.entries(s.categories).map(([k, n]) => `${n} ${CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]?.toLowerCase() ?? k}`).join(", "));
  } else text("(no analysis yet)", colX, y, 18, GREY);

  // the sequence
  rule(680);
  let sx = 60;
  const sy = 724;
  text("SEQUENCE OF SPACES", 60, sy - 20, 18, ORANGE, "600");
  inp.sequence.slice(0, 8).forEach((st, i) => {
    const bw = 178;
    ctx.strokeStyle = i === 0 ? ORANGE : "rgba(255,255,255,0.35)";
    ctx.strokeRect(sx, sy, bw, 70);
    text(`${i + 1}`, sx + 10, sy + 22, 14, GREY);
    text(st.name, sx + 10, sy + 46, 15, "#e6e6e6", "", "left", bw - 20);
    text(st.category, sx + 10, sy + 63, 12, GREY, "", "left", bw - 20);
    if (i < Math.min(inp.sequence.length, 8) - 1) {
      const next = inp.sequence[i + 1];
      text(next.score === null ? "·" : next.score.toFixed(0), sx + bw + 12, sy + 40, 14, next.score !== null && next.score >= 60 ? PINK : ORANGE, "", "center");
    }
    sx += bw + 24;
  });
  if (inp.sequence.length > 8) text(`+ ${inp.sequence.length - 8} more`, 60, sy + 92, 14, GREY);

  // joints, descriptors, warnings
  rule(840);
  let jy = 880;
  text("WEAKEST JOINTS", 60, jy, 18, ORANGE, "600");
  jy += 30;
  [...inp.joints]
    .filter((j) => j.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 6)
    .forEach((j) => {
      text(`${inp.names(j.aId)} · ${inp.names(j.bId)}`, 60, jy, 15, "#e6e6e6", "", "left", 340);
      text(j.score!.toFixed(0), 420, jy, 15, (j.score ?? 0) >= 60 ? PINK : ORANGE, "", "right");
      jy += 26;
    });
  if (s) {
    text("DESCRIPTORS", 520, 880, 18, ORANGE, "600");
    s.descriptors.forEach((d, i) => {
      const col = i < 6 ? 0 : 1;
      const row = i % 6;
      const x = 520 + col * 330;
      const yy = 912 + row * 36;
      text(d.label, x, yy, 14, GREY, "", "left", 200);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, yy + 6, 250, 5);
      ctx.fillStyle = d.score >= 66 ? ORANGE : GREY;
      ctx.fillRect(x, yy + 6, (250 * d.score) / 100, 5);
      text(String(d.score), x + 300, yy, 14, "#e6e6e6", "", "right");
    });
  }
  text("TO FIX", 1220, 880, 18, ORANGE, "600");
  const issues = inp.warnings.filter((w) => w.severity !== "info").slice(0, 7);
  if (!issues.length) text("Nothing is broken.", 1220, 912, 15, PINK);
  issues.forEach((w, i) => text(w.message, 1220, 912 + i * 30, 13, w.severity === "error" ? "#ff269e" : GREY, "", "left", 380));

  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the report."))), "image/png"));
}

export type { Sequence };
