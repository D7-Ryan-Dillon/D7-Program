// Draws a Drawing (lib/drawing/build.ts) on a canvas or as an SVG string. Two grounds: "dark" uses the app's own palette
// (pink foam, orange branches, magenta level lines on near black) for the screen; "paper" is black poche on white for
// printing. Boards pick the ground from their own background (groundFor).

import type { Drawing } from "./build";
import type { Ring } from "./contour";

export type Ground = "dark" | "paper";

export interface DrawingStyle {
  ground: Ground;
  bg: string;
  foam: string;
  plate: string;
  branch: string;
  tint: string;
  text: string;
  muted: string;
  frame: string;
  accent: string;
  emphasis: string;
  route: string;
}

const STYLES: Record<Ground, DrawingStyle> = {
  dark: {
    ground: "dark",
    bg: "#000000",
    foam: "#e8a6c8",
    plate: "#f2b878",
    branch: "#db7228",
    tint: "#262626",
    text: "#ececec",
    muted: "#8a8a8a",
    frame: "rgba(255,255,255,0.35)",
    accent: "#c43383",
    emphasis: "rgba(219,114,40,0.5)",
    route: "#db7228",
  },
  paper: {
    ground: "paper",
    bg: "#ffffff",
    foam: "#1b1b1b",
    plate: "#8a8a8a",
    branch: "#c25a14",
    tint: "#dcdcdc",
    text: "#111111",
    muted: "#666666",
    frame: "#000000",
    accent: "#c43383",
    emphasis: "rgba(196,51,131,0.38)",
    route: "#c43383",
  },
};

export const drawingStyle = (ground: Ground): DrawingStyle => STYLES[ground];

/** Which ground reads on a given background colour (#rgb / #rrggbb): light backgrounds get paper, dark ones the app's palette. */
export function groundFor(background: string): Ground {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim());
  if (!m) return "paper";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "dark" : "paper";
}

export interface RenderOptions {
  /** pixels per foot of the drawing itself */
  pxPerFt: number;
  labels?: boolean;
  /** title and subtitle under the drawing */
  caption?: boolean;
  /** the 10 ft ruler along the bottom and the level labels at the left */
  ruler?: boolean;
  /** draw the background fill (off when the board already has one) */
  background?: boolean;
}

const MARGIN_FT = { left: 3.5, right: 1.5, top: 1.5 };

function layout(d: Drawing, o: RenderOptions) {
  const ruler = o.ruler !== false;
  const caption = o.caption !== false;
  const m = { left: ruler ? MARGIN_FT.left : 0.5, right: ruler ? MARGIN_FT.right : 0.5, top: ruler ? MARGIN_FT.top : 0.5, bottom: (ruler ? 2.4 : 0.5) + (caption ? 3.4 : 0) };
  return { m, w: d.widthFt + m.left + m.right, h: d.heightFt + m.top + m.bottom };
}

/** Size in pixels the drawing takes at the given scale (margins, ruler and caption included). */
export function drawingSize(d: Drawing, o: RenderOptions): { width: number; height: number } {
  const { w, h } = layout(d, o);
  return { width: Math.ceil(w * o.pxPerFt), height: Math.ceil(h * o.pxPerFt) };
}

function ringPath(rs: Ring[], x0: number, y0: number, s: number, hFt: number): Path2D {
  const p = new Path2D();
  for (const r of rs) {
    r.forEach(([u, v], i) => {
      const x = x0 + u * s;
      const y = y0 + (hFt - v) * s;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    p.closePath();
  }
  return p;
}

export function drawToCanvas(ctx: CanvasRenderingContext2D, d: Drawing, style: DrawingStyle, o: RenderOptions, at: { x: number; y: number } = { x: 0, y: 0 }) {
  const s = o.pxPerFt;
  const { m, w, h } = layout(d, o);
  const x0 = at.x + m.left * s;
  const y0 = at.y + m.top * s;
  ctx.save();
  if (o.background !== false) {
    ctx.fillStyle = style.bg;
    ctx.fillRect(at.x, at.y, w * s, h * s);
  }
  const foamPath = ringPath(d.foam, x0, y0, s, d.heightFt);
  if (d.tint.length) {
    ctx.fillStyle = style.tint;
    ctx.fill(ringPath(d.tint, x0, y0, s, d.heightFt), "evenodd");
  }
  ctx.fillStyle = style.foam;
  ctx.fill(foamPath, "evenodd");
  if (d.plates.length || d.branches.length) {
    ctx.save();
    ctx.clip(foamPath, "evenodd");
    if (d.plates.length) {
      ctx.fillStyle = style.plate;
      ctx.fill(ringPath(d.plates, x0, y0, s, d.heightFt), "evenodd");
    }
    if (d.branches.length) {
      ctx.fillStyle = style.branch;
      ctx.fill(ringPath(d.branches, x0, y0, s, d.heightFt), "evenodd");
    }
    ctx.restore();
  }
  if (d.emphasis.length) {
    ctx.fillStyle = style.emphasis;
    ctx.fill(ringPath(d.emphasis, x0, y0, s, d.heightFt), "evenodd");
  }
  ctx.strokeStyle = style.frame;
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.strokeRect(x0, y0, d.widthFt * s, d.heightFt * s);

  const fontPx = Math.max(9, s * 0.95);
  if (o.ruler !== false) {
    ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = style.text;
    ctx.strokeStyle = style.frame;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let t = 0; t <= d.widthFt + 1e-6; t += 10) {
      const x = x0 + t * s;
      ctx.beginPath();
      ctx.moveTo(x, y0 + d.heightFt * s);
      ctx.lineTo(x, y0 + d.heightFt * s + 0.7 * s);
      ctx.stroke();
      ctx.fillText(`${t} ft`, x, y0 + d.heightFt * s + 1.9 * s);
    }
    if (d.levelLines.length) {
      ctx.setLineDash([s * 0.6, s * 0.4]);
      ctx.strokeStyle = style.accent;
      ctx.fillStyle = style.accent;
      ctx.textAlign = "right";
      ctx.lineWidth = Math.max(1, s * 0.05);
      for (const l of d.levelLines) {
        const y = y0 + (d.heightFt - l.z) * s;
        ctx.beginPath();
        ctx.moveTo(x0 - s, y);
        ctx.lineTo(x0 + d.widthFt * s + s, y);
        ctx.stroke();
        ctx.fillText(l.text, x0 - 1.3 * s, y + fontPx * 0.35);
      }
      ctx.setLineDash([]);
    }
  }
  if (d.route && d.route.length > 1) {
    ctx.strokeStyle = style.route;
    ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.setLineDash([s * 0.7, s * 0.5]);
    ctx.beginPath();
    d.route.forEach(([u, v], i) => {
      const x = x0 + u * s;
      const y = y0 + (d.heightFt - v) * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.labels !== false && d.labels.length) {
    ctx.font = `${Math.max(9, s * 0.8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, s * 0.22);
    for (const l of d.labels) {
      const x = x0 + l.x * s;
      const y = y0 + (d.heightFt - l.y) * s;
      ctx.strokeStyle = style.ground === "dark" ? "#000000" : "#ffffff";
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = style.ground === "dark" ? "#ffffff" : "#111111";
      ctx.fillText(l.text, x, y);
    }
  }
  if (o.caption !== false) {
    const base = y0 + d.heightFt * s + (o.ruler !== false ? 2.4 : 0.5) * s;
    ctx.textAlign = "left";
    ctx.fillStyle = style.text;
    ctx.font = `600 ${fontPx * 1.1}px system-ui, sans-serif`;
    ctx.fillText(d.title, x0, base + 1.2 * s);
    ctx.fillStyle = style.muted;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.fillText(d.subtitle, x0, base + 2.7 * s);
  }
  ctx.restore();
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svgPath(rs: Ring[], hFt: number): string {
  return rs
    .filter((r) => r.length >= 3)
    .map((r) => "M " + r.map(([u, v]) => `${u.toFixed(2)} ${(hFt - v).toFixed(2)}`).join(" L ") + " Z")
    .join(" ");
}

/** The same drawing as SVG, in feet, sized for the given scale (default 1 inch = 10 feet). */
export function drawingToSvg(d: Drawing, style: DrawingStyle, o: Partial<RenderOptions> & { feetPerInch?: number } = {}): string {
  const opts: RenderOptions = { pxPerFt: 1, labels: o.labels, caption: o.caption, ruler: o.ruler, background: o.background };
  const { m, w, h } = layout(d, opts);
  const inch = o.feetPerInch ?? 10;
  const hFt = d.heightFt;
  const f = 0.95;
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(w / inch).toFixed(3)}in" height="${(h / inch).toFixed(3)}in" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" font-family="Arial, Helvetica, sans-serif">`,
    `<title>${esc(d.title)} - ${esc(d.subtitle)}</title>`,
  ];
  if (o.background !== false) out.push(`<rect width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${style.bg}"/>`);
  out.push(`<g transform="translate(${m.left} ${m.top})">`);
  const foamD = svgPath(d.foam, hFt);
  if (d.tint.length) out.push(`<path d="${svgPath(d.tint, hFt)}" fill="${style.tint}" fill-rule="evenodd"/>`);
  out.push(`<clipPath id="foam"><path d="${foamD}" clip-rule="evenodd"/></clipPath>`);
  out.push(`<path d="${foamD}" fill="${style.foam}" fill-rule="evenodd"/>`);
  if (d.plates.length) out.push(`<path d="${svgPath(d.plates, hFt)}" fill="${style.plate}" fill-rule="evenodd" clip-path="url(#foam)"/>`);
  if (d.branches.length) out.push(`<path d="${svgPath(d.branches, hFt)}" fill="${style.branch}" fill-rule="evenodd" clip-path="url(#foam)"/>`);
  if (d.emphasis.length) out.push(`<path d="${svgPath(d.emphasis, hFt)}" fill="${style.emphasis}" fill-rule="evenodd"/>`);
  out.push(`<rect width="${d.widthFt}" height="${hFt}" fill="none" stroke="${style.frame}" stroke-width="0.08"/>`);
  if (o.ruler !== false) {
    for (let t = 0; t <= d.widthFt + 1e-6; t += 10) {
      out.push(`<line x1="${t}" y1="${hFt}" x2="${t}" y2="${hFt + 0.7}" stroke="${style.frame}" stroke-width="0.06"/>`);
      out.push(`<text x="${t}" y="${hFt + 1.9}" font-size="${f}" text-anchor="middle" fill="${style.text}">${t} ft</text>`);
    }
    for (const l of d.levelLines) {
      const y = hFt - l.z;
      out.push(`<line x1="-1" y1="${y.toFixed(2)}" x2="${d.widthFt + 1}" y2="${y.toFixed(2)}" stroke="${style.accent}" stroke-width="0.05" stroke-dasharray="0.6 0.4"/>`);
      out.push(`<text x="-1.3" y="${(y + 0.3).toFixed(2)}" font-size="${f}" text-anchor="end" fill="${style.accent}">${esc(l.text)}</text>`);
    }
  }
  if (d.route && d.route.length > 1) {
    out.push(`<polyline points="${d.route.map(([u, v]) => `${u.toFixed(2)},${(hFt - v).toFixed(2)}`).join(" ")}" fill="none" stroke="${style.route}" stroke-width="0.22" stroke-dasharray="0.7 0.5"/>`);
  }
  if (o.labels !== false)
    for (const l of d.labels)
      out.push(`<text x="${l.x.toFixed(2)}" y="${(hFt - l.y).toFixed(2)}" font-size="0.8" text-anchor="middle" fill="${style.ground === "dark" ? "#fff" : "#111"}" stroke="${style.ground === "dark" ? "#000" : "#fff"}" stroke-width="0.2" paint-order="stroke">${esc(l.text)}</text>`);
  if (o.caption !== false) {
    const base = hFt + (o.ruler !== false ? 2.4 : 0.5);
    out.push(`<text x="0" y="${(base + 1.2).toFixed(2)}" font-size="${(f * 1.1).toFixed(2)}" font-weight="600" fill="${style.text}">${esc(d.title)}</text>`);
    out.push(`<text x="0" y="${(base + 2.7).toFixed(2)}" font-size="${f}" fill="${style.muted}">${esc(d.subtitle)}</text>`);
  }
  out.push(`</g></svg>`);
  return out.join("\n") + "\n";
}

/** The drawing as a PNG at the given scale (feet per inch) and dpi. Browser only (uses a canvas). */
export async function drawingToPng(d: Drawing, style: DrawingStyle, o: { feetPerInch: number; dpi: number; labels?: boolean; caption?: boolean; ruler?: boolean }): Promise<Blob> {
  const pxPerFt = o.dpi / o.feetPerInch;
  const opts: RenderOptions = { pxPerFt, labels: o.labels, caption: o.caption, ruler: o.ruler, background: true };
  const { width, height } = drawingSize(d, opts);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 16000);
  canvas.height = Math.min(height, 16000);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  drawToCanvas(ctx, d, style, opts);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't write the PNG."))), "image/png"));
}
