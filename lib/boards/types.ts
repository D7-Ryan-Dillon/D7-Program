// A "board" is a presentation-plate layout: a grid of tiles rendered from a
// fixed axo/perspective angle, exported as print-resolution PNGs -- one page
// of the tile renders, one page of their scored descriptors (see
// lib/scoring/descriptors.ts). Kept as a plain serializable config so it can
// eventually be persisted the same way Viewer/Arrange state is.

// AxoViewKey/DEFAULT_AXO_VIEW now live in lib/faceViews.ts (the view presets
// moved there too, used by the shared lib/renderTile.ts, not just Boards) --
// re-exported here so nothing importing them from this file had to change.
import type { AxoViewKey } from "@/lib/faceViews";
export type { AxoViewKey } from "@/lib/faceViews";
export { DEFAULT_AXO_VIEW } from "@/lib/faceViews";

export interface BoardSlot {
  id: string;
  tileId: string | null;
  view: AxoViewKey;
  /** Manual override for this tile's name-tag text size, in points. Unset
   * (or null) means auto-fit. */
  nameFontSizePt: number | null;
}

export interface BoardTextBox {
  enabled: boolean;
  text: string;
  color: string;
}

/** The credit line along the bottom of the board: a rule spanning the full
 * content width, with the school logo + left-side text flush to the left
 * margin and the right-side text flush to the right margin. One color
 * covers the line, both text blocks, and the (recolored) logo together. */
export interface BoardFooter {
  enabled: boolean;
  leftText: string;
  rightText: string;
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
  /** Gap between tiles (and the caption cell), in inches -- horizontal and
   * vertical set independently so a wide board can be packed tighter in one
   * direction than the other. */
  gapXIn: number;
  gapYIn: number;
  /** Manual size overrides, in points; unset (or null) means auto-fit. */
  titleFontSizePt: number | null;
  captionFontSizePt: number | null;
  footerFontSizePt: number | null;
  slots: BoardSlot[];
  textBox: BoardTextBox;
  footer: BoardFooter;
}

export const DPI = 300;
export const MIN_TILES = 1;
export const MAX_TILES = 12;

/** How a tile's own name is shown on a board -- underscores read as
 * placeholders in a stored id, not as part of a title. */
export function displayName(name: string): string {
  return name.replace(/_/g, " ");
}

/** The name tag's own text: a tile's full stored name ("gathering_4_
 * contained_room_within_volume_V2") is far too long to read at the tag's
 * size, so only the leading category + number survives ("gathering 4").
 * Falls back to the full display name if a tile isn't named that way. */
export function shortTileLabel(name: string): string {
  const match = name.match(/^([a-zA-Z]+)_(\d+)/);
  return match ? `${match[1]} ${match[2]}` : displayName(name);
}

export function defaultBoardConfig(): BoardConfig {
  return {
    name: "Example Spaces",
    widthIn: 13.33,
    heightIn: 7.5,
    backgroundColor: "#000000",
    fontFamily: "Arkitech",
    titleColor: "#c43383",
    descriptorColor: "#9aa0a6",
    highlightColor: "#db7228",
    foamColor: "#ffffff",
    voidColor: "#c43383",
    foamOpacity: 0.1,
    voidOpacity: 1,
    outlineWidthPt: 1.5,
    gapXIn: 0.5,
    gapYIn: 0.5,
    titleFontSizePt: null,
    captionFontSizePt: null,
    footerFontSizePt: null,
    slots: [],
    textBox: { enabled: false, text: "", color: "#e6e6e6" },
    footer: { enabled: false, leftText: "DESIGN 7 | FALL 2026 | DUSTIN WHITE", rightText: "RYAN BURGESS, DILLON MITKO", color: "#ffffff" },
  };
}
