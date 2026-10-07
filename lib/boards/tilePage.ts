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
import { renderTileToDataUrl } from "@/lib/renderTile";
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
  show: { bar: boolean; result: boolean; reading: boolean };
  columns: 1 | 2;
  /** 0.6 to 1.6: the size of the info text against the default (it still shrinks to fit) */
  infoScale: number;
  /** the share of the text side the text box may take when there is info under it */
  textShare: number;
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
  show: { bar: true, result: false, reading: false },
  columns: 1,
  infoScale: 1,
  textShare: 0.4,
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
              pg.text(bar.index === null ? "not assessable" : `${bar.index + 1}/${bar.steps} ${bar.word ?? ""}`, x + w * 0.77, yy, w * 0.23, 0.2 * s, 0.12 * s, { color: pg.p.muted, lines: 1 });
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

/** Draws the tile page onto a canvas of the page's size; returns the canvas. */
export async function drawTilePage(inp: TilePageInput): Promise<HTMLCanvasElement> {
  const { settings: st, tile, palette } = inp;
  const c = document.createElement("canvas");
  c.width = Math.round(st.widthIn * inp.dpi);
  c.height = Math.round(st.heightIn * inp.dpi);
  const family = inp.fontFamily ? `"${inp.fontFamily}", ${BOARD_FONT}` : BOARD_FONT;
  const pg = new Page(c, inp.dpi, palette, family);
  const W = st.widthIn;
  const H = st.heightIn;
  const style = paletteStyle(palette);
  const tileW = (W - 2 * M_IN - GAP) * Math.max(0.3, Math.min(0.7, st.tileShare));
  const textW = W - 2 * M_IN - GAP - tileW;
  const tileX = st.side === "left" ? M_IN : W - M_IN - tileW;
  const textX = st.side === "left" ? M_IN + tileW + GAP : M_IN;
  const areaH = H - 2 * M_IN;

  // the tile, large
  if (st.view === "plan" || st.view === "section") drawDiagram(pg, tile, st.view, style, tileX, M_IN, tileW, areaH);
  else if (tile.glbUrl) {
    const url = await renderTileToDataUrl({
      glbUrl: tile.glbUrl,
      refine: inp.dpi >= 100 ? tile : undefined,
      view: st.view,
      width: Math.max(64, Math.round(tileW * inp.dpi)),
      height: Math.max(64, Math.round(areaH * inp.dpi)),
      backgroundColor: null,
      foamColor: inp.look.foamColor,
      voidColor: inp.look.voidColor,
      foamOpacity: inp.look.foamOpacity,
      voidOpacity: inp.look.voidOpacity,
      foamVisible: true,
      voidVisible: true,
      pxPerPt: inp.dpi / 72,
    });
    const img = await loadImage(url);
    const s = Math.min(pg.i(tileW) / img.width, pg.i(areaH) / img.height);
    pg.ctx.drawImage(img, pg.i(tileX) + (pg.i(tileW) - img.width * s) / 2, pg.i(M_IN) + (pg.i(areaH) - img.height * s) / 2, img.width * s, img.height * s);
  }

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
