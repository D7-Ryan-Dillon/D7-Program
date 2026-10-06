// Presentation sheets for the Analysis: what a board for a typology says about it, drawn from the SAME evaluation the Analysis tab and the exports read
// (lib/scoring/matrixEval.ts), so the three agree. Landscape pages, 22 x 11 in by default, on the board's own background (black). Each kind of content is
// optional (and a sheet with none of its content is left out); nothing is crammed in: every piece of text is fitted to its box and the sheets split the
// work (what the typology is and what was asked of it / what was measured and read / the evidence and the selection).
//
//   1  Typology and criteria   the typology and its spatial intention; the matrix's descriptors in its own words, with which are carried forward and why
//   2  Measurements            for each carried criterion, each variant: the value with its unit, its status, and the reading (yours where you wrote one)
//   3  Evidence and selection  plan / section diagrams with the evidence marked, the usable-space check, and the suggested selection with its rationale

import { buildDrawing, type Drawing } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, type DrawingStyle } from "@/lib/drawing/render";
import { diagramSpec } from "@/lib/scoring/exportResults";
import { paletteStyle, type Palette } from "@/lib/boardPalette";
import { BOARD_FONT, drawBlock } from "@/lib/textBlock";
import { MATRIX, STATUS_LABEL, type MatrixKey } from "@/lib/scoring/matrix";
import type { MatrixResult, TileEvaluation } from "@/lib/scoring/matrixEval";
import { intentionText, type Pick, type TypologyGroup } from "@/lib/scoring/compareSet";
import { interpretationFor, type EvaluationProfile } from "@/lib/scoring/profile";
import { shortName } from "@/lib/scoring/compare";
import { ft, ft2, ft3 } from "@/lib/scoring/words";
import type { ParsedTile } from "@/lib/types";

export interface SheetContent {
  /** the typology and its spatial intention */
  intention: boolean;
  /** the matrix's own descriptors, qualitative and quantitative criteria and precedent */
  criteria: boolean;
  /** which criteria are carried forward and set aside, with the reasons */
  reasons: boolean;
  /** the measurements with their units and status */
  measures: boolean;
  /** the automated readings and any you wrote */
  readings: boolean;
  /** evidence diagrams and the usable-space check */
  diagrams: boolean;
  /** the suggested selection and its rationale */
  selection: boolean;
}

export const defaultSheetContent = (): SheetContent => ({ intention: true, criteria: true, reasons: true, measures: true, readings: true, diagrams: true, selection: true });

export interface SheetInput {
  project: string;
  group: TypologyGroup;
  evals: Map<string, TileEvaluation>;
  profile: EvaluationProfile;
  carried: MatrixKey[];
  reasons: Partial<Record<MatrixKey, string>>;
  setAside: Partial<Record<MatrixKey, string>>;
  pick: Pick | null;
  palette: Palette;
  fontFamily?: string;
  content: SheetContent;
  widthIn: number;
  heightIn: number;
  dpi: number;
}

export interface Sheet {
  name: string;
  blob: Blob;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the sheet."))), "image/png"));

class Page {
  ctx: CanvasRenderingContext2D;
  constructor(public canvas: HTMLCanvasElement, public px: number, public p: Palette, public family: string) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  /** inches to pixels */
  i = (v: number) => v * this.px;
  text(s: string, x: number, y: number, w: number, h: number, size: number, o: { min?: number; lines?: number; weight?: string; color?: string; align?: CanvasTextAlign; mono?: boolean } = {}): number {
    // the board font has no superscripts: ft² and ft³ are written out (the monospaced text keeps them)
    const shown = o.mono ? s : s.replace(/ft²/g, "sq ft").replace(/ft³/g, "cu ft");
    // returns the height used, in inches
    return drawBlock(this.ctx, shown, this.i(x), this.i(y), this.i(w), this.i(h), {
      max: this.i(size),
      min: this.i(o.min ?? size * 0.55),
      maxLines: o.lines ?? Math.max(1, Math.floor(h / (size * 1.25))),
      weight: o.weight,
      family: o.mono ? "ui-monospace, Menlo, Consolas, 'Courier New', monospace" : this.family,
      color: o.color ?? this.p.text,
      align: o.align,
    }) / this.px;
  }
  rule(x: number, y: number, w: number, a = 0.6) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = this.p.frame;
    c.globalAlpha = a;
    c.lineWidth = Math.max(1, this.i(0.008));
    c.beginPath();
    c.moveTo(this.i(x), this.i(y));
    c.lineTo(this.i(x + w), this.i(y));
    c.stroke();
    c.restore();
  }
  frame(x: number, y: number, w: number, h: number) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = this.p.frame;
    c.lineWidth = Math.max(1, this.i(0.008));
    c.strokeRect(this.i(x), this.i(y), this.i(w), this.i(h));
    c.restore();
  }
}

const M = 0.55;

function header(pg: Page, W: number, title: string, sub: string, project: string) {
  pg.text(title.toUpperCase(), M, 0.34, W * 0.6, 0.55, 0.42, { weight: "600", color: pg.p.accent, lines: 1 });
  pg.text(sub, M, 0.92, W * 0.62, 0.28, 0.15, { color: pg.p.muted, lines: 1 });
  pg.text(project.toUpperCase(), W - M - W * 0.3, 0.42, W * 0.3, 0.3, 0.15, { color: pg.p.muted, align: "right", lines: 1 });
  pg.text(new Date().toLocaleDateString(), W - M - W * 0.3, 0.72, W * 0.3, 0.25, 0.12, { color: pg.p.muted, align: "right", lines: 1 });
  pg.rule(M, 1.28, W - 2 * M);
}

const statusColor = (pg: Page, s: string) => (s === "measured" ? pg.p.good : s === "unavailable" || s === "not-applicable" ? pg.p.muted : pg.p.warn);

// ---- sheet 1: the typology, the matrix, what is carried ----------------------------------------------------------------------------------------------

function sheetCriteria(pg: Page, W: number, H: number, inp: SheetInput) {
  const { content: c } = inp;
  header(pg, W, inp.group.label, "Typology and criteria", inp.project);
  const left = c.intention ? 5.6 : 0;
  const top = 1.5;
  if (c.intention) {
    const it = intentionText(inp.group, inp.profile.overrides.intentions[inp.group.key]);
    pg.text("TYPOLOGY", M, top, left - 0.3, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
    pg.text(inp.group.label, M, top + 0.26, left - 0.3, 0.8, 0.3, { weight: "600", lines: 2 });
    pg.text(`${inp.group.tiles.length} variant${inp.group.tiles.length === 1 ? "" : "s"}: ${inp.group.tiles.map((t) => t.name).join(", ")}`, M, top + 1.1, left - 0.3, 0.7, 0.13, { color: pg.p.muted, lines: 4 });
    pg.text("SPATIAL INTENTION", M, top + 1.95, left - 0.3, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
    pg.text(it.text, M, top + 2.2, left - 0.3, 3.1, 0.2, { lines: 14 });
    if (!it.written) pg.text("Generated from the name and category of the tiles. The real intention can be written in the Analysis tab and replaces this line.", M, top + 5.4, left - 0.3, 0.7, 0.11, { color: pg.p.muted, lines: 4 });
  }
  if (!c.criteria && !c.reasons) return;
  const x0 = M + left;
  const w = W - x0 - M;
  const cols = c.criteria
    ? [
        { k: "flag", w: 0.28 },
        { k: "name", w: 2.1 },
        { k: "q", w: 3.3 },
        { k: "n", w: 3.3 },
        { k: "p", w: 2.2 },
        ...(c.reasons ? [{ k: "r", w: 0 }] : []),
      ]
    : [{ k: "flag", w: 0.28 }, { k: "name", w: 2.4 }, { k: "r", w: 0 }];
  const fixed = cols.reduce((a, k) => a + k.w, 0);
  const free = Math.max(0, w - fixed);
  const nFree = cols.filter((k) => k.k === "r").length || 1;
  const widths = cols.map((k) => (k.k === "r" ? Math.max(2, free / nFree) : k.w));
  // if the columns are wider than the page, scale them all down together
  const sum = widths.reduce((a, b) => a + b, 0);
  const sc = sum > w ? w / sum : 1;
  let x = x0;
  const xs = widths.map((cw) => {
    const r = x;
    x += cw * sc;
    return r;
  });
  const heads: Record<string, string> = { flag: "", name: "DESCRIPTOR", q: "QUALITATIVE CRITERION", n: "QUANTITATIVE CRITERION", p: "PRECEDENT", r: "CARRIED FORWARD, AND WHY" };
  cols.forEach((col, i) => pg.text(heads[col.k], xs[i], top, widths[i] * sc - 0.1, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 }));
  pg.rule(x0, top + 0.26, w);
  const rowH = (H - top - 0.4 - 0.3) / MATRIX.length;
  MATRIX.forEach((m, r) => {
    const y = top + 0.34 + r * rowH;
    const carried = inp.carried.includes(m.key);
    cols.forEach((col, i) => {
      const cw = widths[i] * sc - 0.12;
      switch (col.k) {
        case "flag":
          pg.ctx.save();
          pg.ctx.fillStyle = carried ? pg.p.accent : "transparent";
          pg.ctx.strokeStyle = pg.p.frame;
          pg.ctx.lineWidth = Math.max(1, pg.i(0.01));
          pg.ctx.beginPath();
          pg.ctx.arc(pg.i(xs[i] + 0.1), pg.i(y + rowH * 0.32), pg.i(0.07), 0, Math.PI * 2);
          if (carried) pg.ctx.fill();
          else pg.ctx.stroke();
          pg.ctx.restore();
          break;
        case "name":
          pg.text(m.name, xs[i], y, cw, rowH * 0.62, 0.17, { weight: "600", lines: 2, color: carried ? pg.p.text : pg.p.muted });
          pg.text(m.group, xs[i], y + rowH * 0.62, cw, rowH * 0.3, 0.09, { color: pg.p.muted, lines: 1 });
          break;
        case "q":
          pg.text(m.qualitative, xs[i], y, cw, rowH * 0.92, 0.125, { color: pg.p.muted, lines: 4 });
          break;
        case "n":
          pg.text(m.quantitative, xs[i], y, cw, rowH * 0.92, 0.125, { color: pg.p.muted, lines: 4 });
          break;
        case "p":
          pg.text(m.precedent, xs[i], y, cw, rowH * 0.92, 0.115, { color: pg.p.muted, lines: 4 });
          break;
        case "r":
          pg.text(carried ? (inp.reasons[m.key] ?? "") : (inp.setAside[m.key] ?? "set aside"), xs[i], y, cw, rowH * 0.92, 0.115, { color: carried ? pg.p.text : pg.p.muted, lines: 5 });
          break;
      }
    });
    if (r < MATRIX.length - 1) pg.rule(x0, y + rowH - 0.05, w, 0.25);
  });
}

// ---- sheet 2: measurements and readings -------------------------------------------------------------------------------------------------------------------

function sheetMeasures(pg: Page, W: number, H: number, inp: SheetInput, tiles: ParsedTile[], page: number, pages: number) {
  const { content: c } = inp;
  header(pg, W, inp.group.label, `Measurements and readings${pages > 1 ? ` · ${page}/${pages}` : ""}`, inp.project);
  const keys = inp.carried;
  const top = 1.5;
  const nameW = 2.4;
  const colW = (W - 2 * M - nameW) / Math.max(1, tiles.length);
  tiles.forEach((t, i) => {
    pg.text(t.name.toUpperCase(), M + nameW + i * colW, top, colW - 0.15, 0.22, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
  });
  pg.text("CRITERION", M, top, nameW - 0.1, 0.22, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
  pg.rule(M, top + 0.28, W - 2 * M);
  if (!keys.length) {
    pg.text("No criterion is carried forward yet: none can be assessed and tell the tiles apart. Criteria can be pinned on in the Analysis tab.", M, top + 0.5, W - 2 * M, 0.5, 0.17, { color: pg.p.muted, lines: 2 });
    return;
  }
  const rowH = (H - top - 0.4 - 0.3) / keys.length;
  keys.forEach((k, r) => {
    const y = top + 0.36 + r * rowH;
    const m = MATRIX.find((x) => x.key === k)!;
    pg.text(m.name, M, y, nameW - 0.15, rowH * 0.55, 0.17, { weight: "600", lines: 2 });
    pg.text(m.group, M, y + rowH * 0.55, nameW - 0.15, rowH * 0.3, 0.09, { color: pg.p.muted, lines: 1 });
    tiles.forEach((t, i) => {
      const res = inp.evals.get(t.id)?.results.find((x) => x.key === k) as MatrixResult | undefined;
      const x = M + nameW + i * colW;
      if (!res) return;
      let yy = y;
      if (c.measures) {
        yy += pg.text(res.measure.headline, x, yy, colW - 0.2, rowH * 0.42, 0.135, { weight: "600", lines: 3, mono: true });
        pg.text(STATUS_LABEL[res.measure.status].toUpperCase() + (res.measure.value !== null && res.measure.unit ? ` · ${res.measure.unit}` : ""), x, yy + 0.02, colW - 0.2, 0.16, 0.085, { color: statusColor(pg, res.measure.status), lines: 1, mono: true });
        yy += 0.2;
      }
      if (c.readings) {
        const reading = interpretationFor(inp.profile, t.id, res);
        pg.text(`${reading.edited ? "✎ " : ""}${reading.text}`, x, yy, colW - 0.2, Math.max(0.2, y + rowH * 0.95 - yy), 0.11, { color: pg.p.muted, lines: 6 });
      }
    });
    if (r < keys.length - 1) pg.rule(M, y + rowH - 0.05, W - 2 * M, 0.25);
  });
}

// ---- sheet 3: evidence and selection --------------------------------------------------------------------------------------------------------------------------

function sheetEvidence(pg: Page, W: number, H: number, inp: SheetInput, style: DrawingStyle) {
  const { content: c } = inp;
  header(pg, W, inp.group.label, "Evidence and selection", inp.project);
  const tile = (inp.pick?.tileId ? inp.group.tiles.find((t) => t.id === inp.pick!.tileId) : null) ?? inp.group.tiles[0];
  const ev = inp.evals.get(tile.id);
  const top = 1.5;
  const rightW = c.selection || ev ? 5.4 : 0;
  const gridW = W - 2 * M - (rightW ? rightW + 0.3 : 0);
  if (c.diagrams && ev) {
    const use = ev.results.filter((r) => inp.carried.includes(r.key) && r.measure.status !== "unavailable").slice(0, 8);
    const cols = use.length > 6 ? 4 : use.length > 3 ? 3 : Math.max(1, use.length);
    const rows = Math.max(1, Math.ceil(use.length / cols));
    const cw = gridW / cols;
    const ch = (H - top - 0.5) / rows;
    pg.text(`${tile.name.toUpperCase()}${inp.group.tiles.length > 1 ? (inp.pick?.tileId === tile.id ? " · the suggested variant" : "") : ""}`, M, top - 0.05, gridW, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 });
    use.forEach((r, i) => {
      const x = M + (i % cols) * cw;
      const y = top + 0.25 + Math.floor(i / cols) * ch;
      const d: Drawing | null = buildDrawing(tile, diagramSpec(tile, r), { ...r.evidence });
      const capH = 0.62;
      if (d) {
        const unit = drawingSize(d, { pxPerFt: 1, caption: false });
        const availW = pg.i(cw - 0.25);
        const availH = pg.i(ch - capH - 0.1);
        const pxPerFt = Math.min(availW / unit.width, availH / unit.height);
        const fit = drawingSize(d, { pxPerFt, caption: false });
        drawToCanvas(pg.ctx, { ...d, labels: [] }, style, { pxPerFt, caption: false, background: false }, { x: pg.i(x) + (availW - fit.width) / 2, y: pg.i(y) });
      }
      pg.text(r.criterion.name, x, y + ch - capH, cw - 0.25, 0.22, 0.13, { weight: "600", lines: 1 });
      pg.text(r.measure.headline, x, y + ch - capH + 0.22, cw - 0.25, 0.36, 0.1, { color: pg.p.muted, lines: 2, mono: true });
    });
  }
  if (rightW) {
    const x = W - M - rightW;
    let y = top;
    if (ev && c.diagrams) {
      const u = ev.usable;
      pg.text("USABLE SPACE", x, y, rightW, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
      y += 0.3;
      const t = u.thresholds;
      const lines = u.available
        ? [
            `${ft3(u.voidFt3)} carved · ${ft3(u.reachableVoidFt3)} over floor that can be reached`,
            `${ft2(u.plateFt2)} of plate · ${ft2(u.usableFt2)} exposed and usable floor`,
            `${u.voidPieces} void piece${u.voidPieces === 1 ? "" : "s"} · ${u.zonesReached} of ${u.zones} floor zones joined to the way in`,
            `${u.verticalVisual} void link${u.verticalVisual === 1 ? "" : "s"} between levels · ${u.levelsReached} of ${u.levelsTotal} levels reached on foot`,
            `${ft2(u.tightFt2)} of floor too narrow or too low · ${ft2(u.cutOffFt2)} of floor with no way to it`,
            `Thresholds: ${ft(t.headroomFt, 1)} headroom, ${ft(t.widthFt, 1)} clear width, ${ft(t.stepFt, 1)} steps. Proto-architectural, not a code check.`,
          ]
        : [u.reason];
      for (const l of lines) y += pg.text(l, x, y, rightW, 0.5, 0.115, { color: pg.p.muted, lines: 3 }) + 0.07;
      y += 0.2;
    }
    if (c.selection) {
      pg.text("SUGGESTED SELECTION", x, y, rightW, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
      y += 0.3;
      const mine = inp.profile.overrides.picks[inp.group.key];
      const chosen = mine ? inp.group.tiles.find((t) => t.id === mine) : inp.pick?.supported ? inp.group.tiles.find((t) => t.id === inp.pick!.tileId) : null;
      const none = inp.pick?.verdict === "tradeoff" ? "A tradeoff, not a winner" : inp.pick?.verdict === "tie" ? "No pick: the variants do not differ where it matters" : "No pick: the evidence does not support one";
      const headline = inp.group.tiles.length < 2 ? "Only one variant" : chosen ? `${chosen.name}${mine ? " (your choice)" : ""}` : none;
      y += pg.text(headline, x, y, rightW, 0.6, 0.18, { weight: "600", lines: 2, color: chosen ? pg.p.good : pg.p.text }) + 0.1;
      const why = inp.profile.overrides.pickReasons[inp.group.key] ?? inp.pick?.rationale ?? "";
      y += pg.text(why, x, y, rightW, Math.max(0.5, (H - y - 0.45) * 0.55), 0.12, { color: pg.p.muted, lines: 10 }) + 0.08;
      // who leads on what, and the rules behind it (the system's assumptions, not assignment requirements)
      for (const t of (inp.pick?.tradeoffs ?? []).slice(0, 5)) y += pg.text(`• ${t}`, x, y, rightW, 0.5, 0.105, { color: pg.p.muted, lines: 3 }) + 0.05;
      if (inp.pick && inp.pick.assumptions.length && H - y > 0.7) pg.text(`Targets used are the system's assumptions for this typology, not assignment requirements: ${inp.pick.assumptions.slice(0, 3).map((a) => a.split(" — ")[0]).join("; ")}.`, x, y + 0.05, rightW, H - y - 0.45, 0.095, { color: pg.p.muted, lines: 5 });
    }
  }
}

/** The sheets for one typology; each is a landscape page of the given size on the palette's background. */
export async function buildAnalysisSheets(inp: SheetInput): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const px = inp.dpi;
  const family = inp.fontFamily ? `"${inp.fontFamily}", ${BOARD_FONT}` : BOARD_FONT;
  const style = paletteStyle(inp.palette);
  const make = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(W * px);
    c.height = Math.round(H * px);
    return new Page(c, px, inp.palette, family);
  };
  const stem = inp.group.key.replace(/[^\w.-]+/g, "_") || "typology";
  const out: Sheet[] = [];
  const c = inp.content;
  if (c.intention || c.criteria || c.reasons) {
    const pg = make();
    sheetCriteria(pg, W, H, inp);
    out.push({ name: `${stem}_1_criteria.png`, blob: await toBlob(pg.canvas) });
  }
  if (c.measures || c.readings) {
    // up to four variants side by side on a sheet; more continue on the next
    const per = 4;
    const chunks: ParsedTile[][] = [];
    for (let i = 0; i < inp.group.tiles.length; i += per) chunks.push(inp.group.tiles.slice(i, i + per));
    for (let i = 0; i < chunks.length; i++) {
      const pg = make();
      sheetMeasures(pg, W, H, inp, chunks[i], i + 1, chunks.length);
      out.push({ name: `${stem}_2_measurements${chunks.length > 1 ? `_${i + 1}` : ""}.png`, blob: await toBlob(pg.canvas) });
    }
  }
  if (c.diagrams || c.selection) {
    const pg = make();
    sheetEvidence(pg, W, H, inp, style);
    out.push({ name: `${stem}_3_evidence.png`, blob: await toBlob(pg.canvas) });
  }
  return out;
}

export { shortName };
