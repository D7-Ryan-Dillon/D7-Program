// The tile page: one tile large on one side of the page, your own text box on the other, and under the text box whatever the program knows about the tile that you
// have ticked (what it is, the key numbers, the descriptors with their bars, the measurements and readings, the rooms, a plan and a section). Everything is drawn from the same
// evaluation as the Analysis tab and the other boards, so the page agrees with them. Any size, PNG.

import { buildDrawing } from "@/lib/drawing/build";
import { drawToCanvas, drawingSize, type DrawingStyle } from "@/lib/drawing/render";
import { specFromState, defaultDrawState } from "@/lib/drawing/state";
import { paletteStyle, type Palette } from "@/lib/boardPalette";
import { BOARD_FONT } from "@/lib/textBlock";
import { MATRIX, STATUS_LABEL, type MatrixKey } from "@/lib/scoring/matrix";
import { evaluateTile, type TileEvaluation } from "@/lib/scoring/matrixEval";
import { barOf, type BarSpec } from "@/lib/scoring/bars";
import { intentionText, typologyKey } from "@/lib/scoring/compareSet";
import { interpretationFor, type EvaluationProfile } from "@/lib/scoring/profile";
import { ft, ft2, ft3 } from "@/lib/scoring/words";
import { createTileRenderer, createTileRig, type TileRenderOptions } from "@/lib/renderTile";
import { drawBoardFooter, footerLayout, type BoardAnimation } from "@/lib/boards/exportBoard";
import type { BoardConfig } from "@/lib/boards/types";
import { parseTileName } from "@/lib/boards/tileLabel";
import { Page, toBlob } from "@/lib/boards/analysisSheets";
import type { AxoViewKey } from "@/lib/faceViews";
import type { ParsedTile } from "@/lib/types";

/** What can be put under the text box. Descriptors are ticked one by one (`d.<key>`); the rest are single switches. */
export const INFO_ITEMS: { key: string; label: string; hint: string }[] = [
  { key: "typology", label: "Category and type", hint: "e.g. Gathering · stepped amphitheater" },
  { key: "intention", label: "Spatial intention", hint: "what the type is for, read from its name (or what you wrote in the Analysis tab)" },
  { key: "facts", label: "Key numbers", hint: "size, void share, floor area, floor you can walk to, levels, rooms" },
  { key: "usable", label: "Usable space", hint: "how much of the floor can be reached on foot, what is cut off, what is too tight" },
  { key: "levels", label: "Levels", hint: "each floor level: its height and area" },
  { key: "circulation", label: "Circulation", hint: "the main route: length, bends, how many routes and joins" },
  { key: "daylight", label: "Daylight", hint: "how much of the floor is under open sky, and how far light reaches" },
  { key: "structure", label: "Structure and printing", hint: "foam volume, pieces, floating foam, retained plates, overhang" },
  { key: "identity", label: "Name and id", hint: "the tile's file name and id" },
  { key: "rooms", label: "Rooms", hint: "each room: its kind, floor area and clear height" },
  { key: "plan", label: "Plan drawing", hint: "a plan of the main floor" },
  { key: "section", label: "Section drawing", hint: "a section through the tile" },
];

export interface TilePageSettings {
  tileId: string | null;
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** which side the tile is on */
  side: "left" | "right";
  /** how much of the page width the tile takes, 0.3 to 0.7 */
  tileShare: number;
  /** 3D view of the tile, or a drawing */
  view: AxoViewKey | "plan" | "section";
  showTitle: boolean;
  /** empty: the tile's name */
  title: string;
  /** your text box: Enter makes a new line */
  text: string;
  /** what is under it: INFO_ITEMS keys and `d.<descriptor>` keys */
  info: Record<string, boolean>;
  /** for each ticked descriptor: the bar, the measured result, the reading */
  show: { bar: boolean; result: boolean; reading: boolean; fit: boolean };
  columns: 1 | 2;
  /** 0.6 to 1.6: the size of the info text against the default (it still shrinks to fit) */
  infoScale: number;
  /** the share of the text side the text box may take when there is info under it */
  textShare: number;
  /** a font for all the text (empty: the board's font) */
  font: string;
  /** a line under the tile (empty: none) */
  caption: string;
  /** the footer of the Boards tab along the bottom (its text, logo and colour) */
  boardsFooter: boolean;
  /** the spinning export */
  anim: { seconds: number; fps: number; widthPx: number };
}

export const defaultTilePage = (): TilePageSettings => ({
  tileId: null,
  widthIn: 22,
  heightIn: 11,
  dpi: 150,
  side: "left",
  tileShare: 0.5,
  view: "iso-top-ne",
  showTitle: true,
  title: "",
  text: "",
  info: { typology: true, "d.carved": true, "d.stepped": true, "d.porous": true, "d.resistant": true, "d.nonHierarchical": true, "d.monumental": true, "d.spatialDensity": true },
  show: { bar: true, result: false, reading: false, fit: false },
  columns: 1,
  infoScale: 1,
  textShare: 0.4,
  font: "",
  caption: "",
  boardsFooter: false,
  anim: { seconds: 8, fps: 20, widthPx: 1400 },
});

export interface TilePageInput {
  settings: TilePageSettings;
  tile: ParsedTile;
  evals: Map<string, TileEvaluation>;
  profile: EvaluationProfile;
  palette: Palette;
  fontFamily?: string;
  look: { foamColor: string; voidColor: string; foamOpacity: number; voidOpacity: number };
  /** pixels per inch of the page */
  dpi: number;
  /** the Boards tab's settings: its footer is drawn from them when the page asks for it */
  boardConfig?: BoardConfig;
}

const M_IN = 0.55;
const GAP = 0.45;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Couldn't load the tile render."));
    img.src = url;
  });

function drawDiagram(pg: Page, tile: ParsedTile, mode: "plan" | "section", style: DrawingStyle, x: number, y: number, w: number, h: number) {
  const spec = specFromState(tile, { ...defaultDrawState(), mode });
  const d = spec ? buildDrawing(tile, spec) : null;
  if (!d) return;
  const unit = drawingSize(d, { pxPerFt: 1, caption: false });
  const pxPerFt = Math.min(pg.i(w) / unit.width, pg.i(h) / unit.height);
  const fit = drawingSize(d, { pxPerFt, caption: false });
  drawToCanvas(pg.ctx, { ...d, labels: [] }, style, { pxPerFt, caption: false, background: false }, { x: pg.i(x) + (pg.i(w) - fit.width) / 2, y: pg.i(y) + (pg.i(h) - fit.height) / 2 });
}

function pageBar(pg: Page, x: number, y: number, w: number, h: number, bar: BarSpec) {
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
      c.fillStyle = pg.p.accent;
      c.fillRect(sx, pg.i(y), segW, pg.i(h));
      c.globalAlpha = 1;
      if (!bar.solid) {
        c.strokeStyle = pg.p.accent;
        c.lineWidth = Math.max(1, pg.i(0.008));
        c.strokeRect(sx, pg.i(y), segW, pg.i(h));
      }
    } else {
      c.globalAlpha = 0.18;
      c.fillStyle = pg.p.accent;
      c.fillRect(sx, pg.i(y), segW, pg.i(h));
      c.globalAlpha = 1;
    }
  }
  c.restore();
}

/** Your text with its own line breaks: each line wrapped on its own; the largest size at which it all fits the box (down to a minimum). Returns the height used, inches. */
function paragraphs(pg: Page, text: string, x: number, y: number, w: number, h: number, maxSize: number, draw: boolean): { height: number; size: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const size0 = maxSize;
  for (let size = size0; size >= 0.1; size -= 0.01) {
    let used = 0;
    for (const line of lines) {
      if (!line.trim()) {
        used += size * 0.7;
        continue;
      }
      used += measureText(pg, line, w, size) + size * 0.25;
    }
    if (used <= h || size <= 0.105) {
      if (draw) {
        let yy = y;
        for (const line of lines) {
          if (!line.trim()) {
            yy += size * 0.7;
            continue;
          }
          yy += pg.text(line, x, yy, w, h - (yy - y), size, { min: size, lines: 60 }) + size * 0.25;
        }
      }
      return { height: Math.min(used, h), size };
    }
  }
  return { height: h, size: 0.1 };
}

/** The height a block of text takes at a size, inches, without drawing it. */
function measureText(pg: Page, s: string, w: number, size: number): number {
  const c = pg.ctx;
  c.save();
  c.font = `${pg.i(size)}px ${pg.family}`;
  const words = s.split(/\s+/).filter(Boolean);
  let lines = 1;
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > pg.i(w) && line) {
      lines++;
      line = word;
    } else line = next;
  }
  c.restore();
  return lines * size * 1.25;
}

interface Row {
  /** draws the block at (x, y) with width w and returns its height; when `draw` is false it only measures */
  paint: (pg: Page, x: number, y: number, w: number, s: number, draw: boolean) => number;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function buildRows(inp: TilePageInput, ev: TileEvaluation, style: DrawingStyle): Row[] {
  const { tile, settings: st, profile } = inp;
  const rows: Row[] = [];
  const heading = (label: string): Row => ({
    paint: (pg, x, y, w, s, draw) => {
      if (draw) pg.text(label.toUpperCase(), x, y, w, 0.22 * s, 0.12 * s, { color: pg.p.heading, weight: "600", lines: 1 });
      return 0.2 * s;
    },
  });
  const para = (label: string, body: string): Row => ({
    paint: (pg, x, y, w, s, draw) => {
      const hh = heading(label).paint(pg, x, y, w, s, draw);
      const bh = measureText(pg, body, w, 0.15 * s);
      if (draw) pg.text(body, x, y + hh + 0.04 * s, w, bh + 0.05, 0.15 * s, { min: 0.15 * s, lines: 40, color: pg.p.text });
      return hh + 0.04 * s + bh + 0.14 * s;
    },
  });
  const p = parseTileName(tile.name);
  const category = cap(tile.meta?.category ?? tile.guessed.category ?? p.category ?? "");
  const typology = cap((tile.meta?.typology ?? tile.guessed.typology ?? p.typology ?? "").replace(/_/g, " "));
  if (st.info.typology) rows.push(para("Category and type", [category, typology].filter(Boolean).join(" · ") || tile.name));
  if (st.info.intention) {
    const key = typologyKey(tile);
    const it = intentionText({ key, label: typology || tile.name, tiles: [tile] } as never, profile.overrides.intentions[key]);
    rows.push(para("Spatial intention", it.text));
  }
  const u = ev.usable;
  if (st.info.facts) {
    const [a, b, c] = tile.tileFt;
    const lines: [string, string][] = [["Size", `${a} × ${b} × ${c} ft`]];
    if (u.available) {
      lines.push(["Void", `${Math.round((u.voidFt3 / (a * b * c)) * 100)}% of the block (${ft3(u.voidFt3)})`], ["Floor", `${ft2(u.floorFt2)}, ${ft2(u.usableFt2)} you can walk to`], ["Levels", `${u.levelsTotal} (${u.levelsReached} reached on foot)`]);
    }
    if (tile.spaces) lines.push(["Rooms", String(tile.spaces.rooms.length)]);
    rows.push({
      paint: (pg, x, y, w, s, draw) => {
        const hh = heading("Key numbers").paint(pg, x, y, w, s, draw);
        let yy = y + hh + 0.05 * s;
        for (const [k, v] of lines) {
          if (draw) {
            pg.text(k, x, yy, w * 0.28, 0.2 * s, 0.14 * s, { color: pg.p.muted, lines: 1 });
            pg.text(v, x + w * 0.3, yy, w * 0.7, 0.2 * s, 0.14 * s, { lines: 1 });
          }
          yy += 0.22 * s;
        }
        return yy - y + 0.1 * s;
      },
    });
  }
  if (st.info.usable && u.available) {
    const total = u.floorFt2 || 1;
    rows.push(
      para(
        "Usable space",
        `${Math.round((u.usableFt2 / total) * 100)}% of the floor (${ft2(u.usableFt2)} of ${ft2(u.floorFt2)}) can be reached on foot; ${ft2(u.cutOffFt2)} is cut off and ${ft2(u.tightFt2)} is too narrow or low to walk. ${u.zonesReached} of ${u.zones} floor zones and ${u.levelsReached} of ${u.levelsTotal} levels are reached.`,
      ),
    );
  }
  // the descriptors, one row each for those ticked
  const keys = MATRIX.map((m) => m.key).filter((k) => st.info[`d.${k}`]) as MatrixKey[];
  if (keys.length) {
    rows.push({
      paint: (pg, x, y, w, s, draw) => {
        let yy = y + heading("Descriptors").paint(pg, x, y, w, s, draw) + 0.06 * s;
        for (const k of keys) {
          const r = ev.results.find((q) => q.key === k);
          if (!r) continue;
          const bar = barOf(r, typologyKey(tile));
          const labelW = st.show.bar ? w * 0.42 : w;
          if (draw) {
            pg.text(r.criterion.name, x, yy, labelW, 0.2 * s, 0.14 * s, { weight: "600", lines: 1 });
            if (st.show.bar) {
              pageBar(pg, x + w * 0.44, yy + 0.04 * s, w * 0.3, 0.11 * s, bar);
              pg.text(bar.index === null ? "not assessable" : `${bar.index + 1}/${bar.steps} ${bar.word ?? ""}${st.show.fit && bar.fit !== null ? ` · fit ${Math.round(bar.fit * 100)}%` : ""}`, x + w * 0.77, yy, w * 0.23, 0.2 * s, 0.12 * s, { color: pg.p.muted, lines: 1 });
            }
          }
          yy += 0.23 * s;
          if (st.show.result) {
            const t = `${r.measure.headline}${r.measure.status === "measured" ? "" : ` (${STATUS_LABEL[r.measure.status]})`}`;
            const hh = measureText(pg, t, w, 0.12 * s);
            if (draw) pg.text(t, x, yy - 0.03 * s, w, hh + 0.04, 0.12 * s, { color: pg.p.muted, min: 0.12 * s, lines: 6, mono: true });
            yy += hh;
          }
          if (st.show.reading) {
            const t = interpretationFor(profile, tile.id, r).text;
            const hh = measureText(pg, t, w, 0.12 * s);
            if (draw) pg.text(t, x, yy - 0.02 * s, w, hh + 0.04, 0.12 * s, { color: pg.p.text, min: 0.12 * s, lines: 10 });
            yy += hh + 0.04 * s;
          }
          yy += 0.04 * s;
        }
        return yy - y + 0.08 * s;
      },
    });
  }
  if (st.info.levels && tile.spaces?.levels.length) {
    const levels = tile.spaces.levels;
    rows.push({
      paint: (pg, x, y, w, s, draw) => {
        let yy = y + heading("Levels").paint(pg, x, y, w, s, draw) + 0.05 * s;
        for (const l of levels) {
          if (draw) {
            pg.text(l.name || `Level ${l.id}`, x, yy, w * 0.4, 0.2 * s, 0.13 * s, { lines: 1 });
            pg.text(`${ft(l.z_ft, 1)} · ${ft2(l.area_ft2)}${l.kind === "sloped" ? " · sloped" : ""}`, x + w * 0.42, yy, w * 0.58, 0.2 * s, 0.12 * s, { color: pg.p.muted, lines: 1 });
          }
          yy += 0.21 * s;
        }
        return yy - y + 0.1 * s;
      },
    });
  }
  if (st.info.circulation && tile.spaces) {
    const sp = tile.spaces;
    const parts: string[] = [];
    if (sp.main_route) parts.push(`The main route is ${ft(sp.main_route.length_ft)} long with ${sp.main_route.bends} bend${sp.main_route.bends === 1 ? "" : "s"} (${Math.round(sp.main_route.sinuosity * 100) / 100} times the straight line).`);
    parts.push(`${sp.routes.length} route${sp.routes.length === 1 ? "" : "s"} between spaces and ${sp.connections.length} join${sp.connections.length === 1 ? "" : "s"} between rooms.`);
    const nh = ev.results.find((r) => r.key === "nonHierarchical");
    if (nh) parts.push(nh.measure.headline + ".");
    rows.push(para("Circulation", parts.join(" ")));
  }
  if (st.info.daylight && tile.spaces?.daylight) {
    const d = tile.spaces.daylight;
    rows.push(para("Daylight", `${Math.round(d.sky_floor_fraction * 100)}% of the floor is under open sky and ${Math.round(d.lit_floor_fraction * 100)}% is within ${ft(d.lit_within_ft)} of light; the average distance to light is ${ft(d.mean_light_distance_ft, 1)}.`));
  }
  if (st.info.structure && tile.structure) {
    const s = tile.structure;
    rows.push(para("Structure and printing", `${ft3(s.foam_ft3)} of foam in ${s.foam_pieces} piece${s.foam_pieces === 1 ? "" : "s"}; ${ft3(s.floating_ft3)} floating. ${s.plates.length} retained plate${s.plates.length === 1 ? "" : "s"}, ${ft2(s.overhang_area_ft2)} of overhang (${Math.round(s.overhang_share * 100)}% of the foam surface).`));
  }
  if (st.info.identity) rows.push(para("Name and id", `${tile.name} · id ${tile.id.slice(0, 18)}`));
  if (st.info.rooms && tile.spaces?.rooms.length) {
    const rooms = tile.spaces.rooms;
    rows.push({
      paint: (pg, x, y, w, s, draw) => {
        let yy = y + heading("Rooms").paint(pg, x, y, w, s, draw) + 0.05 * s;
        for (const r of rooms) {
          if (draw) {
            pg.text(r.name || `Room ${r.id}`, x, yy, w * 0.5, 0.2 * s, 0.13 * s, { lines: 1 });
            pg.text(`${ft2(r.floor_area_ft2)} floor · ${ft(r.clear_height_ft.max ?? r.clear_height_ft.mean ?? 0, 1)} clear`, x + w * 0.52, yy, w * 0.48, 0.2 * s, 0.12 * s, { color: pg.p.muted, lines: 1 });
          }
          yy += 0.21 * s;
        }
        return yy - y + 0.1 * s;
      },
    });
  }
  for (const mode of ["plan", "section"] as const) {
    if (!st.info[mode]) continue;
    rows.push({
      paint: (pg, x, y, w, s, draw) => {
        const hh = heading(mode === "plan" ? "Plan" : "Section").paint(pg, x, y, w, s, draw);
        const dh = Math.min(w * 0.6, 1.8 * s);
        if (draw) drawDiagram(pg, tile, mode, style, x, y + hh + 0.04 * s, w, dh);
        return hh + 0.04 * s + dh + 0.12 * s;
      },
    });
  }
  return rows;
}

/** Where the tile goes on the page, inches. */
/** The height the Boards footer takes at the bottom of the page, inches (0 when the page does not ask for it). It does not depend on the resolution. */
function footerReserve(inp: TilePageInput): number {
  const st = inp.settings;
  if (!st.boardsFooter || !inp.boardConfig) return 0;
  const l = footerLayout(inp.boardConfig, st.widthIn * 100, st.heightIn * 100, M_IN * 100, 100);
  return l.total / 100;
}

function tileBox(st: TilePageSettings, footer: number) {
  const W = st.widthIn;
  const H = st.heightIn;
  const caption = st.caption.trim() ? 0.4 : 0;
  const tileW = (W - 2 * M_IN - GAP) * Math.max(0.3, Math.min(0.7, st.tileShare));
  const x = st.side === "left" ? M_IN : W - M_IN - tileW;
  return { x, y: M_IN, w: tileW, h: H - 2 * M_IN - footer - caption, footer, caption };
}

function tileRenderOptions(inp: TilePageInput, width: number, height: number): TileRenderOptions {
  const { settings: st, tile } = inp;
  return {
    glbUrl: tile.glbUrl,
    refine: inp.dpi >= 100 ? tile : undefined,
    view: st.view as AxoViewKey,
    width: Math.max(64, Math.round(width)),
    height: Math.max(64, Math.round(height)),
    backgroundColor: null,
    foamColor: inp.look.foamColor,
    voidColor: inp.look.voidColor,
    foamOpacity: inp.look.foamOpacity,
    voidOpacity: inp.look.voidOpacity,
    foamVisible: true,
    voidVisible: true,
    pxPerPt: inp.dpi / 72,
  };
}

/** Draws the tile page onto a canvas of the page's size; returns the canvas. `skipTile`: leaves the 3D tile out (the spinning export draws it itself, turn by turn). */
export async function drawTilePage(inp: TilePageInput, opt: { skipTile?: boolean } = {}): Promise<HTMLCanvasElement> {
  const { settings: st, tile, palette } = inp;
  const c = document.createElement("canvas");
  c.width = Math.round(st.widthIn * inp.dpi);
  c.height = Math.round(st.heightIn * inp.dpi);
  const fam = st.font || inp.fontFamily;
  const family = fam ? `"${fam}", ${BOARD_FONT}` : BOARD_FONT;
  const pg = new Page(c, inp.dpi, palette, family);
  const W = st.widthIn;
  const H = st.heightIn;
  const style = paletteStyle(palette);
  const box = tileBox(st, footerReserve(inp));
  const tileW = box.w;
  const textW = W - 2 * M_IN - GAP - tileW;
  const tileX = box.x;
  const textX = st.side === "left" ? M_IN + tileW + GAP : M_IN;
  const areaH = H - 2 * M_IN - box.footer;

  // the tile, large
  if (st.view === "plan" || st.view === "section") drawDiagram(pg, tile, st.view, style, tileX, box.y, tileW, box.h);
  else if (tile.glbUrl && !opt.skipTile) {
    const { renderTileToDataUrl } = await import("@/lib/renderTile");
    const url = await renderTileToDataUrl(tileRenderOptions(inp, tileW * inp.dpi, box.h * inp.dpi));
    const img = await loadImage(url);
    const s = Math.min(pg.i(tileW) / img.width, pg.i(box.h) / img.height);
    pg.ctx.drawImage(img, pg.i(tileX) + (pg.i(tileW) - img.width * s) / 2, pg.i(box.y) + (pg.i(box.h) - img.height * s) / 2, img.width * s, img.height * s);
  }
  if (box.caption) pg.text(st.caption, tileX, box.y + box.h + 0.08, tileW, 0.3, 0.16, { color: pg.p.muted, align: "center", lines: 2 });
  if (box.footer && inp.boardConfig) await drawBoardFooter(pg.ctx, inp.boardConfig, c.width, c.height, pg.i(M_IN), inp.dpi);

  // the text side: title, your text, then what is ticked
  let y = M_IN;
  if (st.showTitle) {
    const title = (st.title || tile.name).toUpperCase();
    y += pg.text(title, textX, y, textW, 0.7, 0.4, { weight: "600", color: pg.p.accent, lines: 2, min: 0.16 }) + 0.12;
    pg.rule(textX, y, textW);
    y += 0.2;
  }
  const rows = buildRows(inp, ev(inp), style);
  const bottom = M_IN + areaH;
  const infoOn = rows.length > 0;
  const textH = st.text.trim() ? (infoOn ? Math.min((bottom - y) * st.textShare, 6) : bottom - y) : 0;
  if (textH > 0) {
    const used = paragraphs(pg, st.text, textX, y, textW, textH, 0.26, true);
    y += used.height + 0.25;
  }
  if (infoOn) {
    const colW = (textW - (st.columns - 1) * 0.35) / st.columns;
    const scratch = new Page(document.createElement("canvas"), inp.dpi, palette, family);
    scratch.canvas.width = 4;
    scratch.canvas.height = 4;
    const availH = bottom - y;
    // the largest size at which everything fits in the columns
    let scale = st.infoScale;
    const flow = (s: number, draw: boolean): boolean => {
      let col = 0;
      let yy = y;
      for (const row of rows) {
        const h = row.paint(scratch, 0, 0, colW, s, false);
        if (yy + h > y + availH + 1e-6) {
          col++;
          yy = y;
          if (col >= st.columns) return false;
        }
        if (draw) row.paint(pg, textX + col * (colW + 0.35), yy, colW, s, true);
        yy += h;
      }
      return true;
    };
    while (scale > 0.35 && !flow(scale, false)) scale -= 0.05;
    flow(scale, true);
  }
  return c;
}

const ev = (inp: TilePageInput): TileEvaluation => inp.evals.get(inp.tile.id) ?? evaluateTile(inp.tile);

export async function exportTilePage(inp: TilePageInput): Promise<Blob> {
  return toBlob(await drawTilePage(inp));
}

const evenUp = (n: number) => Math.ceil(n / 2) * 2;

/**
 * The tile page as a spin: the page is drawn once without the tile, then for every frame the tile is rendered turned a little further about its vertical axis and laid into
 * its place. One full turn loops. The same source the board animations use, so it goes through the same GIF and MP4 encoders.
 */
export async function createTilePageAnimation(inp: TilePageInput, widthPx: number, frameCount: number, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<BoardAnimation> {
  const st = inp.settings;
  if (st.view === "plan" || st.view === "section") throw new Error("A plan or a section does not turn: choose a 3D view for the spinning export.");
  if (!inp.tile.glbUrl) throw new Error("This tile has no 3D model to turn.");
  const dpi = widthPx / st.widthIn;
  const at = { ...inp, dpi };
  const under = await drawTilePage(at, { skipTile: true });
  const width = evenUp(under.width);
  const height = evenUp(under.height);
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const box = tileBox(st, footerReserve(inp));
  const bw = Math.round(box.w * dpi);
  const bh = Math.round(box.h * dpi);
  const renderer = createTileRenderer(Math.max(64, bw), Math.max(64, bh), true);
  if (signal?.aborted) {
    renderer.dispose();
    throw new DOMException("Cancelled", "AbortError");
  }
  onProgress?.(0, 1);
  const rig = await createTileRig(renderer, tileRenderOptions(at, bw, bh));
  onProgress?.(1, 1);
  return {
    width,
    height,
    frameCount,
    canvas: frame,
    renderFrame(i: number) {
      ctx.drawImage(under, 0, 0);
      rig.renderAt((360 * i) / frameCount);
      const el = renderer.domElement;
      const s = Math.min((box.w * dpi) / el.width, (box.h * dpi) / el.height);
      ctx.drawImage(el, box.x * dpi + (box.w * dpi - el.width * s) / 2, box.y * dpi + (box.h * dpi - el.height * s) / 2, el.width * s, el.height * s);
    },
    dispose() {
      rig.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
