// A lightweight auto-trace for a newly-added tile photo -- a JS port of
// the boundary-walking half of Section-Field's scripts/vectorize_tiles.py
// (the grid-boundary tracer), paired with a simple alpha/luminance
// threshold instead of that script's fuller alpha+luminance+texture+
// saturation classifier. This is only ever a *starting point*: the result
// feeds straight into the correction editor for the user to clean up, the
// same as the 48 baked tiles' own auto-trace proposals do, so it doesn't
// need to be as faithful as the original offline pipeline.

import type { SectionTrace } from "./volumeField";

const GRID = 144;
const MIN_COMPONENT_CELLS = 5;

function removeTinyComponents(mask: Uint8Array, width: number, height: number, minimum: number): Uint8Array {
  const out = mask.slice();
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const component: number[] = [];
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of neighbors) {
        if (n >= 0 && mask[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (component.length < minimum) for (const i of component) out[i] = 0;
  }
  return out;
}

/** Walks the boundary of every connected region in `mask` into one closed
 * SVG path per loop (ported from vectorize_tiles.py's boundary_path) --
 * exact edges of a pixel grid, not a smoothed curve, which reads a little
 * blocky but is a fine starting point for manual cleanup. */
function boundaryPath(mask: Uint8Array, width: number, height: number): string {
  const edges = new Map<string, [number, number][]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = edges.get(k) ?? [];
    list.push([bx, by]);
    edges.set(k, list);
  };
  const at = (x: number, y: number) => (x >= 0 && x < width && y >= 0 && y < height ? mask[y * width + x] : 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const sx = 88 / width;
  const sy = 88 / height;
  const ox = 6;
  const oy = 6;
  const commands: string[] = [];
  while (edges.size) {
    const [startKey] = edges.keys();
    const [sxCoord, syCoord] = startKey.split(",").map(Number);
    const loop: [number, number][] = [[sxCoord, syCoord]];
    let currentKey = startKey;
    for (let guard = 0; guard < (width + 1) * (height + 1) * 2; guard++) {
      const options = edges.get(currentKey);
      if (!options || !options.length) break;
      const next = options.pop()!;
      if (!options.length) edges.delete(currentKey);
      loop.push(next);
      currentKey = key(next[0], next[1]);
      if (currentKey === startKey) break;
    }
    if (loop.length >= 5 && key(loop[loop.length - 1][0], loop[loop.length - 1][1]) === startKey) {
      commands.push("M" + loop.map(([x, y]) => `${(ox + x * sx).toFixed(2)},${(oy + y * sy).toFixed(2)}`).join(" L") + " Z");
    }
  }
  return commands.join(" ");
}

/** Builds a starting SectionTrace for a newly-uploaded tile photo. Loads
 * the image, downsamples it to a working grid, and classifies each cell as
 * mass (bright/opaque) or void (dark/transparent background) -- a photo of
 * a foam model shot against a plain background, same assumption the real
 * exporter makes. */
export async function autoTraceImage(file: File): Promise<SectionTrace> {
  const bitmap = await createImageBitmap(file);
  const scale = GRID / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    mask[i] = a > 40 && luminance > 24 ? 1 : 0;
  }
  const cleaned = removeTinyComponents(mask, width, height, MIN_COMPONENT_CELLS);
  const d = boundaryPath(cleaned, width, height);

  return { width: 100, height: 100, shapes: d ? [{ d }] : [] };
}
