// A "board" is a presentation-plate layout: a grid of tiles rendered from a
// fixed axo/perspective angle, exported as print-resolution PNGs -- one page
// of the tile renders, one page of their scored descriptors (see
// lib/scoring/descriptors.ts). Kept as a plain serializable config so it can
// eventually be persisted the same way Viewer/Arrange state is.

// AxoViewKey/DEFAULT_AXO_VIEW now live in lib/faceViews.ts (the view presets
// moved there too, used by the shared lib/renderTile.ts, not just Boards) --
// re-exported here so nothing importing them from this file had to change.
import type { AxoViewKey } from "@/lib/faceViews";
import type { ClipState } from "@/lib/clipping";
export type { AxoViewKey } from "@/lib/faceViews";
export { DEFAULT_AXO_VIEW } from "@/lib/faceViews";

/** A custom (non-preset) camera, captured when the per-tile popup editor
 * is left in free Perspective mode rather than a locked axo preset --
 * enough to reproduce the exact framing in a headless re-render. */
export interface CustomCamera {
  position: [number, number, number];
  target: [number, number, number];
  up?: [number, number, number];
}

/** `weightPt` is a print line weight in points (1pt = 1/72in) at the board's
 * own size -- so 0.25pt is a hairline on the printed board whatever DPI it
 * is exported at, and the on-screen preview shows it at its true relative
 * thickness. */
export interface OutlineSettings {
  enabled: boolean;
  color: string;
  opacity: number;
  weightPt: number;
}

export interface FacetLineSettings {
  enabled: boolean;
  color: string;
  opacity: number;
  /** Print line weight in points, like the outlines'. */
  weightPt: number;
}

/** Per-tile overrides set from the Boards tab's per-slot popup editor --
 * everything here is optional and falls back to the matching board-wide
 * BoardConfig setting when unset, exactly like `view`/`nameFontSizePt`
 * already do below. */
export interface BoardSlotOverrides {
  foamColor?: string;
  foamOpacity?: number;
  voidColor?: string;
  voidOpacity?: number;
  clip?: ClipState;
  foamOutline?: OutlineSettings;
  voidOutline?: OutlineSettings;
  facetLines?: FacetLineSettings;
  /** Only set when the popup was left in free Perspective rotation rather
   * than a locked axo preset -- takes priority over `view` when present. */
  customCamera?: CustomCamera;
}

export interface BoardSlot {
  id: string;
  tileId: string | null;
  /** Category + typology number for the label and the catalogue layout,
   * overriding what is parsed from the tile's name. */
  tag?: { category: string; number: number | null };
  /** Replaces the whole name-tag text for this tile when non-empty. */
  labelOverride?: string;
  view: AxoViewKey;
  /** Manual override for this tile's name-tag text size, in points. Unset
   * (or null) means auto-fit. */
  nameFontSizePt: number | null;
  overrides?: BoardSlotOverrides;
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

/** The little name tag hanging off each module. Geometry is a fraction of the
 * module's side, so it scales with the board. */
export type LabelMode = "short" | "typology" | "full" | "custom";
export interface NameTagSettings {
  /** How much of the module's width the tag spans (measured from the right edge). */
  widthFraction: number;
  /** The tag's height as a fraction of the module's side. */
  heightFraction: number;
  /** Text wraps to at most this many lines before it starts to shrink. */
  maxLines: number;
  /** Auto-fit never shrinks the text below this, in points. */
  minFontPt: number;
  labelMode: LabelMode;
  /** For "custom": {category} {n} {typology} {version} {name}. */
  template: string;
}

/** The descriptor page's top-N highlight. */
export interface HighlightSettings {
  enabled: boolean;
  count: number;
}

export const CATALOGUE_CATEGORIES = ["gathering", "office", "lobby"] as const;
export const CATALOGUE_COLUMNS = 5;

/** Optional 3x5 layout: a row per category, a column per typology number. */
export interface CatalogueSettings {
  enabled: boolean;
  /** Dashed placeholders for typologies with no tile yet. */
  placeholders: boolean;
  showRowLabels: boolean;
  showColumnLabels: boolean;
  rowLabels: string[];
  columnLabels: string[];
  labelColor: string;
  /** null = auto. */
  labelFontPt: number | null;
  /** Width of the row-label band (left) and height of the column-label band (top), inches. */
  rowBandIn: number;
  columnBandIn: number;
}

export type DitherMode = "none" | "ordered" | "diffusion";

/** Looping turntable export (GIF / MP4): every tile turns one full 360deg
 * about its vertical axis, starting from the view it is set to, all in sync.
 * One revolution is rendered; GIF's own loop flag (or the player's loop
 * switch for MP4) repeats it, so the seam is seamless by construction. */
export interface AnimationSettings {
  /** One file per ticked page. */
  page1: boolean;
  page2: boolean;
  spinSeconds: number;
  /** Offered: 10, 20, 30. GIF frame delays are whole centiseconds, so rates
   * that do not divide evenly (30) get alternating 30/40ms delays whose
   * running total stays on the true frame times. */
  fps: number;
  /** Output width in pixels; height follows the board's aspect ratio. */
  widthPx: number;
  /** "auto": a global palette sized from the actual frames, dithering only
   * where it visibly helps. "custom": the two settings below. */
  colors: "auto" | "custom";
  paletteSize: number;
  dither: DitherMode;
}

export const FPS_OPTIONS = [10, 20, 30] as const;

export function defaultAnimationSettings(): AnimationSettings {
  return { page1: true, page2: false, spinSeconds: 8, fps: 20, widthPx: 1000, colors: "auto", paletteSize: 128, dither: "none" };
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
  /** Board-wide master line settings for every tile's own render (not the
   * module's print frame -- see `outlineWidthPt` below for that) -- a
   * per-slot popup override can shadow these for one specific tile.
   * `foamOutline` traces the tile's outer shape (cube / hex prism edges),
   * `voidOutline` the void's silhouette, `facetLines` the foam's facet
   * edges. Default off everywhere. */
  foamOutline: OutlineSettings;
  voidOutline: OutlineSettings;
  facetLines: FacetLineSettings;
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
  animation: AnimationSettings;
  nameTag: NameTagSettings;
  highlight: HighlightSettings;
  catalogue: CatalogueSettings;
  /** Which descriptors page 2 lists, in order -- the project's carried-forward
   * criteria. Not persisted with the board (set from the project); null = all. */
  descriptorKeys?: string[] | null;
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

export function defaultNameTag(): NameTagSettings {
  return { widthFraction: 0.3136, heightFraction: 0.0716, maxLines: 2, minFontPt: 4, labelMode: "short", template: "{category} {n} - {typology}" };
}

export function defaultCatalogue(): CatalogueSettings {
  return {
    enabled: false,
    placeholders: true,
    showRowLabels: true,
    showColumnLabels: true,
    rowLabels: ["Gathering", "Office", "Lobby"],
    columnLabels: ["1", "2", "3", "4", "5"],
    labelColor: "#9aa0a6",
    labelFontPt: null,
    rowBandIn: 1.2,
    columnBandIn: 0.4,
  };
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
    foamOutline: { enabled: false, color: "#ffffff", opacity: 1, weightPt: 0.75 },
    voidOutline: { enabled: false, color: "#ffffff", opacity: 1, weightPt: 0.75 },
    facetLines: { enabled: false, color: "#ffffff", opacity: 0.4, weightPt: 0.25 },
    outlineWidthPt: 1.5,
    gapXIn: 0.5,
    gapYIn: 0.5,
    titleFontSizePt: null,
    captionFontSizePt: null,
    footerFontSizePt: null,
    slots: [],
    textBox: { enabled: false, text: "", color: "#e6e6e6" },
    footer: { enabled: false, leftText: "DESIGN 7 | FALL 2026 | DUSTIN WHITE", rightText: "RYAN BURGESS, DILLON MITKO", color: "#ffffff" },
    animation: defaultAnimationSettings(),
    nameTag: defaultNameTag(),
    highlight: { enabled: true, count: 3 },
    catalogue: defaultCatalogue(),
  };
}
