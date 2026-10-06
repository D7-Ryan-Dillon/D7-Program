// The sheets Assignment 2 asks for, drawn from the program's own results (the same evaluation as the Analysis tab, the same interlock test as Arrange):
//
//   geometry     6.1  the 3 x 5 catalogue of the fifteen tiles, each with an aggregation of copies (repeat, mirror or shift) that proves the interlock, its joint
//                     scores, and the Part 2 pass: the tile's strongest descriptors still read in the aggregate, and the carried criteria are still present
//   diagrams     5.1  the 3 x 5 catalogue as plan and section diagrams, every cell labelled with its type
//   ideas        4.2-4.4  one page per category: each type's image, spatial intention, the descriptors it shows most, and its criteria evaluation as bars
//   criteria     7.1  the matrix's descriptors: carried forward or set aside, and why, with how each of the fifteen tiles reads
//   evaluation   7.2-7.4  one page per category: the carried criteria across its five types, usable floor, fit to the type
//   workflow     the workflow and the run logs (the interlock test of every tile, written out; room for the Versur logs)
//   insights     8.1       and   references
//
// Landscape pages of any size (22 x 11 in by default) on the board's background. Text is fitted to its box; nothing is crammed in.

import { buildDrawing, planSpecs } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, type DrawingStyle } from "@/lib/drawing/render";
import { specFromState, defaultDrawState } from "@/lib/drawing/state";
import { paletteStyle, type Palette } from "@/lib/boardPalette";
import { BOARD_FONT } from "@/lib/textBlock";
import { MATRIX, type MatrixKey } from "@/lib/scoring/matrix";
import { evaluateTile, type TileEvaluation } from "@/lib/scoring/matrixEval";
import { barOf, type BarSpec } from "@/lib/scoring/bars";
import { intentionText, typologyGroups, typologyKey } from "@/lib/scoring/compareSet";
import type { EvaluationProfile } from "@/lib/scoring/profile";
import { renderTileToDataUrl } from "@/lib/renderTile";
import { analyzeLayout } from "@/lib/arrange/layout";
import { buildComposite, compositeToTile } from "@/lib/arrange/composite";
import { INTERLOCK_PATTERNS, runInterlock, type InterlockCount, type InterlockPattern, type InterlockResult } from "@/lib/arrange/interlock";
import { defaultRules } from "@/lib/arrange/types";
import { parseTileName } from "@/lib/boards/tileLabel";
import { CATALOGUE_CATEGORIES, CATALOGUE_COLUMNS } from "@/lib/boards/types";
import { Page, header, M, toBlob, statusColor, type Sheet } from "@/lib/boards/analysisSheets";
import { ft2 } from "@/lib/scoring/words";
import type { ParsedTile } from "@/lib/types";

export type AssignmentKind = "geometry" | "diagrams" | "ideas" | "criteria" | "evaluation" | "workflow" | "insights" | "references";

export interface AssignmentTexts {
  /** the workflow, in your words */
  workflow: string;
  /** the Versur run logs (they live outside the program: paste them here) */
  versur: string;
  insights: string;
  references: string;
}

export const defaultAssignmentTexts = (): AssignmentTexts => ({
  workflow:
    "Assignment 1: the descriptors and the criteria matrix (the Part 3 matrix) for the fifteen types.\nPart 1: fifteen diagrammatic ideas, one per type, labelled with the type they encode.\nPart 2: one geometrical system for the whole catalogue: erosion tiles on a 20 ft registration lattice, each a tile that repeats, mirrors, shifts and turns in 90 degree steps and interlocks with its neighbours (floors, voids and openings continue across the joint). Each tile is tested in the Arrange tab by two, four and eight copies.\nPart 3: the criteria carried forward from the Assignment 1 matrix, scored on the fifteen tiles in the Analysis tab (measured, with units and status), and the selection.",
  versur: "Part 1 run log: [paste the Versur run log]\n\nPart 2 run log: [paste the Versur run log]\n\nPart 3 run log: [paste the Versur run log]",
  insights: "",
  references: "FAU School of Architecture, ARC4327 Architectural Design 7, Assignment 2: Proto-Architectural Spaces, Fall 2026.\n[add the images, articles, books, videos and lectures used]",
});

export interface AssignmentInput {
  project: string;
  tiles: ParsedTile[];
  evals: Map<string, TileEvaluation>;
  profile: EvaluationProfile;
  carried: MatrixKey[];
  reasons: Partial<Record<MatrixKey, string>>;
  setAside: Partial<Record<MatrixKey, string>>;
  palette: Palette;
  fontFamily?: string;
  /** the board's own look for tile renders */
  look: { foamColor: string; voidColor: string; foamOpacity: number; voidOpacity: number };
  texts: AssignmentTexts;
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** for the category pages: gathering, office or lobby */
  category?: (typeof CATALOGUE_CATEGORIES)[number];
  onProgress?: (done: number, total: number, what: string) => void;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- placing the fifteen -----------------------------------------------------------------------------------------------------------------------------

interface Placed {
  tile: ParsedTile;
  category: number;
  number: number;
  tag: string;
  type: string;
}

function place(tiles: ParsedTile[]): Placed[] {
  const out: Placed[] = [];
  for (const t of tiles) {
    const p = parseTileName(t.name);
    const cat = CATALOGUE_CATEGORIES.findIndex((c) => (t.meta?.category ?? p.category).toLowerCase().startsWith(c));
    const num = t.meta?.slot ?? p.number;
    if (cat < 0 || !num || num < 1 || num > CATALOGUE_COLUMNS) continue;
    out.push({ tile: t, category: cat, number: num, tag: `${CATALOGUE_CATEGORIES[cat][0].toUpperCase()}${num}`, type: cap((t.meta?.typology ?? p.typology).replace(/_/g, " ")) });
  }
  // two variants of one cell: the first in the bank order is shown
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.tag) ? false : (seen.add(p.tag), true))).sort((a, b) => a.category - b.category || a.number - b.number);
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Couldn't load a tile render."));
    img.src = url;
  });

async function renderImage(tile: ParsedTile, inp: AssignmentInput, wPx: number, hPx: number): Promise<HTMLImageElement | null> {
  if (!tile.glbUrl) return null;
  const url = await renderTileToDataUrl({
    glbUrl: tile.glbUrl,
    refine: inp.dpi >= 100 ? tile : undefined,
    view: "iso-top-ne",
    width: Math.max(64, Math.round(wPx)),
    height: Math.max(64, Math.round(hPx)),
    backgroundColor: null,
    foamColor: inp.look.foamColor,
    voidColor: inp.look.voidColor,
    foamOpacity: inp.look.foamOpacity,
    voidOpacity: inp.look.voidOpacity,
    foamVisible: true,
    voidVisible: true,
    pxPerPt: inp.dpi / 72,
  });
  return loadImage(url);
}

function drawFit(pg: Page, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(pg.i(w) / img.width, pg.i(h) / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  pg.ctx.drawImage(img, pg.i(x) + (pg.i(w) - dw) / 2, pg.i(y) + (pg.i(h) - dh) / 2, dw, dh);
}

/** A bar on the page: segments for the app's scale, filled to where the measurement falls (lighter when only a proxy or an assumption, dashed when not assessable). */
function pageBar(pg: Page, x: number, y: number, w: number, h: number, bar: BarSpec | null, color: string) {
  if (!bar) return;
  const c = pg.ctx;
  const n = Math.max(1, bar.steps);
  const gap = pg.i(0.025);
  const segW = (pg.i(w) - gap * (n - 1)) / n;
  c.save();
  for (let i = 0; i < n; i++) {
    const sx = pg.i(x) + i * (segW + gap);
    if (bar.index === null) {
      c.strokeStyle = pg.p.muted;
      c.lineWidth = Math.max(1, pg.i(0.008));
      c.setLineDash([pg.i(0.03), pg.i(0.03)]);
      c.strokeRect(sx, pg.i(y), segW, pg.i(h));
    } else if (i <= bar.index) {
      c.globalAlpha = bar.solid ? 1 : 0.5;
      c.fillStyle = color;
      c.fillRect(sx, pg.i(y), segW, pg.i(h));
      c.globalAlpha = 1;
      if (!bar.solid) {
        c.strokeStyle = color;
        c.lineWidth = Math.max(1, pg.i(0.008));
        c.strokeRect(sx, pg.i(y), segW, pg.i(h));
      }
    } else {
      c.globalAlpha = 0.18;
      c.fillStyle = color;
      c.fillRect(sx, pg.i(y), segW, pg.i(h));
      c.globalAlpha = 1;
    }
  }
  c.restore();
}

function drawDiagram(pg: Page, tile: ParsedTile, mode: "plan" | "section", style: DrawingStyle, x: number, y: number, w: number, h: number) {
  const spec = specFromState(tile, { ...defaultDrawState(), mode });
  const d = spec ? buildDrawing(tile, spec) : null;
  if (!d) return;
  const unit = drawingSize(d, { pxPerFt: 1, caption: false });
  const pxPerFt = Math.min(pg.i(w) / unit.width, pg.i(h) / unit.height);
  const fit = drawingSize(d, { pxPerFt, caption: false });
  drawToCanvas(pg.ctx, { ...d, labels: [] }, style, { pxPerFt, caption: false, background: false }, { x: pg.i(x) + (pg.i(w) - fit.width) / 2, y: pg.i(y) + (pg.i(h) - fit.height) / 2 });
}

const makePage = (inp: AssignmentInput) => {
  const c = document.createElement("canvas");
  c.width = Math.round(inp.widthIn * inp.dpi);
  c.height = Math.round(inp.heightIn * inp.dpi);
  const family = inp.fontFamily ? `"${inp.fontFamily}", ${BOARD_FONT}` : BOARD_FONT;
  return new Page(c, inp.dpi, inp.palette, family);
};

const evalOf = (inp: AssignmentInput, t: ParsedTile): TileEvaluation => inp.evals.get(t.id) ?? evaluateTile(t);

// ---- the Part 2 pass ---------------------------------------------------------------------------------------------------------------------------------

export interface PassReading {
  holds: number;
  of: number;
  names: string[];
  present: number;
  carried: number;
}

/** Do the tile's strongest descriptors still read in the aggregate (within one band), and are the carried criteria still assessable there? */
export function part2Pass(base: TileEvaluation, agg: TileEvaluation, carried: MatrixKey[]): PassReading {
  const ranked = base.results
    .filter((r) => r.interpretation.index !== undefined && r.measure.status !== "unavailable" && r.measure.status !== "not-applicable")
    .sort((a, b) => (b.interpretation.index ?? 0) - (a.interpretation.index ?? 0))
    .slice(0, 3);
  const kept = ranked.filter((r) => {
    const q = agg.results.find((x) => x.key === r.key);
    return !!q && q.interpretation.index !== undefined && Math.abs(q.interpretation.index - (r.interpretation.index ?? 0)) <= 1;
  });
  const keys = carried.length ? carried : MATRIX.map((m) => m.key);
  const present = keys.filter((k) => {
    const q = agg.results.find((x) => x.key === k);
    return !!q && q.measure.status !== "unavailable" && q.measure.status !== "not-applicable";
  }).length;
  return { holds: kept.length, of: ranked.length, names: kept.map((r) => r.criterion.name), present, carried: keys.length };
}

/** The aggregation that proves the interlock best: connected and walkable first, then the better joint score; fewer copies first (2 and 4 are what the brief shows). */
export function bestAggregation(tile: ParsedTile, tiles: Map<string, ParsedTile>): { result: InterlockResult; count: InterlockCount } | null {
  let best: { result: InterlockResult; count: InterlockCount; v: number } | null = null;
  for (const count of [4, 2] as InterlockCount[])
    for (const pattern of INTERLOCK_PATTERNS) {
      const r = runInterlock(tile, pattern, count, defaultRules());
      const v = (r.connected ? 1000 : 0) + (r.walkable ? 500 : 0) + (r.overall ?? 0) + (count === 4 ? 5 : 0);
      if (!best || v > best.v) best = { result: r, count, v };
    }
  void tiles;
  return best;
}

// ---- 6.1 the geometry catalogue ---------------------------------------------------------------------------------------------------------------------

async function sheetGeometry(inp: AssignmentInput): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const pg = makePage(inp);
  header(pg, W, "Geometrical system catalogue", "Fifteen tiles, one system: erosion tiles on a 20 ft lattice, each shown with copies that prove the interlock", inp.project);
  const placed = place(inp.tiles);
  const tilesById = new Map(inp.tiles.map((t) => [t.id, t]));
  const rules = defaultRules();
  const gridTop = 1.5;
  const cw = (W - 2 * M) / CATALOGUE_COLUMNS;
  const rowsN = CATALOGUE_CATEGORIES.length;
  const ch = (H - gridTop - 0.45) / rowsN;
  let done = 0;
  for (const p of placed) {
    inp.onProgress?.(done++, placed.length, p.tile.name);
    const x = M + (p.number - 1) * cw;
    const y = gridTop + p.category * ch;
    const agg = bestAggregation(p.tile, tilesById);
    const imgH = ch - 0.95;
    const halfW = (cw - 0.2) / 2;
    const own = await renderImage(p.tile, inp, pg.i(halfW) * 1.0, pg.i(imgH));
    if (own) drawFit(pg, own, x, y, halfW, imgH);
    let line1 = "no aggregation could be made";
    let pass = "";
    if (agg) {
      const layout = analyzeLayout(agg.result.doc, tilesById, rules);
      const comp = buildComposite(layout.boxes);
      if (comp) {
        const aggTile = await compositeToTile(comp, layout.boxes, { name: `${p.tag} ${agg.result.pattern} x${agg.count}`, doc: agg.result.doc, withMeshes: true });
        const img = await renderImage(aggTile, inp, pg.i(halfW), pg.i(imgH));
        if (img) drawFit(pg, img, x + halfW + 0.1, y, halfW, imgH);
        const base = evalOf(inp, p.tile);
        const reading = part2Pass(base, evaluateTile(aggTile), inp.carried);
        pass = `Part 2 pass: ${reading.holds} of ${reading.of} strongest descriptors still read${reading.names.length ? ` (${reading.names.join(", ")})` : ""}; ${reading.present} of ${reading.carried} criteria present`;
        const { evictTileRender } = await import("@/lib/renderTile");
        evictTileRender(aggTile.glbUrl);
      }
      const r = agg.result;
      line1 = `${r.pattern} x${agg.count} · ${r.joints} joint${r.joints === 1 ? "" : "s"} · score ${r.overall === null ? "-" : Math.round(r.overall)} · ${r.connected ? (r.walkable ? "walkable" : "attached") : "not attached"}`;
    }
    pg.text(`${p.tag}  ${p.type}`.toUpperCase(), x, y + imgH + 0.04, cw - 0.2, 0.22, 0.125, { weight: "600", color: pg.p.accent, lines: 1 });
    pg.text(line1, x, y + imgH + 0.27, cw - 0.2, 0.2, 0.1, { color: pg.p.muted, lines: 1, mono: true });
    if (pass) pg.text(pass, x, y + imgH + 0.47, cw - 0.2, 0.42, 0.095, { color: pg.p.text, lines: 3 });
  }
  CATALOGUE_CATEGORIES.forEach((c, i) => pg.text(c.toUpperCase(), M - 0.4, gridTop + i * ch + 0.6, 0.3, ch - 1, 0.1, { color: pg.p.heading, weight: "600", lines: 1 }));
  return [{ name: "6_1_geometry_catalogue.png", blob: await toBlob(pg.canvas) }];
}

// ---- 5.1 the diagram catalogue ----------------------------------------------------------------------------------------------------------------------

async function sheetDiagrams(inp: AssignmentInput): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const pg = makePage(inp);
  const style = paletteStyle(inp.palette);
  header(pg, W, "Diagrammatic catalogue", "Fifteen ideas, three categories by five types: plan and section of each, labelled with the type it encodes", inp.project);
  const gridTop = 1.5;
  const cw = (W - 2 * M) / CATALOGUE_COLUMNS;
  const ch = (H - gridTop - 0.45) / CATALOGUE_CATEGORIES.length;
  const placed = place(inp.tiles);
  let done = 0;
  for (const p of placed) {
    inp.onProgress?.(done++, placed.length, p.tile.name);
    const x = M + (p.number - 1) * cw;
    const y = gridTop + p.category * ch;
    const dh = ch - 0.6;
    drawDiagram(pg, p.tile, "plan", style, x, y, (cw - 0.2) * 0.45, dh);
    drawDiagram(pg, p.tile, "section", style, x + (cw - 0.2) * 0.5, y, (cw - 0.2) * 0.5, dh);
    pg.text(`${cap(CATALOGUE_CATEGORIES[p.category])} ${p.number}`.toUpperCase(), x, y + dh + 0.03, cw - 0.2, 0.2, 0.1, { color: pg.p.heading, weight: "600", lines: 1 });
    pg.text(p.type, x, y + dh + 0.24, cw - 0.2, 0.28, 0.14, { weight: "600", lines: 1 });
  }
  return [{ name: "5_1_diagram_catalogue.png", blob: await toBlob(pg.canvas) }];
}

// ---- 4.2-4.4 the ideas, per category ----------------------------------------------------------------------------------------------------------------

async function sheetIdeas(inp: AssignmentInput): Promise<Sheet[]> {
  const out: Sheet[] = [];
  const cats = inp.category ? [inp.category] : [...CATALOGUE_CATEGORIES];
  const placed = place(inp.tiles);
  let done = 0;
  for (const cat of cats) {
    const ci = CATALOGUE_CATEGORIES.indexOf(cat);
    const W = inp.widthIn;
    const H = inp.heightIn;
    const pg = makePage(inp);
    const sec = ci + 2;
    header(pg, W, `${cap(cat)} spaces`, `Section 4.${sec}: the diagrammatic ideas, the descriptors used and the criteria evaluation`, inp.project);
    const cw = (W - 2 * M) / CATALOGUE_COLUMNS;
    const top = 1.45;
    for (const p of placed.filter((q) => q.category === ci)) {
      inp.onProgress?.(done++, 5 * cats.length, p.tile.name);
      const x = M + (p.number - 1) * cw;
      const w = cw - 0.25;
      pg.text(`${p.tag}  ${p.type}`.toUpperCase(), x, top, w, 0.26, 0.14, { weight: "600", color: pg.p.accent, lines: 1 });
      const img = await renderImage(p.tile, inp, pg.i(w), pg.i(2.3));
      if (img) drawFit(pg, img, x, top + 0.32, w, 2.3);
      const group = typologyGroups([p.tile])[0];
      const it = intentionText(group, inp.profile.overrides.intentions[group.key]);
      pg.text(it.text, x, top + 2.7, w, 1.15, 0.115, { color: pg.p.muted, lines: 7 });
      const ev = evalOf(inp, p.tile);
      const ranked = ev.results.filter((r) => r.interpretation.index !== undefined && r.measure.status !== "unavailable").sort((a, b) => (b.interpretation.index ?? 0) - (a.interpretation.index ?? 0)).slice(0, 3);
      pg.text("DESCRIPTORS USED", x, top + 3.92, w, 0.16, 0.09, { color: pg.p.heading, weight: "600", lines: 1 });
      pg.text(ranked.map((r) => `${r.criterion.name} (${r.interpretation.scale?.[r.interpretation.index ?? 0] ?? ""})`).join(" · "), x, top + 4.08, w, 0.5, 0.105, { lines: 3 });
      pg.text("CRITERIA EVALUATION", x, top + 4.62, w, 0.16, 0.09, { color: pg.p.heading, weight: "600", lines: 1 });
      const rowH = Math.min(0.22, (H - (top + 4.82) - 0.4) / ev.results.length);
      ev.results.forEach((r, i) => {
        const yy = top + 4.82 + i * rowH;
        const bar = barOf(r, typologyKey(p.tile));
        pg.text(r.criterion.name, x, yy, w * 0.5, rowH, rowH * 0.62, { color: inp.carried.includes(r.key) ? pg.p.text : pg.p.muted, lines: 1, min: 0.05 });
        pageBar(pg, x + w * 0.52, yy + rowH * 0.2, w * 0.48, rowH * 0.55, bar, pg.p.accent);
      });
    }
    out.push({ name: `4_${sec}_${cat}_ideas.png`, blob: await toBlob(pg.canvas) });
  }
  return out;
}

// ---- 7.1 the criteria -------------------------------------------------------------------------------------------------------------------------------

async function sheetCriteria(inp: AssignmentInput): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const pg = makePage(inp);
  header(pg, W, "Selection criteria", "Section 7.1: the criteria carried forward from the Assignment 1 matrix, those set aside, and how the fifteen tiles read on each", inp.project);
  const placed = place(inp.tiles);
  const top = 1.5;
  const flagW = 0.3;
  const nameW = 2.1;
  const tilesW = Math.min(0.6 * placed.length, W * 0.4);
  const reasonW = W - 2 * M - flagW - nameW - tilesW - 0.2;
  const colW = tilesW / Math.max(1, placed.length);
  const xTiles = W - M - tilesW;
  pg.text("DESCRIPTOR", M + flagW, top, nameW, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 });
  pg.text("CARRIED FORWARD, OR SET ASIDE, AND WHY", M + flagW + nameW, top, reasonW, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 });
  placed.forEach((p, i) => pg.text(p.tag, xTiles + i * colW, top, colW - 0.04, 0.2, 0.1, { color: pg.p.heading, weight: "600", lines: 1, align: "center" }));
  pg.rule(M, top + 0.28, W - 2 * M);
  const rowH = (H - top - 0.45 - 0.3) / MATRIX.length;
  MATRIX.forEach((m, r) => {
    const y = top + 0.36 + r * rowH;
    const carried = inp.carried.includes(m.key);
    pg.ctx.save();
    pg.ctx.fillStyle = carried ? pg.p.accent : "transparent";
    pg.ctx.strokeStyle = pg.p.frame;
    pg.ctx.lineWidth = Math.max(1, pg.i(0.01));
    pg.ctx.beginPath();
    pg.ctx.arc(pg.i(M + 0.1), pg.i(y + rowH * 0.3), pg.i(0.07), 0, Math.PI * 2);
    if (carried) pg.ctx.fill();
    else pg.ctx.stroke();
    pg.ctx.restore();
    pg.text(m.name, M + flagW, y, nameW - 0.1, rowH * 0.6, 0.16, { weight: "600", lines: 2, color: carried ? pg.p.text : pg.p.muted });
    pg.text(m.group, M + flagW, y + rowH * 0.6, nameW - 0.1, rowH * 0.3, 0.085, { color: pg.p.muted, lines: 1 });
    pg.text(carried ? (inp.reasons[m.key] ?? "carried forward") : (inp.setAside[m.key] ?? "set aside for this phase"), M + flagW + nameW, y, reasonW - 0.1, rowH * 0.92, 0.115, { color: carried ? pg.p.text : pg.p.muted, lines: 5 });
    placed.forEach((p, i) => {
      const res = evalOf(inp, p.tile).results.find((q) => q.key === m.key);
      if (res) pageBar(pg, xTiles + i * colW + 0.03, y + rowH * 0.3, colW - 0.1, Math.min(0.12, rowH * 0.2), barOf(res, typologyKey(p.tile)), carried ? pg.p.accent : pg.p.muted);
    });
    if (r < MATRIX.length - 1) pg.rule(M, y + rowH - 0.05, W - 2 * M, 0.25);
  });
  return [{ name: "7_1_selection_criteria.png", blob: await toBlob(pg.canvas) }];
}

// ---- 7.2-7.4 evaluation per category ---------------------------------------------------------------------------------------------------------------

async function sheetEvaluation(inp: AssignmentInput): Promise<Sheet[]> {
  const out: Sheet[] = [];
  const cats = inp.category ? [inp.category] : [...CATALOGUE_CATEGORIES];
  const placed = place(inp.tiles);
  const style = paletteStyle(inp.palette);
  for (const cat of cats) {
    const ci = CATALOGUE_CATEGORIES.indexOf(cat);
    const W = inp.widthIn;
    const H = inp.heightIn;
    const pg = makePage(inp);
    const sec = ci + 2;
    header(pg, W, `${cap(cat)} spaces: selection and evaluation`, `Section 7.${sec}: the carried criteria across the five types, measured with units and status`, inp.project);
    const mine = placed.filter((p) => p.category === ci);
    const keys: MatrixKey[] = inp.carried.length ? inp.carried : MATRIX.map((m) => m.key);
    const nameW = 2.2;
    const cw = (W - 2 * M - nameW) / CATALOGUE_COLUMNS;
    const top = 1.45;
    const dgH = 1.45;
    mine.forEach((p) => {
      const x = M + nameW + (p.number - 1) * cw;
      pg.text(`${p.tag}  ${p.type}`.toUpperCase(), x, top, cw - 0.15, 0.22, 0.115, { weight: "600", color: pg.p.accent, lines: 1 });
      drawDiagram(pg, p.tile, "plan", style, x, top + 0.26, (cw - 0.15) * 0.5, dgH);
      drawDiagram(pg, p.tile, "section", style, x + (cw - 0.15) * 0.5, top + 0.26, (cw - 0.15) * 0.5, dgH);
    });
    pg.text("CRITERION", M, top, nameW - 0.1, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 });
    const rowsTop = top + dgH + 0.45;
    pg.rule(M, rowsTop - 0.06, W - 2 * M);
    const usableRow = 0.5;
    const rowH = (H - rowsTop - 0.45 - usableRow) / keys.length;
    keys.forEach((k, r) => {
      const y = rowsTop + r * rowH;
      const m = MATRIX.find((q) => q.key === k)!;
      pg.text(m.name, M, y, nameW - 0.15, rowH * 0.6, 0.15, { weight: "600", lines: 2 });
      pg.text(m.group, M, y + rowH * 0.62, nameW - 0.15, rowH * 0.3, 0.085, { color: pg.p.muted, lines: 1 });
      mine.forEach((p) => {
        const x = M + nameW + (p.number - 1) * cw;
        const res = evalOf(inp, p.tile).results.find((q) => q.key === k);
        if (!res) return;
        const bar = barOf(res, typologyKey(p.tile));
        pageBar(pg, x, y + 0.02, cw - 0.4, Math.min(0.12, rowH * 0.18), bar, pg.p.accent);
        pg.text(bar.index === null ? "not assessable" : `${bar.word ?? ""}${bar.fit !== null ? ` · fit ${Math.round(bar.fit * 100)}%` : ""}`, x, y + 0.17, cw - 0.2, 0.17, 0.095, { color: statusColor(pg, res.measure.status), lines: 1 });
        pg.text(res.measure.headline, x, y + 0.34, cw - 0.2, Math.max(0.2, rowH - 0.42), 0.092, { color: pg.p.muted, lines: 3, mono: true });
      });
      if (r < keys.length - 1) pg.rule(M, y + rowH - 0.04, W - 2 * M, 0.2);
    });
    const uy = H - 0.45 - usableRow + 0.05;
    pg.rule(M, uy - 0.05, W - 2 * M);
    pg.text("USABLE FLOOR", M, uy, nameW - 0.15, 0.2, 0.11, { color: pg.p.heading, weight: "600", lines: 1 });
    mine.forEach((p) => {
      const x = M + nameW + (p.number - 1) * cw;
      const u = evalOf(inp, p.tile).usable;
      pg.text(u.available ? `${Math.round((100 * u.usableFt2) / Math.max(1, u.floorFt2))}% of ${ft2(u.floorFt2)} reached on foot · ${u.zonesReached} of ${u.zones} floors joined` : u.reason, x, uy, cw - 0.2, 0.42, 0.095, { color: pg.p.muted, lines: 3 });
    });
    out.push({ name: `7_${sec}_${cat}_evaluation.png`, blob: await toBlob(pg.canvas) });
  }
  return out;
}

// ---- the workflow and the run logs --------------------------------------------------------------------------------------------------------------------

async function sheetWorkflow(inp: AssignmentInput): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const pg = makePage(inp);
  header(pg, W, "Overall project workflow", "From Assignment 1 through the diagrammatic ideas to the proto-geometrical options, with the run logs", inp.project);
  const top = 1.5;
  const leftW = W * 0.34;
  pg.text("WORKFLOW", M, top, leftW, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
  pg.text(inp.texts.workflow, M, top + 0.3, leftW, H * 0.45, 0.14, { lines: 22 });
  pg.text("VERSUR RUN LOGS", M, top + 0.35 + H * 0.45, leftW, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
  pg.text(inp.texts.versur, M, top + 0.65 + H * 0.45, leftW, H - (top + 0.65 + H * 0.45) - 0.4, 0.105, { color: pg.p.muted, lines: 12, mono: true });
  // the interlock test of every tile, as the Arrange tab runs it
  const x0 = M + leftW + 0.5;
  const w = W - x0 - M;
  pg.text("RUN LOG: THE INTERLOCK TEST (ARRANGE TAB), TWO AND FOUR COPIES", x0, top, w, 0.2, 0.12, { color: pg.p.heading, weight: "600", lines: 1 });
  const placed = place(inp.tiles);
  const cols: { p: InterlockPattern; n: InterlockCount }[] = (["repeat", "mirror", "shift"] as InterlockPattern[]).flatMap((p) => ([2, 4] as InterlockCount[]).map((n) => ({ p, n })));
  const nameW = 2.3;
  const cw = (w - nameW) / cols.length;
  cols.forEach((c, i) => pg.text(`${c.p} x${c.n}`, x0 + nameW + i * cw, top + 0.32, cw - 0.05, 0.2, 0.1, { color: pg.p.heading, weight: "600", lines: 1, mono: true }));
  pg.rule(x0, top + 0.56, w);
  const rowH = Math.min(0.42, (H - top - 1.5) / Math.max(1, placed.length));
  placed.forEach((p, r) => {
    const y = top + 0.62 + r * rowH;
    pg.text(`${p.tag}  ${p.type}`, x0, y, nameW - 0.1, rowH, 0.115, { lines: 1 });
    cols.forEach((c, i) => {
      const res = runInterlock(p.tile, c.p, c.n, defaultRules());
      const mark = res.connected ? (res.walkable ? "W" : "a") : "x";
      pg.text(`${res.overall === null ? "-" : Math.round(res.overall)} ${mark}`, x0 + nameW + i * cw, y, cw - 0.05, rowH, 0.11, { color: res.connected && res.walkable ? pg.p.good : res.connected ? pg.p.warn : pg.p.bad, lines: 1, mono: true });
    });
    inp.onProgress?.(r + 1, placed.length, p.tile.name);
  });
  pg.text("score = the joint rule, 0 to 100 (mean over the joints) · W = attached, collision-free, every copy reachable on foot · a = attached, not every copy reachable · x = not attached or colliding · - = no joint", x0, top + 0.7 + placed.length * rowH, w, 0.5, 0.095, { color: pg.p.muted, lines: 3, mono: true });
  return [{ name: "workflow_run_logs.png", blob: await toBlob(pg.canvas) }];
}

// ---- 8.1 insights and references --------------------------------------------------------------------------------------------------------------------

/** A first draft of the overall insights from the numbers: which tile leads and trails on each descriptor, and how the interlock tests went. */
export function draftInsights(inp: AssignmentInput): string {
  const placed = place(inp.tiles);
  const lines: string[] = [];
  for (const m of MATRIX) {
    const rows = placed
      .map((p) => ({ p, r: evalOf(inp, p.tile).results.find((q) => q.key === m.key) }))
      .filter((x) => x.r && x.r.interpretation.index !== undefined && x.r.measure.status !== "unavailable") as { p: Placed; r: NonNullable<ReturnType<TileEvaluation["results"]["find"]>> }[];
    if (rows.length < 2) continue;
    rows.sort((a, b) => (b.r.interpretation.index ?? 0) - (a.r.interpretation.index ?? 0));
    const hi = rows[0];
    const lo = rows[rows.length - 1];
    lines.push(`${m.name}: strongest in ${hi.p.tag} ${hi.p.type} (${hi.r.measure.headline}); weakest in ${lo.p.tag} ${lo.p.type}.`);
  }
  return lines.join("\n");
}

async function sheetText(inp: AssignmentInput, title: string, sub: string, text: string, file: string): Promise<Sheet[]> {
  const W = inp.widthIn;
  const H = inp.heightIn;
  const pg = makePage(inp);
  header(pg, W, title, sub, inp.project);
  pg.text(text || "[write this section in the Boards tab, Assignment 2 sheets]", M, 1.55, W - 2 * M, H - 2.1, 0.22, { lines: 30, color: text ? pg.p.text : pg.p.muted });
  return [{ name: file, blob: await toBlob(pg.canvas) }];
}

/** One kind of sheet (or one per category), as PNGs. */
export async function buildAssignmentSheets(kind: AssignmentKind, inp: AssignmentInput): Promise<Sheet[]> {
  switch (kind) {
    case "geometry":
      return sheetGeometry(inp);
    case "diagrams":
      return sheetDiagrams(inp);
    case "ideas":
      return sheetIdeas(inp);
    case "criteria":
      return sheetCriteria(inp);
    case "evaluation":
      return sheetEvaluation(inp);
    case "workflow":
      return sheetWorkflow(inp);
    case "insights":
      return sheetText(inp, "Overall insights", "Section 8.1: the key insights, patterns and trends of the geometrical system catalogue", inp.texts.insights.trim() || draftInsights(inp), "8_1_insights.png");
    case "references":
      return sheetText(inp, "References", "Images, articles, books, videos and lectures used", inp.texts.references, "references.png");
  }
}

export { planSpecs };
