// Turns a BoardAnimation (lib/boards/exportBoard.ts) into a looping GIF.
//
// A GIF has one 256-colour table to spend. The board is a handful of flat
// colours on a plain ground, so instead of re-quantizing every frame (slow,
// and the palette would shimmer from frame to frame) this builds ONE global
// palette from a spread of sample frames, maps every frame onto it, and
// stores only the pixels that changed since the previous frame (everything
// else is the reserved transparent index, which LZW squeezes to almost
// nothing). The loop flag is set to "forever"; one revolution is all that is
// ever rendered.

import { GIFEncoder, quantize, type Palette } from "gifenc";
import type { BoardAnimation } from "./exportBoard";
import type { AnimationSettings, DitherMode } from "./types";

export interface GifResult {
  blob: Blob;
  /** Colours in the table (including the transparent slot). */
  colors: number;
  dither: DitherMode;
}

export type GifProgress = (phase: "palette" | "encode", done: number, total: number) => void;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

function readFrame(source: BoardAnimation): Uint8ClampedArray {
  const ctx = source.canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx.getImageData(0, 0, source.width, source.height).data;
}

// ---- palette ---------------------------------------------------------------

const SAMPLE_FRAMES = 8;
/** An auto palette is accepted once the pixels it cannot match exactly are
 * off by less than this on average (RGB steps out of 255) -- the steps between
 * shades of a smoothly lit surface are what show as banding, so that is what
 * is measured, not the flat background that matches exactly. */
const AUTO_ERROR_LIMIT = 2;
/** ...and ordered dithering is switched on when even the biggest palette is
 * off by more than this. */
const AUTO_DITHER_ERROR = 2.5;
const AUTO_SIZES = [32, 64, 128, 256];

/** Every other pixel of a spread of frames, concatenated. */
async function sampleFrames(source: BoardAnimation, onProgress: GifProgress, signal?: AbortSignal): Promise<Uint8Array> {
  const count = Math.min(SAMPLE_FRAMES, source.frameCount);
  const indices = Array.from(new Set(Array.from({ length: count }, (_, k) => Math.floor((k * source.frameCount) / count))));
  const perFrame = Math.ceil((source.width * source.height) / 2);
  const out = new Uint8Array(indices.length * perFrame * 4);
  let o = 0;
  for (let k = 0; k < indices.length; k++) {
    throwIfAborted(signal);
    source.renderFrame(indices[k]);
    const data = readFrame(source);
    for (let p = 0; p < data.length; p += 8) {
      out[o++] = data[p];
      out[o++] = data[p + 1];
      out[o++] = data[p + 2];
      out[o++] = 255;
    }
    onProgress("palette", k + 1, indices.length);
    await yieldToUi();
  }
  return out.subarray(0, o);
}

/** Average colour error, over the pixels that do not match exactly, of
 * mapping `sample` onto `palette`. */
function paletteError(sample: Uint8Array, palette: Palette): number {
  const nearest = makeNearest(palette);
  let sum = 0;
  let n = 0;
  // Every 4th pixel is plenty for an average.
  for (let p = 0; p < sample.length; p += 16) {
    const c = palette[nearest(sample[p], sample[p + 1], sample[p + 2])];
    const dr = sample[p] - c[0];
    const dg = sample[p + 1] - c[1];
    const db = sample[p + 2] - c[2];
    const e = (dr * dr + dg * dg + db * db) / 3;
    if (e > 0) {
      sum += e;
      n++;
    }
  }
  return Math.sqrt(sum / Math.max(n, 1));
}

interface PalettePlan {
  /** Real colours; the transparent slot is appended after them. */
  palette: Palette;
  dither: DitherMode;
}

async function planPalette(source: BoardAnimation, settings: AnimationSettings, onProgress: GifProgress, signal?: AbortSignal): Promise<PalettePlan> {
  const sample = await sampleFrames(source, onProgress, signal);
  // One slot of the table is the transparent index, so a table of N holds N-1 colours.
  if (settings.colors === "custom") return { palette: quantize(sample, Math.max(2, settings.paletteSize) - 1), dither: settings.dither };

  let chosen: { palette: Palette; error: number } | null = null;
  for (const size of AUTO_SIZES) {
    throwIfAborted(signal);
    const palette = quantize(sample, size - 1);
    const error = paletteError(sample, palette);
    chosen = { palette, error };
    if (error <= AUTO_ERROR_LIMIT) break;
    await yieldToUi();
  }
  return { palette: chosen!.palette, dither: chosen!.error > AUTO_DITHER_ERROR ? "ordered" : "none" };
}

// ---- mapping pixels onto the palette --------------------------------------

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Total swing of the ordered-dither threshold, in colour steps. */
const ORDERED_SPREAD = 32;

/** Nearest palette entry for an RGB colour, cached by its 6-6-6 bucket
 * (gifenc's own applyPalette buckets at 5-6-5, whose coarse red/blue steps
 * show as banding on smoothly lit surfaces). */
function makeNearest(palette: Palette) {
  const cache = new Int16Array(1 << 18).fill(-1);
  return (r: number, g: number, b: number): number => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache[key];
    if (hit >= 0) return hit;
    const cr = ((r >> 2) << 2) | (r >> 6);
    const cg = ((g >> 2) << 2) | (g >> 6);
    const cb = ((b >> 2) << 2) | (b >> 6);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = cr - palette[i][0];
      const dg = cg - palette[i][1];
      const db = cb - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mapFrame(rgba: Uint8ClampedArray, width: number, height: number, palette: Palette, dither: DitherMode, nearest: (r: number, g: number, b: number) => number): Uint8Array {
  const out = new Uint8Array(width * height);
  if (dither === "none") {
    for (let i = 0; i < out.length; i++) out[i] = nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    return out;
  }

  if (dither === "ordered") {
    // Position-based, so a pixel that doesn't change between frames keeps
    // its index -- unlike error diffusion, it never fights the delta frames.
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const t = ((BAYER_4[((y & 3) << 2) | (x & 3)] + 0.5) / 16 - 0.5) * ORDERED_SPREAD;
        out[i] = nearest(clamp255(rgba[i * 4] + t), clamp255(rgba[i * 4 + 1] + t), clamp255(rgba[i * 4 + 2] + t));
      }
    return out;
  }

  // Floyd-Steinberg.
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = clamp255(rgba[i * 4] + cur[(x + 1) * 3]);
      const g = clamp255(rgba[i * 4 + 1] + cur[(x + 1) * 3 + 1]);
      const b = clamp255(rgba[i * 4 + 2] + cur[(x + 1) * 3 + 2]);
      const idx = nearest(r | 0, g | 0, b | 0);
      out[i] = idx;
      const c = palette[idx];
      const er = r - c[0];
      const eg = g - c[1];
      const eb = b - c[2];
      const spread = (dx: number, buf: Float32Array, w: number) => {
        buf[dx * 3] += er * w;
        buf[dx * 3 + 1] += eg * w;
        buf[dx * 3 + 2] += eb * w;
      };
      spread(x + 2, cur, 7 / 16);
      spread(x, next, 3 / 16);
      spread(x + 1, next, 5 / 16);
      spread(x + 2, next, 1 / 16);
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
  return out;
}

// ---- encode ----------------------------------------------------------------

export async function encodeGif(source: BoardAnimation, settings: AnimationSettings, onProgress: GifProgress, signal?: AbortSignal): Promise<GifResult> {
  const plan = await planPalette(source, settings, onProgress, signal);
  const transparentIndex = plan.palette.length;
  const table: Palette = [...plan.palette, [0, 0, 0]];
  const colorDepth = Math.max(2, Math.ceil(Math.log2(table.length)));
  const nearest = makeNearest(plan.palette);
  // Delays are whole centiseconds: round the running frame times, not each
  // delay, so 30fps (33.3ms) alternates 30/30/40 instead of drifting fast.
  const frameDelay = (i: number) => Math.round(((i + 1) * 1000) / settings.fps / 10) * 10 - Math.round((i * 1000) / settings.fps / 10) * 10;

  const gif = GIFEncoder();
  let previous: Uint8Array | null = null;
  for (let i = 0; i < source.frameCount; i++) {
    throwIfAborted(signal);
    source.renderFrame(i);
    const index = mapFrame(readFrame(source), source.width, source.height, plan.palette, plan.dither, nearest);

    let pixels = index;
    if (previous) {
      pixels = new Uint8Array(index.length);
      for (let p = 0; p < index.length; p++) pixels[p] = index[p] === previous[p] ? transparentIndex : index[p];
    }
    gif.writeFrame(pixels, source.width, source.height, {
      palette: i === 0 ? table : undefined,
      delay: frameDelay(i),
      repeat: 0,
      colorDepth,
      transparent: previous !== null,
      transparentIndex,
      // Leave each frame in place: the next one only repaints what changed.
      dispose: 1,
    });
    previous = index;
    onProgress("encode", i + 1, source.frameCount);
    await yieldToUi();
  }
  gif.finish();
  return { blob: new Blob([gif.bytesView()], { type: "image/gif" }), colors: table.length, dither: plan.dither };
}
