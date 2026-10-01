// The frame around each tile (and its name tag) in the reference boards:
// a rectangle with its top-left corner chamfered inward, and a second,
// narrower chamfer near the bottom-right where the bottom edge steps DOWN
// into a small tag that holds the tile's name -- i.e. the tag "bumps out"
// below the main rectangle rather than being cut from it. One shared
// definition so the live CSS preview and the canvas export draw the exact
// same shape.

export interface FrameMetrics {
  /** Size of the top-left chamfer, in the same units as width/height. */
  chamfer: number;
  /** X where the bottom edge steps down into the name tag. */
  tagStart: number;
  /** How tall the name tag is, carved out of the bottom of the frame
   * (the frame's own total height never changes -- see module doc). */
  tagHeight: number;
}

export function frameMetricsFor(width: number, height: number): FrameMetrics {
  const chamfer = Math.min(width, height) * 0.07;
  const tagHeight = Math.max(height * 0.13, 22);
  return { chamfer, tagStart: width * 0.62, tagHeight };
}

/** The main frame's own content area (above the name tag). */
export function frameContentHeight(height: number, metrics: FrameMetrics): number {
  return height - metrics.tagHeight;
}

export function framePoints(width: number, height: number, metrics: FrameMetrics): [number, number][] {
  const { chamfer, tagStart } = metrics;
  const mainHeight = frameContentHeight(height, metrics);
  return [
    [chamfer, 0],
    [width, 0],
    [width, height],
    [tagStart + chamfer, height],
    [tagStart, mainHeight],
    [0, mainHeight],
    [0, chamfer],
  ];
}

export function traceFrame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, metrics: FrameMetrics) {
  const points = framePoints(width, height, metrics).map(([px, py]) => [x + px, y + py] as const);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
}

/** CSS clip-path version of framePoints, in percentages so it works at any
 * element size without knowing its real rendered pixel dimensions (unlike
 * the canvas path above, which always has real pixel sizes to work with). */
export function frameClipPathPercent(chamferPercent = 7, tagStartPercent = 62, tagHeightPercent = 13): string {
  const mainH = 100 - tagHeightPercent;
  const points: [number, number][] = [
    [chamferPercent, 0],
    [100, 0],
    [100, 100],
    [tagStartPercent + chamferPercent, 100],
    [tagStartPercent, mainH],
    [0, mainH],
    [0, chamferPercent],
  ];
  return `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;
}
