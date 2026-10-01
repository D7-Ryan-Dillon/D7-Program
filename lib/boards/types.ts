// A "board" is a presentation-plate layout: a grid of tiles rendered from a
// fixed axo/perspective angle, exported as print-resolution PNGs -- one page
// of the tile renders, one page of their scored descriptors (see
// lib/scoring/descriptors.ts). Kept as a plain serializable config so it can
// eventually be persisted the same way Viewer/Arrange state is.

export type AxoViewKey = "iso-ne" | "iso-nw" | "iso-se" | "iso-sw" | "perspective";

export interface BoardSlot {
  id: string;
  tileId: string | null;
  view: AxoViewKey;
}

export interface BoardTextBox {
  enabled: boolean;
  text: string;
  color: string;
}

export interface BoardConfig {
  name: string;
  widthIn: number;
  heightIn: number;
  backgroundColor: string;
  fontFamily: string;
  titleColor: string;
  descriptorColor: string;
  highlightColor: string;
  foamColor: string;
  voidColor: string;
  foamOpacity: number;
  voidOpacity: number;
  /** Frame stroke weight, in points (1pt = 1/72in, same convention as
   * print/vector tools -- independent of the board's own DPI). */
  outlineWidthPt: number;
  /** Gap between tiles (and the caption cell), in inches. */
  gapIn: number;
  slots: BoardSlot[];
  textBox: BoardTextBox;
}

export const DPI = 300;
export const MIN_TILES = 1;
export const MAX_TILES = 12;

export const DEFAULT_AXO_VIEW: AxoViewKey = "iso-ne";

export function defaultBoardConfig(): BoardConfig {
  return {
    name: "Untitled board",
    widthIn: 24,
    heightIn: 18,
    backgroundColor: "#0a0a0b",
    fontFamily: "Arial",
    titleColor: "#e8a6c8",
    descriptorColor: "#9aa0a6",
    highlightColor: "#db7228",
    foamColor: "#e8a6c8",
    voidColor: "#1c1c1f",
    foamOpacity: 1,
    voidOpacity: 1,
    outlineWidthPt: 1.5,
    gapIn: 0.2,
    slots: [],
    textBox: { enabled: false, text: "", color: "#e6e6e6" },
  };
}
